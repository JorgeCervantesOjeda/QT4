import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import addDays from 'date-fns/addDays'
import addMonths from 'date-fns/addMonths'
import addWeeks from 'date-fns/addWeeks'
import format from 'date-fns/format'
import getDay from 'date-fns/getDay'
import parse from 'date-fns/parse'
import startOfDay from 'date-fns/startOfDay'
import startOfWeek from 'date-fns/startOfWeek'
import { enUS } from 'date-fns/locale'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  writeBatch,
  where,
} from 'firebase/firestore'
import { Calendar, dateFnsLocalizer, type Event as CalendarEvent } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { useAuth } from '../auth/useAuth'
import AppBrand from '../components/AppBrand'
import BackStack from '../components/BackStack'
import DataTable from '../components/DataTable'
import ErrorChecklistModal from '../components/ErrorChecklistModal'
import ModalDialog from '../components/ModalDialog'
import {
  type FileStorageProviderKind,
  type NotificationProviderKind,
  versionNumberToString,
} from '../domain/types'
import { GiphyInline } from '../giphy/GiphyProvider'
import { buildAdminAuditErrorChecklist } from '../lib/errorChecklistBuilders'
import { buildFilesApiUrl, getFilesApiConfigSummary } from '../lib/filesApi'
import { db } from '../lib/firebase'
import {
  formatRuntimeConfigSummary,
  getDefaultAppRuntimeConfig,
  loadAppRuntimeConfig,
  saveAppRuntimeConfig,
} from '../lib/runtimeConfig'
import { REVIEW_WINDOW_MS } from '../lib/reviewWindow'
import { formatTimeAgo } from '../lib/time'

type AuditLogEntry = {
  id: string
  actorId: string
  actorEmail?: string | null
  action: string
  entityType: string
  entityId: string
  projectId?: string
  docId?: string
  versionId?: string
  threadId?: string
  commentId?: string
  targetUserId?: string
  createdAt?: Date | null
  metadata?: Record<string, unknown>
}

type TaskDurationEntry = {
  taskKey: string
  taskType: string
  actorId?: string
  actorEmail?: string | null
  appearedAt: Date | null
  completedAt: Date | null
  isApproximate: boolean
}

type UserDirectoryEntry = {
  userId: string
  email?: string | null
  displayName?: string | null
}

type DocumentLabel = {
  title: string
  shortId: number | null
  type: string
}

type AuditCalendarEvent = CalendarEvent & {
  resource: AuditLogEntry
}

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

const parseLocalDateInput = (value: string): Date | null => {
  const [yearRaw, monthRaw, dayRaw] = value.split( '-' )
  const year = Number( yearRaw )
  const month = Number( monthRaw )
  const day = Number( dayRaw )
  if( !Number.isFinite( year ) || !Number.isFinite( month ) || !Number.isFinite( day ) ) {
    return null
  }
  if( month < 1 || month > 12 || day < 1 || day > 31 ) {
    return null
  }
  const parsed = new Date( year, month - 1, day, 0, 0, 0, 0 )
  if(
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }
  return parsed
}

const chunkArray = <T,>(items: T[], size: number): T[][] => {
  if( size <= 0 ) {
    return [ items ]
  }
  const chunks: T[][] = []
  for( let i = 0; i < items.length; i += size ) {
    chunks.push( items.slice( i, i + size ) )
  }
  return chunks
}

const calendarLocalizer = dateFnsLocalizer( {
  format,
  parse,
  startOfWeek,
  getDay,
  locales: {
    'en-US': enUS,
  },
} )

const DATA_MODEL_UPDATE_VERSION = 2
const ALL_USERS_FILTER = '__all_users__'
const AUDIT_CSV_HEADERS = [
  'when',
  'actor',
  'actorEmail',
  'action',
  'entityType',
  'project',
  'document',
  'version',
  'threadOrComment',
  'targetUser',
  'entityId',
  'metadata',
]

const formatCsvValue = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String( value )
  if( /[",\r\n]/.test( text ) ) {
    return `"${text.replace( /"/g, '""' )}"`
  }
  return text
}

const buildCsvText = (headers: string[], rows: unknown[][]): string =>
  [ headers, ...rows ].map( ( row ) => row.map( formatCsvValue ).join( ',' ) ).join( '\r\n' )

const safeCsvFileSegment = (value: string): string => {
  const normalized = value.trim().replace( /[^a-z0-9_-]+/gi, '-' ).replace( /-+/g, '-' )
  return normalized.replace( /^-|-$/g, '' ) || 'audit'
}

