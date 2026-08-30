// src/pages/versions/versionDecisionActions.test.ts
// Verifies accept/reject decision side effects at the Firestore boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCEPTED_DERIVED_DOCUMENT_MESSAGE,
} from '../../lib/documentDerivation'
import type { DocumentSummary, VersionSummary } from './types'

const firestoreMocks = vi.hoisted( () => ( {
  batchCommit: vi.fn<() => Promise<void>>(),
  batchSet: vi.fn(),
  batchUpdate: vi.fn(),
  doc: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  getDoc: vi.fn(),
  serverTimestamp: vi.fn( () => 'server-timestamp' ),
} ) )

const auditMocks = vi.hoisted( () => ( {
  logAudit: vi.fn<() => Promise<void>>(),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  collection: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  doc: firestoreMocks.doc,
  getDoc: firestoreMocks.getDoc,
  getDocs: vi.fn( async () => ( { docs: [] } ) ),
  query: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  serverTimestamp: firestoreMocks.serverTimestamp,
  where: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  writeBatch: vi.fn( () => ( {
    set: firestoreMocks.batchSet,
    update: firestoreMocks.batchUpdate,
    commit: firestoreMocks.batchCommit,
  } ) ),
} ) )

vi.mock( '../../lib/audit', () => ( {
  logAudit: auditMocks.logAudit,
} ) )

vi.mock( '../../lib/firebase', () => ( {
  db: { app: 'test' },
} ) )

vi.mock( '../../lib/slowUiAction', () => ( {
  measureSlowUiAction: async ( _metadata: unknown, callback: () => Promise<void> ) => callback(),
} ) )

import { createVersionDecisionActions } from './versionDecisionActions'

const reviewReadyVersion: VersionSummary = {
  id: 'change-request-version-1',
  number: 1,
  status: 'In Review',
  createdBy: 'author-1',
  createdAt: new Date( '2026-04-02T12:00:00.000Z' ),
  activityAt: new Date( '2026-04-02T12:00:00.000Z' ),
  reviewerIds: ['reviewer-1'],
  reviewStartAt: null,
  reviewEndAt: null,
  reviewDurationDays: 3,
  hasFile: true,
  fileRefId: 'file-1',
  numThreads: 1,
  numOpenThreads: 0,
  numComments: 2,
  numThreadsWithTwoPlusComments: 1,
  acceptedErrorReportId: null,
}

const changeRequestDocument: DocumentSummary = {
  id: 'change-request-1',
  projectId: 'target-project',
  title: 'Beta change request',
  createdBy: 'author-1',
  type: 'changeRequest',
  shortId: 31,
  baseProjectId: 'base-project',
  baseDocId: 'base-document',
  baseVersionId: 'base-version',
}

const derivedDocument: DocumentSummary = {
  id: 'derived-document-1',
  projectId: 'target-project',
  title: 'Derived beta requirements',
  createdBy: 'author-1',
  type: 'derivedDocument',
  shortId: 32,
  originProjectId: 'base-project',
  originDocumentId: 'base-document',
  originVersionId: 'base-version',
  incorporatedChangeRequestVersionIds: ['change-request-version-1'],
}

const buildActions = (overrides: Partial<Parameters<typeof createVersionDecisionActions>[0]> = {}) => createVersionDecisionActions( {
  canAcceptOrReject: true,
  docId: 'change-request-1',
  documentData: changeRequestDocument,
  isAdmin: false,
  isLeader: true,
  latestVersion: reviewReadyVersion,
  loadDocumentAndVersions: vi.fn(),
  logBlockedVersionDecision: vi.fn(),
  projectId: 'target-project',
  reportVersionsError: vi.fn(),
  setError: vi.fn(),
  setIsBusy: vi.fn(),
  setSuccessMessage: vi.fn(),
  setVersionDecisionModal: vi.fn(),
  userEmail: 'author@example.com',
  userId: 'author-1',
  versionDecisionModal: null,
  versions: [reviewReadyVersion],
  ...overrides,
} )

describe( 'createVersionDecisionActions', () => {
  beforeEach( () => {
    vi.clearAllMocks()
    firestoreMocks.batchCommit.mockResolvedValue( undefined )
    auditMocks.logAudit.mockResolvedValue( undefined )
    firestoreMocks.getDoc.mockResolvedValue( {
      exists: () => true,
      data: () => ( {
        status: 'Accepted',
        generationStatus: 'generated',
        activeChangeRequestVersionIds: ['change-request-version-1'],
      } ),
    } )
  } )

  afterEach( () => {
    vi.clearAllMocks()
  } )

  it( 'blocks accepting a change request after the derived variant for the same base was accepted', async () => {
    const setError = vi.fn()
    const actions = buildActions( { setError } )

    await actions.handleAcceptLatestVersion()

    expect( setError ).toHaveBeenCalledWith( ACCEPTED_DERIVED_DOCUMENT_MESSAGE )
    expect( firestoreMocks.batchUpdate ).not.toHaveBeenCalled()
    expect( firestoreMocks.batchCommit ).not.toHaveBeenCalled()
  } )

  it( 'records an accepted change request in the deterministic derived configuration when the line is open', async () => {
    firestoreMocks.getDoc.mockResolvedValueOnce( {
      exists: () => false,
      data: () => ( {} ),
    } )
    const actions = buildActions()

    await actions.handleAcceptLatestVersion()

    expect( firestoreMocks.batchSet ).toHaveBeenCalledWith(
      { segments: [{ app: 'test' }, 'derivedConfigurations', 'target-project|base-project|base-document|base-version'] },
      expect.objectContaining( {
        activeChangeRequestVersionIds: ['change-request-version-1'],
        generationStatus: 'open',
        status: 'Open',
      } ),
      { merge: true },
    )
    expect( firestoreMocks.batchCommit ).toHaveBeenCalledOnce()
  } )

  it( 'blocks accepting a derived variant when new active change requests are not incorporated', async () => {
    firestoreMocks.getDoc.mockResolvedValueOnce( {
      exists: () => true,
      data: () => ( {
        status: 'Open',
        generationStatus: 'open',
        activeChangeRequestVersionIds: ['change-request-version-1', 'change-request-version-2'],
      } ),
    } )
    const setError = vi.fn()
    const actions = buildActions( {
      docId: 'derived-document-1',
      documentData: derivedDocument,
      latestVersion: {
        ...reviewReadyVersion,
        id: 'derived-version-1',
      },
      setError,
      versions: [
        {
          ...reviewReadyVersion,
          id: 'derived-version-1',
        },
      ],
    } )

    await actions.handleAcceptLatestVersion()

    expect( setError ).toHaveBeenCalledWith(
      'This derived variant no longer matches the active accepted change requests. Create a new derived variant before accepting.',
    )
    expect( firestoreMocks.batchUpdate ).not.toHaveBeenCalled()
    expect( firestoreMocks.batchCommit ).not.toHaveBeenCalled()
  } )
} )
