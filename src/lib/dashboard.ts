import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  where,
} from 'firebase/firestore'
import type { DocumentData, DocumentSnapshot, QueryConstraint, QuerySnapshot } from 'firebase/firestore'
import { versionNumberToString } from '../domain/types'
import { logAudit } from './audit'
import { db } from './firebase'
import { canAddCommentInWindow } from './reviewWindow'
import { consumeInjectedTestFault } from './testFaults'

export type DashboardTask = {
  id: string
  type: 'authoring' | 'reply' | 'reviewer' | 'acceptedReport'
  lifecycleState?: 'active' | 'expired'
  visualState?: 'neutral' | 'inCreation' | 'reviewActive' | 'reviewGrace' | 'reviewExpired' | 'accepted'
  title: string
  detail: string
  projectId: string
  link: string
  createdAt?: Date | null
  reviewEndAt?: Date | null
  reviewPeriodState?: 'active' | 'grace'
}

export type DashboardTaskType = DashboardTask['type']
export type DashboardRefreshScope = 'all' | DashboardTaskType

type BuildDashboardTasksOptions = {
  types?: DashboardTaskType[]
  onProgress?: (progress: DashboardBuildProgress) => void
}

type RefreshDashboardOptions = {
  types?: DashboardTaskType[]
  onProgress?: (progress: DashboardBuildProgress) => void
}

export type DashboardBuildProgress = {
  currentStep: number
  totalSteps: number
  label: string
}

const DASHBOARD_STORAGE_VERSION = 2
const DASHBOARD_BATCH_SIZE = 400

type VersionRecord = {
  id: string
  projectId: string
  docId: string
  number: number
  status: string
  createdBy: string
  reviewerIds: string[]
  hasFile: boolean
  createdAt?: Date | null
  updatedAt?: Date | null
  reviewStartAt?: Date | null
  reviewEndAt?: Date | null
}

type ThreadRecord = {
  id: string
  status: string
  versionId: string
  docId: string
  projectId: string
  commentCount: number
  createdAt?: Date | null
  lastCommentAt?: Date | null
  lastCommentBy?: string
}

type ReplyTask = {
  id: string
  versionId: string
  threadId: string
  lifecycleState: 'active' | 'expired'
}

const appendQueryParam = (link: string, key: string, value: string): string => {
  const hashIndex = link.indexOf( '#' )
  const base = hashIndex >= 0 ? link.slice( 0, hashIndex ) : link
  const hash = hashIndex >= 0 ? link.slice( hashIndex ) : ''
  const separator = base.includes( '?' ) ? '&' : '?'
  return `${base}${separator}${encodeURIComponent( key )}=${encodeURIComponent( value )}${hash}`
}

