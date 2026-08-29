// src/pages/versions/reviewDurationActions.ts
// Creates Firestore actions for configuring review duration before review starts.
import type { Dispatch, SetStateAction } from 'react'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { logAudit } from '../../lib/audit'
import { db } from '../../lib/firebase'
import { numOfReviewDurationDays } from '../../lib/reviewWindow'
import type { VersionSummary } from './types'

type VersionsErrorReporter = (
  error: unknown,
  action: string,
  source?: 'firestore' | 'storage' | 'auth' | 'ui' | 'network' | 'unknown',
  overrides?: { versionId?: string | null; threadId?: string | null },
) => void

type ReviewDurationActionParams = {
  canConfigureReviewDuration: boolean
  docId?: string
  projectId: string
  selectedVersion: VersionSummary | null
  setError: Dispatch<SetStateAction<string | null>>
  setIsBusy: Dispatch<SetStateAction<boolean>>
  setVersions: Dispatch<SetStateAction<VersionSummary[]>>
  reportVersionsError: VersionsErrorReporter
  userEmail?: string | null
  userId: string
}

const createReviewDurationActions = (params: ReviewDurationActionParams) => {
  const handleReviewDurationDaysChange = async (reviewDurationDays: number) => {
    const selectedVersion = params.selectedVersion
    if( !selectedVersion || !params.userId ) {
      params.setError( 'Select a version to configure review duration.' )
      return
    }
    if( !params.canConfigureReviewDuration ) {
      params.setError( 'You can configure review duration only while the version is In Creation and you are the author, project leader, or admin.' )
      return
    }

    const nextReviewDurationDays = numOfReviewDurationDays( reviewDurationDays )
    if( nextReviewDurationDays === selectedVersion.reviewDurationDays ) {
      return
    }

    const previousReviewDurationDays = selectedVersion.reviewDurationDays
    params.setError( null )
    params.setVersions( ( currentVersions ) =>
      currentVersions.map( ( version ) =>
        version.id === selectedVersion.id
          ? { ...version, reviewDurationDays: nextReviewDurationDays }
          : version,
      ),
    )
    params.setIsBusy( true )
    try {
      await updateDoc( doc( db, 'versions', selectedVersion.id ), {
        reviewDurationDays: nextReviewDurationDays,
        updatedAt: serverTimestamp(),
        updatedBy: params.userId,
      } )
    } catch( err ) {
      params.setVersions( ( currentVersions ) =>
        currentVersions.map( ( version ) =>
          version.id === selectedVersion.id
            ? { ...version, reviewDurationDays: previousReviewDurationDays }
            : version,
        ),
      )
      const message = err instanceof Error ? err.message : 'Unexpected error'
      params.reportVersionsError( err, 'versions.updateReviewDuration', 'firestore', {
        versionId: selectedVersion.id,
      } )
      params.setError( message )
      params.setIsBusy( false )
      return
    }
    void logAudit( {
      actorId: params.userId,
      actorEmail: params.userEmail ?? null,
      action: 'updateReviewDuration',
      entityType: 'version',
      entityId: selectedVersion.id,
      projectId: params.projectId,
      docId: params.docId,
      versionId: selectedVersion.id,
      metadata: {
        previousReviewDurationDays,
        reviewDurationDays: nextReviewDurationDays,
      },
    } ).catch( ( err ) => {
      console.warn( 'Audit log failed (update review duration):', err )
    } )
    params.setIsBusy( false )
  }

  return { handleReviewDurationDaysChange }
}

export { createReviewDurationActions }
