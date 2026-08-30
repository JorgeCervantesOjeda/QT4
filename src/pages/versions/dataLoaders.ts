// One-shot Firestore loaders for document, version, project, member, and accepted-report state.
import type { Dispatch, SetStateAction } from 'react'
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  type QuerySnapshot,
  where,
} from 'firebase/firestore'
import { FIRST_VERSION_NUMBER } from '../../domain/types'
import { db } from '../../lib/firebase'
import { numOfReviewDurationDays } from '../../lib/reviewWindow'
import type {
  AcceptedErrorReportSummary,
  BaseDocumentSummary,
  DocumentSummary,
  ProjectMember,
  VersionSummary,
} from './types'
import {
  areProjectMembersEqual,
  areStringArraysEqual,
  areUserDirectoryEqual,
  areVersionsEqual,
  toTimestampDate,
} from './utils'

type UserDirectory = Record<string, { email?: string | null; displayName?: string | null }>

type LoadDocumentAndVersionsParams = {
  docId: string | undefined
  projectIdFromQuery: string
  versionIdFromQuery: string
  selectedVersionId: string | null
  userId: string
  userEmail?: string | null
  userDisplayName?: string | null
  setError: Dispatch<SetStateAction<string | null>>
  setIsBusy: Dispatch<SetStateAction<boolean>>
  setErrorReportGate: Dispatch<SetStateAction<{ isBlocking: boolean; isLoading: boolean }>>
  setDocumentData: Dispatch<SetStateAction<DocumentSummary | null>>
  setVersions: Dispatch<SetStateAction<VersionSummary[]>>
  setBaseDocumentData: Dispatch<SetStateAction<BaseDocumentSummary | null>>
  setProjectMembers: Dispatch<SetStateAction<ProjectMember[]>>
  setProjectName: Dispatch<SetStateAction<string>>
  setProjectShortId: Dispatch<SetStateAction<number | null>>
  setSelectedReviewerIds: Dispatch<SetStateAction<string[]>>
  setSelectedAuthorId: Dispatch<SetStateAction<string>>
  setSelectedVersionId: Dispatch<SetStateAction<string | null>>
  setUserDirectoryById: Dispatch<SetStateAction<UserDirectory>>
  reportVersionsError: (error: unknown, action: string) => void
}

const loadAcceptedErrorReportsForBaseVersion = async (
  activeProjectId: string,
  baseVersionId: string,
): Promise<AcceptedErrorReportSummary[]> => {
  if( !activeProjectId || !baseVersionId ) {
    return []
  }
  const errorReportsSnapshot = await getDocs(
    query(
      collection( db, 'documents' ),
      where( 'projectId', '==', activeProjectId ),
      where( 'type', '==', 'errorReport' ),
      where( 'baseVersionId', '==', baseVersionId ),
    ),
  )
  if( errorReportsSnapshot.empty ) {
    return []
  }
  const reportSummaries = await Promise.all(
    errorReportsSnapshot.docs.map( async ( reportSnapshot ) => {
      const reportData = reportSnapshot.data()
      const reportVersionSnapshot = await getDocs(
        query(
          collection( db, 'versions' ),
          where( 'projectId', '==', activeProjectId ),
          where( 'docId', '==', reportSnapshot.id ),
          orderBy( 'number', 'desc' ),
          limit( 1 ),
        ),
      )
      const latestVersionSnapshot = reportVersionSnapshot.docs[0]
      const latestVersionData = latestVersionSnapshot?.data()
      const latestVersionStatus = ( latestVersionData?.status as string | undefined ) ?? ''
      if( latestVersionStatus !== 'Accepted' || !latestVersionSnapshot ) {
        return null
      }
      return {
        docId: reportSnapshot.id,
        title: ( reportData.title as string | undefined ) ?? 'Untitled error report',
        shortId: Number.isFinite( reportData.shortId ) ? Number( reportData.shortId ) : null,
        latestVersionId: latestVersionSnapshot.id,
        latestVersionNumber: Number( latestVersionData?.number ?? FIRST_VERSION_NUMBER ),
        acceptedAt: toTimestampDate( latestVersionData?.updatedAt ) ?? toTimestampDate( latestVersionData?.createdAt ),
      }
    } ),
  )
  return reportSummaries
    .filter( Boolean )
    .sort( ( left, right ) => {
      const leftAcceptedAt = left?.acceptedAt?.getTime() ?? 0
      const rightAcceptedAt = right?.acceptedAt?.getTime() ?? 0
      return rightAcceptedAt - leftAcceptedAt
    } ) as AcceptedErrorReportSummary[]
}