function AdminAuditPage() {
  const { user } = useAuth()
  const userId = user?.uid ?? ''
  const defaultRuntimeConfig = getDefaultAppRuntimeConfig()
  const [isAdmin, setIsAdmin] = useState( false )
  const [isBusy, setIsBusy] = useState( false )
  const [error, setError] = useState<string | null>( null )

  const [users, setUsers] = useState<UserDirectoryEntry[]>([] )
  const [selectedUserId, setSelectedUserId] = useState( '' )
  const [startDate, setStartDate] = useState( '' )
  const [endDate, setEndDate] = useState( '' )
  const [lastReportRangeLabel, setLastReportRangeLabel] = useState( '' )
  const [logs, setLogs] = useState<AuditLogEntry[]>([] )

  const [projectNameById, setProjectNameById] = useState<Record<string, string>>( {} )
  const [documentById, setDocumentById] = useState<Record<string, DocumentLabel>>( {} )
  const [versionNumberById, setVersionNumberById] = useState<Record<string, number>>( {} )
  const [threadTitleById, setThreadTitleById] = useState<Record<string, string>>( {} )
  const [commentBodyById, setCommentBodyById] = useState<Record<string, string>>( {} )
  const [userDirectoryById, setUserDirectoryById] = useState<Record<string, UserDirectoryEntry>>( {} )
  const [taskDurations, setTaskDurations] = useState<TaskDurationEntry[]>([] )
  const [logSorting, setLogSorting] = useState<SortingState>( [ { id: 'createdAtMs', desc: true } ] )
  const [taskSorting, setTaskSorting] = useState<SortingState>( [ { id: 'appearedAtMs', desc: true } ] )
  const [logViewMode, setLogViewMode] = useState<'table' | 'calendar'>( () => {
    const stored = window.localStorage.getItem( 'qt4_audit_log_view' )
    return stored === 'calendar' ? 'calendar' : 'table'
  } )
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day' | 'agenda'>( 'month' )
  const [calendarDate, setCalendarDate] = useState<Date>( startOfDay( new Date() ) )
  const [selectedCalendarLog, setSelectedCalendarLog] = useState<AuditLogEntry | null>( null )
  const [filesApiStatus, setFilesApiStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>( 'idle' )
  const [filesApiMessage, setFilesApiMessage] = useState<string>( '' )
  const [filesApiCheckedAt, setFilesApiCheckedAt] = useState<string>( '' )
  const [runtimeConfigStatus, setRuntimeConfigStatus] = useState<'idle' | 'loading' | 'saving' | 'done' | 'error'>( 'idle' )
  const [runtimeConfigMessage, setRuntimeConfigMessage] = useState( '' )
  const [runtimeConfigLoadedAt, setRuntimeConfigLoadedAt] = useState( '' )
  const [runtimeConfigSource, setRuntimeConfigSource] = useState<'firestore' | 'defaults'>( 'defaults' )
  const [selectedFileStorageProvider, setSelectedFileStorageProvider] = useState<FileStorageProviderKind>(
    defaultRuntimeConfig.fileStorageProvider,
  )
  const [selectedEmailProvider, setSelectedEmailProvider] = useState<NotificationProviderKind>(
    defaultRuntimeConfig.emailProvider,
  )
  const [modelUpdateStatus, setModelUpdateStatus] = useState<'idle' | 'running' | 'done' | 'error'>( 'idle' )
  const [modelUpdateMessage, setModelUpdateMessage] = useState<string>( '' )
  const [modelUpdateSummary, setModelUpdateSummary] = useState<string>( '' )
  const [modelUpdateProgress, setModelUpdateProgress] = useState( 0 )
  const [modelUpdateProgressLabel, setModelUpdateProgressLabel] = useState( '' )
  const [modelUpdateLog, setModelUpdateLog] = useState<string[]>([] )
  const [isModelUpdateLogOpen, setIsModelUpdateLogOpen] = useState( false )
  const [modelUpdateLogCopyStatus, setModelUpdateLogCopyStatus] = useState<'idle' | 'copied' | 'error'>( 'idle' )
  const [confirmModelUpdate, setConfirmModelUpdate] = useState( false )
  const [reviewRepairStatus, setReviewRepairStatus] = useState<'idle' | 'running' | 'done' | 'error'>( 'idle' )
  const [reviewRepairMessage, setReviewRepairMessage] = useState<string>( '' )
  const [reviewRepairSummary, setReviewRepairSummary] = useState<string>( '' )
  const [confirmReviewRepair, setConfirmReviewRepair] = useState( false )
  const runReportButtonRef = useRef<HTMLButtonElement | null>( null )
  const shouldRestoreRunReportFocusRef = useRef( false )
  const reportUserId = isAdmin ? selectedUserId : userId
  const isAllUsersSelected = isAdmin && reportUserId === ALL_USERS_FILTER

  const copyModelUpdateLog = useCallback( async () => {
    const text = [ ...modelUpdateLog, modelUpdateSummary ].filter( Boolean ).join( '\n' )
    if( !text ) {
      setModelUpdateLogCopyStatus( 'error' )
      return
    }
    try {
      await navigator.clipboard.writeText( text )
      setModelUpdateLogCopyStatus( 'copied' )
    } catch {
      setModelUpdateLogCopyStatus( 'error' )
    }
  }, [ modelUpdateLog, modelUpdateSummary ] )

  const errorChecklist = useMemo( () => buildAdminAuditErrorChecklist( error, {
    userSignedIn: Boolean( userId ),
    selectedUserValid: !isAdmin || Boolean( selectedUserId ),
    isStartDateValid: !startDate || Boolean( parseLocalDateInput( startDate ) ),
    isEndDateValid: !endDate || Boolean( parseLocalDateInput( endDate ) ),
    networkAvailable: typeof navigator !== 'undefined' ? navigator.onLine : true,
  } ), [ error, userId, isAdmin, selectedUserId, startDate, endDate ] )

  const formatActorLabelByIdentity = useCallback( (actorId?: string, actorEmail?: string | null) => {
    if( !actorId && !actorEmail ) {
      return 'Unknown user'
    }
    const entry = actorId ? userDirectoryById[actorId] : undefined
    const displayName = entry?.displayName ?? ''
    const email = entry?.email ?? actorEmail ?? ''
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
  }, [ userDirectoryById ] )

  const formatActorLabel = useCallback( (log: AuditLogEntry) => {
    return formatActorLabelByIdentity( log.actorId, log.actorEmail )
  }, [ formatActorLabelByIdentity ] )

  const logTableRows = useMemo(
    () =>
      logs.map( ( log ) => ( {
        ...log,
        createdAtMs: log.createdAt ? log.createdAt.getTime() : 0,
        actorLabel: formatActorLabel( log ),
      } ) ),
    [ logs, formatActorLabel ],
  )

  const calendarEvents = useMemo<AuditCalendarEvent[]>(
    () =>
      logs
        .filter( ( log ) => log.createdAt instanceof Date )
        .map( ( log ) => {
          const start = log.createdAt as Date
          const end = new Date( start.getTime() + 30 * 60 * 1000 )
          return {
            title: isAllUsersSelected
              ? `${formatActorLabel( log )} - ${log.action} (${log.entityType})`
              : `${log.action} (${log.entityType})`,
            start,
            end,
            allDay: false,
            resource: log,
          }
        } ),
    [ logs, formatActorLabel, isAllUsersSelected ],
  )

  const visibleCalendarEvents = useMemo<AuditCalendarEvent[]>( () => {
    if( calendarView !== 'agenda' ) {
      return calendarEvents
    }
    const dayStart = startOfDay( calendarDate )
    const dayEnd = addDays( dayStart, 1 )
    return calendarEvents.filter( ( event ) => {
      const start = event.start instanceof Date ? event.start : null
      if( !start ) {
        return false
      }
      return start >= dayStart && start < dayEnd
    } )
  }, [ calendarEvents, calendarDate, calendarView ] )

  const logColumns = useMemo<ColumnDef<AuditLogEntry & { createdAtMs: number; actorLabel: string }>[]>( 
    () => {
      const resolveUserLabel = (memberUserId?: string) => {
        if( !memberUserId ) {
          return 'Unknown user'
        }
        const entry = userDirectoryById[memberUserId]
        const displayName = entry?.displayName ?? ''
        const email = entry?.email ?? ''
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
      }
      const resolveDocumentLabel = (docId?: string) => {
        if( !docId ) {
          return 'Unknown document'
        }
        const entry = documentById[docId]
        if( !entry ) {
          return 'Unknown document'
        }
        const shortId = entry.shortId ?? 'Unassigned'
        if( entry.type === 'errorReport' ) {
          return `Error report - ${shortId} - ${entry.title}`
        }
        return `${shortId} - ${entry.title}`
      }
      const resolveVersionLabel = (versionId?: string) => {
        if( !versionId ) {
          return 'Unknown version'
        }
        const number = versionNumberById[versionId]
        if( !number ) {
          return 'Unknown version'
        }
        return versionNumberToString( number )
      }
      const resolveThreadLabel = (threadId?: string) => {
        if( !threadId ) {
          return 'Thread'
        }
        const title = threadTitleById[threadId]
        return title ? `Thread: ${title}` : 'Thread'
      }
      const resolveCommentLabel = (commentId?: string) => {
        if( !commentId ) {
          return 'Comment'
        }
        const body = commentBodyById[commentId]
        if( !body ) {
          return 'Comment'
        }
        const trimmed = body.trim()
        if( trimmed.length <= 80 ) {
          return `Comment: ${trimmed}`
        }
        return `Comment: ${trimmed.slice( 0, 80 )}...`
      }
      return [
        {
          header: 'When',
          accessorKey: 'createdAtMs',
          cell: ( info ) => ( info.row.original.createdAt ? formatTimeAgo( info.row.original.createdAt ) : 'Unknown' ),
        },
        {
          header: 'Action',
          accessorKey: 'action',
        },
        ...( isAllUsersSelected
          ? [
            {
              header: 'Actor',
              accessorKey: 'actorLabel',
            },
          ]
          : [] ),
        {
          header: 'Project',
          accessorKey: 'projectId',
          cell: ( info ) => info.getValue<string>() ? ( projectNameById[info.getValue<string>()] ?? 'Unknown project' ) : '-',
        },
        {
          header: 'Document',
          accessorKey: 'docId',
          cell: ( info ) => info.getValue<string>() ? resolveDocumentLabel( info.getValue<string>() ) : '-',
        },
        {
          header: 'Version',
          accessorKey: 'versionId',
          cell: ( info ) => info.getValue<string>() ? resolveVersionLabel( info.getValue<string>() ) : '-',
        },
        {
          header: 'Thread/Comment',
          accessorKey: 'threadId',
          cell: ( info ) => {
            const row = info.row.original
            if( row.commentId ) {
              return resolveCommentLabel( row.commentId )
            }
            if( row.threadId ) {
              return resolveThreadLabel( row.threadId )
            }
            return '-'
          },
        },
        {
          header: 'Target user',
          accessorKey: 'targetUserId',
          cell: ( info ) => info.getValue<string>() ? resolveUserLabel( info.getValue<string>() ) : '-',
        },
      ]
    },
    [
      projectNameById,
      documentById,
      versionNumberById,
      threadTitleById,
      commentBodyById,
      userDirectoryById,
      isAllUsersSelected,
    ],
  )

  const taskTableRows = useMemo(
    () =>
      taskDurations.map( ( entry ) => ( {
        ...entry,
        appearedAtMs: entry.appearedAt ? entry.appearedAt.getTime() : 0,
        completedAtMs: entry.completedAt ? entry.completedAt.getTime() : 0,
        actorLabel: formatActorLabelByIdentity( entry.actorId, entry.actorEmail ),
      } ) ),
    [ taskDurations, formatActorLabelByIdentity ],
  )

  const taskColumns = useMemo<ColumnDef<TaskDurationEntry & { appearedAtMs: number; completedAtMs: number; actorLabel: string }>[]>( 
    () => [
      ...( isAllUsersSelected
        ? [
          {
            header: 'User',
            accessorKey: 'actorLabel',
          },
        ]
        : [] ),
      {
        header: 'Task',
        accessorKey: 'taskType',
      },
      {
        header: 'Appeared',
        accessorKey: 'appearedAtMs',
        cell: ( info ) => ( info.row.original.appearedAt ? formatTimeAgo( info.row.original.appearedAt ) : '-' ),
      },
      {
        header: 'Completed',
        accessorKey: 'completedAtMs',
        cell: ( info ) => ( info.row.original.completedAt ? formatTimeAgo( info.row.original.completedAt ) : '-' ),
      },
      {
        header: 'Approximate end',
        accessorKey: 'isApproximate',
        cell: ( info ) => ( info.getValue<boolean>() ? 'Yes' : 'No' ),
      },
      {
        header: 'Duration',
        accessorKey: 'taskKey',
        cell: ( info ) => {
          const row = info.row.original
          if( row.appearedAt && row.completedAt ) {
            const durationMs = row.completedAt.getTime() - row.appearedAt.getTime()
            if( durationMs > 0 ) {
              return `${Math.round( durationMs / 60000 )} min`
            }
          }
          return '-'
        },
      },
    ],
    [ isAllUsersSelected ],
  )

  const sortedUsers = useMemo(
    () =>
      [ ...users ].sort( ( a, b ) => ( a.displayName ?? a.email ?? '' ).localeCompare( b.displayName ?? b.email ?? '' ) ),
    [ users ],
  )

  function formatUserLabel( memberUserId?: string ) {
    if( !memberUserId ) {
      return 'Unknown user'
    }
    const entry = userDirectoryById[memberUserId]
    const displayName = entry?.displayName ?? ''
    const email = entry?.email ?? ''
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
  }

  function formatDocumentLabel( docId?: string ) {
    if( !docId ) {
      return 'Unknown document'
    }
    const entry = documentById[docId]
    if( !entry ) {
      return 'Unknown document'
    }
    const shortId = entry.shortId ?? 'Unassigned'
    if( entry.type === 'errorReport' ) {
      return `Error report - ${shortId} - ${entry.title}`
    }
    return `${shortId} - ${entry.title}`
  }

  function formatVersionLabel( versionId?: string ) {
    if( !versionId ) {
      return 'Unknown version'
    }
    const number = versionNumberById[versionId]
    if( !number ) {
      return 'Unknown version'
    }
    return versionNumberToString( number )
  }

  function formatThreadLabel( threadId?: string ) {
    if( !threadId ) {
      return 'Thread'
    }
    const title = threadTitleById[threadId]
    return title ? `Thread: ${title}` : 'Thread'
  }

  function formatCommentLabel( commentId?: string ) {
    if( !commentId ) {
      return 'Comment'
    }
    const body = commentBodyById[commentId]
    if( !body ) {
      return 'Comment'
    }
    const trimmed = body.trim()
    if( trimmed.length <= 80 ) {
      return `Comment: ${trimmed}`
    }
    return `Comment: ${trimmed.slice( 0, 80 )}...`
  }

  const formatCalendarLogSummary = (log: AuditLogEntry) => {
    const actor = formatActorLabel( log )
    const project = log.projectId ? ( projectNameById[log.projectId] ?? 'Unknown project' ) : '-'
    const document = log.docId ? formatDocumentLabel( log.docId ) : '-'
    const version = log.versionId ? formatVersionLabel( log.versionId ) : '-'
    const targetUser = log.targetUserId ? formatUserLabel( log.targetUserId ) : '-'
    return { actor, project, document, version, targetUser }
  }

  const downloadAuditCsv = () => {
    if( logs.length === 0 ) {
      return
    }
    const rows = logs.map( ( log ) => {
      const summary = formatCalendarLogSummary( log )
      const threadOrComment = log.commentId
        ? formatCommentLabel( log.commentId )
        : log.threadId
          ? formatThreadLabel( log.threadId )
          : '-'
      return [
        log.createdAt?.toISOString() ?? '',
        summary.actor,
        log.actorEmail ?? userDirectoryById[log.actorId]?.email ?? '',
        log.action,
        log.entityType,
        summary.project,
        summary.document,
        summary.version,
        threadOrComment,
        summary.targetUser,
        log.entityId,
        log.metadata ? JSON.stringify( log.metadata ) : '',
      ]
    } )
    const csvText = buildCsvText( AUDIT_CSV_HEADERS, rows )
    const blob = new Blob( [ csvText ], { type: 'text/csv;charset=utf-8' } )
    const url = URL.createObjectURL( blob )
    const link = document.createElement( 'a' )
    const userSegment = isAllUsersSelected ? 'all-users' : safeCsvFileSegment( reportUserId || 'current-user' )
    const startSegment = safeCsvFileSegment( startDate || 'last-30-days' )
    const endSegment = safeCsvFileSegment( endDate || 'now' )
    link.href = url
    link.download = `qt4-audit-${userSegment}-${startSegment}-${endSegment}.csv`
    document.body.appendChild( link )
    link.click()
    link.remove()
    URL.revokeObjectURL( url )
  }

  useEffect( () => {
    if( !userId ) {
      return
    }
    void (async () => {
      try {
        const profileSnapshot = await getDoc( doc( db, 'userProfiles', userId ) )
        setIsAdmin( Boolean( profileSnapshot.data()?.isAdmin ) )
      } catch {
        setIsAdmin( false )
      }
    })()
  }, [ userId ] )

  const checkFilesApi = useCallback( async () => {
    setFilesApiStatus( 'checking' )
    setFilesApiMessage( '' )
    try {
      const idToken = await user?.getIdToken()
      if( !idToken ) {
        throw new Error( 'User session is required.' )
      }
      const resp = await fetch( buildFilesApiUrl( '/me' ), {
        method: 'GET',
        headers: { Authorization: `Bearer ${idToken}` },
      } )
      if( !resp.ok ) {
        const text = await resp.text()
        setFilesApiStatus( 'error' )
        setFilesApiMessage( `Files API error (${resp.status}): ${text || resp.statusText}` )
        const nowIso = new Date().toISOString()
        setFilesApiCheckedAt( nowIso )
        window.localStorage.setItem( 'qt4_files_api_last_check', nowIso )
        window.localStorage.setItem( 'qt4_files_api_last_status', 'error' )
        window.localStorage.setItem( 'qt4_files_api_last_message', `Files API error (${resp.status}): ${text || resp.statusText}` )
        return
      }
      const payload = ( await resp.json() ) as {
        projectId?: string | null
        firebaseUid?: string | null
        firebaseEmail?: string | null
        defaultExpireAfterDays?: number | null
      }
      const projectLabel = payload.projectId ?? 'Unknown project'
      const uidLabel = payload.firebaseUid ?? 'Unknown uid'
      const emailSuffix = payload.firebaseEmail ? `, email: ${payload.firebaseEmail}` : ''
      const defaultExpire =
        payload.defaultExpireAfterDays === null || payload.defaultExpireAfterDays === undefined
          ? 'default'
          : `${payload.defaultExpireAfterDays} days`
      const message = `Connected: project ${projectLabel}, uid ${uidLabel}${emailSuffix} (default expire: ${defaultExpire}).`
      const nowIso = new Date().toISOString()
      setFilesApiStatus( 'ok' )
      setFilesApiMessage( message )
      setFilesApiCheckedAt( nowIso )
      window.localStorage.setItem( 'qt4_files_api_last_check', nowIso )
      window.localStorage.setItem( 'qt4_files_api_last_status', 'ok' )
      window.localStorage.setItem( 'qt4_files_api_last_message', message )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setFilesApiStatus( 'error' )
      setFilesApiMessage( `Files API error: ${message}` )
      const nowIso = new Date().toISOString()
      setFilesApiCheckedAt( nowIso )
      window.localStorage.setItem( 'qt4_files_api_last_check', nowIso )
      window.localStorage.setItem( 'qt4_files_api_last_status', 'error' )
      window.localStorage.setItem( 'qt4_files_api_last_message', `Files API error: ${message}` )
    }
  }, [ user ] )

  const loadRuntimeConfigFromFirestore = useCallback( async () => {
    setRuntimeConfigStatus( 'loading' )
    setRuntimeConfigMessage( '' )
    try {
      const { config, source } = await loadAppRuntimeConfig()
      setSelectedFileStorageProvider( config.fileStorageProvider )
      setSelectedEmailProvider( config.emailProvider )
      setRuntimeConfigSource( source )
      setRuntimeConfigStatus( 'done' )
      setRuntimeConfigMessage(
        source === 'firestore'
          ? `Loaded: ${formatRuntimeConfigSummary( config )}.`
          : `Using defaults: ${formatRuntimeConfigSummary( config )}.`,
      )
      const nowIso = new Date().toISOString()
      setRuntimeConfigLoadedAt( nowIso )
      window.localStorage.setItem( 'qt4_runtime_config_last_check', nowIso )
      window.localStorage.setItem( 'qt4_runtime_config_last_status', 'done' )
      window.localStorage.setItem( 'qt4_runtime_config_last_message', formatRuntimeConfigSummary( config ) )
      window.localStorage.setItem( 'qt4_runtime_config_last_source', source )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setRuntimeConfigStatus( 'error' )
      setRuntimeConfigMessage( `Runtime configuration failed to load: ${message}` )
      const nowIso = new Date().toISOString()
      setRuntimeConfigLoadedAt( nowIso )
      window.localStorage.setItem( 'qt4_runtime_config_last_check', nowIso )
      window.localStorage.setItem( 'qt4_runtime_config_last_status', 'error' )
      window.localStorage.setItem( 'qt4_runtime_config_last_message', `Runtime configuration failed to load: ${message}` )
    }
  }, [] )

  const handleSaveRuntimeConfig = useCallback( async () => {
    if( !isAdmin ) {
      setRuntimeConfigStatus( 'error' )
      setRuntimeConfigMessage( 'Admin access is required to update runtime configuration.' )
      return
    }
    if( !userId ) {
      setRuntimeConfigStatus( 'error' )
      setRuntimeConfigMessage( 'Sign in before updating runtime configuration.' )
      return
    }
    setRuntimeConfigStatus( 'saving' )
    setRuntimeConfigMessage( 'Saving runtime configuration...' )
    try {
      await saveAppRuntimeConfig(
        {
          fileStorageProvider: selectedFileStorageProvider,
          emailProvider: selectedEmailProvider,
        },
        userId,
      )
      setRuntimeConfigStatus( 'done' )
      setRuntimeConfigSource( 'firestore' )
      const summary = `Saved: ${formatRuntimeConfigSummary( {
        fileStorageProvider: selectedFileStorageProvider,
        emailProvider: selectedEmailProvider,
      } )}.`
      setRuntimeConfigMessage( summary )
      const nowIso = new Date().toISOString()
      setRuntimeConfigLoadedAt( nowIso )
      window.localStorage.setItem( 'qt4_runtime_config_last_check', nowIso )
      window.localStorage.setItem( 'qt4_runtime_config_last_status', 'done' )
      window.localStorage.setItem( 'qt4_runtime_config_last_message', summary )
      window.localStorage.setItem( 'qt4_runtime_config_last_source', 'firestore' )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setRuntimeConfigStatus( 'error' )
      setRuntimeConfigMessage( `Runtime configuration failed to save: ${message}` )
    }
  }, [ isAdmin, selectedEmailProvider, selectedFileStorageProvider, userId ] )

  const handleUpdateModel = async () => {
    if( !isAdmin ) {
      setModelUpdateStatus( 'error' )
      setModelUpdateMessage( 'Admin access is required to update the data model.' )
      return
    }
    if( !userId ) {
      setModelUpdateStatus( 'error' )
      setModelUpdateMessage( 'Sign in before updating the data model.' )
      return
    }
    setModelUpdateStatus( 'running' )
    setModelUpdateMessage( 'Loading data...' )
    setModelUpdateSummary( '' )
    setModelUpdateProgress( 5 )
    setModelUpdateProgressLabel( 'Loading data' )
    setModelUpdateLog( [] )
    setIsModelUpdateLogOpen( true )
    setModelUpdateLogCopyStatus( 'idle' )
    try {
      const [ projectsSnap, documentsSnap, versionsSnap, threadsSnap, commentsSnap, filesSnap ] = await Promise.all( [
        getDocs( collection( db, 'projects' ) ),
        getDocs( collection( db, 'documents' ) ),
        getDocs( collection( db, 'versions' ) ),
        getDocs( collection( db, 'threads' ) ),
        getDocs( collection( db, 'comments' ) ),
        getDocs( collection( db, 'files' ) ),
      ] )

      const projects = projectsSnap.docs.map( ( snapshot ) => {
        const data = snapshot.data()
        return {
          id: snapshot.id,
          shortId: Number.isFinite( data.shortId ) ? Number( data.shortId ) : null,
          createdAt: toTimestampDate( data.createdAt ),
        }
      } )
      const documents = documentsSnap.docs.map( ( snapshot ) => {
        const data = snapshot.data()
        return {
          id: snapshot.id,
          shortId: Number.isFinite( data.shortId ) ? Number( data.shortId ) : null,
          createdAt: toTimestampDate( data.createdAt ),
          projectId: ( data.projectId as string | undefined ) ?? '',
        }
      } )
      const versions = versionsSnap.docs.map( ( snapshot ) => {
        const data = snapshot.data()
        return {
          id: snapshot.id,
          projectId: ( data.projectId as string | undefined ) ?? '',
          docId: ( data.docId as string | undefined ) ?? '',
          fileRefId: ( data.fileRefId as string | null | undefined ) ?? null,
          numThreads: Number.isFinite( data.numThreads ) ? Number( data.numThreads ) : null,
          numOpenThreads: Number.isFinite( data.numOpenThreads ) ? Number( data.numOpenThreads ) : null,
          numComments: Number.isFinite( data.numComments ) ? Number( data.numComments ) : null,
          numThreadsWithTwoPlusComments: Number.isFinite( data.numThreadsWithTwoPlusComments ) ? Number( data.numThreadsWithTwoPlusComments ) : null,
          stats: ( data.stats as {
            numThreads?: number
            numOpenThreads?: number
            numComments?: number
            numThreadsWithTwoPlusComments?: number
          } | undefined ) ?? undefined,
        }
      } )
      const threads = threadsSnap.docs.map( ( snapshot ) => {
        const data = snapshot.data()
        return {
          id: snapshot.id,
          versionId: ( data.versionId as string | undefined ) ?? '',
          status: ( data.status as string | undefined ) ?? '',
          commentCount: Number.isFinite( data.commentCount ) ? Number( data.commentCount ) : 0,
          lastCommentAt: toTimestampDate( data.lastCommentAt ),
          lastCommentBy: ( data.lastCommentBy as string | undefined ) ?? null,
        }
      } )
      const comments = commentsSnap.docs.map( ( snapshot ) => {
        const data = snapshot.data()
        return {
          id: snapshot.id,
          threadId: ( data.threadId as string | undefined ) ?? '',
          versionId: ( data.versionId as string | undefined ) ?? '',
          createdBy: ( data.createdBy as string | undefined ) ?? '',
          createdAt: toTimestampDate( data.createdAt ) ?? toTimestampDate( data.updatedAt ),
        }
      } )
      const files = filesSnap.docs.map( ( snapshot ) => {
        const data = snapshot.data()
        return {
          id: snapshot.id,
          projectId: ( data.projectId as string | undefined ) ?? '',
          docId: ( data.docId as string | undefined ) ?? '',
          versionId: ( data.versionId as string | undefined ) ?? '',
        }
      } )

      const projectRepairLog: string[] = []
      const documentRepairLog: string[] = []
      const threadRepairLog: string[] = []
      const versionRepairLog: string[] = []
      const fileRepairLog: string[] = []

      const missingProjects = projects.filter( ( project ) => !Number.isFinite( project.shortId ) )
      const missingDocuments = documents.filter( ( document ) => !Number.isFinite( document.shortId ) )
      const maxProjectShortId = projects.reduce( ( currentMax, project ) => {
        if( !Number.isFinite( project.shortId ) ) {
          return currentMax
        }
        return Math.max( currentMax, Number( project.shortId ) )
      }, 0 )
      const maxShortIdByProject = new Map<string, number>()
      documents.forEach( ( document ) => {
        if( !Number.isFinite( document.shortId ) ) {
          return
        }
        const key = document.projectId || 'unknown'
        const value = Number( document.shortId )
        const currentMax = maxShortIdByProject.get( key ) ?? 0
        if( value > currentMax ) {
          maxShortIdByProject.set( key, value )
        }
      } )

      const assignShortIds = async (
        collectionName: 'projects' | 'documents',
        missing: Array<{ id: string; createdAt: Date | null }>,
      ): Promise<number> => {
        if( missing.length === 0 ) {
          return 0
        }
        const sorted = [ ...missing ].sort( ( a, b ) => {
          const aTime = a.createdAt ? a.createdAt.getTime() : 0
          const bTime = b.createdAt ? b.createdAt.getTime() : 0
          if( aTime !== bTime ) {
            return aTime - bTime
          }
          return a.id.localeCompare( b.id )
        } )
        const chunks = chunkArray( sorted, 200 )
        const minimumNext = maxProjectShortId + 1
        let assigned = 0
        for( const chunk of chunks ) {
          await runTransaction( db, async ( transaction ) => {
            const counterRef = doc( db, 'counters', collectionName )
            const counterSnap = await transaction.get( counterRef )
            const start = Math.max( Number( counterSnap.data()?.nextNumber ?? 1 ), minimumNext )
            let next = start
            chunk.forEach( ( entry ) => {
              projectRepairLog.push( `${collectionName === 'projects' ? 'Project' : 'Document'} ${entry.id}: shortId -> ${next}.` )
              transaction.update( doc( db, collectionName, entry.id ), {
                shortId: next,
                updatedAt: serverTimestamp(),
                updatedBy: userId,
              } )
              next += 1
            } )
            transaction.set( counterRef, { nextNumber: next }, { merge: true } )
          } )
          assigned += chunk.length
        }
        return assigned
      }

      if( missingProjects.length > 0 ) {
        setModelUpdateMessage( 'Assigning project short IDs...' )
        setModelUpdateProgress( 20 )
        setModelUpdateProgressLabel( 'Assigning project short IDs' )
        setModelUpdateLog( ( previous ) => [ ...previous, `Projects: assigning short IDs to ${missingProjects.length} record(s).` ] )
      }
      const assignedProjects = await assignShortIds( 'projects', missingProjects )

      const assignDocumentShortIds = async (
        entries: Array<{ id: string; createdAt: Date | null; projectId: string }>,
      ): Promise<number> => {
        if( entries.length === 0 ) {
          return 0
        }
        const grouped = new Map<string, Array<{ id: string; createdAt: Date | null }>>()
        entries.forEach( ( entry ) => {
          const key = entry.projectId || 'unknown'
          if( !grouped.has( key ) ) {
            grouped.set( key, [] )
          }
          grouped.get( key )?.push( { id: entry.id, createdAt: entry.createdAt } )
        } )
        let assigned = 0
        for( const [ projectKey, entries ] of grouped ) {
          const sorted = [ ...entries ].sort( ( a, b ) => {
            const aTime = a.createdAt ? a.createdAt.getTime() : 0
            const bTime = b.createdAt ? b.createdAt.getTime() : 0
            if( aTime !== bTime ) {
              return aTime - bTime
            }
            return a.id.localeCompare( b.id )
          } )
          const chunks = chunkArray( sorted, 200 )
          const minimumNext = ( maxShortIdByProject.get( projectKey ) ?? 0 ) + 1
          for( const chunk of chunks ) {
            await runTransaction( db, async ( transaction ) => {
              const counterRef = doc( db, 'counters', `documents_${projectKey}` )
              const counterSnap = await transaction.get( counterRef )
              let next = Math.max( Number( counterSnap.data()?.nextNumber ?? 1 ), minimumNext )
              chunk.forEach( ( entry ) => {
                documentRepairLog.push( `Document ${entry.id}: shortId -> ${next} (project ${projectKey}).` )
                transaction.update( doc( db, 'documents', entry.id ), {
                  shortId: next,
                  updatedAt: serverTimestamp(),
                  updatedBy: userId,
                } )
                next += 1
              } )
              transaction.set( counterRef, { nextNumber: next }, { merge: true } )
            } )
            assigned += chunk.length
          }
        }
        return assigned
      }

      if( missingDocuments.length > 0 ) {
        setModelUpdateMessage( 'Assigning missing document short IDs per project...' )
        setModelUpdateProgress( 35 )
        setModelUpdateProgressLabel( 'Assigning document short IDs' )
        setModelUpdateLog( ( previous ) => [
          ...previous,
          `Documents: assigning short IDs to ${missingDocuments.length} record(s), grouped by project.`,
        ] )
      }
      const assignedDocuments = await assignDocumentShortIds( missingDocuments )

      setModelUpdateMessage( 'Updating thread statistics...' )
      setModelUpdateProgress( 55 )
      setModelUpdateProgressLabel( 'Updating thread statistics' )
      const threadAggById = new Map<
        string,
        { count: number; lastAt: Date | null; lastBy: string | null }
      >()
      comments.forEach( ( comment ) => {
        if( !comment.threadId ) {
          return
        }
        const entry = threadAggById.get( comment.threadId ) ?? { count: 0, lastAt: null, lastBy: null }
        entry.count += 1
        if( comment.createdAt && ( !entry.lastAt || comment.createdAt.getTime() > entry.lastAt.getTime() ) ) {
          entry.lastAt = comment.createdAt
          entry.lastBy = comment.createdBy || null
        }
        threadAggById.set( comment.threadId, entry )
      } )

      const threadUpdates = threads.flatMap( ( thread ) => {
        const agg = threadAggById.get( thread.id ) ?? { count: 0, lastAt: null, lastBy: null }
        const nextLastAt = agg.count > 0 ? agg.lastAt : null
        const nextLastBy = agg.count > 0 ? agg.lastBy : null
        const currentLastAtMs = thread.lastCommentAt ? thread.lastCommentAt.getTime() : 0
        const nextLastAtMs = nextLastAt ? nextLastAt.getTime() : 0
        if(
          thread.commentCount === agg.count
          && currentLastAtMs === nextLastAtMs
          && ( thread.lastCommentBy ?? null ) === nextLastBy
        ) {
          return []
        }
        threadRepairLog.push(
          `Thread ${thread.id}: commentCount ${thread.commentCount} -> ${agg.count}; lastCommentAt ${thread.lastCommentAt ? thread.lastCommentAt.toISOString() : '(missing)'} -> ${nextLastAt ? nextLastAt.toISOString() : '(missing)'}; lastCommentBy ${thread.lastCommentBy ?? '(missing)'} -> ${nextLastBy ?? '(missing)'}.`,
        )
        return [
          {
            ref: doc( db, 'threads', thread.id ),
            data: {
              commentCount: agg.count,
              lastCommentAt: nextLastAt ? Timestamp.fromDate( nextLastAt ) : null,
              lastCommentBy: nextLastBy ?? null,
              updatedAt: serverTimestamp(),
              updatedBy: userId,
            },
          },
        ]
      } )
      const threadChunks = chunkArray( threadUpdates, 400 )
      for( const chunk of threadChunks ) {
        if( chunk.length === 0 ) {
          continue
        }
        const batch = writeBatch( db )
        chunk.forEach( ( update ) => {
          batch.update( update.ref, update.data )
        } )
        await batch.commit()
      }

      setModelUpdateMessage( 'Updating version statistics...' )
      setModelUpdateProgress( 75 )
      setModelUpdateProgressLabel( 'Updating version statistics' )
      const versionAggById = new Map<string, {
        numThreads: number
        numOpenThreads: number
        numComments: number
        numThreadsWithTwoPlusComments: number
      }>()
      const ensureVersionAgg = (versionId: string) => {
        if( !versionId ) {
          return null
        }
        if( !versionAggById.has( versionId ) ) {
          versionAggById.set( versionId, {
            numThreads: 0,
            numOpenThreads: 0,
            numComments: 0,
            numThreadsWithTwoPlusComments: 0,
          } )
        }
        return versionAggById.get( versionId ) ?? null
      }
      threads.forEach( ( thread ) => {
        const entry = ensureVersionAgg( thread.versionId )
        if( !entry ) {
          return
        }
        entry.numThreads += 1
        if( thread.status === 'open' ) {
          entry.numOpenThreads += 1
        }
        if( thread.commentCount >= 2 ) {
          entry.numThreadsWithTwoPlusComments += 1
        }
      } )
      comments.forEach( ( comment ) => {
        const entry = ensureVersionAgg( comment.versionId )
        if( !entry ) {
          return
        }
        entry.numComments += 1
      } )

      const versionUpdates = versions.flatMap( ( version ) => {
        const agg = versionAggById.get( version.id ) ?? {
          numThreads: 0,
          numOpenThreads: 0,
          numComments: 0,
          numThreadsWithTwoPlusComments: 0,
        }
        const currentNumThreads = Number.isFinite( version.numThreads )
          ? Number( version.numThreads )
          : Number.isFinite( version.stats?.numThreads )
            ? Number( version.stats?.numThreads )
            : 0
        const currentNumOpenThreads = Number.isFinite( version.numOpenThreads )
          ? Number( version.numOpenThreads )
          : Number.isFinite( version.stats?.numOpenThreads )
            ? Number( version.stats?.numOpenThreads )
            : 0
        const currentNumComments = Number.isFinite( version.numComments )
          ? Number( version.numComments )
          : Number.isFinite( version.stats?.numComments )
            ? Number( version.stats?.numComments )
            : 0
        const currentNumThreadsWithTwoPlusComments = Number.isFinite( version.numThreadsWithTwoPlusComments )
          ? Number( version.numThreadsWithTwoPlusComments )
          : Number.isFinite( version.stats?.numThreadsWithTwoPlusComments )
            ? Number( version.stats?.numThreadsWithTwoPlusComments )
            : 0
        if(
          currentNumThreads === agg.numThreads
          && currentNumOpenThreads === agg.numOpenThreads
          && currentNumComments === agg.numComments
          && currentNumThreadsWithTwoPlusComments === agg.numThreadsWithTwoPlusComments
          && version.stats
          && version.stats.numThreads === agg.numThreads
          && version.stats.numOpenThreads === agg.numOpenThreads
          && version.stats.numComments === agg.numComments
          && version.stats.numThreadsWithTwoPlusComments === agg.numThreadsWithTwoPlusComments
        ) {
          return []
        }
        versionRepairLog.push(
          `Version ${version.id}: stats.numThreads ${currentNumThreads} -> ${agg.numThreads}; stats.numOpenThreads ${currentNumOpenThreads} -> ${agg.numOpenThreads}; stats.numComments ${currentNumComments} -> ${agg.numComments}; stats.numThreadsWithTwoPlusComments ${currentNumThreadsWithTwoPlusComments} -> ${agg.numThreadsWithTwoPlusComments}.`,
        )
        return [
          {
            ref: doc( db, 'versions', version.id ),
            data: {
              stats: {
                numThreads: agg.numThreads,
                numOpenThreads: agg.numOpenThreads,
                numComments: agg.numComments,
                numThreadsWithTwoPlusComments: agg.numThreadsWithTwoPlusComments,
              },
              numThreads: agg.numThreads,
              numOpenThreads: agg.numOpenThreads,
              numComments: agg.numComments,
              numThreadsWithTwoPlusComments: agg.numThreadsWithTwoPlusComments,
              updatedAt: serverTimestamp(),
              updatedBy: userId,
            },
          },
        ]
      } )
      const versionChunks = chunkArray( versionUpdates, 400 )
      for( const chunk of versionChunks ) {
        if( chunk.length === 0 ) {
          continue
        }
        const batch = writeBatch( db )
        chunk.forEach( ( update ) => {
          batch.update( update.ref, update.data )
        } )
        await batch.commit()
      }

      setModelUpdateMessage( 'Backfilling file metadata links...' )
      setModelUpdateProgress( 90 )
      setModelUpdateProgressLabel( 'Backfilling file metadata links' )
      const documentProjectIdById = new Map( documents.map( ( document ) => [ document.id, document.projectId ] ) )
      const versionById = new Map(
        versions.map( ( version ) => [
          version.id,
          {
            projectId: version.projectId,
            docId: version.docId,
          },
        ] ),
      )
      const versionByFileRefId = new Map<string, { versionId: string; projectId: string; docId: string }>()
      versions.forEach( ( version ) => {
        if( !version.fileRefId ) {
          return
        }
        versionByFileRefId.set( version.fileRefId, {
          versionId: version.id,
          projectId: version.projectId,
          docId: version.docId,
        } )
      } )

      const fileUpdates = files.flatMap( ( file ) => {
        const linkedVersion =
          ( file.versionId ? versionById.get( file.versionId ) : undefined ) ?? 
          versionByFileRefId.get( file.id )
        const nextVersionId =
          file.versionId ||
          versionByFileRefId.get( file.id )?.versionId ||
          ''
        const nextDocId =
          file.docId ||
          linkedVersion?.docId ||
          ''
        const nextProjectId =
          file.projectId ||
          linkedVersion?.projectId ||
          ( nextDocId ? ( documentProjectIdById.get( nextDocId ) ?? '' ) : '' )

        const patch: Record<string, unknown> = {}
        if( nextProjectId && nextProjectId !== file.projectId ) {
          patch.projectId = nextProjectId
        }
        if( nextDocId && nextDocId !== file.docId ) {
          patch.docId = nextDocId
        }
        if( nextVersionId && nextVersionId !== file.versionId ) {
          patch.versionId = nextVersionId
        }
        if( Object.keys( patch ).length === 0 ) {
          return []
        }
        const changeParts = [
          file.projectId !== nextProjectId ? `projectId: ${file.projectId || '(missing)'} -> ${nextProjectId || '(missing)'}` : null,
          file.docId !== nextDocId ? `docId: ${file.docId || '(missing)'} -> ${nextDocId || '(missing)'}` : null,
          file.versionId !== nextVersionId ? `versionId: ${file.versionId || '(missing)'} -> ${nextVersionId || '(missing)'}` : null,
        ].filter( Boolean ) as string[]
        if( changeParts.length > 0 ) {
          fileRepairLog.push( `File ${file.id}: ${changeParts.join( '; ' )}.` )
        }
        return [
          {
            ref: doc( db, 'files', file.id ),
            data: {
              ...patch,
              updatedAt: serverTimestamp(),
              updatedBy: userId,
            },
          },
        ]
      } )
      const fileChunks = chunkArray( fileUpdates, 400 )
      if( fileRepairLog.length > 0 ) {
        setModelUpdateLog( ( previous ) => [ ...previous, ...fileRepairLog ] )
      }
      for( const chunk of fileChunks ) {
        if( chunk.length === 0 ) {
          continue
        }
        const batch = writeBatch( db )
        chunk.forEach( ( update ) => {
          batch.update( update.ref, update.data )
        } )
        await batch.commit()
      }

      setModelUpdateStatus( 'done' )
      setModelUpdateMessage( `Data model update v${DATA_MODEL_UPDATE_VERSION} completed.` )
      setModelUpdateProgress( 100 )
      setModelUpdateProgressLabel( 'Completed' )
      setModelUpdateSummary(
        `Projects updated: ${assignedProjects}. Documents updated: ${assignedDocuments}. Threads updated: ${threadUpdates.length}. Versions updated: ${versionUpdates.length}. Files updated: ${fileUpdates.length}.`,
      )
      setModelUpdateLog( [
        ...projectRepairLog,
        ...documentRepairLog,
        ...threadRepairLog,
        ...versionRepairLog,
        ...fileRepairLog,
        `Summary: projects=${assignedProjects}, documents=${assignedDocuments}, threads=${threadUpdates.length}, versions=${versionUpdates.length}, files=${fileUpdates.length}.`,
      ] )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setModelUpdateStatus( 'error' )
      setModelUpdateMessage( `Data model update failed: ${message}` )
      setModelUpdateProgressLabel( 'Failed' )
      setModelUpdateLog( ( previous ) => [ ...previous, `Error: ${message}` ] )
    }
  }

  const requestModelUpdateConfirmation = () => {
    if( !isAdmin ) {
      setModelUpdateStatus( 'error' )
      setModelUpdateMessage( 'Admin access is required to update the data model.' )
      return
    }
    if( !userId ) {
      setModelUpdateStatus( 'error' )
      setModelUpdateMessage( 'Sign in before updating the data model.' )
      return
    }
    setConfirmModelUpdate( true )
  }

  const handleRepairReviewExpirations = async () => {
    if( !isAdmin ) {
      setReviewRepairStatus( 'error' )
      setReviewRepairMessage( 'Admin access is required to repair legacy timestamps.' )
      return
    }
    if( !userId ) {
      setReviewRepairStatus( 'error' )
      setReviewRepairMessage( 'Sign in before repairing legacy timestamps.' )
      return
    }
    setReviewRepairStatus( 'running' )
    setReviewRepairMessage( 'Loading documents and versions...' )
    setReviewRepairSummary( '' )
    try {
      const [ documentsSnapshot, versionsSnapshot ] = await Promise.all( [
        getDocs( collection( db, 'documents' ) ),
        getDocs( collection( db, 'versions' ) ),
      ] )

      const inferredVersionCreatedAtByDocId = new Map<string, Date>()
      versionsSnapshot.docs.forEach( ( snapshot ) => {
        const data = snapshot.data()
        const docId = ( data.docId as string | undefined ) ?? ''
        if( !docId ) {
          return
        }
        const currentCreatedAt = toTimestampDate( data.createdAt )
        const reviewStartAt = toTimestampDate( data.reviewStartAt )
        const updatedAt = toTimestampDate( data.updatedAt )
        const currentReviewEndAt = toTimestampDate( data.reviewEndAt )
        const inferredCreatedAt =
          currentCreatedAt ??
          reviewStartAt ??
          updatedAt ??
          ( currentReviewEndAt ? new Date( currentReviewEndAt.getTime() - REVIEW_WINDOW_MS ) : null )
        if( !inferredCreatedAt ) {
          return
        }
        const currentEarliest = inferredVersionCreatedAtByDocId.get( docId )
        if( !currentEarliest || inferredCreatedAt.getTime() < currentEarliest.getTime() ) {
          inferredVersionCreatedAtByDocId.set( docId, inferredCreatedAt )
        }
      } )

      const documentUpdates = documentsSnapshot.docs.flatMap( ( snapshot ) => {
        const data = snapshot.data()
        const currentCreatedAt = toTimestampDate( data.createdAt )
        const updatedAt = toTimestampDate( data.updatedAt )
        const inferredFromVersion = inferredVersionCreatedAtByDocId.get( snapshot.id ) ?? null
        const inferredCreatedAt =
          currentCreatedAt ??
          inferredFromVersion ??
          updatedAt ??
          new Date()
        if( currentCreatedAt ) {
          return []
        }
        let createdAtSource: 'versionCreatedAt' | 'updatedAt' | 'currentTime' = 'currentTime'
        if( inferredFromVersion ) {
          createdAtSource = 'versionCreatedAt'
        } else if( updatedAt ) {
          createdAtSource = 'updatedAt'
        }
        return [
          {
            ref: doc( db, 'documents', snapshot.id ),
            data: {
              createdAt: Timestamp.fromDate( inferredCreatedAt ),
              updatedAt: serverTimestamp(),
              updatedBy: userId,
            },
            createdAtSource,
          },
        ]
      } )

      const updates = versionsSnapshot.docs.flatMap( ( snapshot ) => {
        const data = snapshot.data()
        const status = ( data.status as string | undefined ) ?? ''
        const currentCreatedAt = toTimestampDate( data.createdAt )
        const reviewStartAt = toTimestampDate( data.reviewStartAt )
        const updatedAt = toTimestampDate( data.updatedAt )
        const currentReviewEndAt = toTimestampDate( data.reviewEndAt )
        const inferredCreatedAt =
          currentCreatedAt ??
          reviewStartAt ??
          updatedAt ??
          ( currentReviewEndAt ? new Date( currentReviewEndAt.getTime() - REVIEW_WINDOW_MS ) : null ) ??
          new Date()
        const nextData: Record<string, unknown> = {
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        }
        let repairedCreatedAt = false
        let repairedReviewEndAt = false
        let createdAtSource: 'reviewStartAt' | 'updatedAt' | 'reviewEndAt' | 'currentTime' | null = null
        if( !currentCreatedAt ) {
          nextData.createdAt = Timestamp.fromDate( inferredCreatedAt )
          repairedCreatedAt = true
          if( reviewStartAt ) {
            createdAtSource = 'reviewStartAt'
          } else if( updatedAt ) {
            createdAtSource = 'updatedAt'
          } else if( currentReviewEndAt ) {
            createdAtSource = 'reviewEndAt'
          } else {
            createdAtSource = 'currentTime'
          }
        }
        if( status === 'In Review' && !currentReviewEndAt ) {
          const reviewBaseDate = reviewStartAt ?? currentCreatedAt ?? inferredCreatedAt
          const nextReviewEndAt = new Date( reviewBaseDate.getTime() + REVIEW_WINDOW_MS )
          nextData.reviewEndAt = Timestamp.fromDate( nextReviewEndAt )
          repairedReviewEndAt = true
        }
        if( !repairedCreatedAt && !repairedReviewEndAt ) {
          return []
        }
        return [
          {
            ref: doc( db, 'versions', snapshot.id ),
            data: nextData,
            repairedCreatedAt,
            repairedReviewEndAt,
            createdAtSource,
            usedReviewStartAt: repairedReviewEndAt && Boolean( reviewStartAt ),
          },
        ]
      } )

      if( updates.length === 0 ) {
        if( documentUpdates.length === 0 ) {
          setReviewRepairStatus( 'done' )
          setReviewRepairMessage( 'No repairs needed. Document and version timestamps are already complete.' )
          setReviewRepairSummary( `Documents scanned: ${documentsSnapshot.docs.length}. Versions scanned: ${versionsSnapshot.docs.length}.` )
          return
        }
      }

      setReviewRepairMessage( 'Applying timestamp repairs...' )
      const documentUpdateChunks = chunkArray( documentUpdates, 400 )
      for( const chunk of documentUpdateChunks ) {
        const batch = writeBatch( db )
        chunk.forEach( ( update ) => {
          batch.update( update.ref, update.data )
        } )
        await batch.commit()
      }

      if( updates.length === 0 ) {
        setReviewRepairStatus( 'done' )
        const documentsFromVersion = documentUpdates.filter( ( update ) => update.createdAtSource === 'versionCreatedAt' ).length
        const documentsFromUpdatedAt = documentUpdates.filter( ( update ) => update.createdAtSource === 'updatedAt' ).length
        const documentsFromCurrentTime = documentUpdates.filter( ( update ) => update.createdAtSource === 'currentTime' ).length
        setReviewRepairMessage( 'Legacy timestamp repair completed.' )
        setReviewRepairSummary(
          `Documents scanned: ${documentsSnapshot.docs.length}. document createdAt repaired: ${documentUpdates.length} (version createdAt: ${documentsFromVersion}, updatedAt: ${documentsFromUpdatedAt}, current time: ${documentsFromCurrentTime}). Versions scanned: ${versionsSnapshot.docs.length}.`,
        )
        return
      }

      const updateChunks = chunkArray( updates, 400 )
      for( const chunk of updateChunks ) {
        const batch = writeBatch( db )
        chunk.forEach( ( update ) => {
          batch.update( update.ref, update.data )
        } )
        await batch.commit()
      }

      const repairedCreatedAt = updates.filter( ( update ) => update.repairedCreatedAt ).length
      const repairedReviewEndAt = updates.filter( ( update ) => update.repairedReviewEndAt ).length
      const basedOnReviewStart = updates.filter( ( update ) => update.usedReviewStartAt ).length
      const createdAtFromReviewStart = updates.filter( ( update ) => update.createdAtSource === 'reviewStartAt' ).length
      const createdAtFromUpdatedAt = updates.filter( ( update ) => update.createdAtSource === 'updatedAt' ).length
      const createdAtFromReviewEndAt = updates.filter( ( update ) => update.createdAtSource === 'reviewEndAt' ).length
      const createdAtFromCurrentTime = updates.filter( ( update ) => update.createdAtSource === 'currentTime' ).length
      const documentCreatedAtRepaired = documentUpdates.length
      const documentsFromVersion = documentUpdates.filter( ( update ) => update.createdAtSource === 'versionCreatedAt' ).length
      const documentsFromUpdatedAt = documentUpdates.filter( ( update ) => update.createdAtSource === 'updatedAt' ).length
      const documentsFromCurrentTime = documentUpdates.filter( ( update ) => update.createdAtSource === 'currentTime' ).length
      const scannedInReview = versionsSnapshot.docs.filter(
        ( snapshot ) => ( ( snapshot.data().status as string | undefined ) ?? '' ) === 'In Review',
      ).length
      setReviewRepairStatus( 'done' )
      setReviewRepairMessage( 'Legacy timestamp repair completed.' )
      setReviewRepairSummary(
        `Documents scanned: ${documentsSnapshot.docs.length}. document createdAt repaired: ${documentCreatedAtRepaired} (version createdAt: ${documentsFromVersion}, updatedAt: ${documentsFromUpdatedAt}, current time: ${documentsFromCurrentTime}). Versions scanned: ${versionsSnapshot.docs.length}. In Review scanned: ${scannedInReview}. version createdAt repaired: ${repairedCreatedAt} (reviewStartAt: ${createdAtFromReviewStart}, updatedAt: ${createdAtFromUpdatedAt}, reviewEndAt fallback: ${createdAtFromReviewEndAt}, current time: ${createdAtFromCurrentTime}). version reviewEndAt repaired: ${repairedReviewEndAt} (based on reviewStartAt: ${basedOnReviewStart}).`,
      )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setReviewRepairStatus( 'error' )
      setReviewRepairMessage( `Legacy timestamp repair failed: ${message}` )
    }
  }

  const requestReviewRepairConfirmation = () => {
    if( !isAdmin ) {
      setReviewRepairStatus( 'error' )
      setReviewRepairMessage( 'Admin access is required to repair legacy timestamps.' )
      return
    }
    if( !userId ) {
      setReviewRepairStatus( 'error' )
      setReviewRepairMessage( 'Sign in before repairing legacy timestamps.' )
      return
    }
    setConfirmReviewRepair( true )
  }

  useEffect( () => {
    if( !isAdmin ) {
      return
    }
    void checkFilesApi()
    void loadRuntimeConfigFromFirestore()
  }, [ isAdmin, checkFilesApi, loadRuntimeConfigFromFirestore ] )

  useEffect( () => {
    const storedCheck = window.localStorage.getItem( 'qt4_files_api_last_check' )
    const storedStatus = window.localStorage.getItem( 'qt4_files_api_last_status' )
    const storedMessage = window.localStorage.getItem( 'qt4_files_api_last_message' )
    if( storedCheck ) {
      setFilesApiCheckedAt( storedCheck )
    }
    if( storedStatus === 'ok' || storedStatus === 'error' ) {
      setFilesApiStatus( storedStatus )
    }
    if( storedMessage ) {
      setFilesApiMessage( storedMessage )
    }
    const storedRuntimeCheck = window.localStorage.getItem( 'qt4_runtime_config_last_check' )
    const storedRuntimeStatus = window.localStorage.getItem( 'qt4_runtime_config_last_status' )
    const storedRuntimeMessage = window.localStorage.getItem( 'qt4_runtime_config_last_message' )
    const storedRuntimeSource = window.localStorage.getItem( 'qt4_runtime_config_last_source' )
    if( storedRuntimeCheck ) {
      setRuntimeConfigLoadedAt( storedRuntimeCheck )
    }
    if(
      storedRuntimeStatus === 'idle'
      || storedRuntimeStatus === 'loading'
      || storedRuntimeStatus === 'saving'
      || storedRuntimeStatus === 'done'
      || storedRuntimeStatus === 'error'
    ) {
      setRuntimeConfigStatus( storedRuntimeStatus )
    }
    if( storedRuntimeMessage ) {
      setRuntimeConfigMessage( storedRuntimeMessage )
    }
    if( storedRuntimeSource === 'firestore' || storedRuntimeSource === 'defaults' ) {
      setRuntimeConfigSource( storedRuntimeSource )
    }
  }, [] )

  useEffect( () => {
    const storedUser = window.localStorage.getItem( 'qt4_audit_user' )
    if( storedUser ) {
      setSelectedUserId( storedUser )
    }
    const storedStart = window.localStorage.getItem( 'qt4_audit_start' )
    if( storedStart ) {
      setStartDate( storedStart )
    }
    const storedEnd = window.localStorage.getItem( 'qt4_audit_end' )
    if( storedEnd ) {
      setEndDate( storedEnd )
    }
    const storedLogSorting = window.localStorage.getItem( 'qt4_audit_log_sorting' )
    if( storedLogSorting ) {
      try {
        const parsed = JSON.parse( storedLogSorting ) as SortingState
        if( Array.isArray( parsed ) ) {
          setLogSorting(
            parsed.map( (entry ) => ( {
              ...entry,
              id: entry.id === 'createdAt' ? 'createdAtMs' : entry.id,
            } ) ),
          )
        }
      } catch {
        // ignore parse errors
      }
    }
    const storedTaskSorting = window.localStorage.getItem( 'qt4_audit_task_sorting' )
    if( storedTaskSorting ) {
      try {
        const parsed = JSON.parse( storedTaskSorting ) as SortingState
        if( Array.isArray( parsed ) ) {
          setTaskSorting(
            parsed.map( (entry ) => ( {
              ...entry,
              id: entry.id === 'appearedAt' ? 'appearedAtMs' : entry.id,
            } ) ),
          )
        }
      } catch {
        // ignore parse errors
      }
    }
  }, [] )

  useEffect( () => {
    if( !isAdmin || !selectedUserId ) {
      window.localStorage.removeItem( 'qt4_audit_user' )
      return
    }
    window.localStorage.setItem( 'qt4_audit_user', selectedUserId )
  }, [ isAdmin, selectedUserId ] )

  useEffect( () => {
    if( startDate ) {
      window.localStorage.setItem( 'qt4_audit_start', startDate )
      return
    }
    window.localStorage.removeItem( 'qt4_audit_start' )
  }, [ startDate ] )

  useEffect( () => {
    if( endDate ) {
      window.localStorage.setItem( 'qt4_audit_end', endDate )
      return
    }
    window.localStorage.removeItem( 'qt4_audit_end' )
  }, [ endDate ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_audit_log_sorting', JSON.stringify( logSorting ) )
  }, [ logSorting ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_audit_task_sorting', JSON.stringify( taskSorting ) )
  }, [ taskSorting ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_audit_log_view', logViewMode )
  }, [ logViewMode ] )

  useEffect( () => {
    if( !selectedCalendarLog ) {
      return
    }
    const stillPresent = logs.some( ( entry ) => entry.id === selectedCalendarLog.id )
    if( !stillPresent ) {
      setSelectedCalendarLog( null )
    }
  }, [ logs, selectedCalendarLog ] )

  const handleCalendarNavigate = (direction: 'prev' | 'next') => {
    setCalendarDate( ( current ) => {
      const base = startOfDay( current )
      if( calendarView === 'month' ) {
        return direction === 'next' ? addMonths( base, 1 ) : addMonths( base, -1 )
      }
      if( calendarView === 'week' ) {
        return direction === 'next' ? addWeeks( base, 1 ) : addWeeks( base, -1 )
      }
      return direction === 'next' ? addDays( base, 1 ) : addDays( base, -1 )
    } )
  }

  const calendarPeriodLabel = useMemo( () => {
    if( calendarView === 'month' ) {
      return format( calendarDate, 'MMMM yyyy' )
    }
    if( calendarView === 'day' ) {
      return format( calendarDate, 'EEEE, MMMM d, yyyy' )
    }
    if( calendarView === 'agenda' ) {
      return format( calendarDate, 'EEEE, MMMM d, yyyy' )
    }
    return format( calendarDate, 'MMMM d, yyyy' )
  }, [ calendarDate, calendarView ] )

  useEffect( () => {
    if( !userId ) {
      return
    }
    void (async () => {
      try {
        const directorySnapshot = await getDocs( collection( db, 'userDirectory' ) )
        const nextUsers = directorySnapshot.docs.map( ( snapshot ) => {
          const data = snapshot.data()
          return {
            userId: ( data.userId as string | undefined ) ?? '',
            email: ( data.email as string | undefined ) ?? '',
            displayName: ( data.displayName as string | undefined ) ?? '',
          }
        } ).filter( ( entry ) => entry.userId )
        const nextDirectoryById = nextUsers.reduce<Record<string, UserDirectoryEntry>>( ( acc, entry ) => {
          acc[entry.userId] = entry
          return acc
        }, {} )
        setUsers( nextUsers )
        setUserDirectoryById( nextDirectoryById )
      } catch( err ) {
        if( isAdmin ) {
          const message = err instanceof Error ? err.message : 'Unexpected error'
          setError( message )
        } else {
          setUsers( [] )
          setUserDirectoryById( {} )
        }
      }
    })()
  }, [ userId, isAdmin ] )

  useEffect( () => {
    if( !isAdmin ) {
      if( selectedUserId ) {
        setSelectedUserId( '' )
      }
      return
    }
    if( sortedUsers.length === 0 ) {
      if( selectedUserId ) {
        setSelectedUserId( '' )
      }
      return
    }
    if( selectedUserId === ALL_USERS_FILTER ) {
      return
    }
    const selectedExists = sortedUsers.some( ( entry ) => entry.userId === selectedUserId )
    if( !selectedExists ) {
      setSelectedUserId( sortedUsers[0]?.userId ?? '' )
    }
  }, [ isAdmin, selectedUserId, sortedUsers ] )

  const handleRunReport = async () => {
    if( !reportUserId ) {
      setError( 'Sign in before running the audit report.' )
      return
    }
    setError( null )
    setIsBusy( true )
    try {
      const now = new Date()
      const fallbackStart = new Date( now )
      fallbackStart.setDate( fallbackStart.getDate() - 30 )
      const parsedStart = startDate ? parseLocalDateInput( startDate ) : null
      if( startDate && !parsedStart ) {
        setError( 'Start date is invalid. Use a valid date in YYYY-MM-DD format.' )
        return
      }
      const start = parsedStart ?? fallbackStart
      start.setHours( 0, 0, 0, 0 )
      const parsedEnd = endDate ? parseLocalDateInput( endDate ) : null
      if( endDate && !parsedEnd ) {
        setError( 'End date is invalid. Use a valid date in YYYY-MM-DD format.' )
        return
      }
      const end = parsedEnd ?? now
      end.setHours( 23, 59, 59, 999 )
      if( start.getTime() > end.getTime() ) {
        setError( 'Start date must be on or before end date.' )
        return
      }
      const rangeLabel = `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`

      if( isAdmin && !selectedUserId ) {
        setError( 'Select a user before running the audit report.' )
        return
      }
      const selectedUser = isAdmin ? sortedUsers.find( ( entry ) => entry.userId === selectedUserId ) : null
      console.log( '[Audit report] Starting run', {
        selectedUserId: reportUserId,
        selectedUserEmail: selectedUser?.email ?? user?.email ?? null,
        selectedUserName: selectedUser?.displayName ?? user?.displayName ?? null,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        rangeLabel,
      } )
      const constraints = [
        ...( isAllUsersSelected ? [] : [ where( 'actorId', '==', reportUserId ) ] ),
        where( 'createdAt', '>=', start ),
        where( 'createdAt', '<=', end ),
        orderBy( 'createdAt', 'desc' ),
      ]
      console.log( '[Audit report] Firestore query', {
        collection: 'auditLogs',
        constraints: [
          ...( isAllUsersSelected ? [] : [ { field: 'actorId', op: '==', value: reportUserId } ] ),
          { field: 'createdAt', op: '>=', value: start.toISOString() },
          { field: 'createdAt', op: '<=', value: end.toISOString() },
          { field: 'createdAt', op: 'orderBy desc', value: null },
        ],
      } )
      const logsSnapshot = await getDocs(
        query( collection( db, 'auditLogs' ), ...constraints ),
      )
      const nextLogs = logsSnapshot.docs.map( ( snapshot ) => {
        const data = snapshot.data()
        return {
          id: snapshot.id,
          actorId: ( data.actorId as string | undefined ) ?? '',
          actorEmail: ( data.actorEmail as string | null | undefined ) ?? null,
          action: ( data.action as string | undefined ) ?? 'unknown',
          entityType: ( data.entityType as string | undefined ) ?? 'unknown',
          entityId: ( data.entityId as string | undefined ) ?? '',
          projectId: ( data.projectId as string | undefined ) ?? '',
          docId: ( data.docId as string | undefined ) ?? '',
          versionId: ( data.versionId as string | undefined ) ?? '',
          threadId: ( data.threadId as string | undefined ) ?? '',
          commentId: ( data.commentId as string | undefined ) ?? '',
          targetUserId: ( data.targetUserId as string | undefined ) ?? '',
          createdAt: toTimestampDate( data.createdAt ),
          metadata: ( data.metadata as Record<string, unknown> | undefined ) ?? undefined,
        }
      } )
      console.log( '[Audit report] Query result', {
        count: nextLogs.length,
        ids: nextLogs.map( ( log ) => log.id ),
        actors: nextLogs.map( ( log ) => log.actorId ),
        createdAt: nextLogs.map( ( log ) => log.createdAt?.toISOString() ?? null ),
      } )
      setLogs( nextLogs )
      setLastReportRangeLabel( rangeLabel )

      const taskLogs = nextLogs
        .filter( ( entry ) => entry.action === 'taskAppear' || entry.action === 'taskComplete' )
        .map( ( entry ) => ( {
          action: entry.action,
          actorId: entry.actorId,
          actorEmail: entry.actorEmail,
          createdAt: entry.createdAt ?? null,
          metadata: entry.metadata ?? {},
        } ) )
      const taskKeyMap = new Map<string, {
        taskType: string
        actorId?: string
        actorEmail?: string | null
        appearAt: Date | null
        completeAt: Date | null
      }>()
      taskLogs.forEach( ( entry ) => {
        const taskKey = ( entry.metadata?.taskKey as string | undefined ) ?? ''
        const taskType = ( entry.metadata?.taskType as string | undefined ) ?? 'task'
        if( !taskKey ) {
          return
        }
        const taskActorKey = entry.actorId || entry.actorEmail || 'unknown-user'
        const mapKey = `${taskActorKey}::${taskKey}`
        const current = taskKeyMap.get( mapKey ) ?? {
          taskType,
          actorId: entry.actorId,
          actorEmail: entry.actorEmail,
          appearAt: null,
          completeAt: null,
        }
        if( entry.action === 'taskAppear' ) {
          current.appearAt = current.appearAt
            ? new Date( Math.min( current.appearAt.getTime(), entry.createdAt?.getTime() ?? current.appearAt.getTime() ) )
            : entry.createdAt ?? current.appearAt
        }
        if( entry.action === 'taskComplete' ) {
          current.completeAt = current.completeAt
            ? new Date( Math.min( current.completeAt.getTime(), entry.createdAt?.getTime() ?? current.completeAt.getTime() ) )
            : entry.createdAt ?? current.completeAt
        }
        current.taskType = taskType
        current.actorId = current.actorId ?? entry.actorId
        current.actorEmail = current.actorEmail ?? entry.actorEmail
        taskKeyMap.set( mapKey, current )
      } )

      const durations = Array.from( taskKeyMap.entries() ).map( ( [ taskKey, entry ] ) => {
        return {
          taskKey,
          taskType: entry.taskType,
          actorId: entry.actorId,
          actorEmail: entry.actorEmail,
          appearedAt: entry.appearAt,
          completedAt: entry.completeAt,
          isApproximate: false,
        }
      } )
      setTaskDurations( durations )

      const projectIds = Array.from( new Set( nextLogs.map( ( log ) => log.projectId ).filter( Boolean ) ) )
      const docIds = Array.from( new Set( nextLogs.map( ( log ) => log.docId ).filter( Boolean ) ) )
      const versionIds = Array.from( new Set( nextLogs.map( ( log ) => log.versionId ).filter( Boolean ) ) )
      const threadIds = Array.from( new Set( nextLogs.map( ( log ) => log.threadId ).filter( Boolean ) ) )
      const commentIds = Array.from( new Set( nextLogs.map( ( log ) => log.commentId ).filter( Boolean ) ) )

      if( isAdmin ) {
        const projectSnapshots = await Promise.all(
          projectIds.map( ( projectId ) => getDoc( doc( db, 'projects', projectId ) ) ),
        )
        const nextProjectNameById = projectSnapshots.reduce<Record<string, string>>( ( acc, snapshot ) => {
          if( snapshot.exists() ) {
            acc[snapshot.id] = ( snapshot.data().name as string | undefined ) ?? 'Unknown project'
          }
          return acc
        }, {} )
        setProjectNameById( nextProjectNameById )

        const documentSnapshots = await Promise.all(
          docIds.map( ( docId ) => getDoc( doc( db, 'documents', docId ) ) ),
        )
        const nextDocumentById = documentSnapshots.reduce<Record<string, DocumentLabel>>( ( acc, snapshot ) => {
          if( snapshot.exists() ) {
            const data = snapshot.data()
            acc[snapshot.id] = {
              title: ( data.title as string | undefined ) ?? 'Untitled document',
              shortId: Number.isFinite( data.shortId ) ? Number( data.shortId ) : null,
              type: ( data.type as string | undefined ) ?? 'document',
            }
          }
          return acc
        }, {} )
        setDocumentById( nextDocumentById )

        const versionSnapshots = await Promise.all(
          versionIds.map( ( versionId ) => getDoc( doc( db, 'versions', versionId ) ) ),
        )
        const nextVersionNumberById = versionSnapshots.reduce<Record<string, number>>( ( acc, snapshot ) => {
          if( snapshot.exists() ) {
            acc[snapshot.id] = Number( snapshot.data().number ?? 0 )
          }
          return acc
        }, {} )
        setVersionNumberById( nextVersionNumberById )

        const threadSnapshots = await Promise.all(
          threadIds.map( ( threadId ) => getDoc( doc( db, 'threads', threadId ) ) ),
        )
        const nextThreadTitleById = threadSnapshots.reduce<Record<string, string>>( ( acc, snapshot ) => {
          if( snapshot.exists() ) {
            acc[snapshot.id] = ( snapshot.data().title as string | undefined ) ?? 'Thread'
          }
          return acc
        }, {} )
        setThreadTitleById( nextThreadTitleById )

        const commentSnapshots = await Promise.all(
          commentIds.map( ( commentId ) => getDoc( doc( db, 'comments', commentId ) ) ),
        )
        const nextCommentBodyById = commentSnapshots.reduce<Record<string, string>>( ( acc, snapshot ) => {
          if( snapshot.exists() ) {
            acc[snapshot.id] = ( snapshot.data().body as string | undefined ) ?? ''
          }
          return acc
        }, {} )
        setCommentBodyById( nextCommentBodyById )
      } else {
        setProjectNameById( {} )
        setDocumentById( {} )
        setVersionNumberById( {} )
        setThreadTitleById( {} )
        setCommentBodyById( {} )
      }
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setError( message )
    } finally {
      setIsBusy( false )
      if( shouldRestoreRunReportFocusRef.current ) {
        window.setTimeout( () => {
          runReportButtonRef.current?.focus()
        }, 0 )
        shouldRestoreRunReportFocusRef.current = false
      }
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <AppBrand pageTitle={isAdmin ? 'Admin Audit' : 'My Activity'} />
        </div>
        <BackStack links={[]} />
      </header>

      <main className="app-main">
        {isAdmin ? (
          <section className="panel stack">
            <h2>Files API status</h2>
            <div className="actions">
              <button type="button" onClick={() => void checkFilesApi()} disabled={filesApiStatus === 'checking'}>
                {filesApiStatus === 'checking' ? 'Checking...' : 'Check connection'}
              </button>
            </div>
            {filesApiStatus === 'ok' ? <p className="muted">{filesApiMessage}</p> : null}
            {filesApiStatus === 'error' ? <p className="error">{filesApiMessage}</p> : null}
            {filesApiCheckedAt ? (
              <p className="muted">Last checked: {new Date( filesApiCheckedAt ).toLocaleString()}</p>
            ) : null}
            {filesApiStatus === 'idle' ? (
              <p className="muted">{`Current Files API mode: ${getFilesApiConfigSummary()}.`}</p>
            ) : null}
          </section>
        ) : null}
        {isAdmin ? (
          <section className="panel stack">
            <h2>Runtime providers</h2>
            <label className="field">
              <span>File storage provider</span>
              <select
                value={selectedFileStorageProvider}
                onChange={(event) => setSelectedFileStorageProvider( event.target.value as FileStorageProviderKind )}
                disabled={runtimeConfigStatus === 'saving' || runtimeConfigStatus === 'loading'}
              >
                <option value="files-api">Files API</option>
                <option value="firebase-storage">Firebase Storage</option>
              </select>
            </label>
            <label className="field">
              <span>Email provider</span>
              <select
                value={selectedEmailProvider}
                onChange={(event) => setSelectedEmailProvider( event.target.value as NotificationProviderKind )}
                disabled={runtimeConfigStatus === 'saving' || runtimeConfigStatus === 'loading'}
              >
                <option value="files-api">Files API</option>
                <option value="firebase-functions">Firebase Functions</option>
              </select>
            </label>
            <div className="actions">
              <button
                type="button"
                onClick={() => void loadRuntimeConfigFromFirestore()}
                disabled={runtimeConfigStatus === 'saving' || runtimeConfigStatus === 'loading'}
              >
                {runtimeConfigStatus === 'loading' ? 'Loading...' : 'Reload config'}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveRuntimeConfig()}
                disabled={runtimeConfigStatus === 'saving' || runtimeConfigStatus === 'loading'}
              >
                {runtimeConfigStatus === 'saving' ? 'Saving...' : 'Save providers'}
              </button>
            </div>
            {runtimeConfigStatus === 'error' ? <p className="error">{runtimeConfigMessage}</p> : null}
            {runtimeConfigStatus !== 'error' && runtimeConfigMessage ? (
              <p className="muted">{runtimeConfigMessage}</p>
            ) : null}
            <p className="muted">{`Source: ${runtimeConfigSource}. Defaults: ${formatRuntimeConfigSummary( defaultRuntimeConfig )}.`}</p>
            {runtimeConfigLoadedAt ? (
              <p className="muted">Last checked: {new Date( runtimeConfigLoadedAt ).toLocaleString()}</p>
            ) : null}
          </section>
        ) : null}

        {isAdmin ? (
          <section className="panel stack">
            <h2>Data model update</h2>
            <div className="actions">
              <button
                type="button"
                onClick={requestModelUpdateConfirmation}
                disabled={modelUpdateStatus === 'running'}
              >
                {modelUpdateStatus === 'running'
                  ? `Updating v${DATA_MODEL_UPDATE_VERSION}...`
                  : `Update existing data (v${DATA_MODEL_UPDATE_VERSION})`}
              </button>
            </div>
            {modelUpdateStatus === 'running' ? <p className="muted">{modelUpdateMessage}</p> : null}
            {modelUpdateStatus === 'done' ? <p className="muted">{modelUpdateMessage}</p> : null}
            {modelUpdateSummary ? <p className="muted">{modelUpdateSummary}</p> : null}
            {modelUpdateStatus === 'error' ? <p className="error">{modelUpdateMessage}</p> : null}
            {modelUpdateStatus === 'idle' ? (
              <p className="muted">{`Updater version: v${DATA_MODEL_UPDATE_VERSION}. Backfills missing short IDs, repairs linked file metadata, and recalculates thread/version stats.`}</p>
            ) : null}
          </section>
        ) : null}
        {isModelUpdateLogOpen ? (
          <ModalDialog onClose={() => setIsModelUpdateLogOpen( false )}>
            <h3>Data model update log</h3>
            <GiphyInline reason="thinking" mode="inline" />
            <p className="muted">
              Review the repair steps below, then close this window when you are done.
            </p>
            {modelUpdateStatus === 'running' || modelUpdateStatus === 'done' || modelUpdateStatus === 'error' ? (
              <div className="stack">
                <div className="muted" aria-live="polite">
                  {modelUpdateProgressLabel ? `${modelUpdateProgressLabel} (${modelUpdateProgress}%)` : `${modelUpdateProgress}%`}
                </div>
                <div
                  aria-label="Data model update progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={modelUpdateProgress}
                  style={{
                    height: '10px',
                    borderRadius: '999px',
                    background: 'rgba(0,0,0,0.12)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max( 0, Math.min( 100, modelUpdateProgress ) )}%`,
                      height: '100%',
                      background: 'var(--color-accent, #1e88e5)',
                      transition: 'width 180ms ease',
                    }}
                  />
                </div>
              </div>
            ) : null}
            <div className="stack" style={{ maxHeight: '50vh', overflow: 'auto' }}>
              {modelUpdateLog.length === 0 ? (
                <p className="muted">No repair steps were recorded.</p>
              ) : (
                modelUpdateLog.map( ( line, index ) => (
                  <pre
                    key={`${index}-${line}`}
                    className="muted"
                    style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {line}
                  </pre>
                ) )
              )}
              {modelUpdateSummary ? <p className="muted">{modelUpdateSummary}</p> : null}
            </div>
            <div
              className="actions"
              style={{
                position: 'sticky',
                bottom: 0,
                paddingTop: '0.5rem',
                paddingBottom: '0.25rem',
                background: 'var(--panel-background, #fff)',
                borderTop: '1px solid rgba(0,0,0,0.08)',
              }}
            >
              <button type="button" onClick={() => void copyModelUpdateLog()} disabled={modelUpdateLog.length === 0}>
                Copy log
              </button>
              <button type="button" onClick={() => setIsModelUpdateLogOpen( false )}>
                Close log
              </button>
            </div>
            {modelUpdateLogCopyStatus === 'copied' ? <p className="muted">Log copied to clipboard.</p> : null}
            {modelUpdateLogCopyStatus === 'error' ? <p className="error">Could not copy the log.</p> : null}
          </ModalDialog>
        ) : null}
        {isAdmin ? (
          <section className="panel stack">
            <h2>Legacy timestamp repair</h2>
            <div className="actions">
              <button
                type="button"
                onClick={requestReviewRepairConfirmation}
                disabled={reviewRepairStatus === 'running'}
              >
                {reviewRepairStatus === 'running' ? 'Repairing...' : 'Repair legacy document and version timestamps'}
              </button>
            </div>
            {reviewRepairStatus === 'running' ? <p className="muted">{reviewRepairMessage}</p> : null}
            {reviewRepairStatus === 'done' ? <p className="muted">{reviewRepairMessage}</p> : null}
            {reviewRepairSummary ? <p className="muted">{reviewRepairSummary}</p> : null}
            {reviewRepairStatus === 'error' ? <p className="error">{reviewRepairMessage}</p> : null}
            {reviewRepairStatus === 'idle' ? (
              <p className="muted">
                Repairs legacy timestamps by backfilling missing `documents.createdAt`, missing `versions.createdAt`, and missing `reviewEndAt` on `In Review` versions.
              </p>
            ) : null}
          </section>
        ) : null}
        {confirmModelUpdate ? (
          <ModalDialog onClose={() => setConfirmModelUpdate( false )}>
              <h3>{`Update data model v${DATA_MODEL_UPDATE_VERSION}`}</h3>
              <GiphyInline reason="thinking" mode="inline" />
              <p className="muted">Confirm updating existing data, repairing linked file metadata, and recalculating stats.</p>
              <div className="actions">
                <button type="button" onClick={() => setConfirmModelUpdate( false )} disabled={modelUpdateStatus === 'running'}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmModelUpdate( false )
                    void handleUpdateModel()
                  }}
                  disabled={modelUpdateStatus === 'running'}
                >
                  Confirm
                </button>
              </div>
          </ModalDialog>
        ) : null}
        {confirmReviewRepair ? (
          <ModalDialog onClose={() => setConfirmReviewRepair( false )}>
              <h3>Repair legacy timestamps</h3>
              <GiphyInline reason="thinking" mode="inline" />
              <p className="muted">
                Confirm backfilling missing `documents.createdAt`, missing `versions.createdAt`, and missing `reviewEndAt` for legacy `In Review` versions.
              </p>
              <div className="actions">
                <button
                  type="button"
                  onClick={() => setConfirmReviewRepair( false )}
                  disabled={reviewRepairStatus === 'running'}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmReviewRepair( false )
                    void handleRepairReviewExpirations()
                  }}
                  disabled={reviewRepairStatus === 'running'}
                >
                  Confirm
                </button>
              </div>
          </ModalDialog>
        ) : null}

        <section className="panel stack">
          <h2>Audit report</h2>
          <div className="actions actions--audit-filters">
            <label className="field">
              <span>User</span>
              {isAdmin ? (
                <select value={selectedUserId} onChange={( event ) => setSelectedUserId( event.target.value )}>
                  <option value={ALL_USERS_FILTER}>All users</option>
                  {sortedUsers.map( ( entry ) => (
                    <option key={entry.userId} value={entry.userId}>
                      {entry.displayName || entry.email || 'Unknown user'}
                    </option>
                  ) )}
                </select>
              ) : (
                <input type="text" value={user?.email ?? 'Current user'} readOnly />
              )}
            </label>
            <label className="field">
              <span>Start date</span>
              <input type="date" value={startDate} onChange={( event ) => setStartDate( event.target.value )} />
            </label>
            <label className="field">
              <span>End date</span>
              <input type="date" value={endDate} onChange={( event ) => setEndDate( event.target.value )} />
            </label>
            <button
              ref={runReportButtonRef}
              type="button"
              onClick={() => {
                shouldRestoreRunReportFocusRef.current = true
                void handleRunReport()
              }}
              disabled={isBusy}
            >
              Run report
            </button>
          </div>
        </section>
        {error ? (
          <ErrorChecklistModal
            error={error}
            checklist={errorChecklist}
            onClose={() => setError( null )}
            reportContext={{
              pageLabel: 'Admin Audit',
            }}
          />
        ) : null}

        {isBusy && logs.length === 0 ? (
          <section className="panel">
            <GiphyInline reason="loading" />
            <p className="muted">Generating report...</p>
          </section>
        ) : (
          <section className="panel stack">
            <div className="panel-header">
              <h2>Activity log</h2>
              <div className="actions actions--inline">
                <p className="muted">{logs.length} entries</p>
                <button type="button" onClick={downloadAuditCsv} disabled={logs.length === 0}>
                  Download CSV
                </button>
                <div className="view-toggle">
                  <button
                    type="button"
                    aria-pressed={logViewMode === 'table'}
                    onClick={() => setLogViewMode( 'table' )}
                  >
                    Table
                  </button>
                  <button
                    type="button"
                    aria-pressed={logViewMode === 'calendar'}
                    onClick={() => setLogViewMode( 'calendar' )}
                  >
                    Calendar
                  </button>
                </div>
              </div>
            </div>
            {logs.length === 0 ? (
              <p className="muted">
                {lastReportRangeLabel
                  ? `No audit entries for range: ${lastReportRangeLabel}.`
                  : 'No audit entries for the selected range.'}
              </p>
            ) : logViewMode === 'table' ? (
              <DataTable
                columns={logColumns}
                data={logTableRows}
                sorting={logSorting}
                onSortingChange={setLogSorting}
                tableClassName="data-table--audit"
                storageKey="qt4_table_audit_logs"
                enablePagination
                initialPageSize={20}
              />
            ) : (
              <div className="audit-calendar-shell">
                <div className="actions audit-calendar-controls">
                  <button type="button" onClick={() => handleCalendarNavigate( 'prev' )}>
                    Back
                  </button>
                  <p className="muted">{calendarPeriodLabel}</p>
                  <button type="button" className="ghost" onClick={() => setCalendarDate( startOfDay( new Date() ) )}>
                    Today
                  </button>
                  <button type="button" onClick={() => handleCalendarNavigate( 'next' )}>
                    Next
                  </button>
                  <div className="view-toggle">
                    <button type="button" aria-pressed={calendarView === 'month'} onClick={() => setCalendarView( 'month' )}>
                      Month
                    </button>
                    <button type="button" aria-pressed={calendarView === 'week'} onClick={() => setCalendarView( 'week' )}>
                      Week
                    </button>
                    <button type="button" aria-pressed={calendarView === 'day'} onClick={() => setCalendarView( 'day' )}>
                      Day
                    </button>
                    <button type="button" aria-pressed={calendarView === 'agenda'} onClick={() => setCalendarView( 'agenda' )}>
                      Agenda
                    </button>
                  </div>
                </div>
                <div className="audit-calendar">
                  <Calendar
                    localizer={calendarLocalizer}
                    events={visibleCalendarEvents}
                    date={calendarDate}
                    view={calendarView}
                    length={calendarView === 'agenda' ? 1 : undefined}
                    onNavigate={( nextDate: Date ) => setCalendarDate( startOfDay( nextDate ) )}
                    onView={( nextView: string ) => setCalendarView( nextView as 'month' | 'week' | 'day' | 'agenda' )}
                    startAccessor="start"
                    endAccessor="end"
                    views={[ 'month', 'week', 'day', 'agenda' ]}
                    toolbar={false}
                    style={{ height: 640 }}
                    onSelectEvent={( event: AuditCalendarEvent ) => setSelectedCalendarLog( event.resource )}
                  />
                </div>
                {calendarView === 'agenda' ? (
                  <p className="muted">Agenda date: {format( calendarDate, 'EEEE, MMMM d, yyyy' )}</p>
                ) : null}
                {selectedCalendarLog ? (
                  <div className="audit-calendar-detail">
                    <div className="panel-header">
                      <h3>Selected log</h3>
                      <button type="button" className="ghost" onClick={() => setSelectedCalendarLog( null )}>
                        Close
                      </button>
                    </div>
                    <p><strong>When:</strong> {selectedCalendarLog.createdAt ? selectedCalendarLog.createdAt.toLocaleString() : 'Unknown'}</p>
                    {isAllUsersSelected ? (
                      <p><strong>User:</strong> {formatCalendarLogSummary( selectedCalendarLog ).actor}</p>
                    ) : null}
                    <p><strong>Action:</strong> {selectedCalendarLog.action}</p>
                    <p><strong>Entity:</strong> {selectedCalendarLog.entityType}</p>
                    <p><strong>Project:</strong> {formatCalendarLogSummary( selectedCalendarLog ).project}</p>
                    <p><strong>Document:</strong> {formatCalendarLogSummary( selectedCalendarLog ).document}</p>
                    <p><strong>Version:</strong> {formatCalendarLogSummary( selectedCalendarLog ).version}</p>
                    <p><strong>Target user:</strong> {formatCalendarLogSummary( selectedCalendarLog ).targetUser}</p>
                    <p><strong>Thread/Comment:</strong> {selectedCalendarLog.commentId ? formatCommentLabel( selectedCalendarLog.commentId ) : selectedCalendarLog.threadId ? formatThreadLabel( selectedCalendarLog.threadId ) : '-'}</p>
                  </div>
                ) : (
                  <p className="muted">Select an event to view full log details.</p>
                )}
              </div>
            )}
          </section>
        )}

        <section className="panel stack">
          <div className="panel-header">
            <h2>Task durations</h2>
            <p className="muted">{taskDurations.length} tasks</p>
          </div>
          {taskDurations.length === 0 ? (
            <p className="muted">No task lifecycle data for the selected range.</p>
          ) : (
            <DataTable
              columns={taskColumns}
              data={taskTableRows}
              sorting={taskSorting}
              onSortingChange={setTaskSorting}
              tableClassName="data-table--audit"
              storageKey="qt4_table_audit_tasks"
            />
          )}
        </section>
      </main>
    </div>
  )
}

export default AdminAuditPage


