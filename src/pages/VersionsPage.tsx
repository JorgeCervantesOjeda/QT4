import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  QuerySnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import AppBrand from '../components/AppBrand'
import BackStack from '../components/BackStack'
import DataTable from '../components/DataTable'
import ErrorChecklistModal from '../components/ErrorChecklistModal'
import ModalDialog from '../components/ModalDialog'
import {
  FIRST_VERSION_NUMBER,
  isIntegerVersionNumber,
  versionNumberToString,
  type FileStorageProviderKind,
} from '../domain/types'
import { GiphyInline } from '../giphy/GiphyProvider'
import { logAudit } from '../lib/audit'
import { buildVersionsErrorChecklist } from '../lib/errorChecklistBuilders'
import {
  buildFileKey,
  deleteFileByProvider,
  downloadFileByProvider,
  getEffectiveFileStorageProviderHint,
  uploadFileUsingActiveProvider,
} from '../lib/fileStorage'
import { db } from '../lib/firebase'
import { notifyEmailUsingActiveProvider } from '../lib/notifications'
import {
  canAddCommentInWindow,
  formatApproxCountdown,
  getCommentWindowRemainingMs,
  ONE_HOUR_MS,
  REVIEW_WINDOW_MS,
  shouldAutoSetReviewed,
} from '../lib/reviewWindow'
import { formatTimeAgo } from '../lib/time'
import { normalizeFileStorageProvider } from '../lib/runtimeConfig'

type VersionSummary = {
  id: string
  number: number
  status: string
  createdBy: string
  reviewerIds: string[]
  reviewStartAt?: Date | null
  reviewEndAt?: Date | null
  hasFile: boolean
  fileRefId: string | null
  numThreads: number
  numOpenThreads: number
  numComments: number
  numThreadsWithTwoPlusComments: number
  acceptedErrorReportId: string | null
}

type DocumentSummary = {
  id: string
  projectId: string
  title: string
  createdBy: string
  type: string
  shortId: number | null
  baseDocId?: string | null
  baseVersionId?: string | null
}

type ProjectMember = {
  userId: string
  role: string
  email?: string | null
}


type FileRefSummary = {
  id: string
  fileKey: string
  fileName: string
  contentType: string
  sizeBytes: number
  isPermanent: boolean
  expireAfterDays: number | null
  storageProvider: FileStorageProviderKind
  createdBy: string
  projectId: string
  docId: string
  versionId: string
}

type ThreadSummary = {
  id: string
  status: 'open' | 'closed'
  title: string
  createdBy: string
  commentCount: number
  lastCommentAt?: Date | null
}

type CommentSummary = {
  id: string
  threadId: string
  body: string
  createdBy: string
  createdAt?: Date
}

type PendingVersionAction = 'createVersion' | 'startReview' | 'replaceFile'
type DashboardFocusTarget = 'actions' | 'file' | 'issues' | 'comments'

const toTimestampDate = (value: unknown): Date | null => {
  if( !value ) {
    return null
  }
  if( typeof value === 'object' && value && 'toDate' in value && typeof ( value as { toDate?: () => Date } ).toDate === 'function' ) {
    return ( value as { toDate: () => Date } ).toDate()
  }
  if( value instanceof Date ) {
    return value
  }
  return null
}

const hasLinkedFileMetadata = (version: Pick<VersionSummary, 'hasFile' | 'fileRefId'> | null | undefined) =>
  Boolean( version?.hasFile && version.fileRefId )

const isPermissionDeniedError = (value: unknown): boolean => {
  if( !value || typeof value !== 'object' ) {
    return false
  }
  const code = 'code' in value ? String( ( value as { code?: unknown } ).code ?? '' ) : ''
  const message = value instanceof Error ? value.message.toLowerCase() : ''
  return (
    code.includes( 'permission-denied' ) ||
    message.includes( 'permission-denied' ) ||
    message.includes( 'missing or insufficient permissions' )
  )
}

const DOWNLOAD_SLOW_NOTICE_MS = 5000
const DOWNLOAD_TIMEOUT_MS = 25000
const ISSUE_TITLE_MAX_LENGTH = 120
const normalizeIssueTitleInput = (value: string) => value.replace( /\s+/g, ' ' ).slice( 0, ISSUE_TITLE_MAX_LENGTH )

const formatStorageProviderLabel = (provider: FileStorageProviderKind | null): string => {
  if( provider === 'firebase-storage' ) {
    return 'Firebase Storage'
  }
  if( provider === 'files-api' ) {
    return 'Files API'
  }
  return 'Unknown'
}

const parseDashboardFocusTarget = (value: string | null): DashboardFocusTarget | null => {
  if( value === 'actions' || value === 'file' || value === 'issues' || value === 'comments' ) {
    return value
  }
  return null
}

const buildCommentAnchorId = (commentId: string) => `qt4-comment-${commentId}`

const toDateMs = (value?: Date | null): number | null => ( value ? value.getTime() : null )

const areStringArraysEqual = (left: string[], right: string[]) => {
  if( left.length !== right.length ) {
    return false
  }
  for( let index = 0; index < left.length; index += 1 ) {
    if( left[index] !== right[index] ) {
      return false
    }
  }
  return true
}

const areVersionsEqual = (left: VersionSummary[], right: VersionSummary[]) => {
  if( left.length !== right.length ) {
    return false
  }
  for( let index = 0; index < left.length; index += 1 ) {
    const a = left[index]
    const b = right[index]
    if(
      a.id !== b.id ||
      a.number !== b.number ||
      a.status !== b.status ||
      a.createdBy !== b.createdBy ||
      !areStringArraysEqual( a.reviewerIds, b.reviewerIds ) ||
      toDateMs( a.reviewStartAt ) !== toDateMs( b.reviewStartAt ) ||
      toDateMs( a.reviewEndAt ) !== toDateMs( b.reviewEndAt ) ||
      a.hasFile !== b.hasFile ||
      a.fileRefId !== b.fileRefId ||
      a.numThreads !== b.numThreads ||
      a.numOpenThreads !== b.numOpenThreads ||
      a.numComments !== b.numComments ||
      a.numThreadsWithTwoPlusComments !== b.numThreadsWithTwoPlusComments ||
      a.acceptedErrorReportId !== b.acceptedErrorReportId
    ) {
      return false
    }
  }
  return true
}

const areProjectMembersEqual = (left: ProjectMember[], right: ProjectMember[]) => {
  if( left.length !== right.length ) {
    return false
  }
  for( let index = 0; index < left.length; index += 1 ) {
    const a = left[index]
    const b = right[index]
    if( a.userId !== b.userId || a.role !== b.role || ( a.email ?? null ) !== ( b.email ?? null ) ) {
      return false
    }
  }
  return true
}

const areThreadsEqual = (left: ThreadSummary[], right: ThreadSummary[]) => {
  if( left.length !== right.length ) {
    return false
  }
  for( let index = 0; index < left.length; index += 1 ) {
    const a = left[index]
    const b = right[index]
    if(
      a.id !== b.id ||
      a.status !== b.status ||
      a.title !== b.title ||
      a.createdBy !== b.createdBy ||
      a.commentCount !== b.commentCount ||
      toDateMs( a.lastCommentAt ) !== toDateMs( b.lastCommentAt )
    ) {
      return false
    }
  }
  return true
}

const areCommentsByThreadEqual = (
  left: Record<string, CommentSummary[]>,
  right: Record<string, CommentSummary[]>,
) => {
  const leftKeys = Object.keys( left ).sort()
  const rightKeys = Object.keys( right ).sort()
  if( !areStringArraysEqual( leftKeys, rightKeys ) ) {
    return false
  }
  for( const key of leftKeys ) {
    const leftComments = left[key] ?? []
    const rightComments = right[key] ?? []
    if( leftComments.length !== rightComments.length ) {
      return false
    }
    for( let index = 0; index < leftComments.length; index += 1 ) {
      const a = leftComments[index]
      const b = rightComments[index]
      if(
        a.id !== b.id ||
        a.threadId !== b.threadId ||
        a.body !== b.body ||
        a.createdBy !== b.createdBy ||
        toDateMs( a.createdAt ) !== toDateMs( b.createdAt )
      ) {
        return false
      }
    }
  }
  return true
}

const areUserDirectoryEqual = (
  left: Record<string, { email?: string | null; displayName?: string | null }>,
  right: Record<string, { email?: string | null; displayName?: string | null }>,
) => {
  const leftKeys = Object.keys( left ).sort()
  const rightKeys = Object.keys( right ).sort()
  if( !areStringArraysEqual( leftKeys, rightKeys ) ) {
    return false
  }
  for( const key of leftKeys ) {
    const leftEntry = left[key] ?? {}
    const rightEntry = right[key] ?? {}
    if(
      ( leftEntry.email ?? null ) !== ( rightEntry.email ?? null ) ||
      ( leftEntry.displayName ?? null ) !== ( rightEntry.displayName ?? null )
    ) {
      return false
    }
  }
  return true
}

const formatEmailRecipientsLine = (recipients: { to: string[]; cc: string[] }) => {
  const toPart = `To: ${recipients.to.join( ', ' )}`
  const ccPart = recipients.cc.length > 0 ? ` | Cc: ${recipients.cc.join( ', ' )}` : ''
  return `${toPart}${ccPart}`
}