const loadDocumentAndVersions = async (params: LoadDocumentAndVersionsParams) => {
  const {
    docId,
    projectIdFromQuery,
    versionIdFromQuery,
    selectedVersionId,
    userId,
    userEmail,
    userDisplayName,
    setError,
    setIsBusy,
    setErrorReportGate,
    setDocumentData,
    setVersions,
    setBaseDocumentData,
    setProjectMembers,
    setProjectName,
    setProjectShortId,
    setSelectedReviewerIds,
    setSelectedAuthorId,
    setSelectedVersionId,
    setUserDirectoryById,
    reportVersionsError,
  } = params
  if( !docId ) {
    return
  }
  let step = 'start'
  setError( null )
  setIsBusy( true )
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
    const loadedBaseProjectId = ( documentRaw.baseProjectId as string | undefined ) ?? null
    const loadedBaseDocId = ( documentRaw.baseDocId as string | undefined ) ?? null
    const loadedBaseVersionId = ( documentRaw.baseVersionId as string | undefined ) ?? null
    const loadedOriginProjectId = ( documentRaw.originProjectId as string | undefined ) ?? null
    const loadedOriginDocumentId = ( documentRaw.originDocumentId as string | undefined ) ?? null
    const loadedOriginVersionId = ( documentRaw.originVersionId as string | undefined ) ?? null
    setDocumentData( {
      id: documentSnapshot.id,
      projectId: loadedProjectId,
      title: ( documentRaw.title as string ) ?? 'Untitled document',
      createdBy: loadedAuthorId,
      authorId: ( documentRaw.authorId as string | undefined ) ?? loadedAuthorId,
      type: loadedType,
      shortId: detectedShortId,
      baseProjectId: loadedBaseProjectId,
      baseDocId: loadedBaseDocId,
      baseVersionId: loadedBaseVersionId,
      originProjectId: loadedOriginProjectId,
      originDocumentId: loadedOriginDocumentId,
      originVersionId: loadedOriginVersionId,
      incorporatedChangeRequestVersionIds:
        ( documentRaw.incorporatedChangeRequestVersionIds as string[] | undefined ) ?? [],
    } )
    if( loadedType === 'errorReport' && ( !loadedBaseDocId || !loadedBaseVersionId ) ) {
      setVersions( [] )
      setBaseDocumentData( null )
      setError( 'Invalid error report data: baseDocId and baseVersionId are required.' )
      return
    }
    if(
      loadedType === 'changeRequest' &&
      ( !loadedBaseProjectId || !loadedBaseDocId || !loadedBaseVersionId || loadedBaseProjectId === loadedProjectId )
    ) {
      setVersions( [] )
      setBaseDocumentData( null )
      setError( 'Invalid change request data: baseProjectId, baseDocId and baseVersionId from another project are required.' )
      return
    }
    if(
      loadedType === 'derivedDocument' &&
      ( !loadedOriginProjectId || !loadedOriginDocumentId || !loadedOriginVersionId || loadedOriginProjectId === loadedProjectId )
    ) {
      setVersions( [] )
      setBaseDocumentData( null )
      setError( 'Invalid derived document data: originProjectId, originDocumentId and originVersionId from another project are required.' )
      return
    }
    const referenceProjectId = loadedBaseProjectId ?? loadedOriginProjectId
    const referenceDocId = loadedBaseDocId ?? loadedOriginDocumentId
    const referenceVersionId = loadedBaseVersionId ?? loadedOriginVersionId

    step = 'versions-members'
    const [ versionsSnapshot, membersSnapshot, projectSnapshot, baseDocumentSnapshot, baseProjectSnapshot ] = await Promise.all( [
      getDocs(
        query(
          collection( db, 'versions' ),
          where( 'projectId', '==', loadedProjectId ),
          where( 'docId', '==', docId ),
          orderBy( 'number', 'desc' ),
        ),
      ),
      getDocs( query( collection( db, 'projectMembers' ), where( 'projectId', '==', loadedProjectId ) ) ),
      loadedProjectId ? getDocFromServer( doc( db, 'projects', loadedProjectId ) ) : Promise.resolve( null ),
      referenceDocId ? getDocFromServer( doc( db, 'documents', referenceDocId ) ) : Promise.resolve( null ),
      referenceProjectId ? getDocFromServer( doc( db, 'projects', referenceProjectId ) ) : Promise.resolve( null ),
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
        createdAt: toTimestampDate( data.createdAt ),
        activityAt: toTimestampDate( data.activityAt ) ?? toTimestampDate( data.updatedAt ),
        reviewerIds: ( data.reviewerIds as string[] | undefined ) ?? [],
        reviewStartAt: toTimestampDate( data.reviewStartAt ),
        reviewEndAt: toTimestampDate( data.reviewEndAt ),
        reviewDurationDays: numOfReviewDurationDays( data.reviewDurationDays ),
        hasFile: Boolean( data.hasFile ),
        fileRefId: ( data.fileRefId as string | null | undefined ) ?? null,
        numThreads: Number( stats.numThreads ?? data.numThreads ?? 0 ),
        numOpenThreads: Number( stats.numOpenThreads ?? data.numOpenThreads ?? 0 ),
        numComments: Number( stats.numComments ?? data.numComments ?? 0 ),
        numThreadsWithTwoPlusComments: Number(
          stats.numThreadsWithTwoPlusComments ?? data.numThreadsWithTwoPlusComments ?? 0,
        ),
        acceptedErrorReportId: ( data.acceptedErrorReportId as string | null | undefined ) ?? null,
      }
    } )
    setVersions( ( previous ) => ( areVersionsEqual( previous, nextVersions ) ? previous : nextVersions ) )

    const members = membersSnapshot.docs.map( ( memberSnapshot ) => {
      const data = memberSnapshot.data()
      return {
        userId: ( data.userId as string ) ?? '',
        role: ( data.role as string ) ?? '',
        email: ( data.email as string | null | undefined ) ?? null,
      }
    } )
    setProjectMembers( ( previous ) => ( areProjectMembersEqual( previous, members ) ? previous : members ) )
    updateProjectSummary( projectSnapshot, setProjectName, setProjectShortId )
    await updateBaseDocumentSummary(
      referenceProjectId,
      referenceVersionId,
      baseDocumentSnapshot,
      baseProjectSnapshot,
      setBaseDocumentData,
    )
    updateSelectedVersionState( {
      members,
      nextVersions,
      selectedVersionId,
      versionIdFromQuery,
      setSelectedReviewerIds,
      setSelectedAuthorId,
      setSelectedVersionId,
    } )

    step = 'user-directory'
    const nextDirectoryById = await loadUserDirectory( {
      members,
      loadedAuthorId,
      nextVersions,
      userId,
      userEmail,
      userDisplayName,
    } )
    setUserDirectoryById( ( previous ) =>
      areUserDirectoryEqual( previous, nextDirectoryById ) ? previous : nextDirectoryById,
    )
    step = 'access'
  } catch( err ) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    console.error( `Versions loadDocumentAndVersions failed at ${step}:`, err )
    reportVersionsError( err, `versions.loadDocumentAndVersions.${step}` )
    setError( `Versions failed at ${step}: ${message}` )
  } finally {
    setIsBusy( false )
  }
}

