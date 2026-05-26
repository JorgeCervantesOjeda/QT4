// Firestore subscriptions for role, issue, and comment updates tied to the selected version.
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { trackFirestoreListener } from '../../lib/diagnostics/firestoreListeners'
import { db } from '../../lib/firebase'
import type { CommentSummary, ThreadSummary } from './types'
import {
  areCommentsByThreadEqual,
  areThreadsEqual,
  isIndexBuildingFirestoreError,
  toTimestampDate,
} from './utils'

type ReportVersionsError = (
  error: unknown,
  action: string,
  source?: 'firestore' | 'storage' | 'auth' | 'ui' | 'network' | 'unknown',
) => void

const useRoleSubscriptions = (params: {
  docId?: string
  userId: string
  activeProjectId: string
  setIsAdmin: Dispatch<SetStateAction<boolean>>
  setIsLeader: Dispatch<SetStateAction<boolean>>
}) => {
  const {
    docId,
    userId,
    activeProjectId,
    setIsAdmin,
    setIsLeader,
  } = params

  useEffect( () => {
    if( !userId ) {
      setIsAdmin( false )
      return
    }
    const listener = trackFirestoreListener( {
      label: 'versions.userProfile',
      documentId: docId ?? '',
      queryDescription: `userProfiles/${userId}`,
    } )
    const unsubscribe = onSnapshot(
      doc( db, 'userProfiles', userId ),
      ( snapshot ) => {
        listener.recordSnapshot( {
          exists: snapshot.exists(),
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
        } )
        const data = snapshot.data()
        setIsAdmin( Boolean( data?.isAdmin ) )
      },
      ( err ) => {
        listener.recordError( err )
        setIsAdmin( false )
      },
    )
    return () => {
      listener.dispose()
      unsubscribe()
    }
  }, [ docId, userId, setIsAdmin ] )

  useEffect( () => {
    if( !userId || !activeProjectId ) {
      setIsLeader( false )
      return
    }
    const listener = trackFirestoreListener( {
      label: 'versions.projectMemberRole',
      projectId: activeProjectId,
      documentId: docId ?? '',
      queryDescription: `projectMembers/${activeProjectId}_${userId}`,
    } )
    const unsubscribe = onSnapshot(
      doc( db, 'projectMembers', `${activeProjectId}_${userId}` ),
      ( snapshot ) => {
        listener.recordSnapshot( {
          exists: snapshot.exists(),
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
        } )
        const role = ( snapshot.data()?.role as string | undefined ) ?? ''
        setIsLeader( role === 'leader' )
      },
      ( err ) => {
        listener.recordError( err )
        setIsLeader( false )
      },
    )
    return () => {
      listener.dispose()
      unsubscribe()
    }
  }, [ docId, userId, activeProjectId, setIsLeader ] )
}