function VersionsPage() {
  const { docId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const userId = user?.uid ?? ''
  const navigate = useNavigate()
  const [versions, setVersions] = useState<VersionSummary[]>([] )
  const [documentData, setDocumentData] = useState<DocumentSummary | null>( null )
  const [baseDocumentData, setBaseDocumentData] = useState<{
    id: string
    title: string
    shortId: number | null
  } | null>( null )
  const [projectName, setProjectName] = useState( '' )
  const [projectShortId, setProjectShortId] = useState<number | null>( null )
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([] )
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>([] )
  const [selectedAuthorId, setSelectedAuthorId] = useState<string>( '' )
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>( null )
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>( 'idle' )
  const [uploadMessage, setUploadMessage] = useState<string>( '' )
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading'>( 'idle' )
  const [downloadMessage, setDownloadMessage] = useState<string>( '' )
  const [emailNotifyStatus, setEmailNotifyStatus] = useState<'idle' | 'sending'>( 'idle' )
  const [emailNotifyMessage, setEmailNotifyMessage] = useState<string>( '' )
  const uploadInputRef = useRef<HTMLInputElement | null>( null )
  const [selectedFileRef, setSelectedFileRef] = useState<FileRefSummary | null>( null )
  const [fileMetadataNotice, setFileMetadataNotice] = useState<string | null>( null )
  const [isErrorReportModalOpen, setIsErrorReportModalOpen] = useState( false )
  const [versionDecisionModal, setVersionDecisionModal] = useState<'accept' | 'reject' | null>( null )
  const [pendingVersionAction, setPendingVersionAction] = useState<PendingVersionAction | null>( null )
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>( null )
  const [errorReportTitle, setErrorReportTitle] = useState( '' )
  const [errorReportTitleError, setErrorReportTitleError] = useState<string | null>( null )
  const [viewMode, setViewMode] = useState<'card' | 'table'>( () => {
    const storedView = window.localStorage.getItem( 'qt4_versions_view' )
    return storedView === 'table' || storedView === 'card' ? storedView : 'card'
  } )
  const [threadsViewMode, setThreadsViewMode] = useState<'card' | 'table'>( () => {
    const storedView = window.localStorage.getItem( 'qt4_versions_threads_view' )
    return storedView === 'table' || storedView === 'card' ? storedView : 'card'
  } )
  const [commentsViewMode, setCommentsViewMode] = useState<'card' | 'table'>( () => {
    const storedView = window.localStorage.getItem( 'qt4_versions_thread_comments_view' )
    return storedView === 'table' || storedView === 'card' ? storedView : 'card'
  } )
  const [versionSorting, setVersionSorting] = useState<SortingState>( [ { id: 'number', desc: true } ] )
  const [membersSorting, setMembersSorting] = useState<SortingState>( [ { id: 'memberLabel', desc: false } ] )
  const [threadsSorting, setThreadsSorting] = useState<SortingState>( [ { id: 'title', desc: false } ] )
  const [commentsSorting, setCommentsSorting] = useState<SortingState>( [ { id: 'createdAt', desc: false } ] )
  const [isAdmin, setIsAdmin] = useState( false )
  const [isLeader, setIsLeader] = useState( false )
  const [isBusy, setIsBusy] = useState( false )
  const [isLoadingVersions, setIsLoadingVersions] = useState( true )
  const [error, setError] = useState<string | null>( null )
  const [successMessage, setSuccessMessage] = useState<string | null>( null )
  const [successEmailRecipients, setSuccessEmailRecipients] = useState<{
    to: string[]
    cc: string[]
  } | null>( null )
  const [warningMessage, setWarningMessage] = useState<string | null>( null )
  const lastErrorRef = useRef<string | null>( null )
  const successOkButtonRef = useRef<HTMLButtonElement | null>( null )
  const commentInputRef = useRef<HTMLTextAreaElement | null>( null )
  const preservedThreadNavigationScrollYRef = useRef<number | null>( null )
  const versionsActionsRef = useRef<HTMLDivElement | null>( null )
  const filePanelRef = useRef<HTMLElement | null>( null )
  const reviewIssuesPanelRef = useRef<HTMLElement | null>( null )
  const lastAppliedDashboardFocusRef = useRef<string | null>( null )
  const [userDirectoryById, setUserDirectoryById] = useState<Record<string, { email?: string | null; displayName?: string | null }>>( {} )
  const [errorReportGate, setErrorReportGate] = useState<{ isBlocking: boolean; isLoading: boolean }>({
    isBlocking: false,
    isLoading: false,
  })
  const [threads, setThreads] = useState<ThreadSummary[]>([] )
  const [visibleThreadRows, setVisibleThreadRows] = useState<ThreadSummary[]>([] )
  const [commentsByThread, setCommentsByThread] = useState<Record<string, CommentSummary[]>>( {} )
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>( null )
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>( null )
  const [pendingThreadStatusChange, setPendingThreadStatusChange] = useState<ThreadSummary | null>( null )
  const lastAppliedVersionQueryRef = useRef<string | null>( null )
  const lastAppliedThreadQueryRef = useRef<string | null>( null )
  const lastAppliedCommentQueryRef = useRef<string | null>( null )
  const [newThreadTitle, setNewThreadTitle] = useState( '' )
  const [newCommentBody, setNewCommentBody] = useState( '' )
  const [isLoadingThreads, setIsLoadingThreads] = useState( false )
  const [clockNowMs, setClockNowMs] = useState( () => Date.now() )
  const [isMembersTableCompact, setIsMembersTableCompact] = useState( () =>
    typeof window !== 'undefined' ? window.matchMedia( '(max-width: 480px)' ).matches : false,
  )
  const autoReviewUpdateRef = useRef<string | null>( null )
  const autoReviewPermissionDeniedVersionIdsRef = useRef<Set<string>>( new Set() )

  const projectIdFromQuery = searchParams.get( 'projectId' ) ?? ''
  const versionIdFromQuery = searchParams.get( 'versionId' ) ?? ''
  const threadIdFromQuery = searchParams.get( 'threadId' ) ?? ''
  const commentIdFromQuery = searchParams.get( 'commentId' ) ?? ''
  const dashboardFocusTarget = parseDashboardFocusTarget( searchParams.get( 'focus' ) )
  const projectId = documentData?.projectId ?? projectIdFromQuery
  const latestVersion = versions[0] ?? null
  const selectedVersion = selectedVersionId
    ? versions.find( ( version ) => version.id === selectedVersionId ) || latestVersion
    : latestVersion
  const selectedDownloadProvider = getEffectiveFileStorageProviderHint(
    selectedFileRef?.storageProvider ?? null,
  )
  const getVersionDownloadProvider = useCallback( (version: VersionSummary): FileStorageProviderKind | null => {
    if( selectedVersion?.id === version.id && selectedFileRef?.storageProvider ) {
      return getEffectiveFileStorageProviderHint( selectedFileRef.storageProvider )
    }
    return getEffectiveFileStorageProviderHint()
  }, [ selectedVersion?.id, selectedFileRef?.storageProvider ] )
  const documentAuthorId = documentData?.createdBy ?? ''
  const latestAuthorId = latestVersion?.createdBy ?? documentAuthorId
  const isSelectedAuthor = Boolean(
    userId && ( selectedVersion ? selectedVersion.createdBy === userId : documentAuthorId === userId ),
  )
  const isLatestAuthor = Boolean( userId && latestAuthorId && latestAuthorId === userId )
  const canManageLatestVersion = isLatestAuthor || isLeader || isAdmin
  const canApproveVersion = isLatestAuthor || isLeader || isAdmin
  const canCreateVersionActor = isLatestAuthor || isLeader || isAdmin
  const isReviewer = Boolean( selectedVersion && selectedVersion.reviewerIds.includes( userId ) )
  const canParticipateReview = isSelectedAuthor || isLeader || isReviewer || isAdmin
  const latestVersionInReviewed = Boolean( latestVersion && latestVersion.status === 'Reviewed' )
  const latestVersionInAccepted = Boolean( latestVersion && latestVersion.status === 'Accepted' )
  const selectedVersionInReview = Boolean( selectedVersion && selectedVersion.status === 'In Review' )
  const selectedThread = selectedThreadId
    ? threads.find( ( thread ) => thread.id === selectedThreadId ) ?? null
    : null
  const selectedThreadOpen = Boolean( selectedThread && selectedThread.status === 'open' )
  const selectedThreadComments = useMemo(
    () => ( selectedThreadId ? commentsByThread[selectedThreadId] ?? [] : [] ),
    [ selectedThreadId, commentsByThread ],
  )
  const getLatestCommentAtFromList = useCallback( (comments: CommentSummary[]) =>
    comments.reduce<Date | null>(
      ( latest, comment ) => {
        if( !comment.createdAt ) {
          return latest
        }
        if( !latest || comment.createdAt.getTime() > latest.getTime() ) {
          return comment.createdAt
        }
        return latest
      },
      null,
    ), [] )
  const getThreadLatestCommentAt = useCallback( (thread?: Pick<ThreadSummary, 'id' | 'lastCommentAt'> | null) => {
    if( !thread ) {
      return null
    }
    const fromThread = thread.lastCommentAt ?? null
    if( fromThread ) {
      return fromThread
    }
    return getLatestCommentAtFromList( commentsByThread[thread.id] ?? [] )
  }, [ commentsByThread, getLatestCommentAtFromList ] )
  const selectedThreadLatestCommentAt = useMemo(
    () => getThreadLatestCommentAt( selectedThread ),
    [ selectedThread, getThreadLatestCommentAt ],
  )
  const latestVersionIsSelected = Boolean( latestVersion && selectedVersion && latestVersion.id === selectedVersion.id )
  const latestSelectedVersionCommentAt = useMemo( () => {
    const comments = Object.values( commentsByThread ).flat()
    return comments.reduce<Date | null>( ( latest, comment ) => {
      if( !comment.createdAt ) {
        return latest
      }
      if( !latest || comment.createdAt.getTime() > latest.getTime() ) {
        return comment.createdAt
      }
      return latest
    }, null )
  }, [ commentsByThread ] )
  const selectedVersionRecentCommentGraceRemainingMs = useMemo( () => {
    if( !selectedVersion?.reviewEndAt || !latestSelectedVersionCommentAt ) {
      return 0
    }
    if( selectedVersion.reviewEndAt.getTime() > clockNowMs ) {
      return 0
    }
    const remainingMs = ONE_HOUR_MS - ( clockNowMs - latestSelectedVersionCommentAt.getTime() )
    return remainingMs > 0 ? remainingMs : 0
  }, [ selectedVersion?.reviewEndAt, latestSelectedVersionCommentAt, clockNowMs ] )
  const selectedVersionGraceRemainingMs = useMemo( () => {
    if( !selectedVersion || selectedVersion.status !== 'In Review' || !selectedVersion.reviewEndAt ) {
      return 0
    }
    if( selectedVersion.reviewEndAt.getTime() > clockNowMs ) {
      return 0
    }
    return threads.reduce( ( maxRemaining, thread ) => {
      if( thread.status !== 'open' ) {
        return maxRemaining
      }
      const remainingMs = getCommentWindowRemainingMs(
        selectedVersion.status,
        selectedVersion.reviewEndAt,
        getThreadLatestCommentAt( thread ),
        clockNowMs,
      )
      if( remainingMs === null || remainingMs <= 0 ) {
        return maxRemaining
      }
      return Math.max( maxRemaining, remainingMs )
    }, 0 )
  }, [ selectedVersion, threads, clockNowMs, getThreadLatestCommentAt ] )
  const selectedVersionHasGraceIssues = selectedVersionGraceRemainingMs > 0
  const selectedVersionReviewGraceRemainingMs = Math.max(
    selectedVersionGraceRemainingMs,
    selectedVersionRecentCommentGraceRemainingMs,
  )
  const selectedVersionHasReviewGrace = selectedVersionReviewGraceRemainingMs > 0
  const selectedVersionInActiveReview = Boolean(
    selectedVersion &&
    selectedVersion.status === 'In Review' &&
    (
      !selectedVersion.reviewEndAt ||
      selectedVersion.reviewEndAt.getTime() > clockNowMs ||
      selectedVersionHasGraceIssues
    ),
  )
  const latestVersionInReviewDecisionWindow = Boolean(
    latestVersion &&
    (
      latestVersion.status === 'In Review' ||
      ( latestVersion.status === 'Reviewed' && latestVersionIsSelected && selectedVersionHasReviewGrace )
    ) &&
    (
      !latestVersion.reviewEndAt ||
      latestVersion.reviewEndAt.getTime() > clockNowMs ||
      ( latestVersionIsSelected && selectedVersionHasReviewGrace )
    ),
  )
  const canCreateThread = Boolean(
    selectedVersion &&
    selectedVersionInActiveReview &&
    canParticipateReview &&
    newThreadTitle.trim().length > 0,
  )
  const canAddComment = Boolean(
    selectedVersion &&
    selectedThread &&
    canAddCommentInWindow( {
      versionStatus: selectedVersion.status,
      reviewEndAt: selectedVersion.reviewEndAt,
      threadStatus: selectedThread.status,
      lastThreadCommentAt: selectedThreadLatestCommentAt,
      canParticipate: canParticipateReview,
      hasBody: newCommentBody.trim().length > 0,
      nowMs: clockNowMs,
    } ),
  )
  const getThreadCommentWindowMeta = useCallback(
    (thread?: Pick<ThreadSummary, 'id' | 'status' | 'lastCommentAt'> | null) => {
      if( !selectedVersion ) {
        return { label: 'Unavailable', state: 'unavailable' as const }
      }
      if( selectedVersion.status !== 'In Review' ) {
        return { label: 'Closed (version is not In Review)', state: 'expired' as const }
      }
      if( thread?.status !== 'open' ) {
        return { label: 'Closed issue', state: 'closed' as const }
      }
      if( !selectedVersion.reviewEndAt ) {
        return { label: 'No expiration configured', state: 'active' as const }
      }
      const remainingMs = getCommentWindowRemainingMs(
        selectedVersion.status,
        selectedVersion.reviewEndAt,
        getThreadLatestCommentAt( thread ),
        clockNowMs,
      )
      if( remainingMs === null ) {
        return { label: 'Unavailable', state: 'unavailable' as const }
      }
      if( selectedVersion.reviewEndAt.getTime() > clockNowMs ) {
        return { label: formatApproxCountdown( remainingMs ), state: 'active' as const }
      }
      if( remainingMs <= 0 ) {
        return { label: 'Expired', state: 'expired' as const }
      }
      return { label: `Grace ${formatApproxCountdown( remainingMs )}`, state: 'grace' as const }
    },
    [ selectedVersion, clockNowMs, getThreadLatestCommentAt ],
  )
  const commentWindowCountdownLabel = useMemo( () => {
    if( !selectedVersion || !selectedThread ) {
      return null
    }
    const meta = getThreadCommentWindowMeta( selectedThread )
    return `Selected issue comment window: ${meta.label}.`
  }, [ selectedVersion, selectedThread, getThreadCommentWindowMeta ] )
  const selectedCommentWindowState = useMemo( () => {
    if( !selectedVersion || !selectedThread ) {
      return 'unavailable' as const
    }
    return getThreadCommentWindowMeta( selectedThread ).state
  }, [ selectedVersion, selectedThread, getThreadCommentWindowMeta ] )
  const hasSelectedVersionComments = useMemo(
    () => Object.values( commentsByThread ).some( ( threadComments ) => threadComments.length > 0 ),
    [ commentsByThread ],
  )
  const formatUserLabel = useCallback( (memberUserId: string) => {
    const entry = userDirectoryById[memberUserId]
    const memberEntry = projectMembers.find( ( member ) => member.userId === memberUserId )
    const displayName =
      entry?.displayName ??
      ( memberUserId === userId ? user?.displayName ?? '' : '' )
    const email =
      entry?.email ??
      memberEntry?.email ??
      ( memberUserId === userId ? user?.email ?? '' : '' )
    if( displayName && email ) {
      return `${displayName} (${email})`
    }
    if( displayName ) {
      return displayName
    }
    if( email ) {
      return email
    }
    return 'Unknown user'
  }, [ userDirectoryById, projectMembers, userId, user?.displayName, user?.email ] )

  const orderedThreads = useMemo(
    () => ( threadsViewMode === 'table' ? visibleThreadRows : threads ),
    [ threadsViewMode, visibleThreadRows, threads ],
  )
  const selectedThreadIndex = useMemo(
    () => orderedThreads.findIndex( ( thread ) => thread.id === selectedThreadId ),
    [ orderedThreads, selectedThreadId ],
  )
  const hasPreviousThread = selectedThreadIndex > 0
  const hasNextThread = selectedThreadIndex >= 0 && selectedThreadIndex < orderedThreads.length - 1
  const threadNavigationStatusLabel = selectedThreadIndex >= 0
    ? `Issue ${selectedThreadIndex + 1} of ${orderedThreads.length}`
    : 'Selected issue is hidden by the current table filters.'

  const resolveUserEmail = useCallback( (memberUserId: string): string | null => {
    const entry = userDirectoryById[memberUserId]
    const memberEntry = projectMembers.find( ( member ) => member.userId === memberUserId )
    const email =
      entry?.email ??
      memberEntry?.email ??
      ( memberUserId === userId ? user?.email ?? '' : '' )
    return email?.trim() ? email.trim() : null
  }, [ userDirectoryById, projectMembers, userId, user?.email ] )

  const membersTableRows = useMemo(
    () =>
      projectMembers.map( ( member ) => {
        const isAuthor = selectedAuthorId === member.userId
        const isReviewer = selectedReviewerIds.includes( member.userId ) && !isAuthor
        return {
          userId: member.userId,
          role: member.role,
          memberLabel: formatUserLabel( member.userId ),
          statusLabel: isAuthor ? 'Author' : isReviewer ? 'Reviewer' : 'Not assigned',
          isAuthor,
          isReviewer,
        }
      } ),
    [ projectMembers, selectedAuthorId, selectedReviewerIds, formatUserLabel ],
  )

  const formatFileSize = (sizeBytes: number) => {
    if( !Number.isFinite( sizeBytes ) ) {
      return 'Unknown size'
    }
    if( sizeBytes < 1024 ) {
      return `${sizeBytes} B`
    }
    if( sizeBytes < 1024 * 1024 ) {
      return `${( sizeBytes / 1024 ).toFixed( 1 )} KB`
    }
    return `${( sizeBytes / ( 1024 * 1024 ) ).toFixed( 1 )} MB`
  }

  const normalizeDownloadError = (rawMessage: string) => {
    const lowered = rawMessage.toLowerCase()
    if( lowered.includes( 'action blocked' ) || lowered.includes( '(403)' ) || lowered.includes( ' 403' ) ) {
      return 'Download blocked by Files API authorization (Action blocked).'
    }
    return rawMessage
  }

  const executeDownloadWithTimeout = async (
    action: () => Promise<void>,
    options: {
      attemptId?: string
      timeoutMessage?: string
      onSlowNotice?: () => void
    } = {},
  ) => {
    const attemptId = options.attemptId ?? `${Date.now()}-${Math.random().toString( 36 ).slice( 2, 8 )}`
    const startedAt = Date.now()
    let timeoutId: number | undefined
    let slowNoticeId: number | undefined
    let slowNoticeShown = false
    console.info( '[download][start]', {
      attemptId,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      slowNoticeMs: DOWNLOAD_SLOW_NOTICE_MS,
    } )
    try {
      slowNoticeId = window.setTimeout( () => {
        slowNoticeShown = true
        options.onSlowNotice?.()
        console.info( '[download][slow_notice]', {
          attemptId,
          elapsedMs: Date.now() - startedAt,
        } )
      }, DOWNLOAD_SLOW_NOTICE_MS )
      await Promise.race( [
        action(),
        new Promise<never>( ( _, reject ) => {
          timeoutId = window.setTimeout( () => {
            reject(
              new Error(
                options.timeoutMessage ??
                'Download failed (timeout): the server took too long to respond.',
              ),
            )
          }, DOWNLOAD_TIMEOUT_MS )
        } ),
      ] )
      console.info( '[download][success]', {
        attemptId,
        elapsedMs: Date.now() - startedAt,
        slowNoticeShown,
      } )
    } catch( err ) {
      console.warn( '[download][error]', {
        attemptId,
        elapsedMs: Date.now() - startedAt,
        slowNoticeShown,
        message: err instanceof Error ? err.message : String( err ),
      } )
      throw err
    } finally {
      if( timeoutId !== undefined ) {
        window.clearTimeout( timeoutId )
      }
      if( slowNoticeId !== undefined ) {
        window.clearTimeout( slowNoticeId )
      }
    }
  }

  const handleDownloadVersionFile = useCallback( async (version: VersionSummary) => {
    setError( null )
    setSuccessMessage( null )
    setDownloadStatus( 'downloading' )
    setDownloadMessage( 'Preparing download...' )
    const attemptId = `${Date.now()}-${Math.random().toString( 36 ).slice( 2, 8 )}`
    const metadataStartedAt = Date.now()
    try {
      if( !version.fileRefId ) {
        throw new Error(
          'Cannot download this file: version metadata is incomplete (fileRefId is missing). Please re-upload/replace the file for this version.',
        )
      }
      let fileKey = ''
      let fileName = `version-${versionNumberToString( version.number )}`
      let storageProvider: FileStorageProviderKind = 'files-api'

      if( version.fileRefId ) {
        const fileSnapshot = await getDoc( doc( db, 'files', version.fileRefId ) )
        if( fileSnapshot.exists() ) {
          const fileData = fileSnapshot.data()
          fileKey = ( fileData.fileKey as string | undefined ) ?? ''
          fileName = ( fileData.fileName as string | undefined ) ?? fileName
          storageProvider = normalizeFileStorageProvider( fileData.storageProvider )
        }
      }
      console.info( '[download][metadata_resolved]', {
        attemptId,
        versionId: version.id,
        versionNumber: version.number,
        fileRefId: version.fileRefId,
        fileKey,
        storageProvider,
        elapsedMs: Date.now() - metadataStartedAt,
      } )

      if( !fileKey ) {
        throw new Error( 'Cannot download this file: linked file metadata is missing file key.' )
      }
      setDownloadMessage( 'Downloading file...' )
      await executeDownloadWithTimeout(
        () => downloadFileByProvider( fileKey, fileName, storageProvider ),
        {
          attemptId,
          timeoutMessage: 'Download failed (timeout): the server took too long to respond.',
          onSlowNotice: () => setDownloadMessage( 'Still downloading from the server...' ),
        },
      )
    } catch( err ) {
      const rawMessage = err instanceof Error ? err.message : 'Unexpected error'
      setError( normalizeDownloadError( rawMessage ) )
    } finally {
      setDownloadStatus( 'idle' )
      setDownloadMessage( '' )
    }
  }, [] )

  const requestDownloadVersionFile = useCallback( (version: VersionSummary) => {
    if( downloadStatus === 'downloading' ) {
      return
    }
    if( !userId ) {
      setError( 'Sign in before downloading a file.' )
      return
    }
    if( !hasLinkedFileMetadata( version ) ) {
      setError( 'No file is linked to this version.' )
      return
    }
    void handleDownloadVersionFile( version )
  }, [ userId, handleDownloadVersionFile, downloadStatus ] )

  const statusClassName = (status?: string | null) => {
    switch( status ) {
      case 'In Creation':
        return 'status-card--in-creation'
      case 'In Review':
        return 'status-card--in-review'
      case 'Reviewed':
        return 'status-card--reviewed'
      case 'Accepted':
        return 'status-card--accepted'
      case 'Rejected':
        return 'status-card--rejected'
      case 'Replaced':
        return 'status-card--replaced'
      default:
        return ''
    }
  }

  const allowedReviewerIds = useMemo(
    () =>
      projectMembers
        .map( ( member ) => member.userId )
        .filter( ( memberId ) => Boolean( memberId ) && memberId !== selectedVersion?.createdBy ),
    [ projectMembers, selectedVersion?.createdBy ],
  )

  const createButtonLabel = useMemo(
    () => ( versions.length === 0 ? 'Create initial version' : 'Create next version' ),
    [ versions.length ],
  )

  const canCreateVersion = useMemo( () => {
    if( !canCreateVersionActor ) {
      return false
    }
    if( versions.length === 0 ) {
      return true
    }
    if( !latestVersion ) {
      return false
    }
    if( latestVersion.status === 'In Review' || latestVersion.status === 'Reviewed' ) {
      return true
    }
    if( latestVersion.status === 'Accepted' ) {
      return !errorReportGate.isBlocking && !errorReportGate.isLoading
    }
    return false
  }, [ canCreateVersionActor, versions.length, latestVersion, errorReportGate ] )

  const canAssignReviewers = useMemo(
    () => Boolean( selectedVersion && selectedVersion.status === 'In Creation' && ( isSelectedAuthor || isLeader || isAdmin ) ),
    [ selectedVersion, isSelectedAuthor, isLeader, isAdmin ],
  )

  const canUploadFile = useMemo(
    () => Boolean( selectedVersion && selectedVersion.status === 'In Creation' && ( isSelectedAuthor || isLeader || isAdmin ) ),
    [ selectedVersion, isSelectedAuthor, isLeader, isAdmin ],
  )

  const canAssignAuthor = useMemo(
    () => Boolean( selectedVersion && selectedVersion.status === 'In Creation' && ( isLeader || isAdmin ) ),
    [ selectedVersion, isLeader, isAdmin ],
  )

  const isProjectMemberUser = useMemo(
    () => Boolean( userId && projectMembers.some( ( member ) => member.userId === userId ) ),
    [ projectMembers, userId ],
  )

  const canCreateErrorReportActor = isProjectMemberUser || isAdmin

  const canStartReview = useMemo(
    () =>
      Boolean(
        latestVersion &&
          latestVersion.status === 'In Creation' &&
          hasLinkedFileMetadata( latestVersion ) &&
          latestVersion.reviewerIds.length > 0 &&
          canManageLatestVersion,
      ),
    [ latestVersion, canManageLatestVersion ],
  )

  const canAcceptOrReject = useMemo(
    () =>
      Boolean(
        latestVersion &&
          latestVersionInReviewDecisionWindow &&
          latestVersion.hasFile &&
          latestVersion.numThreads > 0 &&
          latestVersion.numThreadsWithTwoPlusComments > 0 &&
          latestVersion.numOpenThreads === 0 &&
          canApproveVersion,
      ),
    [ latestVersion, latestVersionInReviewDecisionWindow, canApproveVersion ],
  )

  const errorChecklist = useMemo( () => buildVersionsErrorChecklist( error, {
    docSelected: Boolean( docId && documentData ),
    userSignedIn: Boolean( userId ),
    networkAvailable: typeof navigator !== 'undefined' ? navigator.onLine : true,
    hasAnyVersion: versions.length > 0,
    userIsProjectLeader: isLeader,
    userIsDocumentAuthor: Boolean( userId && documentAuthorId && userId === documentAuthorId ),
    userIsLatestVersionAuthor: isLatestAuthor,
    userIsSelectedVersionAuthor: isSelectedAuthor,
    userIsReviewer: isReviewer,
    userIsAdmin: isAdmin,
    hasLatestVersion: Boolean( latestVersion ),
    latestVersionInReview: latestVersionInReviewDecisionWindow,
    latestVersionInReviewed,
    latestVersionInCreation: Boolean( selectedVersion && selectedVersion.status === 'In Creation' ),
    latestVersionInAccepted,
    selectedVersionInCreation: Boolean( selectedVersion && selectedVersion.status === 'In Creation' ),
    selectedVersionInActiveReview,
    selectedVersionCommentWindowOpen: Boolean(
      selectedVersion &&
      selectedThread &&
      canAddCommentInWindow( {
        versionStatus: selectedVersion.status,
        reviewEndAt: selectedVersion.reviewEndAt,
        threadStatus: selectedThread.status,
        lastThreadCommentAt: selectedThreadLatestCommentAt,
        canParticipate: canParticipateReview,
        hasBody: true,
        nowMs: clockNowMs,
      } ),
    ),
    latestVersionHasFile: hasLinkedFileMetadata( latestVersion ),
    latestVersionHasReviewer: Boolean( latestVersion && latestVersion.reviewerIds.length > 0 ),
    latestVersionHasIssues: Boolean( latestVersion && latestVersion.numThreads > 0 ),
    latestVersionHasIssueWithAtLeastTwoComments: Boolean( latestVersion && latestVersion.numThreadsWithTwoPlusComments > 0 ),
    latestVersionNoOpenIssues: Boolean( latestVersion && latestVersion.numOpenThreads === 0 ),
    hasAcceptedRelatedErrorReport: latestVersionInAccepted && !errorReportGate.isBlocking && !errorReportGate.isLoading,
    selectedVersionIsLatest: Boolean( selectedVersion && latestVersion && selectedVersion.id === latestVersion.id ),
    selectedVersionInReview,
    selectedThreadOpen,
    selectedIssueHasAtLeastTwoComments: Boolean( selectedThread && selectedThread.commentCount >= 2 ),
    hasSelectedVersion: Boolean( selectedVersion ),
    selectedVersionHasFile: hasLinkedFileMetadata( selectedVersion ),
    issueTitleProvided: newThreadTitle.trim().length > 0,
    hasSelectedThread: Boolean( selectedThread ),
    commentBodyProvided: newCommentBody.trim().length > 0,
  } ), [
    error,
    docId,
    documentData,
    userId,
    versions.length,
    isLeader,
    documentAuthorId,
    isLatestAuthor,
    isSelectedAuthor,
    isReviewer,
    isAdmin,
    latestVersion,
    latestVersionInReviewDecisionWindow,
    latestVersionInReviewed,
    latestVersionInAccepted,
    errorReportGate.isBlocking,
    errorReportGate.isLoading,
    selectedVersion,
    selectedVersionInReview,
    selectedVersionInActiveReview,
    selectedThreadLatestCommentAt,
    canParticipateReview,
    clockNowMs,
    selectedThreadOpen,
    newThreadTitle,
    selectedThread,
    newCommentBody,
  ] )

  const versionColumns = useMemo<ColumnDef<VersionSummary>[]>( () => [
    {
      header: 'Version',
      accessorKey: 'number',
      cell: ( info ) => versionNumberToString( info.getValue<number>() ),
    },
    {
      header: 'Status',
      accessorKey: 'status',
    },
    {
      header: 'Author',
      accessorKey: 'createdBy',
      cell: ( info ) => formatUserLabel( info.getValue<string>() ),
    },
    {
      header: 'Reviewers',
      accessorKey: 'reviewerIds',
      cell: ( info ) => String( ( info.getValue<string[]>() ?? [] ).length ),
    },
    {
      header: 'Uploaded',
      accessorKey: 'hasFile',
      cell: ( info ) => {
        const version = info.row.original
        if( !version.hasFile ) {
          return 'No'
        }
        if( !version.fileRefId ) {
          return 'Missing metadata'
        }
        return (
          <div className="actions actions--inline">
            <span>Yes</span>
            <button
              type="button"
              onClick={( event ) => {
                event.stopPropagation()
                requestDownloadVersionFile( version )
              }}
              disabled={isBusy || downloadStatus === 'downloading'}
            >
              Download
            </button>
            <span className="download-provider-hint">
              {`From: ${formatStorageProviderLabel( getVersionDownloadProvider( version ) )}`}
            </span>
          </div>
        )
      },
    },
    {
      header: 'Review time left',
      id: 'reviewTimeLeft',
      cell: ( info ) => {
        const version = info.row.original
        if( version.status !== 'In Review' ) {
          return '-'
        }
        if( !version.reviewEndAt ) {
          return 'No expiration'
        }
        const remainingMs = version.reviewEndAt.getTime() - clockNowMs
        if( remainingMs <= 0 ) {
          return 'Expired'
        }
        return formatApproxCountdown( remainingMs )
      },
    },
  ], [ formatUserLabel, clockNowMs, requestDownloadVersionFile, isBusy, downloadStatus, getVersionDownloadProvider ] )

  const commentColumns = useMemo<ColumnDef<CommentSummary>[]>( () => [
    {
      header: 'Author',
      accessorKey: 'createdBy',
      cell: ( info ) => formatUserLabel( info.getValue<string>() ),
    },
    {
      header: 'Comment',
      accessorKey: 'body',
    },
    {
      header: 'When',
      accessorKey: 'createdAt',
      cell: ( info ) => {
        const value = info.getValue<Date | undefined>()
        return value ? formatTimeAgo( value ) : '-'
      },
    },
  ], [ formatUserLabel ] )


  const loadDocumentAndVersions = useCallback( async () => {
    if( !docId ) {
      return
    }
    let step = 'start'
    setError( null )
    setIsBusy( true )
    // Reset gate early to avoid stale checklist values while a new document/version load is in-flight.
    setErrorReportGate( { isBlocking: true, isLoading: true } )
    try {

      step = 'document'
      const documentSnapshot = await getDocFromServer( doc( db, 'documents', docId ) )
      if( !documentSnapshot.exists() ) {
        setDocumentData( null )
        setVersions( [] )
        setError( 'Document not found.' )
        return
      }

      const documentRaw = documentSnapshot.data()
      const loadedProjectId = ( documentRaw.projectId as string ) ?? projectIdFromQuery
      const loadedAuthorId = ( documentRaw.createdBy as string ) ?? ( documentRaw.authorId as string ) ?? ''
      const detectedShortId = Number.isFinite( documentRaw.shortId ) ? Number( documentRaw.shortId ) : null
      const loadedType = ( documentRaw.type as string | undefined ) ?? 'document'
      const loadedBaseDocId = ( documentRaw.baseDocId as string | undefined ) ?? null
      const loadedBaseVersionId = ( documentRaw.baseVersionId as string | undefined ) ?? null
      setDocumentData( {
        id: documentSnapshot.id,
        projectId: loadedProjectId,
        title: ( documentRaw.title as string ) ?? 'Untitled document',
        createdBy: loadedAuthorId,
        type: loadedType,
        shortId: detectedShortId,
        baseDocId: loadedBaseDocId,
        baseVersionId: loadedBaseVersionId,
      } )
      if( loadedType === 'errorReport' && ( !loadedBaseDocId || !loadedBaseVersionId ) ) {
        setVersions( [] )
        setBaseDocumentData( null )
        setError( 'Invalid error report data: baseDocId and baseVersionId are required.' )
        return
      }

      step = 'versions-members'
      const baseDocId = loadedBaseDocId
      const baseVersionId = loadedBaseVersionId
      const [ versionsSnapshot, membersSnapshot, projectSnapshot, baseDocumentSnapshot ] = await Promise.all( [
        getDocs(
          query(
            collection( db, 'versions' ),
            where( 'projectId', '==', loadedProjectId ),
            where( 'docId', '==', docId ),
            orderBy( 'number', 'desc' ),
          ),
        ),
        getDocs(
          query(
            collection( db, 'projectMembers' ),
            where( 'projectId', '==', loadedProjectId ),
          ),
        ),
        loadedProjectId ? getDocFromServer( doc( db, 'projects', loadedProjectId ) ) : Promise.resolve( null ),
        baseDocId ? getDocFromServer( doc( db, 'documents', baseDocId ) ) : Promise.resolve( null ),
      ] )

      const nextVersions = versionsSnapshot.docs.map( ( versionSnapshot ) => {
        const data = versionSnapshot.data()
        const stats = ( data.stats as {
          numThreads?: number
          numOpenThreads?: number
          numComments?: number
          numThreadsWithTwoPlusComments?: number
        } | undefined ) ?? {}
        return {
          id: versionSnapshot.id,
          number: Number( data.number ?? FIRST_VERSION_NUMBER ),
          status: ( data.status as string ) ?? 'In Creation',
          createdBy: ( data.createdBy as string ) ?? '',
          reviewerIds: ( data.reviewerIds as string[] | undefined ) ?? [],
          reviewStartAt: toTimestampDate( data.reviewStartAt ),
          reviewEndAt: toTimestampDate( data.reviewEndAt ),
          hasFile: Boolean( data.hasFile ),
          fileRefId: ( data.fileRefId as string | null | undefined ) ?? null,
          numThreads: Number( stats.numThreads ?? data.numThreads ?? 0 ),
          numOpenThreads: Number( stats.numOpenThreads ?? data.numOpenThreads ?? 0 ),
          numComments: Number( stats.numComments ?? data.numComments ?? 0 ),
          numThreadsWithTwoPlusComments: Number( stats.numThreadsWithTwoPlusComments ?? data.numThreadsWithTwoPlusComments ?? 0 ),
          acceptedErrorReportId: ( data.acceptedErrorReportId as string | null | undefined ) ?? null,
        }
      } )
      const latestVersionLocal = nextVersions[0] ?? null
      setVersions( ( previous ) => ( areVersionsEqual( previous, nextVersions ) ? previous : nextVersions ) )

      const members = membersSnapshot.docs.map( ( memberSnapshot ) => {
        const data = memberSnapshot.data()
        return {
          userId: ( data.userId as string ) ?? '',
          role: ( data.role as string ) ?? '',
          email: ( data.email as string | null | undefined ) ?? null,
        }
      } )
      setProjectMembers( ( previous ) =>
        areProjectMembersEqual( previous, members ) ? previous : members,
      )
      if( projectSnapshot && 'exists' in projectSnapshot && projectSnapshot.exists() ) {
        const projectData = projectSnapshot.data()
        setProjectName( ( projectData?.name as string | undefined ) ?? '' )
        setProjectShortId( Number.isFinite( projectData?.shortId ) ? Number( projectData?.shortId ) : null )
      } else {
        setProjectName( '' )
        setProjectShortId( null )
      }
      if( baseDocumentSnapshot && 'exists' in baseDocumentSnapshot && baseDocumentSnapshot.exists() ) {
        const baseData = baseDocumentSnapshot.data()
        setBaseDocumentData( {
          id: baseDocumentSnapshot.id,
          title: ( baseData?.title as string | undefined ) ?? 'Untitled document',
          shortId: Number.isFinite( baseData?.shortId ) ? Number( baseData?.shortId ) : null,
        } )
      } else if( baseVersionId ) {

        try {
          const baseVersionSnapshot = await getDocFromServer( doc( db, 'versions', baseVersionId ) )
          if( baseVersionSnapshot.exists() ) {
            const baseVersionData = baseVersionSnapshot.data()
            const resolvedBaseDocId = ( baseVersionData?.docId as string | undefined ) ?? ''
            if( resolvedBaseDocId ) {
              const baseDocSnapshot = await getDocFromServer( doc( db, 'documents', resolvedBaseDocId ) )
              if( baseDocSnapshot.exists() ) {
                const baseDocData = baseDocSnapshot.data()
                setBaseDocumentData( {
                  id: baseDocSnapshot.id,
                  title: ( baseDocData?.title as string | undefined ) ?? 'Untitled document',
                  shortId: Number.isFinite( baseDocData?.shortId ) ? Number( baseDocData?.shortId ) : null,
                } )
              } else {

                setBaseDocumentData( null )
              }
            } else {

              setBaseDocumentData( null )
            }
          } else {

            setBaseDocumentData( null )
          }
        } catch {

          setBaseDocumentData( null )
        }
      } else {

        setBaseDocumentData( null )
      }
      const allowedMemberIds = members.map( ( member ) => member.userId ).filter( Boolean )
      // Keep the version chosen in the UI when reloading data after mutations
      // (e.g. assigning reviewers). Query param should only work as fallback.
      const activeVersion =
        ( selectedVersionId
          ? nextVersions.find( ( version ) => version.id === selectedVersionId ) || null
          : null ) ??
        ( versionIdFromQuery
          ? nextVersions.find( ( version ) => version.id === versionIdFromQuery ) || null
          : null ) ?? nextVersions[0] ?? null
      const latestCreatedBy = activeVersion?.createdBy ?? ''
      const nextReviewerIds = ( activeVersion?.reviewerIds ?? [] ).filter( ( reviewerId ) =>
        allowedMemberIds.includes( reviewerId ) && reviewerId !== latestCreatedBy,
      )
      setSelectedReviewerIds( ( previous ) =>
        areStringArraysEqual( previous, nextReviewerIds ) ? previous : nextReviewerIds,
      )
      setSelectedAuthorId( ( previous ) => ( previous === latestCreatedBy ? previous : latestCreatedBy ) )
      setSelectedVersionId( ( previous ) => ( previous === ( activeVersion?.id ?? null ) ? previous : activeVersion?.id ?? null ) )

      const directoryCandidates = new Set<string>()
      members.forEach( ( member ) => {
        if( member.userId ) {
          directoryCandidates.add( member.userId )
        }
      } )
      if( loadedAuthorId ) {
        directoryCandidates.add( loadedAuthorId )
      }
      nextVersions.forEach( ( versionItem ) => {
        if( versionItem.createdBy ) {
          directoryCandidates.add( versionItem.createdBy )
        }
        versionItem.reviewerIds.forEach( ( reviewerId ) => {
          if( reviewerId ) {
            directoryCandidates.add( reviewerId )
          }
        } )
      } )

      const candidateList = Array.from( directoryCandidates )
      step = 'user-directory'
      const nextDirectoryById: Record<string, { email?: string | null; displayName?: string | null }> = {}
      members.forEach( ( member ) => {
        if( member.userId && member.email ) {
          nextDirectoryById[member.userId] = {
            email: member.email,
            displayName: null,
          }
        }
      } )
      const chunks: string[][] = []
      for( let index = 0; index < candidateList.length; index += 10 ) {
        chunks.push( candidateList.slice( index, index + 10 ) )
      }
      let directorySnapshots: QuerySnapshot[] = []
      try {
        directorySnapshots = await Promise.all(
          chunks.map( ( chunk ) =>
            getDocs( query( collection( db, 'userDirectory' ), where( 'userId', 'in', chunk ) ) ),
          ),
        )
      } catch( err ) {
        console.error( 'Versions loadDocumentAndVersions user-directory read failed:', err )
      }
      directorySnapshots.forEach( ( snapshot ) => {
        snapshot.docs.forEach( ( directoryDoc ) => {
          const data = directoryDoc.data()
          const memberUserId = ( data.userId as string | undefined ) ?? ''
          if( memberUserId ) {
            nextDirectoryById[memberUserId] = {
              email: ( data.email as string | null | undefined ) ?? null,
              displayName: ( data.displayName as string | null | undefined ) ?? null,
            }
          }
        } )
      } )
      if( userId ) {
        const existing = nextDirectoryById[userId] ?? {}
        nextDirectoryById[userId] = {
          email: user?.email ?? existing.email ?? null,
          displayName: user?.displayName ?? existing.displayName ?? null,
        }
      }
      const missingProfileIds = candidateList.filter( ( memberUserId ) => {
        if( !memberUserId ) {
          return false
        }
        const entry = nextDirectoryById[memberUserId]
        return !( entry?.displayName || entry?.email )
      } )
      if( missingProfileIds.length > 0 ) {
        step = 'user-profiles'
        await Promise.all(
          missingProfileIds.map( async ( memberUserId ) => {
            try {
              const profileSnapshot = await getDoc( doc( db, 'userProfiles', memberUserId ) )
              const profileName = ( profileSnapshot.data()?.displayName as string | undefined ) ?? ''
              const profileEmail = ( profileSnapshot.data()?.email as string | undefined ) ?? ''
              if( profileName || profileEmail ) {
                nextDirectoryById[memberUserId] = {
                  ...nextDirectoryById[memberUserId],
                  displayName: profileName || ( nextDirectoryById[memberUserId]?.displayName ?? null ),
                  email: profileEmail || ( nextDirectoryById[memberUserId]?.email ?? null ),
                }
              }
            } catch {
              // ignore missing profiles
            }
          } ),
        )
      }
      setUserDirectoryById( ( previous ) => {
        return areUserDirectoryEqual( previous, nextDirectoryById ) ? previous : nextDirectoryById
      } )

      step = 'error-reports'
      if( latestVersionLocal && latestVersionLocal.status === 'Accepted' ) {
        setErrorReportGate( { isBlocking: false, isLoading: true } )
        const errorReportsSnapshot = await getDocs(
          query(
            collection( db, 'documents' ),
            where( 'projectId', '==', loadedProjectId ),
            where( 'type', '==', 'errorReport' ),
            where( 'baseVersionId', '==', latestVersionLocal.id ),
          ),
        )
        const errorReportDocs = errorReportsSnapshot.docs.map( ( docSnapshot ) => docSnapshot.id )
        if( errorReportDocs.length === 0 ) {
          setErrorReportGate( { isBlocking: true, isLoading: false } )
        } else {
          const latestReportVersions = await Promise.all(
            errorReportDocs.map( async ( reportDocId ) => {
              const reportVersionSnapshot = await getDocs(
                query(
                  collection( db, 'versions' ),
                  where( 'projectId', '==', loadedProjectId ),
                  where( 'docId', '==', reportDocId ),
                  orderBy( 'number', 'desc' ),
                  limit( 1 ),
                ),
              )
              const reportData = reportVersionSnapshot.docs[0]?.data()
              return {
                reportDocId,
                latestVersionId: reportVersionSnapshot.docs[0]?.id ?? null,
                latestVersionNumber: Number( reportData?.number ?? FIRST_VERSION_NUMBER ),
                latestVersionStatus: ( reportData?.status as string | undefined ) ?? '',
              }
            } ),
          )
          const hasAcceptedErrorReport = latestReportVersions.some(
            ( report ) => report.latestVersionStatus === 'Accepted',
          )
          const isBlocking = !hasAcceptedErrorReport
          setErrorReportGate( { isBlocking, isLoading: false } )
        }
      } else {
        setErrorReportGate( { isBlocking: false, isLoading: false } )
      }

      step = 'access'
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      console.error( `Versions loadDocumentAndVersions failed at ${step}:`, err )
      setError( `Versions failed at ${step}: ${message}` )
    } finally {
      setIsBusy( false )
    }
  }, [
    docId,
    projectIdFromQuery,
    versionIdFromQuery,
    selectedVersionId,
    userId,
    user?.email,
    user?.displayName,
  ] )

  useEffect( () => {
    if( !docId ) {
      return
    }
    const unsubscribe = onSnapshot(
      doc( db, 'documents', docId ),
      ( snapshot ) => {
        if( !snapshot.exists() ) {
          setDocumentData( null )
          setVersions( [] )
          setError( 'Document not found.' )
          return
        }
        const data = snapshot.data()
        const loadedProjectId = ( data.projectId as string ) ?? projectIdFromQuery
        const loadedAuthorId = ( data.createdBy as string ) ?? ( data.authorId as string ) ?? ''
        const detectedShortId = Number.isFinite( data.shortId ) ? Number( data.shortId ) : null
        const nextBaseDocId = ( data.baseDocId as string | undefined ) ?? null
        const nextBaseVersionId = ( data.baseVersionId as string | undefined ) ?? null
        setDocumentData( {
          id: snapshot.id,
          projectId: loadedProjectId,
          title: ( data.title as string ) ?? 'Untitled document',
          createdBy: loadedAuthorId,
          type: ( data.type as string | undefined ) ?? 'document',
          shortId: detectedShortId,
          baseDocId: nextBaseDocId,
          baseVersionId: nextBaseVersionId,
        } )
        if( ( data.type as string | undefined ) === 'errorReport' && ( !nextBaseDocId || !nextBaseVersionId ) ) {
          setVersions( [] )
          setBaseDocumentData( null )
          setError( 'Invalid error report data: baseDocId and baseVersionId are required.' )
          return
        }
        if( ( data.type as string | undefined ) === 'errorReport' && nextBaseDocId ) {
          void ( async () => {
            try {
              const baseDocSnapshot = await getDocFromServer( doc( db, 'documents', nextBaseDocId ) )
              if( baseDocSnapshot.exists() ) {
                const baseDocData = baseDocSnapshot.data()
                setBaseDocumentData( {
                  id: baseDocSnapshot.id,
                  title: ( baseDocData?.title as string | undefined ) ?? 'Untitled document',
                  shortId: Number.isFinite( baseDocData?.shortId ) ? Number( baseDocData?.shortId ) : null,
                } )
              }
            } catch {
              // ignore base doc lookup errors
            }
          } )()
        }
      },
      ( err ) => {
        const message = err instanceof Error ? err.message : 'Unexpected error'
        setError( `Document failed to load: ${message}` )
      },
    )
    return () => {
      unsubscribe()
    }
  }, [ docId, projectIdFromQuery ] )

  useEffect( () => {
    if( !userId ) {
      setIsAdmin( false )
      return
    }
    const unsubscribe = onSnapshot(
      doc( db, 'userProfiles', userId ),
      ( snapshot ) => {
        const data = snapshot.data()
        setIsAdmin( Boolean( data?.isAdmin ) )
      },
      () => {
        setIsAdmin( false )
      },
    )
    return () => {
      unsubscribe()
    }
  }, [ userId ] )

  useEffect( () => {
    const activeProjectId = documentData?.projectId ?? projectIdFromQuery
    if( !userId || !activeProjectId ) {
      setIsLeader( false )
      return
    }
    const unsubscribe = onSnapshot(
      doc( db, 'projectMembers', `${activeProjectId}_${userId}` ),
      ( snapshot ) => {
        const role = ( snapshot.data()?.role as string | undefined ) ?? ''
        setIsLeader( role === 'leader' )
      },
      () => {
        setIsLeader( false )
      },
    )
    return () => {
      unsubscribe()
    }
  }, [ documentData?.projectId, projectIdFromQuery, userId ] )

  useEffect( () => {
    setUploadStatus( 'idle' )
    setUploadMessage( '' )
  }, [ selectedVersionId ] )

  useEffect( () => {
    if( !selectedVersion?.id ) {
      setThreads( [] )
      setVisibleThreadRows( [] )
      setCommentsByThread( {} )
      setSelectedThreadId( null )
      setNewThreadTitle( '' )
      setNewCommentBody( '' )
      setPendingThreadStatusChange( null )
      lastAppliedThreadQueryRef.current = null
      return
    }
    // Clear stale issue/comment state immediately when switching versions.
    // This avoids interacting with threads from the previously selected version
    // while the new realtime snapshot is still loading.
    setThreads( [] )
    setVisibleThreadRows( [] )
    setCommentsByThread( {} )
    setSelectedThreadId( null )
    setNewThreadTitle( '' )
    setNewCommentBody( '' )
    setPendingThreadStatusChange( null )
    if( !threadIdFromQuery ) {
      lastAppliedThreadQueryRef.current = null
    }
    setIsLoadingThreads( true )
    const threadsUnsub = onSnapshot(
      query( collection( db, 'threads' ), where( 'versionId', '==', selectedVersion.id ) ),
      ( snapshot ) => {
        const nextThreads = snapshot.docs.map( ( threadSnapshot ) => {
          const data = threadSnapshot.data()
          return {
            id: threadSnapshot.id,
            status: ( data.status as 'open' | 'closed' ) ?? 'open',
            title: ( data.title as string | undefined ) ?? 'Untitled issue',
            createdBy: ( data.createdBy as string | undefined ) ?? '',
            commentCount: Number( data.commentCount ?? 0 ),
            lastCommentAt: toTimestampDate( data.lastCommentAt ),
          }
        } )
        setThreads( ( previous ) => ( areThreadsEqual( previous, nextThreads ) ? previous : nextThreads ) )
        setSelectedThreadId( ( current ) =>
          current && nextThreads.some( ( thread ) => thread.id === current ) ? current : null,
        )
        setIsLoadingThreads( false )
      },
      ( err ) => {
        const message = err instanceof Error ? err.message : 'Unexpected error'
        setError( `Issues failed to load: ${message}` )
        setIsLoadingThreads( false )
      },
    )
    const commentsUnsub = onSnapshot(
      query(
        collection( db, 'comments' ),
        where( 'versionId', '==', selectedVersion.id ),
        orderBy( 'createdAt', 'asc' ),
      ),
      ( snapshot ) => {
        const nextComments: Record<string, CommentSummary[]> = {}
        snapshot.docs.forEach( ( commentSnapshot ) => {
          const data = commentSnapshot.data()
          const threadId = ( data.threadId as string | undefined ) ?? ''
          const commentItem: CommentSummary = {
            id: commentSnapshot.id,
            threadId,
            body: ( data.body as string | undefined ) ?? '',
            createdBy: ( data.createdBy as string | undefined ) ?? '',
            createdAt: data.createdAt?.toDate?.() as Date | undefined,
          }
          if( !nextComments[threadId] ) {
            nextComments[threadId] = []
          }
          nextComments[threadId].push( commentItem )
        } )
        setCommentsByThread( ( previous ) =>
          areCommentsByThreadEqual( previous, nextComments ) ? previous : nextComments,
        )
      },
      ( err ) => {
        const message = err instanceof Error ? err.message : 'Unexpected error'
        setError( `Comments failed to load: ${message}` )
      },
    )
    return () => {
      threadsUnsub()
      commentsUnsub()
    }
  }, [ selectedVersion?.id ] )

  useEffect( () => {
    if( !threadIdFromQuery ) {
      lastAppliedThreadQueryRef.current = null
      return
    }
    if( lastAppliedThreadQueryRef.current === threadIdFromQuery ) {
      return
    }
    if( !threads.some( ( thread ) => thread.id === threadIdFromQuery ) ) {
      return
    }
    lastAppliedThreadQueryRef.current = threadIdFromQuery
    setSelectedThreadId( ( current ) => ( current === threadIdFromQuery ? current : threadIdFromQuery ) )
  }, [ threadIdFromQuery, threads ] )

  useEffect( () => {
    setNewCommentBody( '' )
  }, [ selectedThreadId ] )

  useEffect( () => {
    if( preservedThreadNavigationScrollYRef.current === null ) {
      return
    }
    const targetScrollY = preservedThreadNavigationScrollYRef.current
    let secondFrame: number | null = null
    const firstFrame = window.requestAnimationFrame( () => {
      window.scrollTo( { top: targetScrollY, behavior: 'auto' } )
      secondFrame = window.requestAnimationFrame( () => {
        window.scrollTo( { top: targetScrollY, behavior: 'auto' } )
        preservedThreadNavigationScrollYRef.current = null
      } )
    } )
    return () => {
      window.cancelAnimationFrame( firstFrame )
      if( secondFrame !== null ) {
        window.cancelAnimationFrame( secondFrame )
      }
    }
  }, [ selectedThreadId ] )

  useEffect( () => {
    if( !dashboardFocusTarget ) {
      return
    }
    if( !selectedVersion || isLoadingVersions ) {
      return
    }
    if( dashboardFocusTarget === 'comments' && isLoadingThreads ) {
      return
    }

    const focusKey = dashboardFocusTarget === 'comments'
      ? `${dashboardFocusTarget}|${selectedVersion.id}|${selectedThreadId ?? ''}`
      : `${dashboardFocusTarget}|${selectedVersion.id}`
    if( lastAppliedDashboardFocusRef.current === focusKey ) {
      return
    }

    const scrollToTarget = (target: HTMLElement | null, focusInput = false) => {
      if( !target ) {
        return false
      }
      target.scrollIntoView( { behavior: 'smooth', block: 'start' } )
      if( focusInput && commentInputRef.current ) {
        window.setTimeout( () => {
          commentInputRef.current?.focus()
        }, 220 )
      }
      return true
    }

    let didScroll = false
    if( dashboardFocusTarget === 'actions' ) {
      didScroll = scrollToTarget( versionsActionsRef.current )
    } else if( dashboardFocusTarget === 'file' ) {
      didScroll = scrollToTarget( filePanelRef.current )
    } else if( dashboardFocusTarget === 'issues' ) {
      didScroll = scrollToTarget( reviewIssuesPanelRef.current )
    } else if( selectedThread ) {
      didScroll = scrollToTarget( commentInputRef.current, true )
    } else {
      didScroll = scrollToTarget( reviewIssuesPanelRef.current )
    }

    if( didScroll ) {
      lastAppliedDashboardFocusRef.current = focusKey
    }
  }, [
    dashboardFocusTarget,
    selectedVersion,
    selectedThread,
    selectedThreadId,
    isLoadingVersions,
    isLoadingThreads,
  ] )

  useEffect( () => {
    if( !commentIdFromQuery ) {
      lastAppliedCommentQueryRef.current = null
      setHighlightedCommentId( null )
      return
    }
    if( lastAppliedCommentQueryRef.current === commentIdFromQuery ) {
      return
    }
    const targetThreadId =
      selectedThreadId ??
      Object.entries( commentsByThread ).find( ( [ , threadComments ] ) =>
        threadComments.some( ( comment ) => comment.id === commentIdFromQuery ),
      )?.[0] ??
      null
    if( !targetThreadId ) {
      return
    }
    if( selectedThreadId !== targetThreadId ) {
      setSelectedThreadId( targetThreadId )
      return
    }
    const selectedComments = commentsByThread[targetThreadId] ?? []
    if( !selectedComments.some( ( comment ) => comment.id === commentIdFromQuery ) ) {
      return
    }
    if( commentsViewMode !== 'card' ) {
      setCommentsViewMode( 'card' )
      return
    }
    lastAppliedCommentQueryRef.current = commentIdFromQuery
    setHighlightedCommentId( commentIdFromQuery )
    const scrollTimer = window.setTimeout( () => {
      const commentNode = document.getElementById( buildCommentAnchorId( commentIdFromQuery ) )
      commentNode?.scrollIntoView( { behavior: 'smooth', block: 'center' } )
    }, 120 )
    const clearHighlightTimer = window.setTimeout( () => {
      setHighlightedCommentId( ( current ) => ( current === commentIdFromQuery ? null : current ) )
    }, 12000 )
    return () => {
      window.clearTimeout( scrollTimer )
      window.clearTimeout( clearHighlightTimer )
    }
  }, [ commentIdFromQuery, selectedThreadId, commentsByThread, commentsViewMode ] )

  useEffect( () => {
    let isActive = true
    const fileRefId = selectedVersion?.fileRefId ?? null
    if( !fileRefId ) {
      setSelectedFileRef( null )
      setFileMetadataNotice( null )
      return () => {
        isActive = false
      }
    }
    const loadFileRef = async () => {
      try {
        const snapshot = await getDoc( doc( db, 'files', fileRefId ) )
        if( !snapshot.exists() ) {
          if( isActive ) {
            setSelectedFileRef( null )
            setFileMetadataNotice( 'The linked file metadata no longer exists. Upload or replace the file to restore access.' )
          }
          return
        }
        const data = snapshot.data()
        if( isActive ) {
          setSelectedFileRef( {
            id: snapshot.id,
            fileKey: ( data.fileKey as string ) ?? '',
            fileName: ( data.fileName as string ) ?? '',
            contentType: ( data.contentType as string | undefined ) ?? 'application/octet-stream',
            sizeBytes: Number( data.sizeBytes ?? 0 ),
            isPermanent: Boolean( data.isPermanent ),
            expireAfterDays:
              typeof data.expireAfterDays === 'number' ? Number( data.expireAfterDays ) : null,
            storageProvider: normalizeFileStorageProvider( data.storageProvider ),
            createdBy: ( data.createdBy as string ) ?? '',
            projectId: ( data.projectId as string ) ?? '',
            docId: ( data.docId as string ) ?? '',
            versionId: ( data.versionId as string ) ?? '',
          } )
          setFileMetadataNotice( null )
        }
      } catch( err ) {
        if( isActive ) {
          if( isPermissionDeniedError( err ) ) {
            setSelectedFileRef( null )
            setFileMetadataNotice( 'You do not have permission to read linked file metadata for this version.' )
            return
          }
          setFileMetadataNotice( null )
          const message = err instanceof Error ? err.message : 'Unexpected error'
          setError( `File metadata failed to load: ${message}` )
        }
      }
    }
    void loadFileRef()
    return () => {
      isActive = false
    }
  }, [ selectedVersion?.fileRefId ] )

  useEffect( () => {
    const activeProjectId = documentData?.projectId ?? projectIdFromQuery
    if( !docId || !activeProjectId ) {
      return
    }
    setIsLoadingVersions( true )
    const versionsQuery = query(
      collection( db, 'versions' ),
      where( 'projectId', '==', activeProjectId ),
      where( 'docId', '==', docId ),
      orderBy( 'number', 'desc' ),
    )
    const versionsUnsub = onSnapshot(
      versionsQuery,
      ( snapshot ) => {
        const nextVersions = snapshot.docs.map( ( versionSnapshot ) => {
          const data = versionSnapshot.data()
        const stats = ( data.stats as {
          numThreads?: number
          numOpenThreads?: number
          numComments?: number
          numThreadsWithTwoPlusComments?: number
        } | undefined ) ?? {}
          return {
            id: versionSnapshot.id,
            number: Number( data.number ?? FIRST_VERSION_NUMBER ),
            status: ( data.status as string ) ?? 'In Creation',
            createdBy: ( data.createdBy as string ) ?? '',
            reviewerIds: ( data.reviewerIds as string[] | undefined ) ?? [],
            reviewStartAt: toTimestampDate( data.reviewStartAt ),
            reviewEndAt: toTimestampDate( data.reviewEndAt ),
            hasFile: Boolean( data.hasFile ),
            fileRefId: ( data.fileRefId as string | null | undefined ) ?? null,
            numThreads: Number( stats.numThreads ?? data.numThreads ?? 0 ),
            numOpenThreads: Number( stats.numOpenThreads ?? data.numOpenThreads ?? 0 ),
            numComments: Number( stats.numComments ?? data.numComments ?? 0 ),
            numThreadsWithTwoPlusComments: Number( stats.numThreadsWithTwoPlusComments ?? data.numThreadsWithTwoPlusComments ?? 0 ),
            acceptedErrorReportId: ( data.acceptedErrorReportId as string | null | undefined ) ?? null,
          }
        } )
        setVersions( ( previous ) => ( areVersionsEqual( previous, nextVersions ) ? previous : nextVersions ) )
        setIsLoadingVersions( false )
      },
      ( err ) => {
        const message = err instanceof Error ? err.message : 'Unexpected error'
        setError( `Versions failed to load: ${message}` )
        setIsLoadingVersions( false )
      },
    )
    const membersUnsub = onSnapshot(
      query( collection( db, 'projectMembers' ), where( 'projectId', '==', activeProjectId ) ),
      ( snapshot ) => {
        const members = snapshot.docs.map( ( memberSnapshot ) => {
          const data = memberSnapshot.data()
          return {
            userId: ( data.userId as string ) ?? '',
            role: ( data.role as string ) ?? '',
            email: ( data.email as string | null | undefined ) ?? null,
          }
        } )
        setProjectMembers( ( previous ) =>
          areProjectMembersEqual( previous, members ) ? previous : members,
        )
      },
    )
    const projectUnsub = onSnapshot( doc( db, 'projects', activeProjectId ), ( snapshot ) => {
      if( snapshot.exists() ) {
        const data = snapshot.data()
        setProjectName( ( data.name as string | undefined ) ?? '' )
        setProjectShortId( Number.isFinite( data.shortId ) ? Number( data.shortId ) : null )
      }
    } )
    return () => {
      versionsUnsub()
      membersUnsub()
      projectUnsub()
    }
  }, [ docId, documentData?.projectId, projectIdFromQuery ] )

  useEffect( () => {
    const activeProjectId = documentData?.projectId ?? projectIdFromQuery
    if( !activeProjectId || !latestVersion ) {
      setErrorReportGate( { isBlocking: false, isLoading: false } )
      return
    }
    if( latestVersion.status !== 'Accepted' ) {
      setErrorReportGate( { isBlocking: false, isLoading: false } )
      return
    }

    let isActive = true
    setErrorReportGate( { isBlocking: true, isLoading: true } )
    void ( async () => {
      try {
        const errorReportsSnapshot = await getDocs(
          query(
            collection( db, 'documents' ),
            where( 'projectId', '==', activeProjectId ),
            where( 'type', '==', 'errorReport' ),
            where( 'baseVersionId', '==', latestVersion.id ),
          ),
        )
        const errorReportDocs = errorReportsSnapshot.docs.map( ( docSnapshot ) => docSnapshot.id )
        if( !isActive ) {
          return
        }
        if( errorReportDocs.length === 0 ) {
          setErrorReportGate( { isBlocking: true, isLoading: false } )
          return
        }
        const latestReportVersions = await Promise.all(
          errorReportDocs.map( async ( reportDocId ) => {
            const reportVersionSnapshot = await getDocs(
              query(
                collection( db, 'versions' ),
                where( 'projectId', '==', activeProjectId ),
                where( 'docId', '==', reportDocId ),
                orderBy( 'number', 'desc' ),
                limit( 1 ),
              ),
            )
            const reportData = reportVersionSnapshot.docs[0]?.data()
            return {
              reportDocId,
              latestVersionId: reportVersionSnapshot.docs[0]?.id ?? null,
              latestVersionNumber: Number( reportData?.number ?? FIRST_VERSION_NUMBER ),
              latestVersionStatus: ( reportData?.status as string | undefined ) ?? '',
            }
          } ),
        )
        if( !isActive ) {
          return
        }
        const hasAcceptedErrorReport = latestReportVersions.some(
          ( report ) => report.latestVersionStatus === 'Accepted',
        )
        const isBlocking = !hasAcceptedErrorReport
        setErrorReportGate( { isBlocking, isLoading: false } )
      } catch( err ) {
        if( !isActive ) {
          return
        }
        setErrorReportGate( { isBlocking: true, isLoading: false } )
        const message = err instanceof Error ? err.message : 'Unexpected error'
        console.error( 'Create-version gate update failed:', message )
      }
    } )()

    return () => {
      isActive = false
    }
  }, [ documentData?.projectId, projectIdFromQuery, latestVersion?.id, latestVersion?.status, latestVersion ] )

  useEffect( () => {
    const candidateIds = new Set<string>()
    projectMembers.forEach( ( member ) => {
      if( member.userId ) {
        candidateIds.add( member.userId )
      }
    } )
    versions.forEach( ( version ) => {
      if( version.createdBy ) {
        candidateIds.add( version.createdBy )
      }
      version.reviewerIds.forEach( ( reviewerId ) => {
        if( reviewerId ) {
          candidateIds.add( reviewerId )
        }
      } )
    } )
    const candidateList = Array.from( candidateIds )
    if( candidateList.length === 0 ) {
      return
    }
    let isActive = true
    const loadDirectory = async () => {
      const nextDirectoryById: Record<string, { email?: string | null; displayName?: string | null }> = {}
      projectMembers.forEach( ( member ) => {
        if( member.userId && member.email ) {
          nextDirectoryById[member.userId] = {
            email: member.email,
            displayName: null,
          }
        }
      } )
      const chunks: string[][] = []
      for( let index = 0; index < candidateList.length; index += 10 ) {
        chunks.push( candidateList.slice( index, index + 10 ) )
      }
      try {
        const directorySnapshots = await Promise.all(
          chunks.map( ( chunk ) =>
            getDocs( query( collection( db, 'userDirectory' ), where( 'userId', 'in', chunk ) ) ),
          ),
        )
        directorySnapshots.forEach( ( snapshot ) => {
          snapshot.docs.forEach( ( directoryDoc ) => {
            const data = directoryDoc.data()
            const memberUserId = ( data.userId as string | undefined ) ?? ''
            if( memberUserId ) {
              nextDirectoryById[memberUserId] = {
                email: ( data.email as string | null | undefined ) ?? null,
                displayName: ( data.displayName as string | null | undefined ) ?? null,
              }
            }
          } )
        } )
      } catch( err ) {
        console.error( 'Versions user-directory read failed:', err )
      }
      if( userId ) {
        const existing = nextDirectoryById[userId] ?? {}
        nextDirectoryById[userId] = {
          email: user?.email ?? existing.email ?? null,
          displayName: user?.displayName ?? existing.displayName ?? null,
        }
      }
      const missingProfileIds = candidateList.filter( ( memberUserId ) => {
        if( !memberUserId ) {
          return false
        }
        const entry = nextDirectoryById[memberUserId]
        return !( entry?.displayName || entry?.email )
      } )
      if( missingProfileIds.length > 0 ) {
        await Promise.all(
          missingProfileIds.map( async ( memberUserId ) => {
            try {
              const profileSnapshot = await getDoc( doc( db, 'userProfiles', memberUserId ) )
              const profileName = ( profileSnapshot.data()?.displayName as string | undefined ) ?? ''
              const profileEmail = ( profileSnapshot.data()?.email as string | undefined ) ?? ''
              if( profileName || profileEmail ) {
                nextDirectoryById[memberUserId] = {
                  ...nextDirectoryById[memberUserId],
                  displayName: profileName || ( nextDirectoryById[memberUserId]?.displayName ?? null ),
                  email: profileEmail || ( nextDirectoryById[memberUserId]?.email ?? null ),
                }
              }
            } catch {
              // ignore missing profiles
            }
          } ),
        )
      }
      if( isActive ) {
        setUserDirectoryById( ( previous ) => {
          return areUserDirectoryEqual( previous, nextDirectoryById ) ? previous : nextDirectoryById
        } )
      }
    }
    void loadDirectory()
    return () => {
      isActive = false
    }
  }, [ projectMembers, versions, userId, user?.email, user?.displayName ] )

  useEffect( () => {
    if( versions.length === 0 ) {
      lastAppliedVersionQueryRef.current = null
      return
    }
    if( !versionIdFromQuery ) {
      lastAppliedVersionQueryRef.current = null
    }
    const queryVersion =
      versionIdFromQuery && lastAppliedVersionQueryRef.current !== versionIdFromQuery
        ? versions.find( ( version ) => version.id === versionIdFromQuery ) || null
        : null
    const selectedVersionFromState = selectedVersionId
      ? versions.find( ( version ) => version.id === selectedVersionId ) || null
      : null
    const activeVersion =
      queryVersion ??
      selectedVersionFromState ??
      versions[0] ??
      null
    if( !activeVersion ) {
      return
    }
    if( queryVersion ) {
      lastAppliedVersionQueryRef.current = versionIdFromQuery
    }
    const allowedMemberIds = projectMembers.map( ( member ) => member.userId ).filter( Boolean )
    const nextReviewerIds = ( activeVersion.reviewerIds ?? [] ).filter( ( reviewerId ) =>
      allowedMemberIds.includes( reviewerId ) && reviewerId !== activeVersion.createdBy,
    )
    setSelectedReviewerIds( ( previous ) =>
      areStringArraysEqual( previous, nextReviewerIds ) ? previous : nextReviewerIds,
    )
    setSelectedAuthorId( ( previous ) => {
      const nextAuthorId = activeVersion.createdBy ?? ''
      return previous === nextAuthorId ? previous : nextAuthorId
    } )
    setSelectedVersionId( ( previous ) => ( previous === activeVersion.id ? previous : activeVersion.id ) )
  }, [ versions, selectedVersionId, versionIdFromQuery, projectMembers ] )

  useEffect( () => {
    if( !selectedAuthorId ) {
      return
    }
    setSelectedReviewerIds( ( current ) => current.filter( ( reviewerId ) => reviewerId !== selectedAuthorId ) )
  }, [ selectedAuthorId ] )

  useEffect( () => {
    const storedVersionSorting = window.localStorage.getItem( 'qt4_versions_sorting' )
    if( storedVersionSorting ) {
      try {
        const parsed = JSON.parse( storedVersionSorting ) as SortingState
        if( Array.isArray( parsed ) ) {
          setVersionSorting( parsed )
        }
      } catch {
        // ignore parse errors
      }
    }
  }, [] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_versions_view', viewMode )
  }, [ viewMode ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_versions_sorting', JSON.stringify( versionSorting ) )
  }, [ versionSorting ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_versions_threads_view', threadsViewMode )
  }, [ threadsViewMode ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_versions_thread_comments_view', commentsViewMode )
  }, [ commentsViewMode ] )

  useEffect( () => {
    if( error && lastErrorRef.current !== error ) {
      console.error( 'Versions error modal:', error )
      lastErrorRef.current = error
    }
  }, [ error ] )

  useEffect( () => {
    if( successMessage && successOkButtonRef.current ) {
      successOkButtonRef.current.focus()
    }
  }, [ successMessage ] )

  const handleCloseSuccessMessage = () => {
    const shouldRestoreCommentFocus = successMessage === 'The comment was added successfully.'
    const shouldRestoreNewIssueCommentFocus = successMessage === 'Issue created successfully.'
    setSuccessEmailRecipients( null )
    setSuccessMessage( null )
    if( shouldRestoreCommentFocus ) {
      window.setTimeout( () => {
        commentInputRef.current?.focus()
      }, 0 )
    }
    if( shouldRestoreNewIssueCommentFocus ) {
      window.setTimeout( () => {
        commentInputRef.current?.focus()
      }, 0 )
    }
  }

  const reloadAndRestoreSelection = useCallback(
    async (versionId: string | null, threadId?: string | null) => {
      setSelectedVersionId( ( current ) => ( current === versionId ? current : versionId ) )
      if( threadId !== undefined ) {
        const nextThreadId = threadId ?? null
        setSelectedThreadId( ( current ) => ( current === nextThreadId ? current : nextThreadId ) )
      }
    },
    [],
  )

  const selectThreadKeepingViewport = useCallback( (threadId: string) => {
    if( !threadId ) {
      return
    }
    preservedThreadNavigationScrollYRef.current = window.scrollY
    if( dashboardFocusTarget === 'comments' && selectedVersion?.id ) {
      lastAppliedDashboardFocusRef.current = `${dashboardFocusTarget}|${selectedVersion.id}|${threadId}`
    }
    lastAppliedCommentQueryRef.current = null
    setHighlightedCommentId( null )
    const nextSearchParams = new URLSearchParams( searchParams )
    nextSearchParams.set( 'threadId', threadId )
    nextSearchParams.delete( 'commentId' )
    setSearchParams( nextSearchParams, {
      replace: true,
      preventScrollReset: true,
    } )
    setSelectedThreadId( ( current ) => {
      if( current === threadId ) {
        preservedThreadNavigationScrollYRef.current = null
        return current
      }
      return threadId
    } )
  }, [ dashboardFocusTarget, selectedVersion?.id, searchParams, setSearchParams ] )

  const handleSelectAdjacentThread = useCallback( (direction: -1 | 1) => {
    if( selectedThreadIndex < 0 ) {
      return
    }
    const targetThread = orderedThreads[selectedThreadIndex + direction]
    if( !targetThread ) {
      return
    }
    selectThreadKeepingViewport( targetThread.id )
  }, [ selectedThreadIndex, orderedThreads, selectThreadKeepingViewport ] )

  const isVersionReviewExpired = (version?: Pick<VersionSummary, 'status' | 'reviewEndAt'> | null) =>
    Boolean(
      version &&
      version.status === 'In Review' &&
      version.reviewEndAt &&
      version.reviewEndAt.getTime() <= clockNowMs,
    )

  const versionStatusClassName = (version?: Pick<VersionSummary, 'status' | 'reviewEndAt'> | null) => {
    if( isVersionReviewExpired( version ) ) {
      return 'status-card--in-review-expired'
    }
    return statusClassName( version?.status )
  }

  const versionSelectStatusClassName = (version?: Pick<VersionSummary, 'status' | 'reviewEndAt'> | null) => {
    if( isVersionReviewExpired( version ) ) {
      return 'version-select--in-review-expired'
    }
    switch( version?.status ) {
      case 'In Creation':
        return 'version-select--in-creation'
      case 'In Review':
        return 'version-select--in-review'
      case 'Reviewed':
        return 'version-select--reviewed'
      case 'Accepted':
        return 'version-select--accepted'
      case 'Rejected':
        return 'version-select--rejected'
      case 'Replaced':
        return 'version-select--replaced'
      default:
        return ''
    }
  }

  const versionStatusColor = (version?: Pick<VersionSummary, 'status' | 'reviewEndAt'> | null) => {
    if( isVersionReviewExpired( version ) ) {
      return '#ffb347'
    }
    switch( version?.status ) {
      case 'In Review':
        return '#fff59d'
      case 'Reviewed':
        return '#d3d3d3'
      case 'Accepted':
        return '#c8f7c5'
      case 'Rejected':
        return '#f4c7c3'
      case 'Replaced':
        return '#d3d3d3'
      case 'In Creation':
      default:
        return '#ffffff'
    }
  }

  const selectedReviewTimerState = useMemo<
    'active' | 'grace' | 'expired' | 'noExpiration' | 'inactive'
  >( () => {
    if( !selectedVersion || selectedVersion.status !== 'In Review' ) {
      return 'inactive'
    }
    if( !selectedVersion.reviewEndAt ) {
      return 'noExpiration'
    }
    if( selectedVersion.reviewEndAt.getTime() > clockNowMs ) {
      return 'active'
    }
    return selectedVersionHasReviewGrace ? 'grace' : 'expired'
  }, [ selectedVersion, clockNowMs, selectedVersionHasReviewGrace ] )

  const selectedReviewTimerLabel = useMemo( () => {
    if( !selectedVersion || selectedVersion.status !== 'In Review' ) {
      return null
    }
    if( !selectedVersion.reviewEndAt ) {
      return 'No expiration configured'
    }
    const remainingMs = selectedVersion.reviewEndAt.getTime() - clockNowMs
    if( remainingMs <= 0 ) {
      if( selectedVersionHasReviewGrace ) {
        return `Grace ${formatApproxCountdown( selectedVersionReviewGraceRemainingMs )}`
      }
      return 'Expired'
    }
    return formatApproxCountdown( remainingMs )
  }, [ selectedVersion, clockNowMs, selectedVersionHasReviewGrace, selectedVersionReviewGraceRemainingMs ] )

  useEffect( () => {
    setClockNowMs( Date.now() )
    const timer = window.setInterval( () => {
      setClockNowMs( Date.now() )
    }, 60 * 1000 )
    return () => {
      window.clearInterval( timer )
    }
  }, [] )

  useEffect( () => {
    if( typeof window === 'undefined' ) {
      return
    }
    const media = window.matchMedia( '(max-width: 480px)' )
    const handleChange = () => {
      setIsMembersTableCompact( media.matches )
    }
    handleChange()
    if( typeof media.addEventListener === 'function' ) {
      media.addEventListener( 'change', handleChange )
      return () => {
        media.removeEventListener( 'change', handleChange )
      }
    }
    media.addListener( handleChange )
    return () => {
      media.removeListener( handleChange )
    }
  }, [] )

  useEffect( () => {
    if( !latestVersion || !userId ) {
      return
    }
    if( !canManageLatestVersion ) {
      return
    }
    if( !selectedVersion || selectedVersion.id !== latestVersion.id ) {
      return
    }
    if( autoReviewPermissionDeniedVersionIdsRef.current.has( latestVersion.id ) ) {
      return
    }
    if( autoReviewUpdateRef.current === latestVersion.id ) {
      return
    }
    if( latestVersionIsSelected && isLoadingThreads ) {
      return
    }
    if( latestVersion.numComments > 0 && latestVersionIsSelected && !latestSelectedVersionCommentAt ) {
      return
    }
    if( latestVersionIsSelected && selectedVersionHasReviewGrace ) {
      return
    }
    const shouldMarkReviewed = shouldAutoSetReviewed( {
      versionStatus: latestVersion.status,
      reviewEndAt: latestVersion.reviewEndAt,
      latestVersionCommentAt: latestSelectedVersionCommentAt,
      hasAnyComments: hasSelectedVersionComments,
      nowMs: clockNowMs,
    } )
    if( !shouldMarkReviewed ) {
      return
    }
    autoReviewUpdateRef.current = latestVersion.id
    void updateDoc( doc( db, 'versions', latestVersion.id ), {
      status: 'Reviewed',
      updatedAt: serverTimestamp(),
      updatedBy: userId,
    } ).catch( ( err ) => {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      const errorCode =
        err && typeof err === 'object' && 'code' in err
          ? String( ( err as { code: unknown } ).code )
          : ''
      const loweredMessage = message.toLowerCase()
      const permissionDenied =
        errorCode.includes( 'permission-denied' ) ||
        loweredMessage.includes( 'permission-denied' ) ||
        loweredMessage.includes( 'missing or insufficient permissions' )
      if( permissionDenied ) {
        autoReviewPermissionDeniedVersionIdsRef.current.add( latestVersion.id )
      }
      console.warn( 'Auto review completion failed:', message )
      if( !permissionDenied ) {
        autoReviewUpdateRef.current = null
      }
    } )
  }, [
    latestVersion,
    selectedVersion,
    latestSelectedVersionCommentAt,
    hasSelectedVersionComments,
    clockNowMs,
    userId,
    canManageLatestVersion,
    latestVersionIsSelected,
    isLoadingThreads,
    selectedVersionHasReviewGrace,
  ] )

  useEffect( () => {
    if( !documentData ) {
      return
    }
    if( documentData.type === 'errorReport' && ( !documentData.baseDocId || !documentData.baseVersionId ) ) {
      setError( 'Invalid error report data: baseDocId and baseVersionId are required.' )
    }
  }, [ documentData ] )

  const handleCreateVersion = async () => {
    if( !docId || !projectId || !userId || !documentData ) {
      setError( 'Sign in and select a document before creating a version.' )
      return
    }
    if( !canCreateVersion ) {
      if( latestVersion && latestVersion.status === 'Accepted' && errorReportGate.isLoading ) {
        setError( 'Please wait while we check related error reports, then try again.' )
        return
      }
      if( latestVersion && latestVersion.status === 'Accepted' && errorReportGate.isBlocking ) {
        setError( 'To create the next version from an Accepted version, at least one related error report must have latest version in Accepted.' )
        return
      }
      setError( "To create a version: ((user is project leader) or (user is latest version author) or (user is admin)) and ((latest version status = 'In Review' or 'Reviewed') or ((latest version status = 'Accepted') and (exists related error report with latest version status = 'Accepted')))." )
      return
    }
    setError( null )
    setSuccessMessage( null )
    setWarningMessage( null )
    setIsBusy( true )
    try {
      const counterRef = doc( db, 'counters', `versions_${docId}` )
      const versionRef = doc( collection( db, 'versions' ) )
      await runTransaction( db, async ( transaction ) => {
        const counterSnap = await transaction.get( counterRef )
        const txFallbackNext = ( versions.length > 0 ? versions[0].number + 1 : FIRST_VERSION_NUMBER )
        const txNextNumberRaw = counterSnap.data()?.nextNumber
        const txNextNumber = typeof txNextNumberRaw === 'number' ? txNextNumberRaw : txFallbackNext
        const counterPayload = {
          nextNumber: txNextNumber + 1,
          docId,
          projectId,
          previousVersionId: latestVersion?.id ?? null,
        }
        const versionPayload = {
          projectId,
          docId,
          number: txNextNumber,
          status: 'In Creation',
          createdBy: userId,
          reviewerIds: [],
          reviewStartAt: null,
          reviewEndAt: null,
          hasFile: false,
          fileRefId: null,
          stats: {
            numThreads: 0,
            numOpenThreads: 0,
            numComments: 0,
            numThreadsWithTwoPlusComments: 0,
          },
          numThreads: 0,
          numOpenThreads: 0,
          numComments: 0,
          numThreadsWithTwoPlusComments: 0,
          acceptedErrorReportId: null,
          previousVersionId: latestVersion?.id ?? null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        }

        transaction.set(
          counterRef,
          counterPayload,
          { merge: true },
        )

        transaction.set( versionRef, versionPayload )
        if( latestVersion && latestVersion.status === 'In Review' ) {
          transaction.update( doc( db, 'versions', latestVersion.id ), {
            status: 'Reviewed',
            updatedAt: serverTimestamp(),
            updatedBy: userId,
          } )
        }
      } )
      setSuccessMessage( 'Version created successfully.' )
      void ( async () => {
        try {
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'createVersion',
            entityType: 'version',
            entityId: versionRef.id,
            projectId,
            docId,
            versionId: versionRef.id,
          } )
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'taskAppear',
            entityType: 'task',
            entityId: `authoring:${versionRef.id}:${userId}`,
            projectId,
            docId,
            versionId: versionRef.id,
            targetUserId: userId,
            metadata: {
              taskType: 'authoring',
              taskKey: `authoring:${versionRef.id}:${userId}`,
            },
          } )
          if( latestVersion && latestVersion.status === 'Accepted' ) {
            await logAudit( {
              actorId: userId,
              actorEmail: user?.email ?? null,
              action: 'taskComplete',
              entityType: 'task',
              entityId: `acceptedReport:${latestVersion.id}:${userId}`,
              projectId,
              docId,
              versionId: latestVersion.id,
              targetUserId: userId,
              metadata: {
                taskType: 'acceptedReport',
                taskKey: `acceptedReport:${latestVersion.id}:${userId}`,
              },
            } )
          }
        } catch( err ) {
          console.warn( 'Audit log failed (create version):', err )
        }
      } )()
      void loadDocumentAndVersions()
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      const loweredMessage = message.toLowerCase()
      if( loweredMessage.includes( 'missing or insufficient permissions' ) || loweredMessage.includes( 'permission-denied' ) ) {
        setError( "To create a version: ((user is project leader) or (user is latest version author) or (user is admin)) and ((latest version status = 'In Review' or 'Reviewed') or ((latest version status = 'Accepted') and (exists related error report with latest version status = 'Accepted')))." )
      } else {
        setError( message )
      }
    } finally {
      setIsBusy( false )
    }
  }

  const handleToggleReviewer = useCallback( async (reviewerId: string) => {
    if( !selectedVersion || !userId ) {
      setError( 'Select a version to assign reviewers.' )
      return
    }
    if( !canAssignReviewers ) {
      if( selectedVersion.status !== 'In Creation' ) {
        setError( 'You can assign reviewers only while the version is In Creation.' )
      } else {
        setError( 'You can assign reviewers only if you are the author, project leader, or admin.' )
      }
      return
    }
    if( !allowedReviewerIds.includes( reviewerId ) ) {
      setError( 'Reviewers must be project members (including the leader). Select a member from the list.' )
      return
    }
    const previousReviewerIds = selectedReviewerIds
    const nextReviewerIds = selectedReviewerIds.includes( reviewerId )
      ? selectedReviewerIds.filter( ( currentId ) => currentId !== reviewerId )
      : [ ...selectedReviewerIds, reviewerId ]
    setSelectedReviewerIds( nextReviewerIds )
    setIsBusy( true )
    setError( null )
    try {
      await updateDoc( doc( db, 'versions', selectedVersion.id ), {
        reviewerIds: nextReviewerIds,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      } )
    } catch( err ) {
      setSelectedReviewerIds( previousReviewerIds )
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setError( message )
      setIsBusy( false )
      return
    }
    try {
      await logAudit( {
        actorId: userId,
        actorEmail: user?.email ?? null,
        action: 'updateReviewers',
        entityType: 'version',
        entityId: selectedVersion.id,
        projectId,
        docId,
        versionId: selectedVersion.id,
        metadata: {
          reviewerIds: nextReviewerIds,
        },
      } )
    } catch( err ) {
      console.warn( 'Audit log failed (update reviewers):', err )
    } finally {
      setIsBusy( false )
    }
  }, [
    selectedVersion,
    userId,
    canAssignReviewers,
    allowedReviewerIds,
    selectedReviewerIds,
    user?.email,
    projectId,
    docId,
  ] )
  const handleAssignAuthor = useCallback( async (authorId: string) => {
    if( !selectedVersion || !userId ) {
      setError( 'Select a version to change the author.' )
      return
    }
    if( !canAssignAuthor ) {
      if( selectedVersion.status !== 'In Creation' ) {
        setError( 'You can change the author only while the version is In Creation.' )
      } else {
        setError( 'You can change the author only if you are the project leader or admin.' )
      }
      return
    }
    if( !authorId ) {
      setError( 'Select a project member as the new author.' )
      return
    }
    const isMember = projectMembers.some( ( member ) => member.userId === authorId )
    if( !isMember ) {
      setError( 'The author must be a project member (including the leader).' )
      return
    }
    if( authorId === selectedVersion.createdBy ) {
      setSelectedAuthorId( authorId )
      return
    }
    const previousAuthorId = selectedAuthorId || selectedVersion.createdBy
    const previousReviewerIds = selectedReviewerIds
    setError( null )
    const sanitizedReviewerIds = selectedReviewerIds.filter( ( reviewerId ) => reviewerId !== authorId )
    setSelectedAuthorId( authorId )
    setSelectedReviewerIds( sanitizedReviewerIds )
    setIsBusy( true )
    try {
      await updateDoc( doc( db, 'versions', selectedVersion.id ), {
        createdBy: authorId,
        reviewerIds: sanitizedReviewerIds,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      } )
    } catch( err ) {
      setSelectedAuthorId( previousAuthorId )
      setSelectedReviewerIds( previousReviewerIds )
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setError( message )
      setIsBusy( false )
      return
    }
    try {
      await logAudit( {
        actorId: userId,
        actorEmail: user?.email ?? null,
        action: 'assignAuthor',
        entityType: 'version',
        entityId: selectedVersion.id,
        projectId,
        docId,
        versionId: selectedVersion.id,
        targetUserId: authorId,
      } )
    } catch( err ) {
      console.warn( 'Audit log failed (assign author):', err )
    } finally {
      setIsBusy( false )
    }
  }, [
    selectedVersion,
    userId,
    canAssignAuthor,
    projectMembers,
    selectedReviewerIds,
    selectedAuthorId,
    user?.email,
    projectId,
    docId,
  ] )

  const handleUploadFile = async (file: File) => {
    if( !docId || !projectId || !selectedVersion || !userId ) {
      setError( 'Select a version to upload a file.' )
      return
    }
    if( !canUploadFile ) {
      setError( 'You can upload a file only while the version is In Creation.' )
      return
    }
    const lockedVersionId = selectedVersion.id

    setError( null )
    setSuccessMessage( null )
    setIsBusy( true )
    setUploadStatus( 'uploading' )
    setUploadMessage( 'Uploading...' )
    const fileKey = buildFileKey( {
      projectId,
      documentId: docId,
      versionId: selectedVersion.id,
      fileName: file.name,
    } )
    let uploadedNewFile = false
    let shouldDeleteUploadedOnError = true
    let uploadedProvider: FileStorageProviderKind = 'files-api'
    try {
      const existingFileKey = selectedFileRef?.fileKey ?? null
      const existingFileProvider = selectedFileRef?.storageProvider ?? 'files-api'
      const shouldDeleteExistingAfterCommit = Boolean( existingFileKey && existingFileKey !== fileKey )
      // If we overwrote the same key, deleting on rollback would remove the valid file.
      shouldDeleteUploadedOnError = !existingFileKey || existingFileKey !== fileKey
      const uploadResponse = await uploadFileUsingActiveProvider( fileKey, file, {
        overwrite: true,
      } )
      uploadedNewFile = true
      uploadedProvider = uploadResponse.storageProvider
      const fileRefDoc = doc( collection( db, 'files' ) )
      const fileRefPayload = {
        fileKey,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: Number( uploadResponse.sizeBytes ),
        isPermanent: Boolean( uploadResponse.isPermanent ),
        expireAfterDays:
          typeof uploadResponse.expireAfterDays === 'number'
            ? Number( uploadResponse.expireAfterDays )
            : null,
        storageProvider: uploadResponse.storageProvider,
        projectId,
        docId,
        versionId: selectedVersion.id,
        createdAt: serverTimestamp(),
        createdBy: userId,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      }
      const batch = writeBatch( db )
      batch.set( fileRefDoc, fileRefPayload )
      batch.update( doc( db, 'versions', selectedVersion.id ), {
        hasFile: true,
        fileRefId: fileRefDoc.id,
        fileUploadedAt: serverTimestamp(),
        fileUploadedBy: userId,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      } )
      await batch.commit()
      await logAudit( {
        actorId: userId,
        actorEmail: user?.email ?? null,
        action: 'uploadFile',
        entityType: 'file',
        entityId: fileRefDoc.id,
        projectId,
        docId,
        versionId: selectedVersion.id,
        metadata: {
          fileKey,
          fileName: file.name,
        },
      } )
      if( shouldDeleteExistingAfterCommit && existingFileKey ) {
        try {
          await deleteFileByProvider( existingFileKey, existingFileProvider )
        } catch {
          // Ignore cleanup errors; the new upload is already committed.
        }
      }
      setUploadStatus( 'success' )
      setUploadMessage( `Uploaded: ${file.name}` )
      if( uploadInputRef.current ) {
        uploadInputRef.current.value = ''
      }
      await reloadAndRestoreSelection( lockedVersionId )
    } catch( err ) {
      if( uploadedNewFile && shouldDeleteUploadedOnError ) {
        try {
          await deleteFileByProvider( fileKey, uploadedProvider )
        } catch {
          // Ignore cleanup errors when rollback upload fails.
        }
      }
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setError( message )
      setUploadStatus( 'error' )
      setUploadMessage( message )
    } finally {
      setIsBusy( false )
    }
  }

  const memberColumns = useMemo<ColumnDef<{
    userId: string
    role: string
    memberLabel: string
    statusLabel: string
    isAuthor: boolean
    isReviewer: boolean
  }>[]>( 
    () => {
      const columns: ColumnDef<{
        userId: string
        role: string
        memberLabel: string
        statusLabel: string
        isAuthor: boolean
        isReviewer: boolean
      }>[] = [
        {
          header: 'Author',
          accessorKey: 'isAuthor',
          cell: ( info ) => {
            const row = info.row.original
            return (
              <input
                type="radio"
                name="author"
                value={row.userId}
                checked={row.isAuthor}
                onChange={() => void handleAssignAuthor( row.userId )}
                disabled={isBusy}
              />
            )
          },
        },
        {
          header: 'Reviewer',
          accessorKey: 'isReviewer',
          cell: ( info ) => {
            const row = info.row.original
            return (
              <input
                type="checkbox"
                checked={row.isReviewer}
                onChange={() => handleToggleReviewer( row.userId )}
                disabled={isBusy || row.isAuthor}
              />
            )
          },
        },
        {
          header: 'Member',
          accessorKey: 'memberLabel',
        },
      ]
      if( !isMembersTableCompact ) {
        columns.push(
          {
            header: 'Role',
            accessorKey: 'role',
          },
          {
            header: 'Status',
            accessorKey: 'statusLabel',
          },
        )
      }
      return columns
    },
    [ handleAssignAuthor, handleToggleReviewer, isBusy, isMembersTableCompact ],
  )

  const handleDownloadFile = async () => {
    if( !selectedVersion ) {
      setError( 'Select a version to download a file.' )
      return
    }
    if( !hasLinkedFileMetadata( selectedVersion ) ) {
      setError( 'No file is linked to this version.' )
      return
    }
    if( !selectedFileRef ) {
      setError(
        'Cannot download this file: version metadata is incomplete (fileRefId is missing). Please re-upload/replace the file for this version.',
      )
      return
    }
    if( !selectedFileRef.fileKey ) {
      setError( 'Cannot download this file: linked file metadata is missing file key.' )
      return
    }
    setError( null )
    setSuccessMessage( null )
    setDownloadStatus( 'downloading' )
    setDownloadMessage( 'Preparing download...' )
    const attemptId = `${Date.now()}-${Math.random().toString( 36 ).slice( 2, 8 )}`
    try {
      console.info( '[download][selected_file_preflight]', {
        attemptId,
        versionId: selectedVersion.id,
        versionNumber: selectedVersion.number,
        fileRefId: selectedVersion.fileRefId,
        fileKey: selectedFileRef.fileKey,
        storageProvider: selectedFileRef.storageProvider,
      } )
      setDownloadMessage( 'Downloading file...' )
      await executeDownloadWithTimeout(
        () =>
          downloadFileByProvider(
            selectedFileRef.fileKey,
            selectedFileRef.fileName,
            selectedFileRef.storageProvider,
          ),
        {
          attemptId,
          timeoutMessage: 'Download failed (timeout): the server took too long to respond.',
          onSlowNotice: () => setDownloadMessage( 'Still downloading from the server...' ),
        },
      )
    } catch( err ) {
      const rawMessage = err instanceof Error ? err.message : 'Unexpected error'
      setError( normalizeDownloadError( rawMessage ) )
    } finally {
      setDownloadStatus( 'idle' )
      setDownloadMessage( '' )
    }
  }

  const requestDownloadSelectedFile = () => {
    if( downloadStatus === 'downloading' ) {
      return
    }
    if( !userId ) {
      setError( 'Sign in before downloading a file.' )
      return
    }
    void handleDownloadFile()
  }

  const handleStartReview = async () => {
    if( !latestVersion || !userId ) {
      setError( 'Select a version to start review.' )
      return
    }
    if( !canStartReview ) {
      setError( 'To start review, the version must be In Creation, have linked file metadata (fileRefId), have at least one reviewer, and you must be the author or leader.' )
      return
    }

    setError( null )
    setSuccessMessage( null )
    setSuccessEmailRecipients( null )
    setEmailNotifyStatus( 'idle' )
    setEmailNotifyMessage( '' )
    setIsBusy( true )
    try {
      const reviewEndAt = Timestamp.fromDate( new Date( Date.now() + REVIEW_WINDOW_MS ) )
      const batch = writeBatch( db )
      batch.update( doc( db, 'versions', latestVersion.id ), {
        status: 'In Review',
        reviewStartAt: serverTimestamp(),
        reviewEndAt,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      } )
      await batch.commit()
      const reviewerIds = latestVersion.reviewerIds ?? []
      void ( async () => {
        try {
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'startReview',
            entityType: 'version',
            entityId: latestVersion.id,
            projectId,
            docId,
            versionId: latestVersion.id,
          } )
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'taskComplete',
            entityType: 'task',
            entityId: `authoring:${latestVersion.id}:${latestVersion.createdBy ?? ''}`,
            projectId,
            docId,
            versionId: latestVersion.id,
            targetUserId: latestVersion.createdBy ?? '',
            metadata: {
              taskType: 'authoring',
              taskKey: `authoring:${latestVersion.id}:${latestVersion.createdBy ?? ''}`,
            },
          } )
          await Promise.all(
            reviewerIds.map( async ( reviewerId ) =>
              logAudit( {
                actorId: userId,
                actorEmail: user?.email ?? null,
                action: 'taskAppear',
                entityType: 'task',
                entityId: `reviewer:${latestVersion.id}:${reviewerId}`,
                projectId,
                docId,
                versionId: latestVersion.id,
                targetUserId: reviewerId,
                metadata: {
                  taskType: 'reviewer',
                  taskKey: `reviewer:${latestVersion.id}:${reviewerId}`,
                },
              } ),
            ),
          )
        } catch( err ) {
          console.warn( 'Audit log failed (start review):', err )
        }
      } )()
      const authorEmail = latestVersion.createdBy ? resolveUserEmail( latestVersion.createdBy ) : null
      const reviewerEmails = ( latestVersion.reviewerIds ?? [] )
        .map( ( reviewerId ) => resolveUserEmail( reviewerId ) )
        .filter( ( email ): email is string => Boolean( email ) )
        .filter( ( email ) => ( authorEmail ? email !== authorEmail : true ) )
      const toRecipients = authorEmail ? [ authorEmail ] : reviewerEmails.slice( 0, 1 )
      const ccRecipients = authorEmail ? reviewerEmails : reviewerEmails.slice( 1 )
      let sentReviewEmailRecipients: { to: string[]; cc: string[] } | null = null
      if( toRecipients.length > 0 ) {
        const docLabel = `${documentData?.shortId ?? documentData?.id ?? 'Document'} - ${documentData?.title ?? ''}`.trim()
        const versionLabel = versionNumberToString( latestVersion.number )
        const versionUrlQuery = new URLSearchParams()
        if( projectId ) {
          versionUrlQuery.set( 'projectId', projectId )
        }
        versionUrlQuery.set( 'versionId', latestVersion.id )
        versionUrlQuery.set( 'focus', 'issues' )
        const origin = window.location.origin
        const versionDirectUrl = `${origin}/documents/${encodeURIComponent( docId ?? '' )}/versions?${versionUrlQuery.toString()}`
        try {
          setEmailNotifyStatus( 'sending' )
          setEmailNotifyMessage( 'Sending review notifications...' )
          await notifyEmailUsingActiveProvider( {
            to: toRecipients,
            cc: ccRecipients,
            subject: `Review started: ${docLabel} v${versionLabel}`,
            text: `Review started for ${docLabel}.\nVersion: ${versionLabel}\nReviewers: ${
              reviewerIds.length > 0
                ? reviewerIds.map( ( reviewerId ) => formatUserLabel( reviewerId ) ).join( ', ' )
                : 'None'
            }\nStarted by: ${formatUserLabel( userId )}\n\nOpen this version:\n${versionDirectUrl}\n`,
          } )
          sentReviewEmailRecipients = { to: [ ...toRecipients ], cc: [ ...ccRecipients ] }
        } catch( err ) {
          console.warn( 'Email notify failed (start review):', err )
          const message = err instanceof Error ? err.message : 'Unexpected error'
          setWarningMessage( `Review started, but email notification failed: ${message}` )
        } finally {
          setEmailNotifyStatus( 'idle' )
          setEmailNotifyMessage( '' )
        }
      } else {
        setWarningMessage( 'Review started, but no recipient email was resolved for author/reviewers.' )
      }
      setSuccessEmailRecipients( sentReviewEmailRecipients )
      setSuccessMessage( 'Review started successfully.' )
      void loadDocumentAndVersions()
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setError( message )
    } finally {
      setEmailNotifyStatus( 'idle' )
      setEmailNotifyMessage( '' )
      setIsBusy( false )
    }
  }

  const handleAcceptLatestVersion = async () => {
    if( !docId || !userId || !latestVersion ) {
      setError( 'Select the latest version before accepting.' )
      return
    }
    if( !canAcceptOrReject ) {
      setError( 'To accept, the latest version must be in review time or grace, have a file, all issues closed, and at least one issue with two or more comments; you must be author, leader, or admin.' )
      return
    }

    setError( null )
    setSuccessMessage( null )
    setIsBusy( true )
    try {
      const promotedNumber = ( Math.floor( latestVersion.number / 100 ) + 1 ) * 100
      const previousAccepted = versions.find(
        ( versionItem ) =>
          versionItem.id !== latestVersion.id &&
          versionItem.status === 'Accepted' &&
          isIntegerVersionNumber( versionItem.number ),
      )

      const batch = writeBatch( db )
      batch.update( doc( db, 'versions', latestVersion.id ), {
        number: promotedNumber,
        status: 'Accepted',
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      } )
      if( previousAccepted && ( isLeader || isAdmin || previousAccepted.createdBy === userId ) ) {
        batch.update( doc( db, 'versions', previousAccepted.id ), {
          status: 'Replaced',
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        } )
      }
      await batch.commit()
      setSuccessMessage( 'Latest version accepted successfully.' )
      void ( async () => {
        try {
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'acceptVersion',
            entityType: 'version',
            entityId: latestVersion.id,
            projectId,
            docId,
            versionId: latestVersion.id,
          } )
        } catch( err ) {
          console.warn( 'Audit log failed (accept version):', err )
        }
      } )()
      const baseVersionId = documentData?.baseVersionId ?? null
      if( documentData?.type === 'errorReport' && baseVersionId ) {
        void ( async () => {
          try {
            const baseVersionSnapshot = await getDoc( doc( db, 'versions', baseVersionId ) )
            const baseVersionData = baseVersionSnapshot.data()
            const baseAuthorId = ( baseVersionData?.createdBy as string | undefined ) ?? ''
            const baseProjectId = ( baseVersionData?.projectId as string | undefined ) ?? projectId
            const leaderSnapshot = baseProjectId
              ? await getDocs(
                query(
                  collection( db, 'projectMembers' ),
                  where( 'projectId', '==', baseProjectId ),
                  where( 'role', '==', 'leader' ),
                ),
              )
              : null
            const leaderId = leaderSnapshot?.docs[0]?.data()?.userId as string | undefined
            const taskTargets = [ baseAuthorId, leaderId ].filter( Boolean ) as string[]
            await Promise.all(
              taskTargets.map( async ( targetId ) =>
                logAudit( {
                  actorId: userId,
                  actorEmail: user?.email ?? null,
                  action: 'taskAppear',
                  entityType: 'task',
                  entityId: `acceptedReport:${documentData.baseVersionId}:${targetId}`,
                  projectId: baseProjectId,
                  docId: documentData.baseDocId ?? '',
                  versionId: documentData.baseVersionId ?? '',
                  targetUserId: targetId,
                  metadata: {
                    taskType: 'acceptedReport',
                    taskKey: `acceptedReport:${documentData.baseVersionId}:${targetId}`,
                  },
                } ),
              ),
            )
          } catch {
            // ignore task appearance logging failures
          }
        } )()
      }
      void loadDocumentAndVersions()
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setError( message )
    } finally {
      setIsBusy( false )
    }
  }

  const handleRejectLatestVersion = async () => {
    if( !docId || !userId || !latestVersion ) {
      setError( 'Select the latest version before rejecting.' )
      return
    }
    if( !canAcceptOrReject ) {
      setError( 'To reject, the latest version must be in review time or grace, have a file, all issues closed, and at least one issue with two or more comments; you must be author, leader, or admin.' )
      return
    }

    setError( null )
    setSuccessMessage( null )
    setIsBusy( true )
    try {
      const previousAccepted = versions.find(
        ( versionItem ) =>
          versionItem.id !== latestVersion.id &&
          versionItem.status === 'Accepted' &&
          isIntegerVersionNumber( versionItem.number ),
      )

      const batch = writeBatch( db )
      batch.update( doc( db, 'versions', latestVersion.id ), {
        status: 'Rejected',
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      } )
      if( previousAccepted && ( isLeader || isAdmin || previousAccepted.createdBy === userId ) ) {
        batch.update( doc( db, 'versions', previousAccepted.id ), {
          status: 'Replaced',
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        } )
      }
      await batch.commit()
      setSuccessMessage( 'Latest version rejected successfully.' )
      void ( async () => {
        try {
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'rejectVersion',
            entityType: 'version',
            entityId: latestVersion.id,
            projectId,
            docId,
            versionId: latestVersion.id,
          } )
        } catch( err ) {
          console.warn( 'Audit log failed (reject version):', err )
        }
      } )()
      void loadDocumentAndVersions()
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setError( message )
    } finally {
      setIsBusy( false )
    }
  }

  const handleCreateErrorReport = async (title: string) => {
    if( !latestVersion || !projectId || !docId || !userId ) {
      setError( 'Select the latest Accepted version before creating an error report.' )
      return
    }
    if( !canCreateErrorReportActor ) {
      setError( 'Only project members or admins can create an error report.' )
      return
    }
    if( latestVersion.status !== 'Accepted' ) {
      setError( 'You can create an error report only when the latest version is Accepted.' )
      return
    }
    if( title.trim().length === 0 ) {
      setErrorReportTitleError( 'Provide a title for the error report before creating it.' )
      return
    }
    setError( null )
    setSuccessMessage( null )
    setIsBusy( true )
    try {
      const counterRef = doc( db, 'counters', `documents_${projectId}` )
      const errorReportRef = doc( collection( db, 'documents' ) )
      const versionRef = doc( collection( db, 'versions' ) )
      const versionCounterRef = doc( db, 'counters', `versions_${errorReportRef.id}` )
      await runTransaction( db, async ( transaction ) => {
        const counterSnap = await transaction.get( counterRef )
        const nextNumberRaw = counterSnap.data()?.nextNumber
        const nextNumber = typeof nextNumberRaw === 'number' ? nextNumberRaw : 1
        transaction.set(
          counterRef,
          {
            nextNumber: nextNumber + 1,
            docId,
            projectId,
          },
          { merge: true },
        )
        transaction.set( errorReportRef, {
          projectId,
          title: title.trim(),
          type: 'errorReport',
          baseDocId: docId,
          baseVersionId: latestVersion.id,
          createdBy: userId,
          updatedBy: userId,
          shortId: nextNumber,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } )
        transaction.set( versionRef, {
          projectId,
          docId: errorReportRef.id,
          number: FIRST_VERSION_NUMBER,
          status: 'In Creation',
          createdBy: userId,
          reviewerIds: [],
          reviewStartAt: null,
          reviewEndAt: null,
          hasFile: false,
          fileRefId: null,
          stats: {
            numThreads: 0,
            numOpenThreads: 0,
            numComments: 0,
            numThreadsWithTwoPlusComments: 0,
          },
          numThreads: 0,
          numOpenThreads: 0,
          numComments: 0,
          numThreadsWithTwoPlusComments: 0,
          acceptedErrorReportId: null,
          previousVersionId: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        } )
        transaction.set(
          versionCounterRef,
          {
            nextNumber: FIRST_VERSION_NUMBER + 1,
            docId: errorReportRef.id,
            projectId,
            previousVersionId: null,
          },
          { merge: true },
        )
      } )
      await logAudit( {
        actorId: userId,
        actorEmail: user?.email ?? null,
        action: 'createErrorReport',
        entityType: 'document',
        entityId: errorReportRef.id,
        projectId,
        docId: errorReportRef.id,
        metadata: {
          baseDocId: docId,
          baseVersionId: latestVersion.id,
        },
      } )
      setIsErrorReportModalOpen( false )
      setErrorReportTitle( '' )
      setErrorReportTitleError( null )
      navigate( `/documents/${errorReportRef.id}/versions?projectId=${projectId}` )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setError( message )
    } finally {
      setIsBusy( false )
    }
  }

  const handleConfirmVersionDecision = async () => {
    if( versionDecisionModal === 'accept' ) {
      setVersionDecisionModal( null )
      await handleAcceptLatestVersion()
      return
    }
    if( versionDecisionModal === 'reject' ) {
      setVersionDecisionModal( null )
      await handleRejectLatestVersion()
    }
  }

  const requestVersionDecisionConfirmation = ( decision: 'accept' | 'reject' ) => {
    if( !docId || !userId || !latestVersion ) {
      setError( decision === 'accept' ? 'Select the latest version before accepting.' : 'Select the latest version before rejecting.' )
      return
    }
    if( !canAcceptOrReject ) {
      setError(
        decision === 'accept'
          ? 'To accept, the latest version must be in review time or grace, have a file, all issues closed, and at least one issue with two or more comments; you must be author, leader, or admin.'
          : 'To reject, the latest version must be in review time or grace, have a file, all issues closed, and at least one issue with two or more comments; you must be author, leader, or admin.',
      )
      return
    }
    setError( null )
    setVersionDecisionModal( decision )
  }

  const handleConfirmPendingVersionAction = async () => {
    const action = pendingVersionAction
    const file = pendingUploadFile
    setPendingVersionAction( null )
    setPendingUploadFile( null )
    if( action === 'createVersion' ) {
      await handleCreateVersion()
      return
    }
    if( action === 'startReview' ) {
      await handleStartReview()
      return
    }
    if( action === 'replaceFile' ) {
      if( file ) {
        await handleUploadFile( file )
      } else {
        setError( 'Select a file before replacing the current one.' )
      }
      if( uploadInputRef.current ) {
        uploadInputRef.current.value = ''
      }
    }
  }

  const requestCreateVersionConfirmation = () => {
    if( !docId || !projectId || !userId || !documentData ) {
      setError( 'Sign in and select a document before creating a version.' )
      return
    }
    if( !canCreateVersion ) {
      if( latestVersion && latestVersion.status === 'Accepted' && errorReportGate.isLoading ) {
        setError( 'Please wait while we check related error reports, then try again.' )
        return
      }
      if( latestVersion && latestVersion.status === 'Accepted' && errorReportGate.isBlocking ) {
        setError( 'To create the next version from an Accepted version, at least one related error report must have latest version in Accepted.' )
        return
      }
      setError( "To create a version: ((user is project leader) or (user is latest version author) or (user is admin)) and ((latest version status = 'In Review' or 'Reviewed') or ((latest version status = 'Accepted') and (exists related error report with latest version status = 'Accepted')))." )
      return
    }
    setError( null )
    setPendingVersionAction( 'createVersion' )
  }

  const requestStartReviewConfirmation = () => {
    if( !latestVersion || !userId ) {
      setError( 'Select a version to start review.' )
      return
    }
    if( !canStartReview ) {
      setError( 'To start review, the version must be In Creation, have linked file metadata (fileRefId), have at least one reviewer, and you must be the author or leader.' )
      return
    }
    setError( null )
    setPendingVersionAction( 'startReview' )
  }

  const requestReplaceFileConfirmation = (file: File) => {
    if( !docId || !projectId || !selectedVersion || !userId ) {
      setError( 'Select a version to upload a file.' )
      if( uploadInputRef.current ) {
        uploadInputRef.current.value = ''
      }
      return
    }
    if( !canUploadFile ) {
      setError( 'You can upload a file only while the version is In Creation.' )
      if( uploadInputRef.current ) {
        uploadInputRef.current.value = ''
      }
      return
    }
    setError( null )
    setPendingUploadFile( file )
    setPendingVersionAction( 'replaceFile' )
  }

  const handleCreateThread = async () => {
    if( !selectedVersion || !projectId || !docId || !userId ) {
      setError( 'Select a version to create an issue.' )
      return
    }
    if( !canCreateThread ) {
      setError( 'To create an issue, the version must be in active review time or grace, you must be the author, leader, or reviewer, and the title cannot be empty.' )
      return
    }
    const lockedVersionId = selectedVersion.id
    setError( null )
    setIsBusy( true )
    try {
      const threadRef = doc( collection( db, 'threads' ) )
      const versionRef = doc( db, 'versions', selectedVersion.id )
      const threadTitle = normalizeIssueTitleInput( newThreadTitle ).trim()
      await runTransaction( db, async ( transaction ) => {
        const versionSnap = await transaction.get( versionRef )
        if( !versionSnap.exists() ) {
          throw new Error( 'Version not found.' )
        }
        const versionData = versionSnap.data()
        const currentStats = {
          numThreads: Number( versionData.stats?.numThreads ?? versionData.numThreads ?? 0 ),
          numOpenThreads: Number( versionData.stats?.numOpenThreads ?? versionData.numOpenThreads ?? 0 ),
          numComments: Number( versionData.stats?.numComments ?? versionData.numComments ?? 0 ),
          numThreadsWithTwoPlusComments: Number(
            versionData.stats?.numThreadsWithTwoPlusComments ?? versionData.numThreadsWithTwoPlusComments ?? 0,
          ),
        }
        transaction.set( threadRef, {
          projectId,
          docId,
          versionId: selectedVersion.id,
          status: 'open',
          title: threadTitle,
          createdBy: userId,
          commentCount: 0,
          lastCommentAt: null,
          lastCommentBy: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        } )
        transaction.update( versionRef, {
          stats: {
            numThreads: currentStats.numThreads + 1,
            numOpenThreads: currentStats.numOpenThreads + 1,
            numComments: currentStats.numComments,
            numThreadsWithTwoPlusComments: currentStats.numThreadsWithTwoPlusComments,
          },
          numThreads: currentStats.numThreads + 1,
          numOpenThreads: currentStats.numOpenThreads + 1,
          numComments: currentStats.numComments,
          numThreadsWithTwoPlusComments: currentStats.numThreadsWithTwoPlusComments,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        } )
      } )
      setNewThreadTitle( '' )
      setSelectedThreadId( threadRef.id )
      setSuccessMessage( 'Issue created successfully.' )
      void ( async () => {
        try {
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'createThread',
            entityType: 'thread',
            entityId: threadRef.id,
            projectId,
            docId,
            versionId: selectedVersion.id,
            threadId: threadRef.id,
          } )
        } catch( err ) {
          console.warn( 'Audit log failed (create issue):', err )
        }
      } )()
      await reloadAndRestoreSelection( lockedVersionId, threadRef.id )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setError( normalizeDownloadError( message ) )
    } finally {
      setIsBusy( false )
    }
  }

  const handleAddComment = async () => {
    if( !selectedVersion || !projectId || !docId || !selectedThread || !userId ) {
      setError( 'Select a version and issue to add a comment.' )
      return
    }
    const lockedVersionId = selectedVersion.id
    if( !canAddComment ) {
      setError( 'To add a comment, the issue must be open, and either review is still active or the issue has a last comment less than one hour old after review expiry.' )
      return
    }
    setError( null )
    setSuccessEmailRecipients( null )
    setEmailNotifyStatus( 'idle' )
    setEmailNotifyMessage( '' )
    setIsBusy( true )
    try {
      const commentBody = newCommentBody.trim()
      const commentRef = doc( collection( db, 'comments' ) )
      const versionRef = doc( db, 'versions', selectedVersion.id )
      const threadRef = doc( db, 'threads', selectedThread.id )
      await runTransaction( db, async ( transaction ) => {
        const [ versionSnap, threadSnap ] = await Promise.all( [
          transaction.get( versionRef ),
          transaction.get( threadRef ),
        ] )
        if( !versionSnap.exists() || !threadSnap.exists() ) {
          throw new Error( 'Version or issue not found.' )
        }
        const versionData = versionSnap.data()
        const threadData = threadSnap.data()
        const isCommentAllowed = canAddCommentInWindow( {
          versionStatus: ( versionData.status as string | undefined ) ?? '',
          reviewEndAt: toTimestampDate( versionData.reviewEndAt ),
          threadStatus: ( threadData.status as string | undefined ) ?? 'open',
          lastThreadCommentAt: toTimestampDate( threadData.lastCommentAt ),
          canParticipate: canParticipateReview,
          hasBody: commentBody.length > 0,
        } )
        if( !isCommentAllowed ) {
          throw new Error( 'Comment window expired for this issue.' )
        }
        const currentStats = {
          numThreads: Number( versionData.stats?.numThreads ?? versionData.numThreads ?? 0 ),
          numOpenThreads: Number( versionData.stats?.numOpenThreads ?? versionData.numOpenThreads ?? 0 ),
          numComments: Number( versionData.stats?.numComments ?? versionData.numComments ?? 0 ),
          numThreadsWithTwoPlusComments: Number(
            versionData.stats?.numThreadsWithTwoPlusComments ?? versionData.numThreadsWithTwoPlusComments ?? 0,
          ),
        }
        const previousThreadCommentCount = Number( threadData.commentCount ?? 0 )
        const nextThreadCommentCount = previousThreadCommentCount + 1
        const incrementTwoPlusCounter = previousThreadCommentCount < 2 && nextThreadCommentCount >= 2 ? 1 : 0
        transaction.set( commentRef, {
          projectId,
          docId,
          versionId: selectedVersion.id,
          threadId: selectedThread.id,
          body: commentBody,
          createdBy: userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } )
        transaction.update( threadRef, {
          commentCount: nextThreadCommentCount,
          lastCommentAt: serverTimestamp(),
          lastCommentBy: userId,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        } )
        transaction.update( versionRef, {
          stats: {
            numThreads: currentStats.numThreads,
            numOpenThreads: currentStats.numOpenThreads,
            numComments: currentStats.numComments + 1,
            numThreadsWithTwoPlusComments: currentStats.numThreadsWithTwoPlusComments + incrementTwoPlusCounter,
          },
          numThreads: currentStats.numThreads,
          numOpenThreads: currentStats.numOpenThreads,
          numComments: currentStats.numComments + 1,
          numThreadsWithTwoPlusComments: currentStats.numThreadsWithTwoPlusComments + incrementTwoPlusCounter,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        } )
      } )
      setNewCommentBody( '' )
      void ( async () => {
        try {
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'createComment',
            entityType: 'comment',
            entityId: commentRef.id,
            projectId,
            docId,
            versionId: selectedVersion.id,
            threadId: selectedThread.id,
            commentId: commentRef.id,
          } )
        } catch( err ) {
          console.warn( 'Audit log failed (add comment):', err )
        }
      } )()
      const participantIds = new Set<string>()
      if( selectedVersion.createdBy ) {
        participantIds.add( selectedVersion.createdBy )
      }
      if( selectedThread.createdBy ) {
        participantIds.add( selectedThread.createdBy )
      }
      selectedVersion.reviewerIds.forEach( ( reviewerId ) => {
        if( reviewerId ) {
          participantIds.add( reviewerId )
        }
      } )
      selectedThreadComments.forEach( ( comment ) => {
        if( comment.createdBy ) {
          participantIds.add( comment.createdBy )
        }
      } )
      participantIds.delete( userId )
      const recipientEmails = Array.from( participantIds )
        .map( ( participantId ) => resolveUserEmail( participantId ) )
        .filter( ( email ): email is string => Boolean( email ) )
      const normalizedRecipientEmails = Array.from( new Set( recipientEmails.map( ( email ) => email.toLowerCase() ) ) )
      const toRecipients = normalizedRecipientEmails.slice( 0, 1 )
      const ccRecipients = normalizedRecipientEmails.slice( 1 )
      let sentCommentEmailRecipients: { to: string[]; cc: string[] } | null = null
      if( toRecipients.length > 0 ) {
        const commentUrlQuery = new URLSearchParams()
        if( projectId ) {
          commentUrlQuery.set( 'projectId', projectId )
        }
        commentUrlQuery.set( 'versionId', selectedVersion.id )
        commentUrlQuery.set( 'threadId', selectedThread.id )
        commentUrlQuery.set( 'commentId', commentRef.id )
        commentUrlQuery.set( 'focus', 'comments' )
        const origin = window.location.origin
        const commentDirectUrl = `${origin}/documents/${encodeURIComponent( docId )}/versions?${commentUrlQuery.toString()}`
        const docLabel = `${documentData?.shortId ?? documentData?.id ?? 'Document'} - ${documentData?.title ?? ''}`.trim()
        const versionLabel = versionNumberToString( selectedVersion.number )
        const commentBodyForEmail = commentBody.length > 1600
          ? `${commentBody.slice( 0, 1600 )}...`
          : commentBody
        try {
          setEmailNotifyStatus( 'sending' )
          setEmailNotifyMessage( 'Sending comment notifications...' )
          await notifyEmailUsingActiveProvider( {
            to: toRecipients,
            cc: ccRecipients,
            subject: `New comment: ${docLabel} v${versionLabel}`,
            text: `A new comment was added.\nDocument: ${docLabel}\nVersion: ${versionLabel}\nIssue: ${selectedThread.title}\nAuthor: ${formatUserLabel( userId )}\n\nComment:\n${commentBodyForEmail}\n\nOpen this comment directly:\n${commentDirectUrl}\n`,
          } )
          sentCommentEmailRecipients = { to: [ ...toRecipients ], cc: [ ...ccRecipients ] }
        } catch( err ) {
          console.warn( 'Email notify failed (add comment):', err )
          const message = err instanceof Error ? err.message : 'Unexpected error'
          setWarningMessage( `Comment added, but email notification failed: ${message}` )
        } finally {
          setEmailNotifyStatus( 'idle' )
          setEmailNotifyMessage( '' )
        }
      } else {
        setWarningMessage( 'Comment added, but no recipient email was resolved for participants.' )
      }
      setSuccessEmailRecipients( sentCommentEmailRecipients )
      setSuccessMessage( 'The comment was added successfully.' )
      await reloadAndRestoreSelection( lockedVersionId, selectedThread.id )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setError( message )
    } finally {
      setEmailNotifyStatus( 'idle' )
      setEmailNotifyMessage( '' )
      setIsBusy( false )
    }
  }

  const canChangeThreadStatus = useCallback( (thread: ThreadSummary) => {
    if( !selectedVersion || !projectId || !docId || !userId ) {
      setError( 'Select a version to update an issue.' )
      return false
    }
    if( !canParticipateReview || !selectedVersionInActiveReview ) {
      setError( 'To close or reopen issues, the version must be in active review time or grace and you must be the author, leader, or reviewer.' )
      return false
    }
    const loadedCommentsCount = commentsByThread[thread.id]?.length ?? 0
    const commentsCount = Math.max( Number( thread.commentCount ?? 0 ), loadedCommentsCount )
    if( commentsCount < 2 ) {
      setError( 'To close or reopen an issue, it must have at least two comments.' )
      return false
    }
    return true
  }, [ selectedVersion, projectId, docId, userId, canParticipateReview, selectedVersionInActiveReview, commentsByThread ] )

  const requestThreadStatusChangeConfirmation = useCallback( (thread: ThreadSummary) => {
    if( !canChangeThreadStatus( thread ) ) {
      return
    }
    selectThreadKeepingViewport( thread.id )
    setError( null )
    setPendingThreadStatusChange( thread )
  }, [ canChangeThreadStatus, selectThreadKeepingViewport ] )

  const threadColumns = useMemo<ColumnDef<ThreadSummary>[]>( () => [
    {
      header: 'Status',
      accessorKey: 'status',
    },
    {
      header: 'Created by',
      accessorKey: 'createdBy',
      cell: ( info ) => formatUserLabel( info.getValue<string>() ),
    },
    {
      header: 'Comments',
      accessorKey: 'commentCount',
      cell: ( info ) => String( info.getValue<number>() ),
    },
    {
      header: 'Comment window',
      id: 'commentWindow',
      cell: ( info ) => getThreadCommentWindowMeta( info.row.original ).label,
    },
    {
      header: 'Action',
      id: 'action',
      cell: ( info ) => {
        const thread = info.row.original
        return (
          <button
            type="button"
            className="thread-table-action-button"
            onClick={( event ) => {
              event.stopPropagation()
              requestThreadStatusChangeConfirmation( thread )
            }}
            disabled={isBusy}
          >
            {thread.status === 'open' ? 'Close' : 'Reopen'}
          </button>
        )
      },
    },
    {
      header: 'Issue',
      accessorKey: 'title',
    },
  ], [ formatUserLabel, getThreadCommentWindowMeta, isBusy, requestThreadStatusChangeConfirmation ] )

  const handleToggleThreadStatus = async (thread: ThreadSummary) => {
    if( !canChangeThreadStatus( thread ) ) {
      return
    }
    const lockedVersionId = selectedVersion?.id ?? null
    setError( null )
    setIsBusy( true )
    try {
      const isClosing = thread.status === 'open'
      const versionRef = doc( db, 'versions', selectedVersion!.id )
      const threadRef = doc( db, 'threads', thread.id )
      await runTransaction( db, async ( transaction ) => {
        const [ versionSnap, threadSnap ] = await Promise.all( [
          transaction.get( versionRef ),
          transaction.get( threadRef ),
        ] )
        if( !versionSnap.exists() || !threadSnap.exists() ) {
          throw new Error( 'Version or issue not found.' )
        }
        const versionData = versionSnap.data()
        const currentStats = {
          numThreads: Number( versionData.stats?.numThreads ?? versionData.numThreads ?? 0 ),
          numOpenThreads: Number( versionData.stats?.numOpenThreads ?? versionData.numOpenThreads ?? 0 ),
          numComments: Number( versionData.stats?.numComments ?? versionData.numComments ?? 0 ),
          numThreadsWithTwoPlusComments: Number(
            versionData.stats?.numThreadsWithTwoPlusComments ?? versionData.numThreadsWithTwoPlusComments ?? 0,
          ),
        }
        const nextOpenThreads = isClosing
          ? Math.max( 0, currentStats.numOpenThreads - 1 )
          : currentStats.numOpenThreads + 1
        transaction.update( threadRef, {
          status: isClosing ? 'closed' : 'open',
          closedBy: isClosing ? userId : null,
          closedAt: isClosing ? serverTimestamp() : null,
          reopenedBy: isClosing ? null : userId,
          reopenedAt: isClosing ? null : serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        } )
        transaction.update( versionRef, {
          stats: {
            numThreads: currentStats.numThreads,
            numOpenThreads: nextOpenThreads,
            numComments: currentStats.numComments,
            numThreadsWithTwoPlusComments: currentStats.numThreadsWithTwoPlusComments,
          },
          numThreads: currentStats.numThreads,
          numOpenThreads: nextOpenThreads,
          numComments: currentStats.numComments,
          numThreadsWithTwoPlusComments: currentStats.numThreadsWithTwoPlusComments,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        } )
      } )
      setSuccessMessage( isClosing ? 'Issue closed successfully.' : 'Issue reopened successfully.' )
      void ( async () => {
        try {
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'updateThreadStatus',
            entityType: 'thread',
            entityId: thread.id,
            projectId,
            docId,
            versionId: selectedVersion!.id,
            threadId: thread.id,
            metadata: {
              status: isClosing ? 'closed' : 'open',
            },
          } )
        } catch( err ) {
          console.warn( 'Audit log failed (update issue status):', err )
        }
      } )()
      await reloadAndRestoreSelection( lockedVersionId, thread.id )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setError( message )
    } finally {
      setIsBusy( false )
    }
  }

  const handleConfirmThreadStatusChange = async () => {
    if( !pendingThreadStatusChange ) {
      return
    }
    const thread = pendingThreadStatusChange
    setPendingThreadStatusChange( null )
    await handleToggleThreadStatus( thread )
  }

  const openReviewIssuesForVersion = (versionId: string) => {
    if( isBusy ) {
      return
    }
    setSelectedVersionId( versionId )
  }

  const moveSelectedVersion = useCallback(
    (direction: 1 | -1) => {
      if( isBusy || versions.length === 0 ) {
        return
      }
      const currentIndex = selectedVersionId
        ? versions.findIndex( ( version ) => version.id === selectedVersionId )
        : -1
      if( currentIndex < 0 ) {
        setSelectedVersionId( versions[0].id )
        return
      }
      const nextIndex = Math.min( versions.length - 1, Math.max( 0, currentIndex + direction ) )
      setSelectedVersionId( versions[nextIndex].id )
    },
    [ isBusy, versions, selectedVersionId ],
  )

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <AppBrand pageTitle="Document Versions" />
          <div className="document-title-row">
            {projectName ? (
              <div className="context-nav-label">
                <span className="document-title-prefix">Project</span>
                <span className="document-title-text">
                  {`${projectShortId ?? 'Unassigned'} - ${projectName}`}
                </span>
              </div>
            ) : null}
            <div className="context-nav-label">
              <span className="document-title-prefix">
                {documentData?.type === 'errorReport' ? 'Error report' : 'Document'}
              </span>
              <span className="document-title-text">
                {`${documentData?.shortId ?? 'Unassigned'} - ${documentData?.title ?? docId ?? 'Unknown'}`}
              </span>
            </div>
          </div>
          {documentData?.type === 'errorReport' ? (
            <p className="muted">
              For document:{' '}
              {baseDocumentData
                ? `${baseDocumentData.shortId ?? 'Unassigned'} - ${baseDocumentData.title}`
                : documentData?.baseDocId
                  ? `Document ${documentData.baseDocId}`
                  : 'Unknown'}
            </p>
          ) : null}
        </div>
        <BackStack
          links={
            projectId
              ? [
                { label: 'Projects', to: '/projects' },
                { label: 'Documents', to: `/projects/${projectId}/documents` },
              ]
              : [
                { label: 'Projects', to: '/projects' },
              ]
          }
        />
      </header>

      <main className="app-main">
          {isLoadingVersions && versions.length === 0 ? (
            <section className="panel">
              <GiphyInline reason="loading" />
            </section>
          ) : (
          <section className="panel stack">
          <div className="panel-header panel-header--versions">
            {!isBusy ? <h2>Versions</h2> : null}
            <div ref={versionsActionsRef} className="actions actions--versions-toolbar">
              <label className="field">
                <span>Selected version</span>
                <select
                  className={`version-select ${versionSelectStatusClassName( selectedVersion )}`.trim()}
                  value={selectedVersion?.id ?? ''}
                  onChange={( event ) => setSelectedVersionId( event.target.value || null )}
                  onKeyDown={( event ) => {
                    if( versions.length === 0 ) {
                      return
                    }
                    if( event.key === 'ArrowLeft' ) {
                      event.preventDefault()
                      moveSelectedVersion( -1 )
                    } else if( event.key === 'ArrowRight' ) {
                      event.preventDefault()
                      moveSelectedVersion( 1 )
                    } else if( event.key === 'Home' ) {
                      event.preventDefault()
                      setSelectedVersionId( versions[0].id )
                    } else if( event.key === 'End' ) {
                      event.preventDefault()
                      setSelectedVersionId( versions[versions.length - 1].id )
                    }
                  }}
                  disabled={isBusy}
                >
                  {versions.map( ( version ) => (
                    <option
                      key={version.id}
                      value={version.id}
                      style={{ backgroundColor: versionStatusColor( version ), color: '#24130f' }}
                    >
                      {versionNumberToString( version.number )} - {version.status}
                    </option>
                  ) )}
                </select>
              </label>
              <button type="button" onClick={requestCreateVersionConfirmation} disabled={isBusy}>
                {createButtonLabel}
              </button>
              <button type="button" onClick={requestStartReviewConfirmation} disabled={isBusy}>
                Start review
              </button>
              <button type="button" onClick={() => requestVersionDecisionConfirmation( 'accept' )} disabled={isBusy}>
                Accept latest
              </button>
              <button type="button" onClick={() => requestVersionDecisionConfirmation( 'reject' )} disabled={isBusy}>
                Reject latest
              </button>
              <button
                type="button"
                onClick={() => {
                  if( !latestVersion || !userId ) {
                    setError( 'Select the latest Accepted version before creating an error report.' )
                    return
                  }
                  if( !canCreateErrorReportActor ) {
                    setError( 'Only project members or admins can create an error report.' )
                    return
                  }
                  if( latestVersion.status !== 'Accepted' ) {
                    setError( 'You can create an error report only when the latest version is Accepted.' )
                    return
                  }
                  setErrorReportTitle( '' )
                  setErrorReportTitleError( null )
                  setIsErrorReportModalOpen( true )
                }}
                disabled={isBusy}
              >
                Create error report
              </button>
            </div>
          </div>
          <div className="actions">
            <label className="field">
              <span>View</span>
              <div className="view-toggle">
                <button
                  type="button"
                  aria-pressed={viewMode === 'card'}
                  onClick={() => setViewMode( 'card' )}
                >
                  Cards
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === 'table'}
                  onClick={() => setViewMode( 'table' )}
                >
                  Table
                </button>
              </div>
            </label>
          </div>
          {selectedReviewTimerLabel ? (
            <section className={`review-timer review-timer--${selectedReviewTimerState}`}>
              <p className="review-timer__eyebrow">Version review time remaining</p>
              <p className="review-timer__value">{selectedReviewTimerLabel}</p>
            </section>
          ) : null}
          {warningMessage ? <p className="notice-warning">{warningMessage}</p> : null}
          {!isBusy && !isLoadingVersions && versions.length === 0 ? (
            <p className="muted">No versions yet.</p>
          ) : viewMode === 'table' ? (
            <DataTable
              key={`qt4_table_versions_${docId ?? 'unknown'}`}
              columns={versionColumns}
              data={versions}
              sorting={versionSorting}
              onSortingChange={setVersionSorting}
              tableClassName="data-table--versions"
              storageKey={`qt4_table_versions_${docId ?? 'unknown'}`}
              getRowClassName={( row ) => `${versionStatusClassName( row )} ${
                selectedVersion?.id === row.id ? 'data-table-row--selected' : ''
              }`.trim()}
              onRowClick={( row ) => openReviewIssuesForVersion( row.id )}
            />
          ) : (
            <div className="project-grid">
              {versions.map( ( version ) => {
                const isSelected = selectedVersion?.id === version.id
                return (
                  <article
                    key={version.id}
                    className={`project-card ${versionStatusClassName( version )} ${
                      isSelected ? 'project-card--selected' : ''
                    }`}
                    onClick={() => openReviewIssuesForVersion( version.id )}
                    role="button"
                    tabIndex={0}
                    onKeyDown={( event ) => {
                      if( event.key === 'Enter' || event.key === ' ' ) {
                        event.preventDefault()
                        openReviewIssuesForVersion( version.id )
                      }
                    }}
                  >
                  <h3>Version {versionNumberToString( version.number )}</h3>
                  <p className="muted">{version.status}</p>
                  <p className="muted">Author: {formatUserLabel( version.createdBy )}</p>
                  <p className="muted">Reviewers: {version.reviewerIds.length}</p>
                  <p className="muted">
                    Issues: {version.numThreads} - Open: {version.numOpenThreads} - Comments: {version.numComments}
                  </p>
                  <p className="muted">
                    Uploaded: {!version.hasFile ? 'No' : version.fileRefId ? 'Yes' : 'Missing metadata'}
                  </p>
                  <p className="muted">
                    Review time left:{' '}
                    {version.status !== 'In Review'
                      ? '-'
                      : !version.reviewEndAt
                        ? 'No expiration'
                        : version.reviewEndAt.getTime() <= clockNowMs
                          ? 'Expired'
                          : formatApproxCountdown( version.reviewEndAt.getTime() - clockNowMs )}
                  </p>
                  {hasLinkedFileMetadata( version ) ? (
                    <div className="actions">
                      <button
                        type="button"
                        onClick={( event ) => {
                          event.stopPropagation()
                          requestDownloadVersionFile( version )
                        }}
                        onKeyDown={( event ) => event.stopPropagation()}
                        disabled={isBusy || downloadStatus === 'downloading'}
                      >
                        Download file
                      </button>
                      <span className="download-provider-hint">
                        {`From: ${formatStorageProviderLabel( getVersionDownloadProvider( version ) )}`}
                      </span>
                    </div>
                  ) : null}
                </article>
                )
              } )}
            </div>
          )}
          {selectedVersion ? (
            <div className="stack">
              <p className="muted">
                Uploaded: {!selectedVersion.hasFile ? 'No' : selectedVersion.fileRefId ? 'Yes' : 'Missing metadata'}
              </p>
              {documentData?.type === 'errorReport' ? (
                <p className="muted">
                  For document:{' '}
                  {baseDocumentData
                    ? `${baseDocumentData.shortId ?? 'Unassigned'} - ${baseDocumentData.title}`
                    : documentData?.baseDocId
                      ? `Document ${documentData.baseDocId}`
                      : 'Unknown'}
                </p>
              ) : null}
            </div>
          ) : null}
          {selectedVersion ? (
            <section ref={filePanelRef} className="panel stack">
              <h3>File</h3>
              {selectedFileRef ? (
                <div className="stack">
                  <p className="muted">Name: {selectedFileRef.fileName || 'Unnamed file'}</p>
                  <p className="muted">Size: {formatFileSize( selectedFileRef.sizeBytes )}</p>
                </div>
              ) : (
                <p className="muted">No file linked yet.</p>
              )}
              {fileMetadataNotice ? <p className="muted">{fileMetadataNotice}</p> : null}
              <div className="actions">
                <input
                  ref={uploadInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={( event ) => {
                    const file = event.target.files?.[0]
                    if( file ) {
                      if( selectedFileRef ) {
                        requestReplaceFileConfirmation( file )
                      } else {
                        void handleUploadFile( file )
                      }
                    }
                  }}
                  disabled={isBusy}
                />
                <button
                  type="button"
                  onClick={() => {
                    if( !canUploadFile ) {
                      setError( 'You can upload a file only while the version is In Creation.' )
                      return
                    }
                    uploadInputRef.current?.click()
                  }}
                  disabled={isBusy}
                >
                  {selectedFileRef ? 'Replace file' : 'Upload file'}
                </button>
                {selectedFileRef ? (
                  <>
                    <button
                      type="button"
                      onClick={requestDownloadSelectedFile}
                      disabled={isBusy || downloadStatus === 'downloading'}
                    >
                      Download file
                    </button>
                    <span className="download-provider-hint">
                      {`From: ${formatStorageProviderLabel( selectedDownloadProvider )}`}
                    </span>
                  </>
                ) : null}
              </div>
              {uploadStatus === 'uploading' ? <p className="muted">{uploadMessage}</p> : null}
              {uploadStatus === 'success' ? <p className="muted">{uploadMessage}</p> : null}
              {uploadStatus === 'error' ? <p className="error">{uploadMessage}</p> : null}
              <p className="muted">Max size: 20 MB. Uploads are allowed only in In Creation.</p>
            </section>
          ) : null}
          {isErrorReportModalOpen ? (
            <ModalDialog
              onClose={() => {
                setIsErrorReportModalOpen( false )
                setErrorReportTitleError( null )
              }}
            >
                <h3>Create error report</h3>
                <GiphyInline reason="thinking" mode="inline" />
                <label className="field">
                  <span>Title</span>
                  <input
                    type="text"
                    value={errorReportTitle}
                    onChange={( event ) => setErrorReportTitle( event.target.value )}
                    placeholder="Enter error report title"
                  />
                </label>
                {errorReportTitleError ? <p className="error">{errorReportTitleError}</p> : null}
                <div className="actions">
                  <button
                    type="button"
                    onClick={() => {
                      setIsErrorReportModalOpen( false )
                      setErrorReportTitleError( null )
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreateErrorReport( errorReportTitle )}
                    disabled={isBusy}
                  >
                    Confirm
                  </button>
                </div>
            </ModalDialog>
          ) : null}
          {versionDecisionModal ? (
            <ModalDialog onClose={() => setVersionDecisionModal( null )}>
                <h3>{versionDecisionModal === 'accept' ? 'Accept latest version' : 'Reject latest version'}</h3>
                <GiphyInline reason="thinking" mode="inline" />
                <p className="muted">
                  {versionDecisionModal === 'accept'
                    ? 'Confirm acceptance of the latest version. This will update its status to Accepted.'
                    : 'Confirm rejection of the latest version. This will update its status to Rejected.'}
                </p>
                <div className="actions">
                  <button type="button" onClick={() => setVersionDecisionModal( null )} disabled={isBusy}>
                    Cancel
                  </button>
                  <button type="button" onClick={() => void handleConfirmVersionDecision()} disabled={isBusy}>
                    Confirm
                  </button>
                </div>
            </ModalDialog>
          ) : null}
          {pendingVersionAction ? (
            <ModalDialog
              onClose={() => {
                setPendingVersionAction( null )
                setPendingUploadFile( null )
                if( uploadInputRef.current ) {
                  uploadInputRef.current.value = ''
                }
              }}
            >
                <h3>
                  {pendingVersionAction === 'createVersion'
                    ? 'Create new version'
                    : pendingVersionAction === 'startReview'
                      ? 'Start review'
                      : 'Replace file'}
                </h3>
                <GiphyInline reason="thinking" mode="inline" />
                <p className="muted">
                  {pendingVersionAction === 'createVersion'
                    ? 'Confirm creating a new version.'
                    : pendingVersionAction === 'startReview'
                      ? 'Confirm starting review for the latest version.'
                      : 'Confirm replacing the current file.'}
                </p>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingVersionAction( null )
                      setPendingUploadFile( null )
                      if( uploadInputRef.current ) {
                        uploadInputRef.current.value = ''
                      }
                    }}
                    disabled={isBusy}
                  >
                    Cancel
                  </button>
                  <button type="button" onClick={() => void handleConfirmPendingVersionAction()} disabled={isBusy}>
                    Confirm
                  </button>
                </div>
            </ModalDialog>
          ) : null}
          {pendingThreadStatusChange ? (
            <ModalDialog onClose={() => setPendingThreadStatusChange( null )}>
                <h3>{pendingThreadStatusChange.status === 'open' ? 'Close issue' : 'Reopen issue'}</h3>
                <GiphyInline reason="thinking" mode="inline" />
                <p className="muted">
                  {pendingThreadStatusChange.status === 'open'
                    ? 'Confirm closing this issue.'
                    : 'Confirm reopening this issue.'}
                </p>
                <div className="actions">
                  <button type="button" onClick={() => setPendingThreadStatusChange( null )} disabled={isBusy}>
                    Cancel
                  </button>
                  <button type="button" onClick={() => void handleConfirmThreadStatusChange()} disabled={isBusy}>
                    Confirm
                  </button>
                </div>
            </ModalDialog>
          ) : null}
          {uploadStatus === 'uploading' ? (
            <ModalDialog>
                <h3>Uploading file</h3>
                <GiphyInline reason="loading" mode="inline" />
                <p className="muted">{uploadMessage || 'Uploading...'}</p>
            </ModalDialog>
          ) : null}
          {downloadStatus === 'downloading' ? (
            <ModalDialog>
                <h3>Downloading file</h3>
                <GiphyInline reason="loading" mode="inline" />
                <p className="muted">{downloadMessage || 'Downloading...'}</p>
            </ModalDialog>
          ) : null}
          {emailNotifyStatus === 'sending' ? (
            <ModalDialog>
                <h3>Sending email notifications</h3>
                <GiphyInline reason="loading" mode="inline" />
                <p className="muted">{emailNotifyMessage || 'Sending notifications...'}</p>
            </ModalDialog>
          ) : null}
          {successMessage ? (
            <ModalDialog onClose={handleCloseSuccessMessage} initialFocusRef={successOkButtonRef}>
                <h3>Success</h3>
                <GiphyInline reason="good_job" mode="inline" showLabel={false} />
                <p className="muted">{successMessage}</p>
                {successEmailRecipients ? (
                  <details className="success-email-recipients">
                    <summary>{`Email recipients (${successEmailRecipients.to.length + successEmailRecipients.cc.length})`}</summary>
                    <p className="muted">{formatEmailRecipientsLine( successEmailRecipients )}</p>
                  </details>
                ) : null}
                <div className="actions">
                  <button ref={successOkButtonRef} type="button" onClick={handleCloseSuccessMessage}>
                    OK
                  </button>
                </div>
            </ModalDialog>
          ) : null}
          {error ? (
            <ErrorChecklistModal error={error} checklist={errorChecklist} onClose={() => setError( null )} />
          ) : null}

          {selectedVersion && selectedVersion.status === 'In Creation' ? (
            <section className="panel">
              <h3>Author Assignment (Before Review)</h3>
              <p className="muted">Select the version author before starting review.</p>
              <h3>Reviewer Assignment (Before Review)</h3>
              <p className="muted">Select reviewers before starting review.</p>
              <DataTable
                key={`qt4_table_members_${projectId ?? 'unknown'}`}
                columns={memberColumns}
                data={membersTableRows}
                sorting={membersSorting}
                onSortingChange={setMembersSorting}
                tableClassName="data-table--members"
                storageKey={`qt4_table_members_${projectId ?? 'unknown'}`}
              />
            </section>
          ) : null}

          {selectedVersion ? (
            <section ref={reviewIssuesPanelRef} className="panel stack">
              <h3>Review Issues</h3>
              <p className="muted">
                Reviewers:{' '}
                {( selectedVersion.reviewerIds ?? [] ).length > 0
                  ? ( selectedVersion.reviewerIds ?? [] )
                      .map( ( reviewerId ) => formatUserLabel( reviewerId ) )
                      .join( ', ' )
                  : 'None'}
              </p>
              <p className="muted">
                Issues: {selectedVersion.numThreads} - Open: {selectedVersion.numOpenThreads} - Comments: {selectedVersion.numComments}
              </p>
              <div className="stack issue-title-capture">
                <div className="actions actions--capture-row">
                  <input
                    type="text"
                    className="issue-title-input"
                    value={newThreadTitle}
                    onChange={( event ) => setNewThreadTitle( normalizeIssueTitleInput( event.target.value ) )}
                    placeholder="New issue title"
                    maxLength={ISSUE_TITLE_MAX_LENGTH}
                    disabled={isBusy}
                  />
                  <button type="button" onClick={handleCreateThread} disabled={isBusy}>
                    Create issue
                  </button>
                </div>
                <p className="issue-title-hint muted">
                  Single-line title. Maximum {ISSUE_TITLE_MAX_LENGTH} characters.
                </p>
              </div>
              {isLoadingThreads ? (
                <p className="muted">Loading issues...</p>
              ) : threads.length === 0 ? (
                <p className="muted">No issues yet for this version.</p>
              ) : (
                <div className="stack">
                  <div className="actions">
                    <label className="field">
                      <span>Issue view</span>
                      <div className="view-toggle">
                        <button
                          type="button"
                          aria-pressed={threadsViewMode === 'card'}
                          onClick={() => setThreadsViewMode( 'card' )}
                        >
                          Cards
                        </button>
                        <button
                          type="button"
                          aria-pressed={threadsViewMode === 'table'}
                          onClick={() => setThreadsViewMode( 'table' )}
                        >
                          Table
                        </button>
                      </div>
                    </label>
                  </div>
                  {threadsViewMode === 'table' ? (
                    <DataTable
                      key={`qt4_table_versions_threads_${selectedVersion.id}`}
                      columns={threadColumns}
                      data={threads}
                      sorting={threadsSorting}
                      onSortingChange={setThreadsSorting}
                      onVisibleRowsChange={( nextRows ) =>
                        setVisibleThreadRows( ( previous ) => ( areThreadsEqual( previous, nextRows ) ? previous : nextRows ) )
                      }
                      tableClassName="data-table--threads"
                      storageKey={`qt4_table_versions_threads_${selectedVersion.id}`}
                      getRowClassName={( row ) => {
                        const statusClassName = row.status === 'closed'
                          ? 'thread-row--closed'
                          : getThreadCommentWindowMeta( row ).state === 'expired'
                            ? 'thread-row--open-expired'
                            : 'thread-row--open'
                        return `${statusClassName} ${
                          selectedThreadId === row.id ? 'data-table-row--selected' : ''
                        }`.trim()
                      }}
                      onRowClick={( row ) => selectThreadKeepingViewport( row.id )}
                    />
                  ) : (
                    <div className="project-grid">
                      {threads.map( ( thread ) => {
                        const commentWindowMeta = getThreadCommentWindowMeta( thread )
                        return (
                        <article
                          key={thread.id}
                          className={`project-card ${
                            thread.status === 'open'
                              ? commentWindowMeta.state === 'expired'
                                ? 'project-card--thread-open-expired'
                                : 'project-card--thread-open'
                              : 'project-card--thread-closed'
                          } ${selectedThreadId === thread.id ? 'project-card--thread-selected' : ''}`}
                          onClick={() => selectThreadKeepingViewport( thread.id )}
                          role="button"
                          tabIndex={0}
                          onKeyDown={( event ) => {
                            if( event.key === 'Enter' || event.key === ' ' ) {
                              event.preventDefault()
                              selectThreadKeepingViewport( thread.id )
                            }
                          }}
                        >
                          <h4>{thread.title}</h4>
                          <p className="muted">Status: {thread.status}</p>
                          <p className="muted">Created by: {formatUserLabel( thread.createdBy )}</p>
                          <p className="muted">Comments: {commentsByThread[thread.id]?.length ?? thread.commentCount}</p>
                          <p className={`thread-window thread-window--${commentWindowMeta.state}`}>
                            Comment window: {commentWindowMeta.label}
                          </p>
                          <div className="actions">
                            <button
                              type="button"
                              onClick={( event ) => {
                                event.stopPropagation()
                                requestThreadStatusChangeConfirmation( thread )
                              }}
                              disabled={isBusy}
                            >
                              {thread.status === 'open' ? 'Close' : 'Reopen'}
                            </button>
                          </div>
                        </article>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
              {selectedThread ? (
                <div className="stack">
                  <p className="muted selected-thread-title">
                    Selected issue: <span>{selectedThread.title}</span>
                  </p>
                  <div className="actions actions--thread-navigation">
                    <p className="thread-navigation-status muted">{threadNavigationStatusLabel}</p>
                    <div className="thread-navigation-buttons">
                      <button
                        type="button"
                        onClick={() => handleSelectAdjacentThread( -1 )}
                        disabled={isBusy || !hasPreviousThread}
                      >
                        Previous issue
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectAdjacentThread( 1 )}
                        disabled={isBusy || !hasNextThread}
                      >
                        Next issue
                      </button>
                    </div>
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      onClick={() => requestThreadStatusChangeConfirmation( selectedThread )}
                      disabled={isBusy}
                    >
                      {selectedThread.status === 'open' ? 'Close issue' : 'Reopen issue'}
                    </button>
                  </div>
                  <div className="actions">
                    <label className="field">
                      <span>Comment view</span>
                      <div className="view-toggle">
                        <button
                          type="button"
                          aria-pressed={commentsViewMode === 'card'}
                          onClick={() => setCommentsViewMode( 'card' )}
                        >
                          Cards
                        </button>
                        <button
                          type="button"
                          aria-pressed={commentsViewMode === 'table'}
                          onClick={() => setCommentsViewMode( 'table' )}
                        >
                          Table
                        </button>
                      </div>
                    </label>
                  </div>
                  {selectedThreadComments.length === 0 ? (
                    <p className="muted">No comments yet.</p>
                  ) : commentsViewMode === 'table' ? (
                    <DataTable
                      key={`qt4_table_versions_thread_comments_${selectedThread.id}`}
                      columns={commentColumns}
                      data={selectedThreadComments}
                      sorting={commentsSorting}
                      onSortingChange={setCommentsSorting}
                      tableClassName="data-table--comments"
                      storageKey={`qt4_table_versions_thread_comments_${selectedThread.id}`}
                      getRowClassName={( row ) =>
                        highlightedCommentId === row.id ? 'data-table-row--selected comment-row--highlight' : ''
                      }
                    />
                  ) : (
                    <div className="comment-list">
                      {selectedThreadComments.map( ( comment ) => (
                        <article
                          id={buildCommentAnchorId( comment.id )}
                          key={comment.id}
                          className={`project-card ${highlightedCommentId === comment.id ? 'comment-card--highlight' : ''}`.trim()}
                        >
                          <p className="muted">By: {formatUserLabel( comment.createdBy )}</p>
                          <p className="muted">{comment.createdAt ? formatTimeAgo( comment.createdAt ) : '-'}</p>
                          <p className="comment-body">{comment.body}</p>
                        </article>
                      ) )}
                    </div>
                  )}
                  {commentWindowCountdownLabel ? (
                    <p className="muted">{commentWindowCountdownLabel}</p>
                  ) : null}
                  <div className="actions actions--capture-row">
                    <textarea
                      ref={commentInputRef}
                      className={`comment-input comment-input--${selectedCommentWindowState}`}
                      value={newCommentBody}
                      onChange={( event ) => setNewCommentBody( event.target.value )}
                      placeholder="Write a comment"
                      disabled={isBusy}
                    />
                    <button type="button" onClick={handleAddComment} disabled={isBusy}>
                      Add comment
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

        </section>
        )}
      </main>
    </div>
  )
}

export default VersionsPage
