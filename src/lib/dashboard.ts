import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import type { QueryConstraint } from 'firebase/firestore'
import { versionNumberToString } from '../domain/types'
import { logAudit } from './audit'
import { db } from './firebase'

export type DashboardTask = {
  id: string
  type: 'authoring' | 'reply' | 'reviewer' | 'acceptedReport'
  title: string
  detail: string
  projectId: string
  link: string
  createdAt?: Date | null
}

export type DashboardTaskType = DashboardTask['type']
export type DashboardRefreshScope = 'all' | DashboardTaskType

type BuildDashboardTasksOptions = {
  types?: DashboardTaskType[]
}

type RefreshDashboardOptions = {
  types?: DashboardTaskType[]
}

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

const toVersionRecord = (snapshot: { id: string; data: () => Record<string, unknown> }): VersionRecord => {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    projectId: ( data.projectId as string | undefined ) ?? '',
    docId: ( data.docId as string | undefined ) ?? '',
    number: Number( data.number ?? 0 ),
    status: ( data.status as string | undefined ) ?? '',
    createdBy: ( data.createdBy as string | undefined ) ?? '',
    reviewerIds: ( data.reviewerIds as string[] | undefined ) ?? [],
    hasFile: Boolean( data.hasFile ),
    createdAt: toTimestampDate( data.createdAt ),
    updatedAt: toTimestampDate( data.updatedAt ),
    reviewStartAt: toTimestampDate( data.reviewStartAt ),
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

export const buildDashboardTasks = async (
  userId: string,
  options: BuildDashboardTasksOptions = {},
): Promise<DashboardTask[]> => {
  const requestedTypes = options.types && options.types.length > 0
    ? new Set<DashboardTaskType>( options.types )
    : null
  const includesType = (type: DashboardTaskType): boolean =>
    requestedTypes ? requestedTypes.has( type ) : true
  const needsAuthoring = includesType( 'authoring' )
  const needsReviewer = includesType( 'reviewer' )
  const needsReply = includesType( 'reply' )
  const needsAcceptedReport = includesType( 'acceptedReport' )

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
    uniqueProjectIds.map( ( projectId ) => getDoc( doc( db, 'projects', projectId ) ) ),
  )
  const projectNameById = projectDocs.reduce<Record<string, string>>( ( acc, snapshot ) => {
    if( snapshot.exists() ) {
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

  const [ authoringVersions, reviewerVersions ] = await Promise.all( [
    needsAuthoring
      ? fetchVersionsForProjects( [
        where( 'createdBy', '==', userId ),
        where( 'status', '==', 'In Creation' ),
      ] )
      : Promise.resolve( [] ),
    needsReviewer || needsReply
      ? fetchVersionsForProjects( [
        where( 'reviewerIds', 'array-contains', userId ),
        where( 'status', '==', 'In Review' ),
      ] )
      : Promise.resolve( [] ),
  ] )

  const userCommentsSnapshot = needsReviewer || needsReply
    ? await getDocs(
      query(
        collection( db, 'comments' ),
        where( 'createdBy', '==', userId ),
      ),
    )
    : null

  const authorReviewVersions = needsReply
    ? await fetchVersionsForProjects( [
      where( 'createdBy', '==', userId ),
      where( 'status', '==', 'In Review' ),
    ] )
    : []

  const leaderProjectIds = needsReply
    ? projectIds.filter( ( projectId ) => projectRoleById[projectId] === 'leader' )
    : []
  const leaderProjectChunks = chunkArray( leaderProjectIds, 10 ).filter( ( chunk ) => chunk.length > 0 )
  const leaderReviewSnapshots = needsReply
    ? await Promise.all(
      leaderProjectChunks.map( ( chunk ) =>
        getDocs(
          query(
            collection( db, 'versions' ),
            where( 'projectId', 'in', chunk ),
            where( 'status', '==', 'In Review' ),
          ),
        ),
      ),
    )
    : []
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

  const reviewAccessVersions = Array.from(
    new Map(
      [ ...reviewerVersions, ...authorReviewVersions, ...leaderReviewVersions ].map( ( version ) => [
        version.id,
        version,
      ] ),
    ).values(),
  )
  const reviewAccessVersionById = reviewAccessVersions.reduce<Record<string, VersionRecord>>( ( acc, version ) => {
    acc[version.id] = version
    return acc
  }, {} )
  const repliedThreadTasks: ReplyTask[] = []
  const replyThreadById = new Map<string, ThreadRecord>()
  const replyTaskThreadIds = new Set<string>()
  if( needsReply ) {
    try {
      const reviewVersionIdList = Array.from(
        new Set(
          reviewAccessVersions
            .filter( ( version ) => version.status === 'In Review' )
            .map( ( version ) => version.id )
            .filter( Boolean ),
        ),
      )
      const reviewVersionIds = new Set( reviewVersionIdList )
      const threadVersionChunks = chunkArray( reviewVersionIdList, 10 ).filter( ( chunk ) => chunk.length > 0 )
      const threadSnapshots = await Promise.all(
        threadVersionChunks.map( ( chunk ) =>
          getDocs(
            query(
              collection( db, 'threads' ),
              where( 'versionId', 'in', chunk ),
              where( 'status', '==', 'open' ),
            ),
          ),
        ),
      )
      const threads = threadSnapshots
        .flatMap( ( snapshot ) => snapshot.docs )
        .map( toThreadRecord )
        .filter( ( thread ) => reviewVersionIds.has( thread.versionId ) )
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
        if( !latestUserCommentAt && canDetectWithoutParticipation && hasComments ) {
          if( !replyTaskThreadIds.has( thread.id ) ) {
            replyTaskThreadIds.add( thread.id )
            repliedThreadTasks.push( {
              id: thread.id,
              versionId: thread.versionId,
              threadId: thread.id,
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

  const documentSnapshots = await Promise.all(
    Array.from( documentIds ).map( ( docId ) => getDoc( doc( db, 'documents', docId ) ) ),
  )
  const documentById = documentSnapshots.reduce<Record<string, { title: string; shortId: number | null }>>(
    ( acc, snapshot ) => {
      if( snapshot.exists() ) {
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
        title: formatDocumentLabel( docId ),
        detail: `${projectNameById[projectId] ?? 'Project'} - ${fileNote} (Version ${versionNumberToString( version.number )})`,
        projectId,
        link: `/documents/${docId}/versions?projectId=${projectId}`,
        createdAt: version.createdAt ?? null,
      } )
    } )
  }

  if( needsReviewer ) {
    reviewerVersions.forEach( ( version ) => {
      if( userCommentedVersionIds.has( version.id ) ) {
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
        title: formatDocumentLabel( docId ),
        detail: `${projectNameById[projectId] ?? 'Project'} - Review and add your first comment (Version ${versionNumberToString( version.number )})`,
        projectId,
        link: `/documents/${docId}/versions?projectId=${projectId}&versionId=${version.id}`,
        createdAt: version.reviewStartAt ?? version.updatedAt ?? version.createdAt ?? null,
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
        title: formatDocumentLabel( docId ),
        detail: `${projectNameById[projectId] ?? 'Project'} - Reply to the latest thread response`,
        projectId,
        link: `/documents/${docId}/versions?projectId=${projectId}&versionId=${threadTask.versionId}&threadId=${threadTask.threadId}`,
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
        title: formatDocumentLabel( docId ),
        detail: `${projectNameById[projectId] ?? 'Project'} - Review accepted error reports (Version ${versionNumberToString( version.number )})`,
        projectId,
        link: docId
          ? `/documents/${docId}/versions?projectId=${projectId}`
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
  const dashboardRef = doc( db, 'dashboard', userId )
  const existingSnapshot = await getDoc( dashboardRef )
  const existingData = existingSnapshot.exists() ? existingSnapshot.data() : {}
  const previousTasks = ( ( existingData.tasks as DashboardTask[] | undefined ) ?? [] )
    .map( ( task ) => ( { ...task } ) )
  const previousTaskIds = new Set( previousTasks.map( ( task ) => task.id ) )

  const refreshedTypes = options.types && options.types.length > 0
    ? Array.from( new Set( options.types ) )
    : null
  const refreshedTypeSet = refreshedTypes ? new Set( refreshedTypes ) : null
  const refreshedTasks = await buildDashboardTasks(
    userId,
    refreshedTypes ? { types: refreshedTypes } : {},
  ).then( ( tasks ) => tasks.map( ( task ) => ( { ...task } ) ) )
  const untouchedTasks = refreshedTypeSet
    ? previousTasks.filter( ( task ) => !refreshedTypeSet.has( task.type ) )
    : []
  const nextTasks = refreshedTypeSet
    ? [ ...untouchedTasks, ...refreshedTasks ]
    : refreshedTasks
  const nextTaskIds = new Set( nextTasks.map( ( task ) => task.id ) )

  const completedTaskNotes = ( existingData.completedTaskNotes as Record<string, unknown> | undefined ) ?? {}
  const newCompletionNotes: Record<string, unknown> = {}
  previousTaskIds.forEach( ( taskId ) => {
    if( nextTaskIds.has( taskId ) ) {
      return
    }
    if( completedTaskNotes[taskId] ) {
      return
    }
    newCompletionNotes[taskId] = serverTimestamp()
  } )
  const finalCompletionNotes =
    Object.keys( newCompletionNotes ).length > 0
      ? { ...completedTaskNotes, ...newCompletionNotes }
      : completedTaskNotes

  await setDoc(
    dashboardRef,
    {
      userId,
      tasks: nextTasks,
      updatedAt: serverTimestamp(),
      updatedBy: userId,
      completedTaskNotes: finalCompletionNotes,
    },
    { merge: true },
  )
  await logAudit( {
    actorId: userId,
    action: 'refreshDashboard',
    entityType: 'dashboard',
    entityId: userId,
  } )
  return nextTasks
}