const toTimestampDate = (value: unknown): Date | null => {
  if( !value ) {
    return null
  }
  if( typeof value === 'object' && value && 'toDate' in value && typeof ( value as { toDate?: () => Date } ).toDate === 'function' ) {
    return ( value as { toDate: () => Date } ).toDate()
  }
  return null
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

const pruneUndefinedFields = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(
    Object.entries( value ).filter( ( [ , entryValue ] ) => entryValue !== undefined ),
  ) as T

const safeGetDoc = async (
  path: string,
): Promise<DocumentSnapshot<DocumentData> | null> => {
  try {
    const [ collectionId, documentId, ...rest ] = path.split( '/' ).filter( Boolean )
    if( !collectionId || !documentId ) {
      return null
    }
    return await getDoc( doc( db, collectionId, documentId, ...rest ) )
  } catch {
    return null
  }
}

const safeGetDocs = async (
  loader: () => Promise<QuerySnapshot<DocumentData>>,
): Promise<QuerySnapshot<DocumentData> | null> => {
  try {
    return await loader()
  } catch {
    return null
  }
}

export const deserializeDashboardTask = (
  taskId: string,
  data: Record<string, unknown>,
): DashboardTask =>
  pruneUndefinedFields( {
    id: ( data.id as string | undefined ) ?? taskId,
    type: ( data.type as DashboardTaskType | undefined ) ?? 'authoring',
    lifecycleState: data.lifecycleState as DashboardTask['lifecycleState'] | undefined,
    visualState: data.visualState as DashboardTask['visualState'] | undefined,
    title: ( data.title as string | undefined ) ?? 'Untitled task',
    detail: ( data.detail as string | undefined ) ?? '',
    projectId: ( data.projectId as string | undefined ) ?? '',
    link: ( data.link as string | undefined ) ?? '',
    createdAt: toTimestampDate( data.createdAt ),
    reviewEndAt: toTimestampDate( data.reviewEndAt ),
    reviewPeriodState: data.reviewPeriodState as DashboardTask['reviewPeriodState'] | undefined,
  } )

const countTasksByType = (tasks: DashboardTask[]): Record<DashboardTaskType, number> => tasks.reduce(
  ( acc, task ) => {
    acc[task.type] += 1
    return acc
  },
  {
    authoring: 0,
    reply: 0,
    reviewer: 0,
    acceptedReport: 0,
  } satisfies Record<DashboardTaskType, number>,
)

const writeDashboardTaskDocuments = async (
  userId: string,
  tasksToUpsert: DashboardTask[],
  taskIdsToDelete: string[],
): Promise<void> => {
  const operations = [
    ...tasksToUpsert.map( ( task ) => ( { kind: 'set' as const, task } ) ),
    ...taskIdsToDelete.map( ( taskId ) => ( { kind: 'delete' as const, taskId } ) ),
  ]
  if( operations.length === 0 ) {
    return
  }
  const operationChunks = chunkArray( operations, DASHBOARD_BATCH_SIZE )
  for( const operationChunk of operationChunks ) {
    const batch = writeBatch( db )
    operationChunk.forEach( ( operation ) => {
      const taskRef = doc( db, 'dashboard', userId, 'tasks', operation.kind === 'set' ? operation.task.id : operation.taskId )
      if( operation.kind === 'set' ) {
        batch.set( taskRef, pruneUndefinedFields( { ...operation.task } ) )
        return
      }
      batch.delete( taskRef )
    } )
    await batch.commit()
  }
}

const dedupeVersionsById = (versions: VersionRecord[]): VersionRecord[] => Array.from(
  new Map( versions.map( ( version ) => [ version.id, version ] ) ).values(),
)

const toVersionRecord = (snapshot: { id: string; data: () => Record<string, unknown> }): VersionRecord => {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    projectId: ( data.projectId as string | undefined ) ?? '',
    docId: ( data.docId as string | undefined ) ?? '',
    number: Number( data.number ?? 0 ),
    status: ( data.status as string | undefined ) ?? '',
    createdBy: ( data.createdBy as string | undefined ) ?? ( data.authorId as string | undefined ) ?? '',
    reviewerIds: ( data.reviewerIds as string[] | undefined ) ?? [],
    hasFile: Boolean( data.hasFile ),
    createdAt: toTimestampDate( data.createdAt ),
    updatedAt: toTimestampDate( data.updatedAt ),
    reviewStartAt: toTimestampDate( data.reviewStartAt ),
    reviewEndAt: toTimestampDate( data.reviewEndAt ),
  }
}

const toThreadRecord = (snapshot: { id: string; data: () => Record<string, unknown> }): ThreadRecord => {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    status: ( data.status as string | undefined ) ?? '',
    versionId: ( data.versionId as string | undefined ) ?? '',
    docId: ( data.docId as string | undefined ) ?? '',
    projectId: ( data.projectId as string | undefined ) ?? '',
    commentCount: Number( data.commentCount ?? 0 ),
    createdAt: toTimestampDate( data.createdAt ),
    lastCommentAt: toTimestampDate( data.lastCommentAt ),
    lastCommentBy: ( data.lastCommentBy as string | undefined ) ?? '',
  }
}

const isReviewWindowActionable = (
  version: Pick<VersionRecord, 'status' | 'reviewEndAt'>,
  thread: Pick<ThreadRecord, 'status' | 'lastCommentAt'>,
  nowMs: number,
): boolean =>
  canAddCommentInWindow( {
    versionStatus: version.status,
    reviewEndAt: version.reviewEndAt ?? null,
    threadStatus: thread.status,
    lastThreadCommentAt: thread.lastCommentAt ?? null,
    canParticipate: true,
    hasBody: true,
    nowMs,
  } )

