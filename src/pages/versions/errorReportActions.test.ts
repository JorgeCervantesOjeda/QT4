// src/pages/versions/errorReportActions.test.ts: Verifies error-report creation telemetry and transaction boundaries.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VersionSummary } from './types'

const firestoreMocks = vi.hoisted( () => ( {
  collection: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  doc: vi.fn( ( ...segments: unknown[] ) => ( {
    id: 'generated-error-report',
    segments,
  } ) ),
  runTransaction: vi.fn<() => Promise<void>>(),
  serverTimestamp: vi.fn( () => 'server-timestamp' ),
} ) )

const slowUiActionMocks = vi.hoisted( () => ( {
  measureSlowUiAction: vi.fn( async ( _metadata: unknown, callback: () => Promise<unknown> ) => callback() ),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  collection: firestoreMocks.collection,
  doc: firestoreMocks.doc,
  runTransaction: firestoreMocks.runTransaction,
  serverTimestamp: firestoreMocks.serverTimestamp,
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

import { createErrorReportActions } from './errorReportActions'

const acceptedVersion: VersionSummary = {
  id: 'version-1',
  number: 1,
  status: 'Accepted',
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

describe( 'createErrorReportActions', () => {
  beforeEach( () => {
    vi.clearAllMocks()
    firestoreMocks.runTransaction.mockResolvedValue( undefined )
  } )

  it( 'records error-report creation as modal-protected', async () => {
    const actions = createErrorReportActions( {
      canCreateErrorReportActor: true,
      docId: 'doc-1',
      latestVersion: acceptedVersion,
      navigate: vi.fn(),
      projectId: 'project-1',
      setError: vi.fn(),
      setErrorReportTitle: vi.fn(),
      setErrorReportTitleError: vi.fn(),
      setIsBusy: vi.fn(),
      setIsErrorReportModalOpen: vi.fn(),
      setSuccessMessage: vi.fn(),
      userEmail: 'author@example.com',
      userId: 'author-1',
    } )

    await actions.handleCreateErrorReport( 'Missing source' )

    expect( slowUiActionMocks.measureSlowUiAction ).toHaveBeenCalledWith(
      expect.objectContaining( {
        action: 'versions.createErrorReport',
        hasModal: true,
      } ),
      expect.any( Function ),
    )
  } )
} )
