// src/pages/versions/versionCreateAndReviewActions.test.ts
// Verifies version creation and review-start action payloads at the Firestore boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentSummary, VersionSummary } from './types'

const firestoreMocks = vi.hoisted( () => ( {
  batchCommit: vi.fn<() => Promise<void>>(),
  batchUpdate: vi.fn(),
  doc: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  serverTimestamp: vi.fn( () => 'server-timestamp' ),
} ) )

const auditMocks = vi.hoisted( () => ( {
  logAudit: vi.fn<() => Promise<void>>(),
} ) )

const notificationMocks = vi.hoisted( () => ( {
  notifyEmailUsingActiveProvider: vi.fn<() => Promise<void>>(),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  collection: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  doc: firestoreMocks.doc,
  runTransaction: vi.fn(),
  serverTimestamp: firestoreMocks.serverTimestamp,
  Timestamp: {
    fromDate: (date: Date) => ( { iso: date.toISOString() } ),
  },
  writeBatch: vi.fn( () => ( {
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

vi.mock( '../../lib/notifications', () => ( {
  notifyEmailUsingActiveProvider: notificationMocks.notifyEmailUsingActiveProvider,
} ) )

import { createVersionCreateAndReviewActions } from './versionCreateAndReviewActions'

const baseDocument: DocumentSummary = {
  id: 'doc-1',
  projectId: 'project-1',
  title: 'Protocol',
  createdBy: 'author-1',
  type: 'document',
  shortId: 42,
}

const baseVersion: VersionSummary = {
  id: 'version-1',
  number: 1,
  status: 'In Creation',
  createdBy: 'author-1',
  createdAt: new Date( '2026-04-02T12:00:00.000Z' ),
  activityAt: new Date( '2026-04-02T12:00:00.000Z' ),
  reviewerIds: ['reviewer-1'],
  reviewStartAt: null,
  reviewEndAt: null,
  reviewDurationDays: 3,
  hasFile: true,
  fileRefId: 'file-1',
  numThreads: 0,
  numOpenThreads: 0,
  numComments: 0,
  numThreadsWithTwoPlusComments: 0,
  acceptedErrorReportId: null,
}

describe( 'createVersionCreateAndReviewActions', () => {
  beforeEach( () => {
    vi.useFakeTimers()
    vi.setSystemTime( new Date( '2026-04-03T09:00:00.000Z' ) )
    firestoreMocks.batchCommit.mockResolvedValue( undefined )
    auditMocks.logAudit.mockResolvedValue( undefined )
    notificationMocks.notifyEmailUsingActiveProvider.mockResolvedValue( undefined )
  } )

  afterEach( () => {
    vi.useRealTimers()
    vi.clearAllMocks()
  } )

  it( 'starts review using the configured duration days', async () => {
    const actions = createVersionCreateAndReviewActions( {
      canCreateVersion: false,
      canStartReview: true,
      docId: 'doc-1',
      documentData: baseDocument,
      errorReportGate: { isBlocking: false, isLoading: false },
      formatUserLabel: (memberUserId) => memberUserId,
      latestVersion: baseVersion,
      loadDocumentAndVersions: vi.fn(),
      projectId: 'project-1',
      reviewDurationDays: 3,
      reportVersionsError: vi.fn(),
      resolveUserEmail: (memberUserId) =>
        memberUserId === 'author-1'
          ? 'author@example.com'
          : memberUserId === 'reviewer-1'
            ? 'reviewer@example.com'
            : null,
      setEmailNotifyMessage: vi.fn(),
      setEmailNotifyStatus: vi.fn(),
      setError: vi.fn(),
      setIsBusy: vi.fn(),
      setSuccessEmailRecipients: vi.fn(),
      setSuccessMessage: vi.fn(),
      setWarningMessage: vi.fn(),
      userEmail: 'author@example.com',
      userId: 'author-1',
      versions: [baseVersion],
    } )

    await actions.handleStartReview()

    expect( firestoreMocks.batchUpdate ).toHaveBeenCalledWith(
      { segments: [{ app: 'test' }, 'versions', 'version-1'] },
      expect.objectContaining( {
        status: 'In Review',
        reviewDurationDays: 3,
        reviewEndAt: { iso: '2026-04-06T09:00:00.000Z' },
      } ),
    )
  } )
} )