export const buildDashboardTasks = async (
  userId: string,
  options: BuildDashboardTasksOptions = {},
): Promise<DashboardTask[]> => {
  const nowMs = Date.now()
  const totalSteps = 6
  const reportProgress = (currentStep: number, label: string) => {
    options.onProgress?.( { currentStep, totalSteps, label } )
  }
  const requestedTypes = options.types && options.types.length > 0
    ? new Set<DashboardTaskType>( options.types )
    : null
  const includesType = (type: DashboardTaskType): boolean =>
    requestedTypes ? requestedTypes.has( type ) : true
  const needsAuthoring = includesType( 'authoring' )
  const needsReviewer = includesType( 'reviewer' )
  const needsReply = includesType( 'reply' )
  const needsAcceptedReport = includesType( 'acceptedReport' )

  reportProgress( 1, 'Loading project memberships...' )
  const membershipSnapshot = await getDocs(
    query( collection( db, 'projectMembers' ), where( 'userId', '==', userId ) ),
  )
  const projectRoleById = membershipSnapshot.docs.reduce<Record<string, string>>( ( acc, docSnapshot ) => {
    const data = docSnapshot.data()
    const projectId = ( data.projectId as string | undefined ) ?? ''
    if( projectId ) {
      acc[projectId] = ( data.role as string | undefined ) ?? ''
    }
    return acc
  }, {} )
  const projectIds = Object.keys( projectRoleById )
  const uniqueProjectIds = Array.from( new Set( projectIds ) )
  const projectDocs = await Promise.all(
    uniqueProjectIds.map( ( projectId ) => safeGetDoc( `projects/${projectId}` ) ),
  )
  const projectNameById = projectDocs.reduce<Record<string, string>>( ( acc, snapshot ) => {
    if( snapshot?.exists() ) {
      acc[snapshot.id] = ( snapshot.data().name as string | undefined ) ?? 'Untitled project'
    }
    return acc
  }, {} )

  const projectIdChunks = chunkArray( uniqueProjectIds, 10 ).filter( ( chunk ) => chunk.length > 0 )
  const fetchVersionsForProjects = async (constraints: QueryConstraint[]): Promise<VersionRecord[]> => {
    if( projectIdChunks.length === 0 ) {
      return []
    }
    const snapshots = await Promise.all(
      projectIdChunks.map( ( chunk ) =>
        getDocs(
          query(
            collection( db, 'versions' ),
            where( 'projectId', 'in', chunk ),
            ...constraints,
          ),
        ),
      ),
    )
    return snapshots.flatMap( ( snapshot ) => snapshot.docs ).map( toVersionRecord )
  }
  const fetchVersionsForAuthorAcrossProjects = async (statuses: string[]): Promise<VersionRecord[]> => {
    const authorResults = await Promise.all( statuses.flatMap( ( status ) => ( [
      fetchVersionsForProjects( [
        where( 'createdBy', '==', userId ),
        where( 'status', '==', status ),
      ] ),
      fetchVersionsForProjects( [
        where( 'authorId', '==', userId ),
        where( 'status', '==', status ),
      ] ),
    ] ) ) )
    return dedupeVersionsById( authorResults.flat() )
  }

  reportProgress( 2, 'Loading versions and your participation...' )
  const [ authoringVersions, reviewerCandidateVersions ] = await Promise.all( [
    needsAuthoring
      ? fetchVersionsForAuthorAcrossProjects( [ 'In Creation' ] )
      : Promise.resolve( [] ),
    needsReviewer || needsReply
      ? fetchVersionsForProjects( [
        where( 'reviewerIds', 'array-contains', userId ),
      ] )
      : Promise.resolve( [] ),
  ] )
  const reviewerVersions = reviewerCandidateVersions.filter(
    ( version ) => version.status === 'In Review' || version.status === 'Reviewed',
  )
  const leaderProjectIds = needsReply
    ? projectIds.filter( ( projectId ) => projectRoleById[projectId] === 'leader' )
    : []
  const leaderProjectChunks = chunkArray( leaderProjectIds, 10 ).filter( ( chunk ) => chunk.length > 0 )
  const [ userCommentsSnapshot, authorReviewVersions, leaderReviewSnapshots ] = await Promise.all( [
    needsReviewer || needsReply
      ? safeGetDocs( () =>
        getDocs(
          query(
            collection( db, 'comments' ),
            where( 'createdBy', '==', userId ),
          ),
        ),
      )
      : Promise.resolve( null ),
    needsReply
      ? fetchVersionsForAuthorAcrossProjects( [ 'In Review', 'Reviewed' ] )
      : Promise.resolve( [] ),
    needsReply
      ? Promise.all(
        leaderProjectChunks.flatMap( ( chunk ) => ( [
          getDocs(
            query(
              collection( db, 'versions' ),
              where( 'projectId', 'in', chunk ),
              where( 'status', '==', 'In Review' ),
            ),
          ),
          getDocs(
            query(
              collection( db, 'versions' ),
              where( 'projectId', 'in', chunk ),
              where( 'status', '==', 'Reviewed' ),
            ),
          ),
        ] ) ),
      )
      : Promise.resolve( [] ),
  ] )
  const leaderReviewVersions = leaderReviewSnapshots.flatMap( ( snapshot ) => snapshot.docs ).map( toVersionRecord )

  const userCommentLatestByThread = new Map<string, number>()
  const userCommentedVersionIds = new Set<string>()
  userCommentsSnapshot?.docs.forEach( ( snapshot ) => {
    const data = snapshot.data()
    const projectId = ( data.projectId as string | undefined ) ?? ''
    if( projectId && !uniqueProjectIds.includes( projectId ) ) {
      return
    }
    const threadId = ( data.threadId as string | undefined ) ?? ''
    const versionId = ( data.versionId as string | undefined ) ?? ''
    const createdAt = data.createdAt?.toDate?.() as Date | undefined
    if( threadId && createdAt ) {
      const current = userCommentLatestByThread.get( threadId ) ?? 0
      const time = createdAt.getTime()
      if( time > current ) {
        userCommentLatestByThread.set( threadId, time )
      }
    }
    if( versionId ) {
      userCommentedVersionIds.add( versionId )
    }
  } )
  const canBuildReplyTasks = needsReply && userCommentsSnapshot !== null

  const reviewAccessVersions = Array.from(
    new Map(
      [
        ...reviewerVersions,
        ...( canBuildReplyTasks ? authorReviewVersions : [] ),
        ...( canBuildReplyTasks ? leaderReviewVersions : [] ),
      ].map( ( version ) => [
        version.id,
        version,
      ] ),
    ).values(),
  )
  const reviewAccessVersionById = reviewAccessVersions.reduce<Record<string, VersionRecord>>( ( acc, version ) => {
    acc[version.id] = version
    return acc
  }, {} )
  const reviewAccessVersionIds = Array.from(
    new Set(
      reviewAccessVersions
        .filter( ( version ) => version.status === 'In Review' || version.status === 'Reviewed' )
        .map( ( version ) => version.id )
        .filter( Boolean ),
    ),
  )
  const reviewAccessVersionIdSet = new Set( reviewAccessVersionIds )
  const threadVersionChunks = chunkArray( reviewAccessVersionIds, 10 ).filter( ( chunk ) => chunk.length > 0 )
  reportProgress( 3, 'Checking review threads and reply windows...' )
  const reviewThreadSnapshots = ( needsReviewer || needsReply ) && threadVersionChunks.length > 0
    ? (
      await Promise.all(
        threadVersionChunks.map( ( chunk ) =>
          safeGetDocs( () =>
            getDocs(
              query(
                collection( db, 'threads' ),
                where( 'versionId', 'in', chunk ),
                where( 'status', '==', 'open' ),
              ),
            ),
          ),
        ),
      )
    ).filter( ( snapshot ): snapshot is QuerySnapshot<DocumentData> => snapshot !== null )
    : []
  const openReviewThreads = reviewThreadSnapshots
    .flatMap( ( snapshot ) => snapshot.docs )
    .map( toThreadRecord )
    .filter( ( thread ) => reviewAccessVersionIdSet.has( thread.versionId ) )
  const openThreadsByVersionId = openReviewThreads.reduce<Record<string, ThreadRecord[]>>( ( acc, thread ) => {
    if( !acc[thread.versionId] ) {
      acc[thread.versionId] = []
    }
    acc[thread.versionId].push( thread )
    return acc
  }, {} )
  const repliedThreadTasks: ReplyTask[] = []
  const replyThreadById = new Map<string, ThreadRecord>()
  const replyTaskThreadIds = new Set<string>()
  if( canBuildReplyTasks ) {
    try {
      const threads = openReviewThreads
      for( const thread of threads ) {
        const version = reviewAccessVersionById[thread.versionId]
        if( !version ) {
          continue
        }
        const isAuthor = version.createdBy === userId
        const isLeader = ( projectRoleById[version.projectId] ?? '' ) === 'leader'
        const canDetectWithoutParticipation = isAuthor || isLeader
        const hasComments = thread.commentCount > 0 || Boolean( thread.lastCommentAt )
        const latestUserCommentAtMs = userCommentLatestByThread.get( thread.id ) ?? 0
        const latestUserCommentAt = latestUserCommentAtMs ? new Date( latestUserCommentAtMs ) : null
        const hasPendingReply =
          ( !latestUserCommentAt && canDetectWithoutParticipation && hasComments ) ||
          Boolean(
            latestUserCommentAt &&
            thread.lastCommentAt &&
            thread.lastCommentAt.getTime() > latestUserCommentAt.getTime() &&
            thread.lastCommentBy &&
            thread.lastCommentBy !== userId,
          )
        if( !hasPendingReply ) {
          continue
        }
        const canReplyNow = isReviewWindowActionable( version, thread, nowMs )
        const lifecycleState: 'active' | 'expired' = canReplyNow ? 'active' : 'expired'
        if( !latestUserCommentAt && canDetectWithoutParticipation && hasComments ) {
          if( !replyTaskThreadIds.has( thread.id ) ) {
            replyTaskThreadIds.add( thread.id )
            repliedThreadTasks.push( {
              id: thread.id,
              versionId: thread.versionId,
              threadId: thread.id,
              lifecycleState,
            } )
            replyThreadById.set( thread.id, {
              ...thread,
              createdAt: thread.lastCommentAt ?? thread.createdAt,
            } )
          }
          continue
        }
        if( !latestUserCommentAt ) {
          continue
        }
        const latestCommentAt = thread.lastCommentAt ?? null
        const latestCommentAuthor = thread.lastCommentBy ?? ''
        if(
          latestCommentAt &&
          latestCommentAt.getTime() > latestUserCommentAt.getTime() &&
          latestCommentAuthor &&
          latestCommentAuthor !== userId
        ) {
          if( !replyTaskThreadIds.has( thread.id ) ) {
            replyTaskThreadIds.add( thread.id )
            repliedThreadTasks.push( {
              id: thread.id,
              versionId: thread.versionId,
              threadId: thread.id,
              lifecycleState,
            } )
            replyThreadById.set( thread.id, {
              ...thread,
              createdAt: latestCommentAt,
            } )
          }
        }
      }
    } catch {
      // Ignore reply-needed tasks if permission errors occur.
    }
  }
  const versionById: Record<string, VersionRecord> = {}

  type ErrorReportDoc = {
    id: string
    projectId: string
    baseVersionId: string
    createdAt?: Date | null
    acceptedAt?: Date | null
  }
  reportProgress( 4, 'Checking accepted error reports...' )
  const errorReportSnapshots = needsAcceptedReport
    ? await Promise.all(
      projectIdChunks.map( ( chunk ) =>
        getDocs(
          query(
            collection( db, 'documents' ),
            where( 'projectId', 'in', chunk ),
            where( 'type', '==', 'errorReport' ),
          ),
        ),
      ),
    )
    : []
  const errorReportDocs: ErrorReportDoc[] = errorReportSnapshots
    .flatMap( ( snapshot ) => snapshot.docs )
    .map( ( snapshot ) => {
      const data = snapshot.data()
      return {
        id: snapshot.id,
        projectId: ( data.projectId as string | undefined ) ?? '',
        baseVersionId: ( data.baseVersionId as string | undefined ) ?? '',
        createdAt: toTimestampDate( data.createdAt ),
      }
    } )
  const acceptedErrorReports = needsAcceptedReport
    ? await Promise.all(
      errorReportDocs.map( async ( report ) => {
        const latestSnapshot = await getDocs(
          query(
            collection( db, 'versions' ),
            where( 'projectId', '==', report.projectId ),
            where( 'docId', '==', report.id ),
            orderBy( 'number', 'desc' ),
            limit( 1 ),
          ),
        )
        const latestDoc = latestSnapshot.docs[0]
        const status = ( latestDoc?.data()?.status as string | undefined ) ?? ''
        const acceptedAt = toTimestampDate( latestDoc?.data()?.updatedAt ) ?? toTimestampDate( latestDoc?.data()?.createdAt )
        return status === 'Accepted' ? { ...report, acceptedAt } : null
      } ),
    )
    : []
  const acceptedReports = acceptedErrorReports.filter( Boolean ) as Array<ErrorReportDoc>
  const acceptedReportVersionIds = Array.from(
    new Set(
      acceptedReports.map( ( report ) => ( report.baseVersionId as string | undefined ) ?? '' ).filter( Boolean ),
    ),
  )
  const acceptedReportAcceptedAtByVersionId = acceptedReports.reduce<Record<string, Date | null>>( ( acc, report ) => {
    const versionId = report.baseVersionId
    if( !versionId ) {
      return acc
    }
    const acceptedAt = report.acceptedAt ?? null
    const current = acc[versionId]
    if( !current ) {
      acc[versionId] = acceptedAt
      return acc
    }
    if( acceptedAt && acceptedAt.getTime() < current.getTime() ) {
      acc[versionId] = acceptedAt
    }
    return acc
  }, {} )
  const acceptedVersionDocs = needsAcceptedReport
    ? await Promise.all(
      acceptedReportVersionIds.map( ( versionId ) => getDoc( doc( db, 'versions', versionId ) ) ),
    )
    : []
  acceptedVersionDocs
    .filter( ( snapshot ) => snapshot.exists() )
    .forEach( ( docSnap ) => {
      versionById[docSnap.id] = toVersionRecord( docSnap )
    } )
  const latestVersionIdByDocId: Record<string, string> = {}
  if( needsAcceptedReport ) {
    const acceptedDocPairs = Array.from(
      new Map(
        Object.values( versionById )
          .filter( ( version ) => Boolean( version.projectId && version.docId ) )
          .map( ( version ) => [ version.docId, { projectId: version.projectId, docId: version.docId } ] ),
      ).values(),
    )
    const latestSnapshots = await Promise.all(
      acceptedDocPairs.map( ( pair ) =>
        getDocs(
          query(
            collection( db, 'versions' ),
            where( 'projectId', '==', pair.projectId ),
            where( 'docId', '==', pair.docId ),
            orderBy( 'number', 'desc' ),
            limit( 1 ),
          ),
        ),
      ),
    )
    latestSnapshots.forEach( ( snapshot ) => {
      const latestDoc = snapshot.docs[0]
      const latestData = latestDoc?.data()
      const latestDocId = ( latestData?.docId as string | undefined ) ?? ''
      if( latestDocId && latestDoc?.id ) {
        latestVersionIdByDocId[latestDocId] = latestDoc.id
      }
    } )
  }

  const documentIds = new Set<string>()
  const pushDocId = (docId?: string) => {
    if( docId ) {
      documentIds.add( docId )
    }
  }
  if( needsAuthoring ) {
    authoringVersions.forEach( ( version ) => pushDocId( version.docId as string | undefined ) )
  }
  if( needsReviewer ) {
    reviewerVersions.forEach( ( version ) => pushDocId( version.docId as string | undefined ) )
  }
  if( needsAcceptedReport ) {
    Object.values( versionById ).forEach( ( version ) => pushDocId( version.docId ) )
  }
  if( needsReply ) {
    replyThreadById.forEach( ( thread ) => pushDocId( thread.docId ) )
  }

  reportProgress( 5, 'Loading document labels...' )
  const documentSnapshots = await Promise.all(
    Array.from( documentIds ).map( ( docId ) => safeGetDoc( `documents/${docId}` ) ),
  )
  const documentById = documentSnapshots.reduce<Record<string, { title: string; shortId: number | null }>>(
    ( acc, snapshot ) => {
      if( snapshot?.exists() ) {
        const data = snapshot.data()
        acc[snapshot.id] = {
          title: ( data.title as string | undefined ) ?? 'Untitled document',
          shortId: Number.isFinite( data.shortId ) ? Number( data.shortId ) : null,
        }
      }
      return acc
    },
    {},
  )

  const formatDocumentLabel = (docId: string) => {
    const entry = documentById[docId]
    const shortId = entry?.shortId ?? 'Unassigned'
    const title = entry?.title ?? 'Unknown document'
    return `${shortId} - ${title}`
  }

  const nextTasks: DashboardTask[] = []
  reportProgress( 6, 'Building dashboard tasks...' )

  if( needsAuthoring ) {
    authoringVersions.forEach( ( version ) => {
      const projectId = version.projectId
      if( !projectId ) {
        return
      }
      const docId = version.docId
      const fileNote = version.hasFile
        ? 'Draft uploaded. Start review when ready'
        : 'Upload the draft to start review'
      nextTasks.push( {
        id: `authoring-${version.id}`,
        type: 'authoring',
        visualState: 'inCreation',
        title: formatDocumentLabel( docId ),
        detail: `${projectNameById[projectId] ?? 'Project'} - ${fileNote} (Version ${versionNumberToString( version.number )})`,
        projectId,
        link: appendQueryParam(
          `/documents/${docId}/versions?projectId=${projectId}`,
          'focus',
          'file',
        ),
        createdAt: version.createdAt ?? null,
      } )
    } )
  }

  if( needsReviewer ) {
    reviewerVersions.forEach( ( version ) => {
      if( userCommentedVersionIds.has( version.id ) ) {
        return
      }
      const hasActionableReviewWindow =
        version.status === 'In Review' &&
        (
          !version.reviewEndAt ||
          version.reviewEndAt.getTime() > nowMs ||
          ( openThreadsByVersionId[version.id] ?? [] ).some( ( thread ) =>
            isReviewWindowActionable( version, thread, nowMs ),
          )
        )
      const lifecycleState: 'active' | 'expired' = hasActionableReviewWindow ? 'active' : 'expired'
      const reviewPeriodState =
        hasActionableReviewWindow && version.reviewEndAt && version.reviewEndAt.getTime() <= nowMs
          ? 'grace'
          : hasActionableReviewWindow
            ? 'active'
            : undefined
      if( lifecycleState === 'expired' && version.status !== 'In Review' && version.status !== 'Reviewed' ) {
        return
      }
      const projectId = version.projectId
      if( !projectId ) {
        return
      }
      const docId = version.docId
      nextTasks.push( {
        id: `reviewer-${version.id}`,
        type: 'reviewer',
        lifecycleState,
        visualState:
          lifecycleState === 'expired'
            ? 'reviewExpired'
            : reviewPeriodState === 'grace'
              ? 'reviewGrace'
              : 'reviewActive',
        title: formatDocumentLabel( docId ),
        detail:
          lifecycleState === 'expired'
            ? `${projectNameById[projectId] ?? 'Project'} - Review period closed before your first comment (Version ${versionNumberToString( version.number )})`
            : `${projectNameById[projectId] ?? 'Project'} - Review and add your first comment${reviewPeriodState === 'grace' ? ' (grace period)' : ''} (Version ${versionNumberToString( version.number )})`,
        projectId,
        link: appendQueryParam(
          `/documents/${docId}/versions?projectId=${projectId}&versionId=${version.id}`,
          'focus',
          'issues',
        ),
        createdAt: version.reviewStartAt ?? version.updatedAt ?? version.createdAt ?? null,
        reviewEndAt: version.reviewEndAt ?? null,
        reviewPeriodState,
      } )
    } )
  }

  if( needsReply ) {
    repliedThreadTasks.forEach( ( threadTask ) => {
      const thread = replyThreadById.get( threadTask.threadId )
      if( !thread ) {
        return
      }
      const version = reviewAccessVersionById[threadTask.versionId]
      const projectId = thread.projectId || version?.projectId || ''
      if( !projectId ) {
        return
      }
      const docId = thread.docId || version?.docId || ''
      if( !docId ) {
        return
      }
      nextTasks.push( {
        id: `reply-${threadTask.threadId}`,
        type: 'reply',
        lifecycleState: threadTask.lifecycleState,
        visualState:
          threadTask.lifecycleState === 'expired'
            ? 'reviewExpired'
            : version?.reviewEndAt && version.reviewEndAt.getTime() <= nowMs
              ? 'reviewGrace'
              : 'reviewActive',
        title: formatDocumentLabel( docId ),
        detail:
          threadTask.lifecycleState === 'expired'
            ? `${projectNameById[projectId] ?? 'Project'} - Reply window closed before your response`
            : `${projectNameById[projectId] ?? 'Project'} - Reply to the latest thread response`,
        projectId,
        link: appendQueryParam(
          `/documents/${docId}/versions?projectId=${projectId}&versionId=${threadTask.versionId}&threadId=${threadTask.threadId}`,
          'focus',
          'comments',
        ),
        createdAt: thread.createdAt ?? null,
      } )
    } )
  }

  if( needsAcceptedReport ) {
    acceptedReportVersionIds.forEach( ( versionId ) => {
      const version = versionById[versionId]
      if( !version || version.status !== 'Accepted' ) {
        return
      }
      const latestVersionId = latestVersionIdByDocId[version.docId]
      if( latestVersionId && latestVersionId !== version.id ) {
        return
      }
      const projectId = version.projectId
      if( !projectId ) {
        return
      }
      const role = projectRoleById[projectId] ?? ''
      if( role !== 'leader' && version.createdBy !== userId ) {
        return
      }
      const docId = version.docId
      nextTasks.push( {
        id: `accepted-report-${versionId}`,
        type: 'acceptedReport',
        visualState: 'accepted',
        title: formatDocumentLabel( docId ),
        detail: `${projectNameById[projectId] ?? 'Project'} - Review accepted error reports (Version ${versionNumberToString( version.number )})`,
        projectId,
        link: docId
          ? appendQueryParam(
            `/documents/${docId}/versions?projectId=${projectId}`,
            'focus',
            'actions',
          )
          : `/projects/${projectId}/documents`,
        createdAt: acceptedReportAcceptedAtByVersionId[versionId] ?? version.updatedAt ?? version.createdAt ?? null,
      } )
    } )
  }

  return nextTasks
}

