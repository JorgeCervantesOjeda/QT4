// src/pages/versions/reviewIssueActions.test.ts
// Verifies review issue mutation handlers keep confirmation state visible through work.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createReviewIssueActions } from './reviewIssueActions'
import type { CommentSummary, DocumentSummary, ThreadSummary, VersionSummary } from './types'

const firestoreMocks = vi.hoisted( () => ( {
  collection: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  doc: vi.fn( ( ...segments: unknown[] ) => ( {
    id: typeof segments[segments.length - 1] === 'string'
      ? segments[segments.length - 1]
      : `generated-${segments.length}`,
    segments,
  } ) ),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn( () => 'server-timestamp' ),
  updateDoc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  collection: firestoreMocks.collection,
  deleteDoc: firestoreMocks.deleteDoc,
  doc: firestoreMocks.doc,
  runTransaction: firestoreMocks.runTransaction,
  serverTimestamp: firestoreMocks.serverTimestamp,
  setDoc: firestoreMocks.setDoc,
  updateDoc: firestoreMocks.updateDoc,
} ) )

vi.mock( '../../lib/audit', () => ( {
  logAudit: vi.fn( () => Promise.resolve() ),
} ) )

const aiAssistMocks = vi.hoisted( () => ( {
  requestAiAssist: vi.fn(),
} ) )

vi.mock( '../../lib/aiAssist', () => ( {
  requestAiAssist: aiAssistMocks.requestAiAssist,
} ) )

vi.mock( '../../lib/firebase', () => ( {
  db: { app: 'test' },
} ) )

vi.mock( '../../lib/slowUiAction', () => ( {
  measureSlowUiAction: async ( _metadata: unknown, callback: () => Promise<void> ) => callback(),
} ) )

vi.mock( './commentNotification', () => ( {
  notifyCommentParticipants: vi.fn(),
} ) )

const selectedVersion: VersionSummary = {
  id: 'version-1',
  number: 1,
  status: 'In Review',
  createdBy: 'author-1',
  reviewerIds: ['reviewer-1'],
  reviewDurationDays: 3,
  hasFile: true,
  fileRefId: 'file-1',
  numThreads: 1,
  numOpenThreads: 1,
  numComments: 2,
  numThreadsWithTwoPlusComments: 1,
  acceptedErrorReportId: null,
}

const selectedThread: ThreadSummary = {
  id: 'thread-1',
  status: 'open',
  title: 'Clarify source',
  createdBy: 'reviewer-1',
  commentCount: 2,
}

const comments: CommentSummary[] = [
  {
    id: 'comment-1',
    threadId: selectedThread.id,
    body: 'Please clarify the source.',
    createdBy: 'reviewer-1',
  },
  {
    id: 'comment-2',
    threadId: selectedThread.id,
    body: 'The source has been clarified.',
    createdBy: 'author-1',
  },
]

const documentData: DocumentSummary = {
  id: 'doc-1',
  projectId: 'project-1',
  title: 'Design',
  createdBy: 'author-1',
  type: 'document',
  shortId: 12,
}

