// src/pages/ProjectDocumentsPage.tsx
// Lists project documents and creates regular, change-request, and derived documents.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  QuerySnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import AppBrand from '../components/AppBrand'
import BackStack from '../components/BackStack'
import DataTable from '../components/DataTable'
import ErrorChecklistModal, { type ChecklistItem } from '../components/ErrorChecklistModal'
import ModalDialog from '../components/ModalDialog'
import { GiphyInline } from '../giphy/GiphyProvider'
import { useErrorChecklistModal } from '../hooks/useErrorChecklistModal'
import { FIRST_VERSION_NUMBER, versionNumberToString } from '../domain/types'
import { logAudit } from '../lib/audit'
import {
  buildChangeRequestTitle,
  validateChangeRequestCreation,
} from '../lib/changeRequests'
import {
  buildActiveConfiguration,
  formatShortDocumentReference,
  type ActiveConfigurationLine,
} from '../lib/documentDerivation'
import { reportAbnormalError } from '../lib/errorMonitor'
import { db } from '../lib/firebase'
import { formatTimeAgoWithTimestamp } from '../lib/time'
import {
  createChangeRequestDocument,
  loadAcceptedBaseVersions,
  loadChangeRequestBaseProjects,
  type ChangeRequestBaseProject,
  type ChangeRequestBaseVersion,
} from './projectDocuments/changeRequestData'
import { createDerivedDocument } from './projectDocuments/derivedDocumentData'

type DocumentSummary = {
  id: string
  title: string
  createdBy: string
  type: string
  shortId: number | null
  baseProjectId?: string | null
  baseDocId?: string | null
  baseVersionId?: string | null
  originProjectId?: string | null
  originDocumentId?: string | null
  originVersionId?: string | null
  incorporatedChangeRequestVersionIds?: string[]
  latestVersionId: string | null
  latestVersionNumber: number | null
  latestStatus: string | null
  latestReviewEndAt?: Date | null
  createdAt?: Date | null
  updatedAt?: Date | null
  lastActivityAt?: Date | null
  hasFutureActivityAnomaly?: boolean
}

type ProjectSummary = {
  id: string
  name: string
  shortId: number | null
  leaderId: string
}

type ProjectMember = {
  projectId: string
  userId: string
  role: 'leader' | 'member'
  email?: string | null
}

type BaseDocumentReference = {
  projectShortId: number | null
  title: string
  shortId: number | null
  versionNumber: number | null
}

type DocumentFilter = 'all' | 'mine'

const FIRESTORE_IN_FILTER_LIMIT = 10

const isLikelyEmail = (value: string) => /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test( value )

const chunkValues = <T,>(values: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for( let index = 0; index < values.length; index += size ) {
    chunks.push( values.slice( index, index + size ) )
  }
  return chunks
}

const pickLatestDate = ( ...values: Array<Date | null | undefined> ): Date | null => {
  let latest: Date | null = null
  for( const value of values ) {
    if( !value ) {
      continue
    }
    if( !latest || value.getTime() > latest.getTime() ) {
      latest = value
    }
  }
  return latest
}

const resolvePastActivityDate = (
  values: Array<Date | null | undefined>,
  nowMs = Date.now(),
): { activityAt: Date | null; hasFutureActivityAnomaly: boolean } => {
  const pastValues: Date[] = []
  let hasFutureActivityAnomaly = false
  values.forEach( ( value ) => {
    if( !value ) {
      return
    }
    if( value.getTime() > nowMs ) {
      hasFutureActivityAnomaly = true
      return
    }
    pastValues.push( value )
  } )
  return {
    activityAt: pickLatestDate( ...pastValues ),
    hasFutureActivityAnomaly,
  }
}

const toSnapshotDate = (value: unknown): Date | null => {
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

const resolveVersionDocumentActivity = (
  versionData: Record<string, unknown>,
  nowMs = Date.now(),
): { activityAt: Date | null; hasFutureActivityAnomaly: boolean } => {
  const status = typeof versionData.status === 'string' ? versionData.status : null
  const createdAt = toSnapshotDate( versionData.createdAt )
  const updatedAt = toSnapshotDate( versionData.updatedAt )
  const activityAt = toSnapshotDate( versionData.activityAt )
  const fileUploadedAt = toSnapshotDate( versionData.fileUploadedAt )
  const reviewStartAt = toSnapshotDate( versionData.reviewStartAt )
  const reviewEndAt = toSnapshotDate( versionData.reviewEndAt )

  if( status === 'Accepted' || status === 'Rejected' || status === 'Replaced' ) {
    return resolvePastActivityDate(
      [ activityAt, updatedAt, reviewEndAt, fileUploadedAt, reviewStartAt, createdAt ],
      nowMs,
    )
  }

  if( status === 'Reviewed' ) {
    return resolvePastActivityDate(
      [ activityAt, reviewEndAt, updatedAt, fileUploadedAt, reviewStartAt, createdAt ],
      nowMs,
    )
  }

  if( status === 'In Creation' ) {
    return resolvePastActivityDate( [ activityAt, fileUploadedAt, updatedAt, createdAt ], nowMs )
  }

  return resolvePastActivityDate(
    [ activityAt, fileUploadedAt, reviewStartAt, updatedAt, createdAt ],
    nowMs,
  )
}

const isOfflineFirestoreError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String( error ?? '' )
  const loweredMessage = message.toLowerCase()
  const code = error && typeof error === 'object' && 'code' in error
    ? String( ( error as { code?: unknown } ).code ?? '' ).toLowerCase()
    : ''
  return (
    loweredMessage.includes( 'client is offline' ) ||
    loweredMessage.includes( 'failed to get document because the client is offline' ) ||
    loweredMessage.includes( 'offline' ) ||
    code.includes( 'unavailable' ) ||
    code.includes( 'deadline-exceeded' )
  )
}

const isPermissionDeniedFirestoreError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String( error ?? '' )
  const loweredMessage = message.toLowerCase()
  const code = error && typeof error === 'object' && 'code' in error
    ? String( ( error as { code?: unknown } ).code ?? '' ).toLowerCase()
    : ''
  return (
    loweredMessage.includes( 'permission-denied' ) ||
    loweredMessage.includes( 'missing or insufficient permissions' ) ||
    code.includes( 'permission-denied' )
  )
}

const loadVersionSnapshotsForProjectDocuments = async (
  projectId: string,
  documentIds: string[],
): Promise<QuerySnapshot[]> => {
  try {
    return [
      await getDocs( query( collection( db, 'versions' ), where( 'projectId', '==', projectId ) ) ),
    ]
  } catch( err ) {
    if( !isPermissionDeniedFirestoreError( err ) ) {
      throw err
    }
  }

  const documentIdChunks = chunkValues(
    documentIds.filter( Boolean ),
    FIRESTORE_IN_FILTER_LIMIT,
  )
  const fallbackResults = await Promise.allSettled(
    documentIdChunks.map( ( documentIdChunk ) =>
      getDocs(
        query(
          collection( db, 'versions' ),
          where( 'projectId', '==', projectId ),
          where( 'docId', 'in', documentIdChunk ),
        ),
      ),
    ),
  )
  return fallbackResults.flatMap( ( result, index ) => {
    if( result.status === 'fulfilled' ) {
      return [ result.value ]
    }
    console.warn( 'Project document version chunk lookup skipped:', {
      projectId,
      docIds: documentIdChunks[index] ?? [],
      reason: result.reason,
    } )
    return []
  } )
}