const updateProjectSummary = (
  projectSnapshot: Awaited<ReturnType<typeof getDocFromServer>> | null,
  setProjectName: Dispatch<SetStateAction<string>>,
  setProjectShortId: Dispatch<SetStateAction<number | null>>,
) => {
  if( projectSnapshot && projectSnapshot.exists() ) {
    const projectData = projectSnapshot.data() as Record<string, unknown>
    setProjectName( ( projectData?.name as string | undefined ) ?? '' )
    setProjectShortId( Number.isFinite( projectData?.shortId ) ? Number( projectData?.shortId ) : null )
    return
  }
  setProjectName( '' )
  setProjectShortId( null )
}

const updateBaseDocumentSummary = async (
  baseProjectId: string | null,
  baseVersionId: string | null,
  baseDocumentSnapshot: Awaited<ReturnType<typeof getDocFromServer>> | null,
  baseProjectSnapshot: Awaited<ReturnType<typeof getDocFromServer>> | null,
  setBaseDocumentData: Dispatch<SetStateAction<BaseDocumentSummary | null>>,
) => {
  const baseProjectData = baseProjectSnapshot?.exists()
    ? baseProjectSnapshot.data() as Record<string, unknown>
    : null
  const baseProjectShortId = Number.isFinite( baseProjectData?.shortId )
    ? Number( baseProjectData?.shortId )
    : null
  if( !baseVersionId ) {
    if( baseDocumentSnapshot && baseDocumentSnapshot.exists() ) {
      const baseData = baseDocumentSnapshot.data() as Record<string, unknown>
      setBaseDocumentData( {
        id: baseDocumentSnapshot.id,
        projectId: ( baseData?.projectId as string | undefined ) ?? baseProjectId ?? '',
        projectShortId: baseProjectShortId,
        title: ( baseData?.title as string | undefined ) ?? 'Untitled document',
        shortId: Number.isFinite( baseData?.shortId ) ? Number( baseData?.shortId ) : null,
        versionId: null,
        versionNumber: null,
        versionStatus: null,
        hasFile: false,
        fileRefId: null,
      } )
      return
    }
    setBaseDocumentData( null )
    return
  }
  try {
    const baseVersionSnapshot = await getDocFromServer( doc( db, 'versions', baseVersionId ) )
    const baseVersionData = baseVersionSnapshot.exists()
      ? baseVersionSnapshot.data() as Record<string, unknown>
      : {}
    const resolvedBaseDocId = baseVersionSnapshot.exists()
      ? ( baseVersionData.docId as string | undefined ) ?? ''
      : baseDocumentSnapshot?.id ?? ''
    if( !resolvedBaseDocId ) {
      setBaseDocumentData( null )
      return
    }
    const baseDocSnapshot = baseDocumentSnapshot?.exists()
      ? baseDocumentSnapshot
      : await getDocFromServer( doc( db, 'documents', resolvedBaseDocId ) )
    if( !baseDocSnapshot.exists() ) {
      setBaseDocumentData( null )
      return
    }
    const baseDocData = baseDocSnapshot.data() as Record<string, unknown>
    setBaseDocumentData( {
      id: baseDocSnapshot.id,
      projectId: ( baseDocData?.projectId as string | undefined ) ?? ( baseVersionData.projectId as string | undefined ) ?? baseProjectId ?? '',
      projectShortId: baseProjectShortId,
      title: ( baseDocData?.title as string | undefined ) ?? 'Untitled document',
      shortId: Number.isFinite( baseDocData?.shortId ) ? Number( baseDocData?.shortId ) : null,
      versionId: baseVersionSnapshot.exists() ? baseVersionSnapshot.id : baseVersionId,
      versionNumber: baseVersionSnapshot.exists() ? Number( baseVersionData.number ?? FIRST_VERSION_NUMBER ) : null,
      versionStatus: baseVersionSnapshot.exists() ? ( baseVersionData.status as string | undefined ) ?? null : null,
      hasFile: Boolean( baseVersionData.hasFile ),
      fileRefId: ( baseVersionData.fileRefId as string | null | undefined ) ?? null,
    } )
  } catch( err ) {
    console.warn( 'Base document summary fallback failed:', {
      baseProjectId,
      baseVersionId,
      error: err instanceof Error ? err.message : String( err ),
    } )
    setBaseDocumentData( null )
  }
}

