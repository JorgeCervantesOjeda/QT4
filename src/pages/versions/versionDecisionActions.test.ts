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

const versionDecisionMocks = vi.hoisted( () => ( {
  requestVersionDecision: vi.fn<() => Promise<unknown>>(),
} ) )

const propagatedErrorReportsMocks = vi.hoisted( () => ( {
  requestRetryPropagatedErrorReports: vi.fn<() => Promise<unknown>>(),
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

vi.mock( '../../lib/versionDecisions', () => ( {
  requestVersionDecision: versionDecisionMocks.requestVersionDecision,
} ) )

vi.mock( '../../lib/propagatedErrorReports', () => ( {
  requestRetryPropagatedErrorReports: propagatedErrorReportsMocks.requestRetryPropagatedErrorReports,
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
  propagationFailurePrompt: null,
  setPropagationFailurePrompt: vi.fn(),
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
    versionDecisionMocks.requestVersionDecision.mockResolvedValue( {
      ok: true,
      decision: 'accept',
      projectId: 'target-project',
      docId: 'change-request-1',
      versionId: 'change-request-version-1',
      promotedNumber: 100,
      replacedVersionIds: [],
    } )
    propagatedErrorReportsMocks.requestRetryPropagatedErrorReports.mockResolvedValue( {
      ok: true,
      projectId: 'target-project',
      docId: 'change-request-1',
      versionId: 'change-request-version-1',
      createdCount: 1,
      skippedCount: 0,
      failedCount: 0,
      failures: [],
    } )
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
    expect( versionDecisionMocks.requestVersionDecision ).not.toHaveBeenCalled()
  } )

  it( 'requests a backend accept decision when the change request line is open', async () => {
    firestoreMocks.getDoc.mockResolvedValueOnce( {
      exists: () => false,
      data: () => ( {} ),
    } )
    const actions = buildActions()

    await actions.handleAcceptLatestVersion()

    expect( versionDecisionMocks.requestVersionDecision ).toHaveBeenCalledWith( {
      decision: 'accept',
      projectId: 'target-project',
      docId: 'change-request-1',
      versionId: 'change-request-version-1',
    } )
  } )

  it( 'asks the user to report or retry when accepting an error report fails propagation', async () => {
    const setPropagationFailurePrompt = vi.fn()
    versionDecisionMocks.requestVersionDecision.mockResolvedValueOnce( {
      ok: true,
      decision: 'accept',
      projectId: 'target-project',
      docId: 'error-report-1',
      versionId: 'error-report-version-1',
      promotedNumber: 100,
      replacedVersionIds: [],
      propagatedErrorReports: {
        createdCount: 0,
        skippedCount: 0,
        failedCount: 1,
        failures: [{ reason: 'storage_copy_failed' }],
      },
    } )
    const actions = buildActions( {
      docId: 'error-report-1',
      documentData: {
        id: 'error-report-1',
        projectId: 'target-project',
        title: 'Error report',
        createdBy: 'author-1',
        type: 'errorReport',
        shortId: 33,
        baseProjectId: 'base-project',
        baseDocId: 'base-document',
        baseVersionId: 'base-version',
      },
      latestVersion: {
        ...reviewReadyVersion,
        id: 'error-report-version-1',
        fileRefId: 'source-file',
      },
      setPropagationFailurePrompt,
    } )

    await actions.handleAcceptLatestVersion()

    expect( setPropagationFailurePrompt ).toHaveBeenCalledWith(
      expect.objectContaining( {
        projectId: 'target-project',
        docId: 'error-report-1',
        versionId: 'error-report-version-1',
        failures: [{ reason: 'storage_copy_failed' }],
      } ),
    )
  } )

  it( 'retries propagated error report creation from the failure prompt', async () => {
    const setPropagationFailurePrompt = vi.fn()
    const setSuccessMessage = vi.fn()
    const actions = buildActions( {
      propagationFailurePrompt: {
        projectId: 'target-project',
        docId: 'error-report-1',
        versionId: 'error-report-version-1',
        message: 'Propagation failed.',
        failures: [{ reason: 'storage_copy_failed' }],
      },
      setPropagationFailurePrompt,
      setSuccessMessage,
    } )

    await actions.handleRetryPropagatedErrorReports()

    expect( propagatedErrorReportsMocks.requestRetryPropagatedErrorReports ).toHaveBeenCalledWith( {
      projectId: 'target-project',
      docId: 'error-report-1',
      versionId: 'error-report-version-1',
    } )
    expect( setPropagationFailurePrompt ).toHaveBeenCalledWith( null )
    expect( setSuccessMessage ).toHaveBeenCalledWith( 'Propagated error reports created successfully.' )
  } )

  it( 'keeps the accept confirmation modal open until the backend decision finishes', async () => {
    firestoreMocks.getDoc.mockResolvedValueOnce( {
      exists: () => false,
      data: () => ( {} ),
    } )
    const calls: string[] = []
    const setVersionDecisionModal = vi.fn( ( value: 'accept' | 'reject' | null ) => {
      calls.push( `modal:${value ?? 'null'}` )
    } )
    versionDecisionMocks.requestVersionDecision.mockImplementationOnce( async () => {
      calls.push( 'request' )
      return {
        ok: true,
        decision: 'accept',
        projectId: 'target-project',
        docId: 'change-request-1',
        versionId: 'change-request-version-1',
        promotedNumber: 100,
        replacedVersionIds: [],
      }
    } )
    const actions = buildActions( {
      setVersionDecisionModal,
      versionDecisionModal: 'accept',
    } )

    await actions.handleConfirmVersionDecision()

    expect( calls[0] ).toBe( 'request' )
    expect( calls[calls.length - 1] ).toBe( 'modal:null' )
  } )

  it( 'waits for document and version reload before completing an accept decision', async () => {
    firestoreMocks.getDoc.mockResolvedValueOnce( {
      exists: () => false,
      data: () => ( {} ),
    } )
    const calls: string[] = []
    const loadDocumentAndVersions = vi.fn( async () => {
      calls.push( 'load:start' )
      await Promise.resolve()
      calls.push( 'load:done' )
    } )
    const setIsBusy = vi.fn( ( value: boolean ) => {
      calls.push( `busy:${String( value )}` )
    } )
    const actions = buildActions( {
      loadDocumentAndVersions,
      setIsBusy,
      versionDecisionModal: 'accept',
    } )

    await actions.handleConfirmVersionDecision()

    expect( loadDocumentAndVersions ).toHaveBeenCalledTimes( 1 )
    expect( calls ).toEqual( [
      'busy:true',
      'load:start',
      'load:done',
      'busy:false',
    ] )
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
    expect( versionDecisionMocks.requestVersionDecision ).not.toHaveBeenCalled()
  } )

  it( 'requests a backend reject decision', async () => {
    const actions = buildActions()

    await actions.handleRejectLatestVersion()

    expect( versionDecisionMocks.requestVersionDecision ).toHaveBeenCalledWith( {
      decision: 'reject',
      projectId: 'target-project',
      docId: 'change-request-1',
      versionId: 'change-request-version-1',
    } )
  } )
} )