function ProjectDocumentsPage() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const userId = user?.uid ?? ''
  const navigate = useNavigate()

  const [project, setProject] = useState<ProjectSummary | null>( null )
  const [documents, setDocuments] = useState<DocumentSummary[]>([] )
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([] )
  const [filter, setFilter] = useState<DocumentFilter>( 'all' )
  const [title, setTitle] = useState( '' )
  const [memberEmail, setMemberEmail] = useState( '' )
  const [memberError, setMemberError] = useState<string | null>( null )
  const [isAddingMember, setIsAddingMember] = useState( false )
  const [isMembersPanelExpanded, setIsMembersPanelExpanded] = useState( false )
  const [isBusy, setIsBusy] = useState( false )
  const [isChangeRequestModalOpen, setIsChangeRequestModalOpen] = useState( false )
  const [isLoadingChangeRequestBases, setIsLoadingChangeRequestBases] = useState( false )
  const [isCreatingChangeRequest, setIsCreatingChangeRequest] = useState( false )
  const [isCreatingDerivedDocument, setIsCreatingDerivedDocument] = useState( false )
  const [baseProjects, setBaseProjects] = useState<ChangeRequestBaseProject[]>( [] )
  const [acceptedBaseVersions, setAcceptedBaseVersions] = useState<ChangeRequestBaseVersion[]>( [] )
  const [selectedBaseProjectId, setSelectedBaseProjectId] = useState( '' )
  const [selectedBaseVersionId, setSelectedBaseVersionId] = useState( '' )
  const [changeRequestTitle, setChangeRequestTitle] = useState( '' )
  const [changeRequestError, setChangeRequestError] = useState<string | null>( null )
  const [baseDocumentReferences, setBaseDocumentReferences] = useState<Record<string, BaseDocumentReference>>( {} )
  const [isLoadingDocuments, setIsLoadingDocuments] = useState( true )
  const { error, errorChecklist, openError, clearError } = useErrorChecklistModal()
  const [successMessage, setSuccessMessage] = useState<string | null>( null )
  const [viewMode, setViewMode] = useState<'card' | 'table'>( () => {
    const storedView = window.localStorage.getItem( 'qt4_documents_view' )
    return storedView === 'table' || storedView === 'card' ? storedView : 'card'
  } )
  const [sorting, setSorting] = useState<SortingState>( [ { id: 'shortId', desc: false } ] )
  const lastErrorRef = useRef<string | null>( null )
  const successOkButtonRef = useRef<HTMLButtonElement | null>( null )
  const titleInputRef = useRef<HTMLInputElement | null>( null )
  const memberInputRef = useRef<HTMLInputElement | null>( null )
  const shouldRestoreTitleFocusRef = useRef( false )
  const shouldRestoreMemberFocusRef = useRef( false )
  const [userDirectoryById, setUserDirectoryById] = useState<Record<string, { email?: string | null; displayName?: string | null }>>( {} )
  const [nowMs, setNowMs] = useState( () => Date.now() )

  const canSubmit = useMemo(
    () => title.trim().length > 0 && !isBusy && Boolean( projectId ) && Boolean( project ),
    [ title, isBusy, projectId, project ],
  )

  const selectedBaseVersion = useMemo(
    () => acceptedBaseVersions.find( ( versionItem ) => versionItem.versionId === selectedBaseVersionId ) ?? null,
    [ acceptedBaseVersions, selectedBaseVersionId ],
  )

  const selectedBaseProject = useMemo(
    () => baseProjects.find( ( baseProject ) => baseProject.id === selectedBaseProjectId ) ?? null,
    [ baseProjects, selectedBaseProjectId ],
  )

  const canCreateChangeRequest = useMemo(
    () =>
      !isCreatingChangeRequest &&
      Boolean( projectId ) &&
      Boolean( project ) &&
      Boolean( userId ) &&
      Boolean( selectedBaseVersion ) &&
      changeRequestTitle.trim().length > 0,
    [ changeRequestTitle, isCreatingChangeRequest, project, projectId, selectedBaseVersion, userId ],
  )

  const activeConfigurationLines = useMemo(
    () => buildActiveConfiguration(
      documents.map( ( documentItem ) => ( {
        documentId: documentItem.id,
        versionId: documentItem.latestVersionId ?? '',
        projectId: projectId ?? '',
        documentType: documentItem.type,
        baseProjectId: documentItem.baseProjectId,
        baseDocId: documentItem.baseDocId,
        baseVersionId: documentItem.baseVersionId,
        status: documentItem.latestStatus ?? '',
      } ) ),
    ),
    [ documents, projectId ],
  )

  const formatUserLabel = useCallback( (memberUserId: string) => {
    const entry = userDirectoryById[memberUserId]
    const displayName = entry?.displayName ?? ''
    const email = entry?.email ?? ''
    if( displayName ) {
      return displayName
    }
    if( email ) {
      return email
    }
    return 'Unknown user'
  }, [ userDirectoryById ] )

  const isProjectLeader = useMemo(
    () => Boolean( project?.leaderId && project.leaderId === userId ),
    [ project?.leaderId, userId ],
  )

  const sortedProjectMembers = useMemo(
    () =>
      [ ...projectMembers ].sort( ( a, b ) => {
        if( a.role !== b.role ) {
          return a.role === 'leader' ? -1 : 1
        }
        return formatUserLabel( a.userId ).localeCompare( formatUserLabel( b.userId ) )
      } ),
    [ projectMembers, formatUserLabel ],
  )

  const documentTableRows = useMemo(
    () =>
      documents.map( ( documentItem ) => ( {
        ...documentItem,
        creatorLabel: formatUserLabel( documentItem.createdBy ),
        updatedAtMs: documentItem.lastActivityAt ? documentItem.lastActivityAt.getTime() : 0,
      } ) ),
    [ documents, formatUserLabel ],
  )

  const baseDocumentById = useMemo( () => {
    const map = new Map<string, DocumentSummary>()
    documents.forEach( ( docItem ) => {
      if( docItem.id ) {
        map.set( docItem.id, docItem )
      }
    } )
    return map
  }, [ documents ] )

  const formatBaseDocumentLabel = useCallback( (documentItem: DocumentSummary) => {
    if( !documentItem.baseDocId ) {
      return 'Unknown'
    }
    if( baseDocumentById.has( documentItem.baseDocId ) ) {
      const baseDoc = baseDocumentById.get( documentItem.baseDocId )
      return formatShortDocumentReference( {
        projectShortId: project?.shortId,
        documentShortId: baseDoc?.shortId,
        versionNumber: documentItem.latestVersionNumber,
        title: baseDoc?.title ?? 'Unknown',
      } )
    }
    const externalBaseDoc = baseDocumentReferences[documentItem.baseDocId]
    if( externalBaseDoc ) {
      return formatShortDocumentReference( {
        projectShortId: externalBaseDoc.projectShortId,
        documentShortId: externalBaseDoc.shortId,
        versionNumber: externalBaseDoc.versionNumber,
        title: externalBaseDoc.title,
      } )
    }
    return 'Base document reference unavailable'
  }, [ baseDocumentById, baseDocumentReferences, project?.shortId ] )

  const formatActiveConfigurationLine = useCallback( (line: ActiveConfigurationLine) => {
    const baseReference = baseDocumentReferences[line.originDocumentId]
    if( baseReference ) {
      return formatShortDocumentReference( {
        projectShortId: baseReference.projectShortId,
        documentShortId: baseReference.shortId,
        versionNumber: baseReference.versionNumber,
        title: baseReference.title,
      } )
    }
    return 'Base document pending reference load'
  }, [ baseDocumentReferences ] )

  const formatDocumentTitle = useCallback( (documentItem: DocumentSummary) => {
    if( documentItem.type === 'errorReport' ) {
      return `Error report - ${documentItem.shortId ?? 'Unassigned'} - ${documentItem.title}`
    }
    if( documentItem.type === 'changeRequest' ) {
      return `Change request - ${documentItem.shortId ?? 'Unassigned'} - ${documentItem.title}`
    }
    if( documentItem.type === 'derivedDocument' ) {
      return `Derived variant - ${documentItem.shortId ?? 'Unassigned'} - ${documentItem.title}`
    }
    return `${documentItem.shortId ?? 'Unassigned'} - ${documentItem.title}`
  }, [] )

  const documentColumns = useMemo<ColumnDef<DocumentSummary & { creatorLabel: string; updatedAtMs: number }>[]>(
    () => [
      {
        header: 'Short id',
        accessorKey: 'shortId',
        sortingFn: ( rowA, rowB, columnId ) => {
          const leftRaw = rowA.getValue<number | null>( columnId )
          const rightRaw = rowB.getValue<number | null>( columnId )
          const left = typeof leftRaw === 'number' ? leftRaw : Number.POSITIVE_INFINITY
          const right = typeof rightRaw === 'number' ? rightRaw : Number.POSITIVE_INFINITY
          return left - right
        },
        cell: ( info ) => String( info.getValue<number | null>() ?? 'Unassigned' ),
      },
      {
        header: 'Title',
        accessorKey: 'title',
        cell: ( info ) => {
          const row = info.row.original
          if( row.type === 'errorReport' ) {
            return `Error report - ${row.title}`
          }
          if( row.type === 'changeRequest' ) {
            return `Change request - ${row.title}`
          }
          return row.title
        },
      },
      {
        header: 'For',
        accessorKey: 'baseDocId',
        cell: ( info ) => {
          const row = info.row.original
          if( row.type !== 'errorReport' && row.type !== 'changeRequest' ) {
            return '-'
          }
          if( row.baseDocId ) {
            const baseLabel = formatBaseDocumentLabel( row )
            return (
              <span className="error-report-for">
                <span className="error-report-for__short">
                  {baseLabel.split( ' - ' )[0] ?? 'Unknown'}
                </span>
                <span className="error-report-for__full">
                  {baseLabel}
                </span>
              </span>
            )
          }
          return 'Unknown'
        },
      },
      {
        header: 'Status',
        accessorKey: 'latestStatus',
        cell: ( info ) => String( info.getValue<string | null>() ?? 'In Creation' ),
      },
      {
        header: 'Creator',
        accessorKey: 'creatorLabel',
      },
      {
        header: 'Last activity',
        accessorKey: 'updatedAtMs',
        cell: ( info ) =>
          `${formatTimeAgoWithTimestamp( info.row.original.lastActivityAt )}${
            info.row.original.hasFutureActivityAnomaly ? ' ?' : ''
          }`,
      },
    ],
    [ formatBaseDocumentLabel ],
  )

  const sortedDocumentCards = useMemo( () => {
    if( sorting.length === 0 ) {
      return documentTableRows
    }
    const { id, desc } = sorting[0]
    const sorted = [ ...documentTableRows ].sort( ( a, b ) => {
      if( id === 'shortId' ) {
        const left = typeof a.shortId === 'number' ? a.shortId : Number.POSITIVE_INFINITY
        const right = typeof b.shortId === 'number' ? b.shortId : Number.POSITIVE_INFINITY
        return left - right
      }
      const aValue = ( a as Record<string, unknown> )[id]
      const bValue = ( b as Record<string, unknown> )[id]
      if( typeof aValue === 'number' && typeof bValue === 'number' ) {
        return aValue - bValue
      }
      return String( aValue ?? '' ).localeCompare( String( bValue ?? '' ) )
    } )
    return desc ? sorted.reverse() : sorted
  }, [ documentTableRows, sorting ] )

  useEffect( () => {
    const storedSorting = window.localStorage.getItem( 'qt4_documents_sorting' )
    if( storedSorting ) {
      try {
        const parsed = JSON.parse( storedSorting ) as SortingState
        if( Array.isArray( parsed ) ) {
          setSorting( parsed )
        }
      } catch {
        // ignore parse errors
      }
    }
    const storedFilter = window.localStorage.getItem( 'qt4_documents_filter' )
    if( storedFilter === 'all' || storedFilter === 'mine' ) {
      setFilter( storedFilter )
    }
  }, [] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_documents_view', viewMode )
  }, [ viewMode ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_documents_sorting', JSON.stringify( sorting ) )
  }, [ sorting ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_documents_filter', filter )
  }, [ filter ] )

  const statusClassName = (status?: string | null, reviewEndAt?: Date | null) => {
    switch( status ) {
      case 'In Creation':
        return 'status-card--in-creation'
      case 'In Review':
        if( reviewEndAt && reviewEndAt.getTime() <= nowMs ) {
          return 'status-card--in-review-expired'
        }
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

  useEffect( () => {
    const timer = window.setInterval( () => {
      setNowMs( Date.now() )
    }, 60 * 1000 )
    return () => {
      window.clearInterval( timer )
    }
  }, [] )

  const loadProject = useCallback( async () => {
    if( !projectId ) {
      setProject( null )
      return
    }
    try {
      const projectSnapshot = await getDoc( doc( db, 'projects', projectId ) )
      if( !projectSnapshot.exists() ) {
        setProject( null )
        return
      }
      const data = projectSnapshot.data()
      setProject( {
        id: projectSnapshot.id,
        name: ( data.name as string ) ?? 'Untitled project',
        shortId: Number.isFinite( data.shortId ) ? Number( data.shortId ) : null,
        leaderId: ( data.leaderId as string | undefined ) ?? '',
      } )
    } catch {
      setProject( null )
    }
  }, [ projectId ] )

  const loadDocuments = useCallback( async (snapshot: QuerySnapshot) => {
    if( !projectId ) {
      return
    }
    clearError()
    setIsLoadingDocuments( true )
    let step = 'start'
    try {

      step = 'documents'

      const baseDocuments = snapshot.docs.map( ( docSnapshot ) => {
        const data = docSnapshot.data()
        const createdAt = toSnapshotDate( data.createdAt )
        const updatedAt = toSnapshotDate( data.updatedAt )
        const activity = resolvePastActivityDate( [ updatedAt, createdAt ] )
        return {
          id: docSnapshot.id,
          title: ( data.title as string ) ?? '',
          createdBy: ( data.createdBy as string ) ?? ( data.authorId as string ) ?? '',
          type: ( data.type as string | undefined ) ?? 'document',
          shortId: Number.isFinite( data.shortId ) ? Number( data.shortId ) : null,
          baseProjectId: ( data.baseProjectId as string | undefined ) ?? null,
          baseDocId: ( data.baseDocId as string | undefined ) ?? null,
          baseVersionId: ( data.baseVersionId as string | undefined ) ?? null,
          originProjectId: ( data.originProjectId as string | undefined ) ?? null,
          originDocumentId: ( data.originDocumentId as string | undefined ) ?? null,
          originVersionId: ( data.originVersionId as string | undefined ) ?? null,
          incorporatedChangeRequestVersionIds:
            ( data.incorporatedChangeRequestVersionIds as string[] | undefined ) ?? [],
          latestVersionId: null,
          latestVersionNumber: null,
          latestStatus: null,
          createdAt,
          updatedAt,
          lastActivityAt: activity.activityAt,
          hasFutureActivityAnomaly: activity.hasFutureActivityAnomaly,
          latestReviewEndAt: null,
        }
      } )

      step = 'latest-versions'
      const [ versionSnapshots, membersSnapshot ] = await Promise.all( [
        loadVersionSnapshotsForProjectDocuments(
          projectId,
          baseDocuments.map( ( documentItem ) => documentItem.id ),
        ),
        getDocs( query( collection( db, 'projectMembers' ), where( 'projectId', '==', projectId ) ) ),
      ] )
      const members = membersSnapshot.docs.map( ( memberSnapshot ) => {
        const data = memberSnapshot.data()
        return {
          projectId,
          userId: ( data.userId as string | undefined ) ?? '',
          role: ( data.role as 'leader' | 'member' | undefined ) ?? 'member',
          email: ( data.email as string | null | undefined ) ?? null,
        }
      } )
      setProjectMembers( members )
      const versionSummaryByDocId = new Map<string, {
        latestVersionId: string
        latestNumber: number
        latestStatus: string
        latestReviewEndAt: Date | null
        latestVersionCreatedAt: Date | null
        latestVersionActivityAt: Date | null
        latestVersionHasFutureActivityAnomaly: boolean
        latestCreatedBy: string
        latestReviewerIds: string[]
        earliestVersionCreatedAt: Date | null
      }>()
      versionSnapshots.forEach( ( versionsSnapshot ) => {
        versionsSnapshot.docs.forEach( ( versionSnapshot ) => {
          const versionData = versionSnapshot.data()
          const versionDocId = ( versionData.docId as string | undefined ) ?? ''
          if( !versionDocId ) {
            return
          }
          const versionNumber = Number( versionData.number ?? 0 )
          const versionCreatedAt = toSnapshotDate( versionData.createdAt )
          const versionActivity = resolveVersionDocumentActivity( versionData )
          const current = versionSummaryByDocId.get( versionDocId )

          if( !current || versionNumber >= current.latestNumber ) {
            versionSummaryByDocId.set( versionDocId, {
              latestVersionId: versionSnapshot.id,
              latestNumber: versionNumber,
              latestStatus: ( versionData.status as string | undefined ) ?? 'In Creation',
              latestReviewEndAt: toSnapshotDate( versionData.reviewEndAt ),
              latestVersionCreatedAt: versionCreatedAt,
              latestVersionActivityAt: versionActivity.activityAt,
              latestVersionHasFutureActivityAnomaly: versionActivity.hasFutureActivityAnomaly,
              latestCreatedBy: ( versionData.createdBy as string | undefined ) ?? '',
              latestReviewerIds: ( versionData.reviewerIds as string[] | undefined ) ?? [],
              earliestVersionCreatedAt:
                current?.earliestVersionCreatedAt && versionCreatedAt
                  ? new Date( Math.min( current.earliestVersionCreatedAt.getTime(), versionCreatedAt.getTime() ) )
                  : current?.earliestVersionCreatedAt ?? versionCreatedAt,
            } )
            return
          }

          if( versionCreatedAt ) {
            current.earliestVersionCreatedAt = current.earliestVersionCreatedAt
              ? new Date( Math.min( current.earliestVersionCreatedAt.getTime(), versionCreatedAt.getTime() ) )
              : versionCreatedAt
          }
        } )
      } )

      const latestVersions = baseDocuments.map( ( documentItem ) => {
        const versionSummary = versionSummaryByDocId.get( documentItem.id )
        if( !versionSummary ) {
          return {
            documentItem: {
              ...documentItem,
              createdAt: documentItem.createdAt ?? documentItem.updatedAt ?? null,
            },
            isMine: documentItem.createdBy === userId,
          }
        }
        const isMine =
          versionSummary.latestCreatedBy === userId ||
          versionSummary.latestReviewerIds.includes( userId )
        const resolvedCreatedAt =
          documentItem.createdAt ??
          versionSummary.earliestVersionCreatedAt ??
          documentItem.updatedAt ??
          null
        const resolvedActivity = resolvePastActivityDate( [
          documentItem.updatedAt,
          resolvedCreatedAt,
          versionSummary.latestVersionActivityAt,
          versionSummary.latestVersionCreatedAt,
        ] )
        return {
          documentItem: {
            ...documentItem,
            createdAt: resolvedCreatedAt,
            latestVersionId: versionSummary.latestVersionId,
            latestVersionNumber: versionSummary.latestNumber,
            latestStatus: versionSummary.latestStatus,
            latestReviewEndAt: versionSummary.latestReviewEndAt,
            lastActivityAt: resolvedActivity.activityAt,
            hasFutureActivityAnomaly:
              documentItem.hasFutureActivityAnomaly ||
              versionSummary.latestVersionHasFutureActivityAnomaly ||
              resolvedActivity.hasFutureActivityAnomaly,
          },
          isMine,
        }
      } )
      step = 'base-references'
      const currentDocumentIds = new Set( baseDocuments.map( ( documentItem ) => documentItem.id ) )
      const externalBaseDocIds = Array.from(
        new Set(
          baseDocuments
            .flatMap( ( documentItem ) => [documentItem.baseDocId, documentItem.originDocumentId] )
            .filter( ( referenceDocId ): referenceDocId is string =>
              typeof referenceDocId === 'string' && referenceDocId.length > 0 && !currentDocumentIds.has( referenceDocId ),
            ),
        ),
      )
      const nextBaseDocumentReferences: Record<string, BaseDocumentReference> = {}
      await Promise.all(
        externalBaseDocIds.map( async ( baseDocId ) => {
          try {
            const baseDocSnapshot = await getDoc( doc( db, 'documents', baseDocId ) )
            if( baseDocSnapshot.exists() ) {
              const baseDocData = baseDocSnapshot.data()
              const baseProjectId = ( baseDocData.projectId as string | undefined ) ?? ''
              const baseVersionId = baseDocuments.find( ( documentItem ) =>
                documentItem.baseDocId === baseDocId || documentItem.originDocumentId === baseDocId,
              )?.baseVersionId ?? baseDocuments.find( ( documentItem ) =>
                documentItem.originDocumentId === baseDocId,
              )?.originVersionId ?? ''
              const [ baseProjectSnapshot, baseVersionSnapshot ] = await Promise.all( [
                baseProjectId ? getDoc( doc( db, 'projects', baseProjectId ) ) : Promise.resolve( null ),
                baseVersionId ? getDoc( doc( db, 'versions', baseVersionId ) ) : Promise.resolve( null ),
              ] )
              const baseProjectData = baseProjectSnapshot?.exists()
                ? baseProjectSnapshot.data()
                : null
              const baseVersionData = baseVersionSnapshot?.exists()
                ? baseVersionSnapshot.data()
                : null
              nextBaseDocumentReferences[baseDocId] = {
                projectShortId: Number.isFinite( baseProjectData?.shortId ) ? Number( baseProjectData?.shortId ) : null,
                title: ( baseDocData.title as string | undefined ) ?? 'Untitled document',
                shortId: Number.isFinite( baseDocData.shortId ) ? Number( baseDocData.shortId ) : null,
                versionNumber: Number.isFinite( baseVersionData?.number ) ? Number( baseVersionData?.number ) : null,
              }
            }
          } catch( err ) {
            console.warn( 'Project document base reference lookup skipped:', {
              projectId,
              baseDocId,
              reason: err,
            } )
          }
        } ),
      )
      setBaseDocumentReferences( nextBaseDocumentReferences )
      if( filter === 'mine' && userId ) {
        const filtered = latestVersions
          .filter( ( entry ) => entry.isMine )
          .map( ( entry ) => entry.documentItem )
        setDocuments( filtered )
      } else if( filter === 'mine' && !userId ) {
        setDocuments( [] )
      } else {
        setDocuments( latestVersions.map( ( entry ) => entry.documentItem ) )
      }

      step = 'user-directory'
      const creatorIds = Array.from(
        new Set( [
          ...baseDocuments.map( ( docItem ) => docItem.createdBy ).filter( Boolean ),
          ...members.map( ( member ) => member.userId ).filter( Boolean ),
        ] ),
      )
      const chunks: string[][] = []
      for( let index = 0; index < creatorIds.length; index += 10 ) {
        chunks.push( creatorIds.slice( index, index + 10 ) )
      }
      const directorySnapshots = await Promise.all(
        chunks.map( ( chunk ) =>
          getDocs( query( collection( db, 'userDirectory' ), where( 'userId', 'in', chunk ) ) ),
        ),
      )
      const nextDirectoryById: Record<string, { email?: string | null; displayName?: string | null }> = {}
      members.forEach( ( member ) => {
        if( member.userId && member.email ) {
          nextDirectoryById[member.userId] = {
            email: member.email,
            displayName: null,
          }
        }
      } )
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
        nextDirectoryById[userId] = {
          email: user?.email ?? null,
          displayName: user?.displayName ?? null,
        }
      }
      const missingProfileIds = creatorIds.filter(
        ( creatorId ) => creatorId && !nextDirectoryById[creatorId]?.displayName,
      )
      if( missingProfileIds.length > 0 ) {
        await Promise.all(
          missingProfileIds.map( async ( creatorId: string ) => {
            try {
              const profileSnapshot = await getDoc( doc( db, 'userProfiles', creatorId ) )
              const profileName = ( profileSnapshot.data()?.displayName as string | undefined ) ?? ''
              if( profileName ) {
                nextDirectoryById[creatorId] = {
                  ...nextDirectoryById[creatorId],
                  displayName: profileName,
                }
              }
            } catch {
              // ignore missing profiles
            }
          } ),
        )
      }
      setUserDirectoryById( nextDirectoryById )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      console.error( `ProjectDocuments loadDocuments failed at ${step}:`, err )
      if( !isOfflineFirestoreError( err ) ) {
        void reportAbnormalError( {
          error: err,
          source: 'firestore',
          action: `projectDocuments.load.${step}`,
          projectId,
        } )
      }
      openError( `Project documents failed at ${step}: ${message}`, [
        { label: '(project is selected)', ok: Boolean( projectId ) },
        { label: '(network connection is available)', ok: typeof navigator !== 'undefined' ? navigator.onLine : true },
      ] )
    } finally {
      setIsLoadingDocuments( false )
    }
  }, [ projectId, clearError, userId, filter, user?.email, user?.displayName, openError ] )

  useEffect( () => {
    void loadProject()
  }, [ loadProject ] )

  useEffect( () => {
    if( !projectId ) {
      return
    }
    setIsLoadingDocuments( true )
    const documentsQuery = query( collection( db, 'documents' ), where( 'projectId', '==', projectId ) )
    const unsubscribe = onSnapshot(
      documentsQuery,
      ( snapshot ) => {
        void loadDocuments( snapshot )
      },
      ( err ) => {
        const message = err instanceof Error ? err.message : 'Unexpected error'
        openError( `Project documents failed to load: ${message}`, [
          { label: '(project is selected)', ok: Boolean( projectId ) },
          { label: '(network connection is available)', ok: typeof navigator !== 'undefined' ? navigator.onLine : true },
        ] )
        setIsLoadingDocuments( false )
      },
    )
    return () => {
      unsubscribe()
    }
  }, [ projectId, loadDocuments, openError ] )

  useEffect( () => {
    if( error ) {
      if( lastErrorRef.current !== error ) {
        console.error( 'ProjectDocuments error modal:', error )
        lastErrorRef.current = error
      }
    }
  }, [ error ] )

  useEffect( () => {
    if( successMessage && successOkButtonRef.current ) {
      successOkButtonRef.current.focus()
    }
  }, [ successMessage ] )

  const handleCloseSuccessMessage = () => {
    const shouldRestoreFocus = shouldRestoreTitleFocusRef.current
    const shouldRestoreMemberFocus = shouldRestoreMemberFocusRef.current
    setSuccessMessage( null )
    if( shouldRestoreFocus ) {
      window.setTimeout( () => {
        titleInputRef.current?.focus()
      }, 0 )
    }
    if( shouldRestoreMemberFocus ) {
      window.setTimeout( () => {
        memberInputRef.current?.focus()
      }, 0 )
    }
    shouldRestoreTitleFocusRef.current = false
    shouldRestoreMemberFocusRef.current = false
  }

  const loadChangeRequestBaseProjectsForModal = useCallback( async () => {
    if( !projectId || !userId ) {
      setBaseProjects( [] )
      setSelectedBaseProjectId( '' )
      return
    }
    setIsLoadingChangeRequestBases( true )
    setChangeRequestError( null )
    try {
      const loadedProjects = await loadChangeRequestBaseProjects( projectId, userId )
      setBaseProjects( loadedProjects )
      setSelectedBaseProjectId( ( currentProjectId ) => {
        if( currentProjectId && loadedProjects.some( ( baseProject ) => baseProject.id === currentProjectId ) ) {
          return currentProjectId
        }
        return loadedProjects[0]?.id ?? ''
      } )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      void reportAbnormalError( {
        error: err,
        source: 'firestore',
        action: 'projectDocuments.loadChangeRequestBaseProjects',
        projectId,
      } )
      setChangeRequestError( `Change request bases failed to load: ${message}` )
      setBaseProjects( [] )
      setSelectedBaseProjectId( '' )
    } finally {
      setIsLoadingChangeRequestBases( false )
    }
  }, [ projectId, userId ] )

  const loadAcceptedBaseVersionsForModal = useCallback( async (baseProjectId: string) => {
    if( !baseProjectId ) {
      setAcceptedBaseVersions( [] )
      setSelectedBaseVersionId( '' )
      return
    }
    setIsLoadingChangeRequestBases( true )
    setChangeRequestError( null )
    try {
      const acceptedVersions = await loadAcceptedBaseVersions( baseProjectId )
      setAcceptedBaseVersions( acceptedVersions )
      setSelectedBaseVersionId( ( currentVersionId ) => {
        if( currentVersionId && acceptedVersions.some( ( versionItem ) => versionItem.versionId === currentVersionId ) ) {
          return currentVersionId
        }
        return acceptedVersions[0]?.versionId ?? ''
      } )
      if( acceptedVersions.length > 0 && changeRequestTitle.trim().length === 0 ) {
        setChangeRequestTitle( buildChangeRequestTitle( acceptedVersions[0].docTitle ) )
      }
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      void reportAbnormalError( {
        error: err,
        source: 'firestore',
        action: 'projectDocuments.loadAcceptedBaseVersions',
        projectId,
        focus: baseProjectId,
      } )
      setChangeRequestError( `Accepted base versions failed to load: ${message}` )
      setAcceptedBaseVersions( [] )
      setSelectedBaseVersionId( '' )
    } finally {
      setIsLoadingChangeRequestBases( false )
    }
  }, [ changeRequestTitle, projectId ] )

  useEffect( () => {
    if( isChangeRequestModalOpen ) {
      void loadChangeRequestBaseProjectsForModal()
    }
  }, [ isChangeRequestModalOpen, loadChangeRequestBaseProjectsForModal ] )

  useEffect( () => {
    if( isChangeRequestModalOpen ) {
      void loadAcceptedBaseVersionsForModal( selectedBaseProjectId )
    }
  }, [ isChangeRequestModalOpen, loadAcceptedBaseVersionsForModal, selectedBaseProjectId ] )

  const openChangeRequestModal = () => {
    setChangeRequestError( null )
    setAcceptedBaseVersions( [] )
    setSelectedBaseVersionId( '' )
    setChangeRequestTitle( '' )
    setIsChangeRequestModalOpen( true )
  }

  const closeChangeRequestModal = () => {
    if( isCreatingChangeRequest ) {
      return
    }
    setIsChangeRequestModalOpen( false )
  }

  const buildChangeRequestChecklist = useCallback( (): ChecklistItem[] => {
    const selectedBaseProjectForChecklist = selectedBaseVersion?.projectId ?? selectedBaseProjectId
    return [
      { label: '(target project is selected)', ok: Boolean( projectId && project ) },
      { label: '(user is signed in)', ok: Boolean( userId ) },
      { label: '(base project is selected)', ok: Boolean( selectedBaseProjectForChecklist ) },
      { label: '(user is member of base project)', ok: Boolean( selectedBaseVersion ) },
      {
        label: '(base project is different from target project)',
        ok: Boolean( selectedBaseProjectForChecklist && selectedBaseProjectForChecklist !== projectId ),
      },
      { label: "(base version status = 'Accepted')", ok: selectedBaseVersion?.status === 'Accepted' },
      { label: '(change request title is provided)', ok: changeRequestTitle.trim().length > 0 },
    ]
  }, [ changeRequestTitle, project, projectId, selectedBaseProjectId, selectedBaseVersion, userId ] )

  const openChangeRequestCreationError = useCallback( (message: string) => {
    const userMessage = message.startsWith( 'Change request creation failed:' )
      ? message
      : `Change request creation failed: ${message}`
    setChangeRequestError( userMessage )
    openError( userMessage, buildChangeRequestChecklist() )
  }, [ buildChangeRequestChecklist, openError ] )

  const handleCreateChangeRequest = async ( event: React.FormEvent<HTMLFormElement> ) => {
    event.preventDefault()
    const validation = validateChangeRequestCreation( {
      targetProjectId: projectId ?? '',
      baseProjectId: selectedBaseVersion?.projectId ?? selectedBaseProjectId,
      baseDocId: selectedBaseVersion?.docId ?? '',
      baseVersionId: selectedBaseVersion?.versionId ?? '',
      baseVersionStatus: selectedBaseVersion?.status ?? '',
      title: changeRequestTitle,
      userId,
    } )
    if( !validation.ok ) {
      openChangeRequestCreationError( validation.message )
      return
    }
    if( !projectId || !selectedBaseVersion ) {
      openChangeRequestCreationError( 'Select a base document version before creating a change request.' )
      return
    }
    setChangeRequestError( null )
    setSuccessMessage( null )
    setIsCreatingChangeRequest( true )
    try {
      const changeRequest = await createChangeRequestDocument( {
        projectId,
        selectedBaseVersion,
        title: changeRequestTitle,
        userEmail: user?.email,
        userId,
      } )
      setIsChangeRequestModalOpen( false )
      navigate( `/documents/${changeRequest.docId}/versions?projectId=${projectId}` )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      if( !isOfflineFirestoreError( err ) ) {
        void reportAbnormalError( {
          error: err,
          source: 'firestore',
          action: 'projectDocuments.createChangeRequest',
          projectId,
        } )
      }
      openChangeRequestCreationError( message )
    } finally {
      setIsCreatingChangeRequest( false )
    }
  }

  const buildDerivedDocumentChecklist = useCallback( (line: ActiveConfigurationLine): ChecklistItem[] => [
    { label: '(project is selected)', ok: Boolean( projectId && project ) },
    { label: '(user is signed in)', ok: Boolean( userId ) },
    { label: '(base project is external)', ok: Boolean( line.originProjectId && line.originProjectId !== projectId ) },
    { label: '(base document is selected)', ok: Boolean( line.originDocumentId ) },
    { label: '(base version is selected)', ok: Boolean( line.originVersionId ) },
    { label: '(accepted change requests exist)', ok: line.changeRequestVersionIds.length > 0 },
  ], [ project, projectId, userId ] )

  const handleCreateDerivedDocument = async (line: ActiveConfigurationLine) => {
    if( !projectId || !project || !userId ) {
      openError( 'Sign in and select an existing project before creating a derived variant.', buildDerivedDocumentChecklist( line ) )
      return
    }
    setSuccessMessage( null )
    clearError()
    setIsCreatingDerivedDocument( true )
    try {
      const baseReference = baseDocumentReferences[line.originDocumentId]
      const titleSuffix = baseReference?.title ?? 'external base'
      const derivedDocument = await createDerivedDocument( {
        line,
        title: `Derived variant - ${titleSuffix}`,
        userEmail: user?.email,
        userId,
      } )
      navigate( `/documents/${derivedDocument.docId}/versions?projectId=${projectId}` )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      if( !isOfflineFirestoreError( err ) ) {
        void reportAbnormalError( {
          error: err,
          source: 'firestore',
          action: 'projectDocuments.createDerivedDocument',
          projectId,
          docId: line.originDocumentId,
          versionId: line.originVersionId,
        } )
      }
      openError( `Derived variant creation failed: ${message}`, buildDerivedDocumentChecklist( line ) )
    } finally {
      setIsCreatingDerivedDocument( false )
    }
  }

  const handleAddMember = async ( event: React.FormEvent<HTMLFormElement> ) => {
    event.preventDefault()
    if( !projectId || !project || !userId ) {
      setMemberError( 'Sign in and select an existing project before adding members.' )
      return
    }
    if( !isProjectLeader ) {
      setMemberError( 'Only the project leader can add members.' )
      return
    }
    const memberEmailInput = memberEmail.trim()
    const memberEmailLower = memberEmailInput.toLowerCase()
    if( !memberEmailLower ) {
      setMemberError( 'Provide an email address.' )
      return
    }
    if( !isLikelyEmail( memberEmailInput ) ) {
      setMemberError( 'Provide a valid email address.' )
      return
    }
    let directorySnapshot
    try {
      directorySnapshot = await getDoc( doc( db, 'userDirectory', memberEmailInput ) )
      if( !directorySnapshot.exists() && memberEmailInput !== memberEmailLower ) {
        directorySnapshot = await getDoc( doc( db, 'userDirectory', memberEmailLower ) )
      }
      if( !directorySnapshot.exists() ) {
        const directoryQuery = query(
          collection( db, 'userDirectory' ),
          where( 'emailLower', '==', memberEmailLower ),
          limit( 1 ),
        )
        const directoryMatches = await getDocs( directoryQuery )
        if( directoryMatches.docs.length > 0 ) {
          directorySnapshot = directoryMatches.docs[0]
        }
      }
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      void reportAbnormalError( {
        error: err,
        source: 'firestore',
        action: 'projectDocuments.lookupMember',
        projectId,
      } )
      setMemberError( `Member lookup failed: ${message}` )
      return
    }
    if( !directorySnapshot.exists() ) {
      setMemberError( 'No user found for that email address.' )
      return
    }
    const directoryData = directorySnapshot.data()
    const memberUserId = ( directoryData.userId as string | undefined ) ?? ''
    const resolvedMemberEmail = ( directoryData.email as string | undefined ) ?? memberEmailInput
    if( !memberUserId ) {
      setMemberError( 'Member lookup returned an invalid user.' )
      return
    }
    if( projectMembers.some( ( member ) => member.userId === memberUserId ) ) {
      setMemberError( 'That user is already a project member.' )
      return
    }
    if( memberUserId === userId ) {
      setMemberError( 'You are already the project leader.' )
      return
    }
    setMemberError( null )
    setSuccessMessage( null )
    setIsAddingMember( true )
    const previousMembers = projectMembers
    const optimisticMember: ProjectMember = {
      projectId,
      userId: memberUserId,
      role: 'member',
      email: resolvedMemberEmail,
    }
    setProjectMembers( [ ...previousMembers, optimisticMember ] )
    setUserDirectoryById( ( previous ) => ( {
      ...previous,
      [memberUserId]: {
        email: resolvedMemberEmail,
        displayName: previous[memberUserId]?.displayName ?? null,
      },
    } ) )
    try {
      await setDoc(
        doc( db, 'projectMembers', `${projectId}_${memberUserId}` ),
        {
          projectId,
          userId: memberUserId,
          role: 'member',
          email: resolvedMemberEmail,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
      setMemberEmail( '' )
      shouldRestoreMemberFocusRef.current = true
      setSuccessMessage( 'Member added successfully.' )
      void ( async () => {
        try {
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'addProjectMember',
            entityType: 'projectMember',
            entityId: `${projectId}_${memberUserId}`,
            projectId,
            targetUserId: memberUserId,
            metadata: {
              role: 'member',
            },
          } )
        } catch( err ) {
          console.warn( 'Audit log failed (add member):', err )
        }
      } )()
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      void reportAbnormalError( {
        error: err,
        source: 'firestore',
        action: 'projectDocuments.addMember',
        projectId,
      } )
      setMemberError( `Member add failed: ${message}` )
      setProjectMembers( previousMembers )
    } finally {
      setIsAddingMember( false )
    }
  }

  const handleCreateDocument = async ( event: React.FormEvent<HTMLFormElement> ) => {
    event.preventDefault()
    if( !projectId || !project || !userId ) {
      openError( 'Sign in and select an existing project before creating documents.', [
        { label: '(project is selected)', ok: Boolean( projectId ) },
        { label: '(project exists)', ok: Boolean( project ) },
        { label: '(user is signed in)', ok: Boolean( userId ) },
      ] )
      return
    }
    if( title.trim().length === 0 ) {
      openError( 'Document title cannot be empty.', [
        { label: '(project is selected)', ok: Boolean( projectId ) },
        { label: '(user is signed in)', ok: Boolean( userId ) },
        { label: '(document title is provided)', ok: false },
      ] )
      return
    }
    clearError()
    setSuccessMessage( null )
    setIsBusy( true )
    try {
      const counterRef = doc( db, 'counters', `documents_${projectId}` )
      const documentRef = doc( collection( db, 'documents' ) )
      const versionRef = doc( collection( db, 'versions' ) )
      const versionCounterRef = doc( db, 'counters', `versions_${documentRef.id}` )
      await runTransaction( db, async ( transaction ) => {
        const counterSnap = await transaction.get( counterRef )
        const nextNumberRaw = counterSnap.data()?.nextNumber
        const nextNumber = typeof nextNumberRaw === 'number' ? nextNumberRaw : 1
        transaction.set(
          counterRef,
          {
            nextNumber: nextNumber + 1,
            projectId,
          },
          { merge: true },
        )
        transaction.set( documentRef, {
          projectId,
          title: title.trim(),
          type: 'document',
          createdBy: userId,
          authorId: userId,
          updatedBy: userId,
          shortId: nextNumber,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } )
        transaction.set( versionRef, {
          projectId,
          docId: documentRef.id,
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
          activityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        } )
        transaction.set(
          versionCounterRef,
          {
            nextNumber: FIRST_VERSION_NUMBER + 1,
            docId: documentRef.id,
            projectId,
            previousVersionId: null,
          },
          { merge: true },
        )
      } )
      setTitle( '' )
      shouldRestoreTitleFocusRef.current = true
      setSuccessMessage( 'Document created successfully.' )
      void ( async () => {
        try {
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'createDocument',
            entityType: 'document',
            entityId: documentRef.id,
            projectId,
            docId: documentRef.id,
            versionId: versionRef.id,
          } )
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'taskAppear',
            entityType: 'task',
            entityId: `authoring:${versionRef.id}:${userId}`,
            projectId,
            docId: documentRef.id,
            versionId: versionRef.id,
            targetUserId: userId,
            metadata: {
              taskType: 'authoring',
              taskKey: `authoring:${versionRef.id}:${userId}`,
            },
          } )
        } catch( err ) {
          console.warn( 'Audit log failed (create document):', err )
        }
      } )()
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      if( !isOfflineFirestoreError( err ) ) {
        void reportAbnormalError( {
          error: err,
          source: 'firestore',
          action: 'projectDocuments.createDocument',
          projectId,
        } )
      }
      openError( message, [
        { label: '(project is selected)', ok: Boolean( projectId ) },
        { label: '(user is signed in)', ok: Boolean( userId ) },
        { label: '(document title is provided)', ok: title.trim().length > 0 },
        { label: '(network connection is available)', ok: typeof navigator !== 'undefined' ? navigator.onLine : true },
      ] )
    } finally {
      setIsBusy( false )
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <AppBrand pageTitle="Project Documents" />
          <div className="context-nav-label">
            <span className="document-title-prefix">Project</span>
            <span className="document-title-text">
              {project ? `${project.shortId ?? 'Unassigned'} - ${project.name}` : 'Unknown project'}
            </span>
          </div>
        </div>
        <BackStack links={[ { label: 'Projects', to: '/projects' } ]} />
      </header>

      <main className="app-main">
        <section className="panel stack">
          <div className="panel-header">
            <h2>Project members</h2>
            <div className="actions">
              <button
                type="button"
                aria-expanded={isMembersPanelExpanded}
                aria-controls="project-members-panel-content"
                onClick={() => setIsMembersPanelExpanded( ( previous ) => !previous )}
              >
                {isMembersPanelExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>
          </div>
          {isMembersPanelExpanded ? (
            <div id="project-members-panel-content" className="stack">
              {sortedProjectMembers.length === 0 ? (
                <p className="muted">No members loaded for this project.</p>
              ) : (
                <ul className="member-list">
                  {sortedProjectMembers.map( ( member ) => (
                    <li key={`${member.projectId}-${member.userId}`}>
                      <span>{formatUserLabel( member.userId )}</span>
                      <span className="muted">({member.role})</span>
                    </li>
                  ) )}
                </ul>
              )}
              {isProjectLeader ? (
                <form className="form" onSubmit={handleAddMember}>
                  <div className="actions actions--capture-row">
                    <label className="field">
                      <span>Add member (email)</span>
                      <input
                        ref={memberInputRef}
                        type="text"
                        value={memberEmail}
                        onChange={( event ) => setMemberEmail( event.target.value )}
                        placeholder="user@example.com"
                        disabled={isAddingMember || isBusy}
                      />
                    </label>
                    <button type="submit" disabled={isAddingMember || isBusy}>
                      Add member
                    </button>
                  </div>
                  {memberError ? <p className="error">{memberError}</p> : null}
                </form>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="panel stack">
          {!isBusy ? <h2>Create document</h2> : null}
          <form className="form" onSubmit={handleCreateDocument}>
            <label className="field">
              <span>Title</span>
              <input
                ref={titleInputRef}
                type="text"
                name="title"
                required
                value={title}
                onChange={( event ) => setTitle( event.target.value )}
              />
            </label>
            <div className="actions">
              <button type="submit" disabled={!canSubmit}>
                Create document
              </button>
            </div>
          </form>
          <div className="actions">
            <button type="button" onClick={openChangeRequestModal} disabled={!projectId || !project || !userId}>
              New change request
            </button>
          </div>
        </section>

        {activeConfigurationLines.length > 0 ? (
          <section className="panel stack" aria-label="Active derived configuration">
            <div className="panel-header">
              <div>
                <h2>Active derived configuration</h2>
                <p className="muted">Accepted change requests grouped by external base.</p>
              </div>
            </div>
            <div className="project-grid">
              {activeConfigurationLines.map( ( line ) => (
                <article key={line.key} className="project-card">
                  <h3>{formatActiveConfigurationLine( line )}</h3>
                  <p className="muted">
                    Accepted change requests: {line.changeRequestVersionIds.length}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleCreateDerivedDocument( line )}
                    disabled={isCreatingDerivedDocument}
                  >
                    {isCreatingDerivedDocument ? 'Generating derived variant...' : 'Generate derived variant'}
                  </button>
                </article>
              ) )}
            </div>
          </section>
        ) : null}

        {isLoadingDocuments && documents.length === 0 ? (
          <section className="panel">
            <GiphyInline reason="loading" />
          </section>
        ) : (
          <section className="panel stack">
            <div className="panel-header">
              <h2>Documents</h2>
              <div className="actions">
                <label className="field">
                  <span>Filter</span>
                  <div className="view-toggle">
                    <button
                      type="button"
                      aria-pressed={filter === 'all'}
                      onClick={() => setFilter( 'all' )}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      aria-pressed={filter === 'mine'}
                      onClick={() => setFilter( 'mine' )}
                    >
                      Mine
                    </button>
                  </div>
                </label>
              </div>
            </div>
            {error ? (
              <ErrorChecklistModal
                error={error}
                checklist={errorChecklist}
                onClose={clearError}
                reportContext={{
                  pageLabel: 'Project Documents',
                  projectId: projectId ?? '',
                  projectLabel: project ? `${project.shortId ?? 'Unassigned'} - ${project.name}` : '',
                }}
              />
            ) : null}
            {successMessage ? (
              <ModalDialog onClose={handleCloseSuccessMessage} initialFocusRef={successOkButtonRef}>
                  <h3>Success</h3>
                  <GiphyInline reason="good_job" mode="inline" showLabel={false} />
                  <p className="muted">{successMessage}</p>
                  <div className="actions">
                    <button ref={successOkButtonRef} type="button" onClick={handleCloseSuccessMessage}>
                      OK
                    </button>
                  </div>
              </ModalDialog>
            ) : null}
            {isChangeRequestModalOpen ? (
              <ModalDialog onClose={closeChangeRequestModal}>
                <form className="form" onSubmit={handleCreateChangeRequest}>
                  <h3>Create change request</h3>
                  {isLoadingChangeRequestBases ? (
                    <p className="muted">Loading available bases...</p>
                  ) : null}
                  {baseProjects.length === 0 && !isLoadingChangeRequestBases ? (
                    <p className="muted">No other readable projects have accepted base documents.</p>
                  ) : (
                    <>
                      <label className="field">
                        <span>Base project</span>
                        <select
                          value={selectedBaseProjectId}
                          onChange={( event ) => {
                            setSelectedBaseProjectId( event.target.value )
                            setSelectedBaseVersionId( '' )
                            setAcceptedBaseVersions( [] )
                            setChangeRequestTitle( '' )
                          }}
                          disabled={isLoadingChangeRequestBases || isCreatingChangeRequest}
                        >
                          {baseProjects.map( ( baseProject ) => (
                            <option key={baseProject.id} value={baseProject.id}>
                              {`${baseProject.shortId ?? 'Unassigned'} - ${baseProject.name}`}
                            </option>
                          ) )}
                        </select>
                      </label>
                      <label className="field">
                        <span>Base document</span>
                        <select
                          value={selectedBaseVersionId}
                          onChange={( event ) => {
                            const nextVersionId = event.target.value
                            setSelectedBaseVersionId( nextVersionId )
                            const nextBaseVersion = acceptedBaseVersions.find(
                              ( versionItem ) => versionItem.versionId === nextVersionId,
                            )
                            if( nextBaseVersion ) {
                              setChangeRequestTitle( buildChangeRequestTitle( nextBaseVersion.docTitle ) )
                            }
                          }}
                          disabled={
                            isLoadingChangeRequestBases ||
                            isCreatingChangeRequest ||
                            acceptedBaseVersions.length === 0
                          }
                        >
                          {acceptedBaseVersions.map( ( versionItem ) => (
                            <option key={versionItem.versionId} value={versionItem.versionId}>
                              {formatShortDocumentReference( {
                                projectShortId: selectedBaseProject?.shortId,
                                documentShortId: versionItem.docShortId,
                                versionNumber: versionItem.versionNumber,
                                title: versionItem.docTitle,
                              } )}
                            </option>
                          ) )}
                        </select>
                      </label>
                      {acceptedBaseVersions.length === 0 && !isLoadingChangeRequestBases ? (
                        <p className="muted">This base project has no accepted document versions.</p>
                      ) : null}
                      <label className="field">
                        <span>Change request title</span>
                        <input
                          type="text"
                          value={changeRequestTitle}
                          onChange={( event ) => setChangeRequestTitle( event.target.value )}
                          disabled={isCreatingChangeRequest}
                          required
                        />
                      </label>
                    </>
                  )}
                  {changeRequestError ? <p className="error">{changeRequestError}</p> : null}
                  <div className="actions">
                    <button type="submit" disabled={!canCreateChangeRequest}>
                      {isCreatingChangeRequest ? 'Creating change request...' : 'Create change request'}
                    </button>
                    <button type="button" className="ghost" onClick={closeChangeRequestModal} disabled={isCreatingChangeRequest}>
                      Cancel
                    </button>
                  </div>
                </form>
              </ModalDialog>
            ) : null}
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
            {!isLoadingDocuments && documentTableRows.length === 0 ? (
              <p className="muted">No documents yet for this project.</p>
            ) : viewMode === 'table' ? (
              <DataTable
                key={`qt4_table_documents_${projectId ?? 'unknown'}`}
                columns={documentColumns}
                data={documentTableRows}
                sorting={sorting}
                onSortingChange={setSorting}
                tableClassName="data-table--documents"
                storageKey={`qt4_table_documents_${projectId ?? 'unknown'}`}
                getRowClassName={( row ) => statusClassName( row.latestStatus, row.latestReviewEndAt )}
                onRowClick={( row ) => {
                  if( projectId ) {
                    navigate( `/documents/${row.id}/versions?projectId=${projectId}` )
                  }
                }}
              />
            ) : (
              <div className="project-grid">
                {sortedDocumentCards.map( ( documentItem ) => (
                  <article
                    key={documentItem.id}
                    className={`project-card ${statusClassName( documentItem.latestStatus, documentItem.latestReviewEndAt )}`}
                    onClick={() => {
                      if( projectId ) {
                        navigate( `/documents/${documentItem.id}/versions?projectId=${projectId}` )
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={( event ) => {
                      if( event.key === 'Enter' || event.key === ' ' ) {
                        event.preventDefault()
                        if( projectId ) {
                          navigate( `/documents/${documentItem.id}/versions?projectId=${projectId}` )
                        }
                      }
                    }}
                  >
                    <h3>
                      {formatDocumentTitle( documentItem )}
                    </h3>
                    {documentItem.type === 'errorReport' || documentItem.type === 'changeRequest' ? (
                      <p className="muted">
                        For document: {formatBaseDocumentLabel( documentItem )}
                      </p>
                    ) : null}
                    <p className="muted">
                      {documentItem.latestVersionNumber
                        ? `Version ${versionNumberToString( documentItem.latestVersionNumber )} - ${
                            documentItem.latestStatus ?? 'In Creation'
                          }`
                        : 'No versions yet'}
                    </p>
                    <p className="muted">Creator: {formatUserLabel( documentItem.createdBy )}</p>
                    <p className="muted">Created: {formatTimeAgoWithTimestamp( documentItem.createdAt )}</p>
                    <p className="muted">
                      Last activity: {formatTimeAgoWithTimestamp( documentItem.lastActivityAt )}
                      {documentItem.hasFutureActivityAnomaly ? ' ?' : ''}
                    </p>
                  </article>
                ) )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

export default ProjectDocumentsPage