describe( 'createReviewIssueActions', () => {
  beforeEach( () => {
    vi.clearAllMocks()
  } )

  it( 'creates a deterministic like document for the current user and comment', async () => {
    firestoreMocks.setDoc.mockResolvedValueOnce( undefined )
    const setCommentLikesByCommentId = vi.fn()
    const setPendingCommentLikeIds = vi.fn()
    const actions = createReviewIssueActions( {
      canAddComment: true,
      canCreateThread: true,
      canParticipateReview: true,
      commentLikesByCommentId: {},
      commentsByThread: { [selectedThread.id]: comments },
      currentDocumentAuthorId: 'author-1',
      docId: 'doc-1',
      documentData,
      formatUserLabel: ( memberUserId ) => memberUserId,
      newCommentBody: '',
      newThreadTitle: '',
      projectId: 'project-1',
      reloadAndRestoreSelection: vi.fn(),
      reportVersionsError: vi.fn(),
      resolveUserEmail: () => null,
      selectedThread,
      selectedThreadComments: comments,
      selectedVersion,
      selectedVersionInActiveReview: true,
      setCommentLikesByCommentId,
      setEmailNotifyMessage: vi.fn(),
      setEmailNotifyStatus: vi.fn(),
      setError: vi.fn(),
      setIsBusy: vi.fn(),
      setNewCommentBody: vi.fn(),
      setNewThreadTitle: vi.fn(),
      setPendingCommentLikeIds,
      setPendingThreadStatusChange: vi.fn(),
      setSelectedThreadId: vi.fn(),
      setThreadCreationStatus: vi.fn(),
      setSuccessEmailRecipients: vi.fn(),
      setSuccessMessage: vi.fn(),
      setWarningMessage: vi.fn(),
      threads: [selectedThread],
      userEmail: 'author@example.com',
      userId: 'author-1',
    } )

    await actions.handleToggleCommentLike( comments[0] )

    expect( firestoreMocks.doc ).toHaveBeenCalledWith(
      { app: 'test' },
      'commentLikes',
      'comment-1_author-1',
    )
    expect( firestoreMocks.setDoc ).toHaveBeenCalledWith(
      expect.objectContaining( { id: 'comment-1_author-1' } ),
      expect.objectContaining( {
        projectId: 'project-1',
        docId: 'doc-1',
        versionId: 'version-1',
        threadId: 'thread-1',
        commentId: 'comment-1',
        userId: 'author-1',
        createdAt: 'server-timestamp',
      } ),
    )
    expect( firestoreMocks.deleteDoc ).not.toHaveBeenCalled()
    expect( setPendingCommentLikeIds ).toHaveBeenCalled()
    expect( setCommentLikesByCommentId ).toHaveBeenCalled()
  } )

  it( 'deletes the current user like document when the comment is already liked', async () => {
    firestoreMocks.deleteDoc.mockResolvedValueOnce( undefined )
    const actions = createReviewIssueActions( {
      canAddComment: true,
      canCreateThread: true,
      canParticipateReview: true,
      commentLikesByCommentId: {
        'comment-1': {
          count: 1,
          likedByCurrentUser: true,
        },
      },
      commentsByThread: { [selectedThread.id]: comments },
      currentDocumentAuthorId: 'author-1',
      docId: 'doc-1',
      documentData,
      formatUserLabel: ( memberUserId ) => memberUserId,
      newCommentBody: '',
      newThreadTitle: '',
      projectId: 'project-1',
      reloadAndRestoreSelection: vi.fn(),
      reportVersionsError: vi.fn(),
      resolveUserEmail: () => null,
      selectedThread,
      selectedThreadComments: comments,
      selectedVersion,
      selectedVersionInActiveReview: true,
      setCommentLikesByCommentId: vi.fn(),
      setEmailNotifyMessage: vi.fn(),
      setEmailNotifyStatus: vi.fn(),
      setError: vi.fn(),
      setIsBusy: vi.fn(),
      setNewCommentBody: vi.fn(),
      setNewThreadTitle: vi.fn(),
      setPendingCommentLikeIds: vi.fn(),
      setPendingThreadStatusChange: vi.fn(),
      setSelectedThreadId: vi.fn(),
      setThreadCreationStatus: vi.fn(),
      setSuccessEmailRecipients: vi.fn(),
      setSuccessMessage: vi.fn(),
      setWarningMessage: vi.fn(),
      threads: [selectedThread],
      userEmail: 'author@example.com',
      userId: 'author-1',
    } )

    await actions.handleToggleCommentLike( comments[0] )

    expect( firestoreMocks.deleteDoc ).toHaveBeenCalledWith(
      expect.objectContaining( { id: 'comment-1_author-1' } ),
    )
    expect( firestoreMocks.setDoc ).not.toHaveBeenCalled()
  } )

  it( 'creates an issue before the AI summary resolves and updates its title in the background', async () => {
    const createdWrites: Array<{ ref: unknown; data: Record<string, unknown> }> = []
    let resolveAiAssist: ((value: { ok: true; mode: 'draft_issue_title'; result: string }) => void) | undefined
    aiAssistMocks.requestAiAssist.mockImplementationOnce( () => new Promise( (resolve) => {
      resolveAiAssist = resolve
    } ) )
    firestoreMocks.runTransaction.mockImplementation( async ( _db, callback ) => {
      const transaction = {
        get: vi.fn().mockResolvedValueOnce( {
          exists: () => true,
          data: () => ( {
            stats: {
              numThreads: 1,
              numOpenThreads: 1,
              numComments: 2,
              numThreadsWithTwoPlusComments: 1,
            },
          } ),
        } ),
        set: vi.fn( ( ref, data ) => {
          createdWrites.push( { ref, data } )
        } ),
        update: vi.fn(),
      }
      await callback( transaction )
    } )
    const setNewCommentBody = vi.fn()
    const setNewThreadTitle = vi.fn()
    const setSelectedThreadId = vi.fn()
    const setThreadCreationStatus = vi.fn()
    const reloadAndRestoreSelection = vi.fn()
    const actions = createReviewIssueActions( {
      canAddComment: true,
      canCreateThread: true,
      canParticipateReview: true,
      commentLikesByCommentId: {},
      commentsByThread: { [selectedThread.id]: comments },
      currentDocumentAuthorId: 'author-1',
      docId: 'doc-1',
      documentData,
      formatUserLabel: ( memberUserId ) => memberUserId,
      newCommentBody: '',
      newThreadTitle: 'Please add the evidence source used for this value.',
      projectId: 'project-1',
      reloadAndRestoreSelection,
      reportVersionsError: vi.fn(),
      resolveUserEmail: () => null,
      selectedThread,
      selectedThreadComments: comments,
      selectedVersion,
      selectedVersionInActiveReview: true,
      setEmailNotifyMessage: vi.fn(),
      setEmailNotifyStatus: vi.fn(),
      setError: vi.fn(),
      setIsBusy: vi.fn(),
      setCommentLikesByCommentId: vi.fn(),
      setNewCommentBody,
      setNewThreadTitle,
      setPendingCommentLikeIds: vi.fn(),
      setPendingThreadStatusChange: vi.fn(),
      setSelectedThreadId,
      setThreadCreationStatus,
      setSuccessEmailRecipients: vi.fn(),
      setSuccessMessage: vi.fn(),
      setWarningMessage: vi.fn(),
      threads: [selectedThread],
      userEmail: 'author@example.com',
      userId: 'author-1',
    } )

    const actionPromise = actions.handleCreateThread()
    const actionOutcome = await Promise.race( [
      actionPromise.then( () => 'completed' as const ),
      new Promise<'blocked'>( (resolve) => setTimeout( () => resolve( 'blocked' ), 50 ) ),
    ] )
    if( actionOutcome === 'blocked' ) {
      resolveAiAssist?.( {
        ok: true,
        mode: 'draft_issue_title',
        result: 'Missing evidence source',
      } )
      await actionPromise
    }
    expect( actionOutcome ).toBe( 'completed' )

    expect( aiAssistMocks.requestAiAssist ).toHaveBeenCalledWith( {
      mode: 'draft_issue_title',
      text: 'Please add the evidence source used for this value.',
    } )
    expect( createdWrites[0]?.data ).toMatchObject( {
      title: 'Please add the evidence source used for this value',
      commentCount: 1,
      lastCommentBy: 'author-1',
    } )
    expect( createdWrites[1]?.data ).toMatchObject( {
      body: 'Please add the evidence source used for this value.',
      createdBy: 'author-1',
    } )
    expect( setNewCommentBody ).not.toHaveBeenCalled()
    expect( setNewThreadTitle ).toHaveBeenCalledWith( '' )
    expect( setSelectedThreadId ).toHaveBeenCalled()
    expect( reloadAndRestoreSelection ).toHaveBeenCalledWith( 'version-1', expect.any( String ) )
    expect( setThreadCreationStatus.mock.calls ).toEqual( [ [ 'creating' ], [ 'idle' ] ] )
    expect( firestoreMocks.updateDoc ).not.toHaveBeenCalled()

    resolveAiAssist?.( {
      ok: true,
      mode: 'draft_issue_title',
      result: 'Missing evidence source',
    } )
    await vi.waitFor( () => {
      expect( firestoreMocks.updateDoc ).toHaveBeenCalledWith(
        expect.objectContaining( { id: expect.any( String ) } ),
        expect.objectContaining( {
          title: 'Missing evidence source',
          updatedBy: 'author-1',
        } ),
      )
    } )
  } )

  it( 'keeps the issue status confirmation pending until the status change finishes', async () => {
    const calls: string[] = []
    firestoreMocks.runTransaction.mockImplementation( async ( _db, callback ) => {
      const transaction = {
        get: vi.fn()
          .mockResolvedValueOnce( {
            exists: () => true,
            data: () => ( {
              stats: {
                numThreads: 1,
                numOpenThreads: 1,
                numComments: 2,
                numThreadsWithTwoPlusComments: 1,
              },
            } ),
          } )
          .mockResolvedValueOnce( {
            exists: () => true,
            data: () => ( {
              status: 'open',
              commentCount: 2,
            } ),
          } ),
        set: vi.fn(),
        update: vi.fn(),
      }
      await callback( transaction )
      calls.push( 'transaction:done' )
    } )
    const actions = createReviewIssueActions( {
      canAddComment: true,
      canCreateThread: true,
      canParticipateReview: true,
      commentLikesByCommentId: {},
      commentsByThread: { [selectedThread.id]: comments },
      currentDocumentAuthorId: 'author-1',
      docId: 'doc-1',
      documentData,
      formatUserLabel: ( memberUserId ) => memberUserId,
      newCommentBody: '',
      newThreadTitle: '',
      projectId: 'project-1',
      reloadAndRestoreSelection: async () => {
        calls.push( 'reload:done' )
      },
      reportVersionsError: vi.fn(),
      resolveUserEmail: () => null,
      selectedThread,
      selectedThreadComments: comments,
      selectedVersion,
      selectedVersionInActiveReview: true,
      setEmailNotifyMessage: vi.fn(),
      setEmailNotifyStatus: vi.fn(),
      setError: vi.fn(),
      setIsBusy: vi.fn( ( value: boolean ) => calls.push( `busy:${String( value )}` ) ),
      setCommentLikesByCommentId: vi.fn(),
      setNewCommentBody: vi.fn(),
      setNewThreadTitle: vi.fn(),
      setPendingCommentLikeIds: vi.fn(),
      setPendingThreadStatusChange: vi.fn( () => calls.push( 'pending:null' ) ),
      setSelectedThreadId: vi.fn(),
      setThreadCreationStatus: vi.fn(),
      setSuccessEmailRecipients: vi.fn(),
      setSuccessMessage: vi.fn(),
      setWarningMessage: vi.fn(),
      threads: [selectedThread],
      userEmail: 'author@example.com',
      userId: 'author-1',
    } )

    await actions.handleConfirmThreadStatusChange( selectedThread )

    expect( calls.indexOf( 'pending:null' ) ).toBeGreaterThan(
      calls.indexOf( 'transaction:done' ),
    )
  } )
} )
