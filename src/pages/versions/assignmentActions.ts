// Firestore actions for assigning authors and reviewers on in-creation versions.
import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { logAudit } from '../../lib/audit'
import { db } from '../../lib/firebase'
import type { ProjectMember, VersionSummary } from './types'

type VersionsErrorReporter = (
  error: unknown,
  action: string,
  source?: 'firestore' | 'storage' | 'auth' | 'ui' | 'network' | 'unknown',
  overrides?: { versionId?: string | null; threadId?: string | null },
) => void

type UseAssignmentActionsParams = {
  selectedVersion: VersionSummary | null
  userId: string
  userEmail?: string | null
  projectId: string
  docId: string | undefined
  canAssignReviewers: boolean
  canAssignAuthor: boolean
  allowedReviewerIds: string[]
  selectedReviewerIds: string[]
  selectedAuthorId: string
  projectMembers: ProjectMember[]
  setSelectedReviewerIds: Dispatch<SetStateAction<string[]>>
  setSelectedAuthorId: Dispatch<SetStateAction<string>>
  setIsBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  reportVersionsError: VersionsErrorReporter
}

function useAssignmentActions( {
  selectedVersion,
  userId,
  userEmail,
  projectId,
  docId,
  canAssignReviewers,
  canAssignAuthor,
  allowedReviewerIds,
  selectedReviewerIds,
  selectedAuthorId,
  projectMembers,
  setSelectedReviewerIds,
  setSelectedAuthorId,
  setIsBusy,
  setError,
  reportVersionsError,
}: UseAssignmentActionsParams ) {
  const handleToggleReviewer = useCallback( async (reviewerId: string) => {
    if( !selectedVersion || !userId ) {
      setError( 'Select a version to assign reviewers.' )
      return
    }
    if( !canAssignReviewers ) {
      setError(
        selectedVersion.status !== 'In Creation'
          ? 'You can assign reviewers only while the version is In Creation.'
          : 'You can assign reviewers only if you are the author, project leader, or admin.',
      )
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
      reportVersionsError( err, 'versions.updateReviewers', 'firestore', {
        versionId: selectedVersion.id,
      } )
      setError( message )
      setIsBusy( false )
      return
    }
    void logAudit( {
      actorId: userId,
      actorEmail: userEmail ?? null,
      action: 'updateReviewers',
      entityType: 'version',
      entityId: selectedVersion.id,
      projectId,
      docId,
      versionId: selectedVersion.id,
      metadata: {
        reviewerIds: nextReviewerIds,
      },
    } ).catch( ( err ) => {
      console.warn( 'Audit log failed (update reviewers):', err )
    } )
    setIsBusy( false )
  }, [
    selectedVersion,
    userId,
    canAssignReviewers,
    allowedReviewerIds,
    selectedReviewerIds,
    userEmail,
    projectId,
    docId,
    setSelectedReviewerIds,
    setIsBusy,
    setError,
    reportVersionsError,
  ] )

  const handleToggleAllReviewers = useCallback( async (checked: boolean) => {
    if( !selectedVersion || !userId ) {
      setError( 'Select a version to assign reviewers.' )
      return
    }
    if( !canAssignReviewers ) {
      setError(
        selectedVersion.status !== 'In Creation'
          ? 'You can assign reviewers only while the version is In Creation.'
          : 'You can assign reviewers only if you are the author, project leader, or admin.',
      )
      return
    }

    const nextReviewerIds = checked ? allowedReviewerIds : []
    const previousReviewerIds = selectedReviewerIds
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
      reportVersionsError( err, 'versions.toggleAllReviewers', 'firestore', {
        versionId: selectedVersion.id,
      } )
      setError( message )
      setIsBusy( false )
      return
    }
    void logAudit( {
      actorId: userId,
      actorEmail: userEmail ?? null,
      action: 'updateReviewers',
      entityType: 'version',
      entityId: selectedVersion.id,
      projectId,
      docId,
      versionId: selectedVersion.id,
      metadata: {
        reviewerIds: nextReviewerIds,
        source: checked ? 'selectAll' : 'clearAll',
      },
    } ).catch( ( err ) => {
      console.warn( 'Audit log failed (toggle all reviewers):', err )
    } )
    setIsBusy( false )
  }, [
    selectedVersion,
    userId,
    canAssignReviewers,
    allowedReviewerIds,
    selectedReviewerIds,
    userEmail,
    projectId,
    docId,
    setSelectedReviewerIds,
    setIsBusy,
    setError,
    reportVersionsError,
  ] )

  const handleAssignAuthor = useCallback( async (authorId: string) => {
    if( !selectedVersion || !userId || !docId ) {
      setError( 'Select a version to change the author.' )
      return
    }
    if( !canAssignAuthor ) {
      setError(
        selectedVersion.status !== 'In Creation'
          ? 'You can change the author only while the version is In Creation.'
          : 'You can change the author only if you are the project leader or admin.',
      )
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
      const batch = writeBatch( db )
      batch.update( doc( db, 'versions', selectedVersion.id ), {
        createdBy: authorId,
        reviewerIds: sanitizedReviewerIds,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      } )
      batch.update( doc( db, 'documents', docId ), {
        authorId,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      } )
      await batch.commit()
    } catch( err ) {
      setSelectedAuthorId( previousAuthorId )
      setSelectedReviewerIds( previousReviewerIds )
      const message = err instanceof Error ? err.message : 'Unexpected error'
      reportVersionsError( err, 'versions.assignAuthor', 'firestore', {
        versionId: selectedVersion.id,
      } )
      setError( message )
      setIsBusy( false )
      return
    }
    void logAudit( {
      actorId: userId,
      actorEmail: userEmail ?? null,
      action: 'assignAuthor',
      entityType: 'version',
      entityId: selectedVersion.id,
      projectId,
      docId,
      versionId: selectedVersion.id,
      targetUserId: authorId,
    } ).catch( ( err ) => {
      console.warn( 'Audit log failed (assign author):', err )
    } )
    setIsBusy( false )
  }, [
    selectedVersion,
    userId,
    canAssignAuthor,
    projectMembers,
    selectedReviewerIds,
    selectedAuthorId,
    userEmail,
    projectId,
    docId,
    setSelectedAuthorId,
    setSelectedReviewerIds,
    setIsBusy,
    setError,
    reportVersionsError,
  ] )

  return {
    handleToggleReviewer,
    handleToggleAllReviewers,
    handleAssignAuthor,
  }
}

export default useAssignmentActions
