// Firestore subscriptions and sync helpers for project metadata, version lists, and selected-version routing.
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { FIRST_VERSION_NUMBER } from '../../domain/types'
import { db } from '../../lib/firebase'
import type { ProjectMember, VersionSummary } from './types'
import {
  areProjectMembersEqual,
  areStringArraysEqual,
  areUserDirectoryEqual,
  areVersionsEqual,
  toTimestampDate,
} from './utils'

type UserDirectory = Record<string, { email?: string | null; displayName?: string | null }>

type ReportVersionsError = (
  error: unknown,
  action: string,
  source?: 'firestore' | 'storage' | 'auth' | 'ui' | 'network' | 'unknown',
) => void

const useVersionsProjectSubscription = (params: {
  docId?: string
  activeProjectId: string
  reportVersionsError: ReportVersionsError
  setError: Dispatch<SetStateAction<string | null>>
  setIsLoadingVersions: Dispatch<SetStateAction<boolean>>
  setVersions: Dispatch<SetStateAction<VersionSummary[]>>
  setProjectMembers: Dispatch<SetStateAction<ProjectMember[]>>
  setProjectName: Dispatch<SetStateAction<string>>
  setProjectShortId: Dispatch<SetStateAction<number | null>>
}) => {
  const {
    docId,
    activeProjectId,
    reportVersionsError,
    setError,
    setIsLoadingVersions,
    setVersions,
    setProjectMembers,
    setProjectName,
    setProjectShortId,
  } = params

  useEffect( () => {
    if( !docId || !activeProjectId ) {
      return
    }
    setIsLoadingVersions( true )
    const versionsUnsub = onSnapshot(
      query(
        collection( db, 'versions' ),
        where( 'projectId', '==', activeProjectId ),
        where( 'docId', '==', docId ),
        orderBy( 'number', 'desc' ),
      ),
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
            numThreadsWithTwoPlusComments: Number(
              stats.numThreadsWithTwoPlusComments ?? data.numThreadsWithTwoPlusComments ?? 0,
            ),
            acceptedErrorReportId: ( data.acceptedErrorReportId as string | null | undefined ) ?? null,
          }
        } )
        setVersions( ( previous ) => ( areVersionsEqual( previous, nextVersions ) ? previous : nextVersions ) )
        setIsLoadingVersions( false )
      },
      ( err ) => {
        const message = err instanceof Error ? err.message : 'Unexpected error'
        reportVersionsError( err, 'versions.subscribeVersions', 'firestore' )
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
  }, [
    docId,
    activeProjectId,
    reportVersionsError,
    setError,
    setIsLoadingVersions,
    setVersions,
    setProjectMembers,
    setProjectName,
    setProjectShortId,
  ] )
}

const useUserDirectoryRefresh = (params: {
  projectMembers: ProjectMember[]
  versions: VersionSummary[]
  userId: string
  userEmail?: string | null
  userDisplayName?: string | null
  setUserDirectoryById: Dispatch<SetStateAction<UserDirectory>>
}) => {
  const {
    projectMembers,
    versions,
    userId,
    userEmail,
    userDisplayName,
    setUserDirectoryById,
  } = params

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
    void loadDirectory( {
      candidateList,
      projectMembers,
      userId,
      userEmail,
      userDisplayName,
      setUserDirectoryById,
      isActive: () => isActive,
    } )
    return () => {
      isActive = false
    }
  }, [ projectMembers, versions, userId, userEmail, userDisplayName, setUserDirectoryById ] )
}

const useSelectedVersionSync = (params: {
  versions: VersionSummary[]
  selectedVersionId: string | null
  versionIdFromQuery: string
  projectMembers: ProjectMember[]
  lastAppliedVersionQueryRef: MutableRefObject<string | null>
  setSelectedReviewerIds: Dispatch<SetStateAction<string[]>>
  setSelectedAuthorId: Dispatch<SetStateAction<string>>
  setSelectedVersionId: Dispatch<SetStateAction<string | null>>
}) => {
  const {
    versions,
    selectedVersionId,
    versionIdFromQuery,
    projectMembers,
    lastAppliedVersionQueryRef,
    setSelectedReviewerIds,
    setSelectedAuthorId,
    setSelectedVersionId,
  } = params

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
    const activeVersion = queryVersion ?? selectedVersionFromState ?? versions[0] ?? null
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
  }, [
    versions,
    selectedVersionId,
    versionIdFromQuery,
    projectMembers,
    lastAppliedVersionQueryRef,
    setSelectedReviewerIds,
    setSelectedAuthorId,
    setSelectedVersionId,
  ] )
}

const loadDirectory = async (params: {
  candidateList: string[]
  projectMembers: ProjectMember[]
  userId: string
  userEmail?: string | null
  userDisplayName?: string | null
  setUserDirectoryById: Dispatch<SetStateAction<UserDirectory>>
  isActive: () => boolean
}) => {
  const nextDirectoryById: UserDirectory = {}
  params.projectMembers.forEach( ( member ) => {
    if( member.userId && member.email ) {
      nextDirectoryById[member.userId] = { email: member.email, displayName: null }
    }
  } )
  const chunks: string[][] = []
  for( let index = 0; index < params.candidateList.length; index += 10 ) {
    chunks.push( params.candidateList.slice( index, index + 10 ) )
  }
  try {
    const directorySnapshots = await Promise.all(
      chunks.map( ( chunk ) => getDocs( query( collection( db, 'userDirectory' ), where( 'userId', 'in', chunk ) ) ) ),
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
  if( params.userId ) {
    const existing = nextDirectoryById[params.userId] ?? {}
    nextDirectoryById[params.userId] = {
      email: params.userEmail ?? existing.email ?? null,
      displayName: params.userDisplayName ?? existing.displayName ?? null,
    }
  }
  await fillMissingProfiles( params.candidateList, nextDirectoryById )
  if( params.isActive() ) {
    params.setUserDirectoryById( ( previous ) =>
      areUserDirectoryEqual( previous, nextDirectoryById ) ? previous : nextDirectoryById,
    )
  }
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
  useSelectedVersionSync,
  useUserDirectoryRefresh,
  useVersionsProjectSubscription,
}
