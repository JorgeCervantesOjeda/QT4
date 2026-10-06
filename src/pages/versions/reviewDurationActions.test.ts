// src/pages/versions/reviewDurationActions.test.ts: Verifies review-duration telemetry at the Firestore boundary.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VersionSummary } from './types'

const firestoreMocks = vi.hoisted( () => ( {
  doc: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  serverTimestamp: vi.fn( () => 'server-timestamp' ),
  updateDoc: vi.fn<() => Promise<void>>(),
} ) )

const slowUiActionMocks = vi.hoisted( () => ( {
  measureSlowUiAction: vi.fn( async ( _metadata: unknown, callback: () => Promise<unknown> ) => callback() ),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  doc: firestoreMocks.doc,
  serverTimestamp: firestoreMocks.serverTimestamp,
  updateDoc: firestoreMocks.updateDoc,
} ) )

vi.mock( '../../lib/audit', () => ( {
  logAudit: vi.fn( () => Promise.resolve() ),
} ) )

vi.mock( '../../lib/firebase', () => ( {
  db: { app: 'test' },
} ) )

vi.mock( '../../lib/slowUiAction', () => ( {
  measureSlowUiAction: slowUiActionMocks.measureSlowUiAction,
} ) )

import { createReviewDurationActions } from './reviewDurationActions'

const selectedVersion: VersionSummary = {
  id: 'version-1',
  number: 1,
  status: 'In Creation',
  createdBy: 'author-1',
  reviewerIds: [],
  reviewDurationDays: 3,
  hasFile: true,
  fileRefId: 'file-1',
  numThreads: 0,
  numOpenThreads: 0,
  numComments: 0,
  numThreadsWithTwoPlusComments: 0,
  acceptedErrorReportId: null,
}

describe( 'createReviewDurationActions', () => {
  beforeEach( () => {
    vi.clearAllMocks()
    firestoreMocks.updateDoc.mockResolvedValue( undefined )
  } )

  it( 'records review-duration updates as modal-protected', async () => {
    const actions = createReviewDurationActions( {
      canConfigureReviewDuration: true,
      docId: 'doc-1',
      projectId: 'project-1',
      selectedVersion,
      setError: vi.fn(),
      setIsBusy: vi.fn(),
      setVersions: vi.fn(),
      reportVersionsError: vi.fn(),
      userEmail: 'author@example.com',
      userId: 'author-1',
    } )

    await actions.handleReviewDurationDaysChange( 5 )

    expect( slowUiActionMocks.measureSlowUiAction ).toHaveBeenCalledWith(
      expect.objectContaining( {
        action: 'versions.updateReviewDuration',
        hasModal: true,
      } ),
      expect.any( Function ),
    )
  } )
} )