const useThreadsAndCommentsSubscription = (params: {
  selectedVersionId?: string
  projectId: string
  docId?: string
  threadIdFromQuery: string
  commentsRetryToken: number
  commentsRetryTimeoutRef: MutableRefObject<number | null>
  reportVersionsErrorRef: MutableRefObject<ReportVersionsError>
  setThreads: Dispatch<SetStateAction<ThreadSummary[]>>
  setVisibleThreadRows: Dispatch<SetStateAction<ThreadSummary[]>>
  setCommentsByThread: Dispatch<SetStateAction<Record<string, CommentSummary[]>>>
  setSelectedThreadId: Dispatch<SetStateAction<string | null>>
  setNewThreadTitle: Dispatch<SetStateAction<string>>
  setNewCommentBody: Dispatch<SetStateAction<string>>
  setPendingThreadStatusChange: Dispatch<SetStateAction<ThreadSummary | null>>
  setIsLoadingThreads: Dispatch<SetStateAction<boolean>>
  setCommentsRetryToken: Dispatch<SetStateAction<number>>
  setError: Dispatch<SetStateAction<string | null>>
  lastAppliedThreadQueryRef: MutableRefObject<string | null>
}) => {
  const {
    selectedVersionId,
    projectId,
    docId,
    threadIdFromQuery,
    commentsRetryToken,
    commentsRetryTimeoutRef,
    reportVersionsErrorRef,
    setThreads,
    setVisibleThreadRows,
    setCommentsByThread,
    setSelectedThreadId,
    setNewThreadTitle,
    setNewCommentBody,
    setPendingThreadStatusChange,
    setIsLoadingThreads,
    setCommentsRetryToken,
    setError,
    lastAppliedThreadQueryRef,
  } = params

  useEffect( () => {
    if( !selectedVersionId ) {
      clearThreadState( {
        setThreads,
        setVisibleThreadRows,
        setCommentsByThread,
        setSelectedThreadId,
        setNewThreadTitle,
        setNewCommentBody,
        setPendingThreadStatusChange,
      } )
      lastAppliedThreadQueryRef.current = null
      clearCommentsRetryTimeout( commentsRetryTimeoutRef )
      return
    }
    clearThreadState( {
      setThreads,
      setVisibleThreadRows,
      setCommentsByThread,
      setSelectedThreadId,
      setNewThreadTitle,
      setNewCommentBody,
      setPendingThreadStatusChange,
    } )
    clearCommentsRetryTimeout( commentsRetryTimeoutRef )
    if( !threadIdFromQuery ) {
      lastAppliedThreadQueryRef.current = null
    }
    setIsLoadingThreads( true )
    const threadsListener = trackFirestoreListener( {
      label: 'versions.threads',
      projectId,
      documentId: docId ?? '',
      versionId: selectedVersionId,
      focus: 'issues',
      queryDescription: `threads where projectId=${projectId} versionId=${selectedVersionId}`,
    } )
    const threadsUnsub = onSnapshot(
      query(
        collection( db, 'threads' ),
        where( 'projectId', '==', projectId ),
        where( 'versionId', '==', selectedVersionId ),
      ),
      ( snapshot ) => {
        threadsListener.recordSnapshot( {
          size: snapshot.docs.length,
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
        } )
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
        setSelectedThreadId( ( current ) => {
          if( current && nextThreads.some( ( thread ) => thread.id === current ) ) {
            return current
          }
          return nextThreads[0]?.id ?? null
        } )
        setIsLoadingThreads( false )
      },
      ( err ) => {
        threadsListener.recordError( err )
        const message = err instanceof Error ? err.message : 'Unexpected error'
        reportVersionsErrorRef.current( err, 'versions.subscribeThreads', 'firestore' )
        setError( `Issues failed to load: ${message}` )
        setIsLoadingThreads( false )
      },
    )

    const commentsListener = trackFirestoreListener( {
      label: 'versions.comments',
      projectId,
      documentId: docId ?? '',
      versionId: selectedVersionId,
      focus: 'issues',
      queryDescription: `comments where projectId=${projectId} versionId=${selectedVersionId}`,
    } )
    const commentsUnsub = onSnapshot(
      query(
        collection( db, 'comments' ),
        where( 'projectId', '==', projectId ),
        where( 'versionId', '==', selectedVersionId ),
        orderBy( 'createdAt', 'asc' ),
      ),
      ( snapshot ) => {
        commentsListener.recordSnapshot( {
          size: snapshot.docs.length,
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
        } )
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
        commentsListener.recordError( err )
        if( isIndexBuildingFirestoreError( err ) ) {
          setIsLoadingThreads( true )
          setError( null )
          clearCommentsRetryTimeout( commentsRetryTimeoutRef )
          commentsRetryTimeoutRef.current = window.setTimeout( () => {
            commentsRetryTimeoutRef.current = null
            setCommentsRetryToken( ( current ) => current + 1 )
          }, 5000 )
          return
        }
        const message = err instanceof Error ? err.message : 'Unexpected error'
        reportVersionsErrorRef.current( err, 'versions.subscribeComments', 'firestore' )
        setError( `Comments failed to load: ${message}` )
      },
    )
    return () => {
      threadsListener.dispose()
      commentsListener.dispose()
      threadsUnsub()
      commentsUnsub()
      clearCommentsRetryTimeout( commentsRetryTimeoutRef )
    }
  }, [
    selectedVersionId,
    projectId,
    docId,
    threadIdFromQuery,
    commentsRetryToken,
    commentsRetryTimeoutRef,
    reportVersionsErrorRef,
    setThreads,
    setVisibleThreadRows,
    setCommentsByThread,
    setSelectedThreadId,
    setNewThreadTitle,
    setNewCommentBody,
    setPendingThreadStatusChange,
    setIsLoadingThreads,
    setCommentsRetryToken,
    setError,
    lastAppliedThreadQueryRef,
  ] )
}

const clearThreadState = (value: {
  setThreads: Dispatch<SetStateAction<ThreadSummary[]>>
  setVisibleThreadRows: Dispatch<SetStateAction<ThreadSummary[]>>
  setCommentsByThread: Dispatch<SetStateAction<Record<string, CommentSummary[]>>>
  setSelectedThreadId: Dispatch<SetStateAction<string | null>>
  setNewThreadTitle: Dispatch<SetStateAction<string>>
  setNewCommentBody: Dispatch<SetStateAction<string>>
  setPendingThreadStatusChange: Dispatch<SetStateAction<ThreadSummary | null>>
}) => {
  value.setThreads( [] )
  value.setVisibleThreadRows( [] )
  value.setCommentsByThread( {} )
  value.setSelectedThreadId( null )
  value.setNewThreadTitle( '' )
  value.setNewCommentBody( '' )
  value.setPendingThreadStatusChange( null )
}

const clearCommentsRetryTimeout = (commentsRetryTimeoutRef: MutableRefObject<number | null>) => {
  if( commentsRetryTimeoutRef.current !== null ) {
    window.clearTimeout( commentsRetryTimeoutRef.current )
    commentsRetryTimeoutRef.current = null
  }
}

export {
  useRoleSubscriptions,
  useThreadsAndCommentsSubscription,
}