const updateSelectedVersionState = (value: {
  members: ProjectMember[]
  nextVersions: VersionSummary[]
  selectedVersionId: string | null
  versionIdFromQuery: string
  setSelectedReviewerIds: Dispatch<SetStateAction<string[]>>
  setSelectedAuthorId: Dispatch<SetStateAction<string>>
  setSelectedVersionId: Dispatch<SetStateAction<string | null>>
}) => {
  const allowedMemberIds = value.members.map( ( member ) => member.userId ).filter( Boolean )
  const activeVersion =
    ( value.selectedVersionId
      ? value.nextVersions.find( ( version ) => version.id === value.selectedVersionId ) || null
      : null ) ??
    ( value.versionIdFromQuery
      ? value.nextVersions.find( ( version ) => version.id === value.versionIdFromQuery ) || null
      : null ) ?? value.nextVersions[0] ?? null
  const latestCreatedBy = activeVersion?.createdBy ?? ''
  const nextReviewerIds = ( activeVersion?.reviewerIds ?? [] ).filter( ( reviewerId ) =>
    allowedMemberIds.includes( reviewerId ) && reviewerId !== latestCreatedBy,
  )
  value.setSelectedReviewerIds( ( previous ) =>
    areStringArraysEqual( previous, nextReviewerIds ) ? previous : nextReviewerIds,
  )
  value.setSelectedAuthorId( ( previous ) => ( previous === latestCreatedBy ? previous : latestCreatedBy ) )
  value.setSelectedVersionId( ( previous ) =>
    previous === ( activeVersion?.id ?? null ) ? previous : activeVersion?.id ?? null,
  )
}