export const refreshDashboard = async (
  userId: string,
  options: RefreshDashboardOptions = {},
): Promise<DashboardTask[]> => {
  const injectedFault = consumeInjectedTestFault( 'dashboard.refresh', userId )
  if( injectedFault ) {
    throw injectedFault
  }
  const dashboardRef = doc( db, 'dashboard', userId )
  const [ existingSnapshot, storedTaskSnapshots ] = await Promise.all( [
    getDoc( dashboardRef ),
    getDocs( collection( dashboardRef, 'tasks' ) ),
  ] )
  const existingData = existingSnapshot.exists() ? existingSnapshot.data() : {}
  const storageVersion = Number( existingData.storageVersion ?? 1 )
  const storedTasks = storedTaskSnapshots.docs.map( ( snapshot ) =>
    deserializeDashboardTask( snapshot.id, snapshot.data() as Record<string, unknown> ),
  )
  const previousTasksSource = storageVersion >= DASHBOARD_STORAGE_VERSION
    ? storedTasks
    : ( ( existingData.tasks as DashboardTask[] | undefined ) ?? [] ).map( ( task ) =>
      deserializeDashboardTask( task.id, task as unknown as Record<string, unknown> ),
    )
  const previousTasks = previousTasksSource.map( ( task ) => ( { ...task } ) )
  const previousTaskIds = new Set( previousTasks.map( ( task ) => task.id ) )

  const refreshedTypes = options.types && options.types.length > 0
    ? Array.from( new Set( options.types ) )
    : null
  const refreshedTypeSet = refreshedTypes ? new Set( refreshedTypes ) : null
  const refreshedTasks = await buildDashboardTasks(
    userId,
    {
      ...( refreshedTypes ? { types: refreshedTypes } : {} ),
      onProgress: options.onProgress,
    },
  ).then( ( tasks ) => tasks.map( ( task ) => pruneUndefinedFields( { ...task } ) ) )
  const untouchedTasks = refreshedTypeSet
    ? previousTasks.filter( ( task ) => !refreshedTypeSet.has( task.type ) )
    : []
  const nextTasks = refreshedTypeSet
    ? [ ...untouchedTasks, ...refreshedTasks ]
    : refreshedTasks
  const nextTaskIds = new Set( nextTasks.map( ( task ) => task.id ) )
  const taskIdsToDelete = Array.from( previousTaskIds ).filter( ( taskId ) => !nextTaskIds.has( taskId ) )
  const tasksToUpsert = refreshedTypeSet
    ? nextTasks.filter( ( task ) => refreshedTypeSet.has( task.type ) )
    : nextTasks

  await writeDashboardTaskDocuments( userId, tasksToUpsert, taskIdsToDelete )

  await setDoc(
    dashboardRef,
    {
      userId,
      storageVersion: DASHBOARD_STORAGE_VERSION,
      taskCount: nextTasks.length,
      taskCountsByType: countTasksByType( nextTasks ),
      expiredTaskCount: nextTasks.filter( ( task ) => task.lifecycleState === 'expired' ).length,
      updatedAt: serverTimestamp(),
      updatedBy: userId,
      tasks: deleteField(),
      completedTaskNotes: deleteField(),
    },
    { merge: true },
  )
  void logAudit( {
    actorId: userId,
    action: 'refreshDashboard',
    entityType: 'dashboard',
    entityId: userId,
  } ).catch( ( err ) => {
    console.warn( 'Dashboard audit log failed:', err )
  } )
  return nextTasks
}