const loadUserDirectory = async (value: {
  members: ProjectMember[]
  loadedAuthorId: string
  nextVersions: VersionSummary[]
  userId: string
  userEmail?: string | null
  userDisplayName?: string | null
}) => {
  const directoryCandidates = new Set<string>()
  value.members.forEach( ( member ) => {
    if( member.userId ) {
      directoryCandidates.add( member.userId )
    }
  } )
  if( value.loadedAuthorId ) {
    directoryCandidates.add( value.loadedAuthorId )
  }
  value.nextVersions.forEach( ( versionItem ) => {
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
  const nextDirectoryById: UserDirectory = {}
  value.members.forEach( ( member ) => {
    if( member.userId && member.email ) {
      nextDirectoryById[member.userId] = { email: member.email, displayName: null }
    }
  } )
  const chunks: string[][] = []
  for( let index = 0; index < candidateList.length; index += 10 ) {
    chunks.push( candidateList.slice( index, index + 10 ) )
  }
  let directorySnapshots: QuerySnapshot[] = []
  try {
    directorySnapshots = await Promise.all(
      chunks.map( ( chunk ) => getDocs( query( collection( db, 'userDirectory' ), where( 'userId', 'in', chunk ) ) ) ),
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
  if( value.userId ) {
    const existing = nextDirectoryById[value.userId] ?? {}
    nextDirectoryById[value.userId] = {
      email: value.userEmail ?? existing.email ?? null,
      displayName: value.userDisplayName ?? existing.displayName ?? null,
    }
  }
  await fillMissingProfiles( candidateList, nextDirectoryById )
  return nextDirectoryById
}

const fillMissingProfiles = async (candidateList: string[], nextDirectoryById: UserDirectory) => {
  const missingProfileIds = candidateList.filter( ( memberUserId ) => {
    if( !memberUserId ) {
      return false
    }
    const entry = nextDirectoryById[memberUserId]
    return !( entry?.displayName || entry?.email )
  } )
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

export {
  loadAcceptedErrorReportsForBaseVersion,
  loadDocumentAndVersions,
}
