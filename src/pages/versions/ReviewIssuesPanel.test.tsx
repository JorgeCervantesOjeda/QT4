// src/pages/versions/ReviewIssuesPanel.test.tsx: Verifies slow-action instrumentation in review issue AI controls.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewIssuesPanel from './ReviewIssuesPanel'
import type { CommentSummary, ThreadSummary, VersionSummary } from './types'

const aiAssistMocks = vi.hoisted( () => ( {
  requestAiAssist: vi.fn(),
} ) )

const slowUiActionMocks = vi.hoisted( () => ( {
  measureSlowUiAction: vi.fn(),
} ) )

vi.mock( '../../lib/aiAssist', () => ( {
  requestAiAssist: aiAssistMocks.requestAiAssist,
} ) )

vi.mock( '../../lib/slowUiAction', () => ( {
  measureSlowUiAction: slowUiActionMocks.measureSlowUiAction,
} ) )

const selectedVersion: VersionSummary = {
  id: 'version-1',
  number: 1,
  status: 'In Review',
  createdBy: 'author-1',
  reviewerIds: [ 'reviewer-1' ],
  reviewDurationDays: 2,
  hasFile: true,
  fileRefId: 'file-1',
  numThreads: 1,
  numOpenThreads: 1,
  numComments: 1,
  numThreadsWithTwoPlusComments: 0,
  acceptedErrorReportId: null,
}

const selectedThread: ThreadSummary = {
  id: 'thread-1',
  status: 'open',
  title: 'Missing evidence',
  createdBy: 'reviewer-1',
  commentCount: 1,
}

const selectedThreadComments: CommentSummary[] = [
  {
    id: 'comment-1',
    threadId: 'thread-1',
    body: 'Please add evidence.',
    createdBy: 'reviewer-1',
  },
]

const renderPanel = (overrides: Partial<ComponentProps<typeof ReviewIssuesPanel>> = {}) => {
  const props: ComponentProps<typeof ReviewIssuesPanel> = {
    projectId: "project-1",
    docId: "doc-1",
    selectedVersion,
    reviewIssuesPanelRef: createRef<HTMLElement>(),
    formatUserLabel: ( userId ) => userId,
    newThreadTitle: "",
    setNewThreadTitle: vi.fn(),
    isBusy: false,
    onCreateThread: vi.fn(),
    isLoadingThreads: false,
    threads: [ selectedThread ],
    threadsViewMode: "card",
    setThreadsViewMode: vi.fn(),
    threadColumns: [],
    threadsSorting: [],
    setThreadsSorting: vi.fn(),
    setVisibleThreadRows: vi.fn(),
    getThreadCommentWindowMeta: () => ( { state: "active", label: "Open" } ),
    effectiveSelectedThreadId: "thread-1",
    selectThreadKeepingViewport: vi.fn(),
    commentsByThread: { "thread-1": selectedThreadComments },
    requestThreadStatusChangeConfirmation: vi.fn(),
    selectedThread,
    threadNavigationStatusLabel: "1 of 1",
    onSelectAdjacentThread: vi.fn(),
    hasPreviousThread: false,
    hasNextThread: false,
    commentsViewMode: "card",
    setCommentsViewMode: vi.fn(),
    selectedThreadComments,
    commentColumns: [
      {
        header: 'Comment',
        accessorKey: 'body',
      },
    ],
    commentsSorting: [],
    setCommentsSorting: vi.fn(),
    highlightedCommentId: null,
    commentWindowCountdownLabel: null,
    commentInputRef: createRef<HTMLTextAreaElement>(),
    selectedCommentWindowState: "active",
    newCommentBody: "Please clarify the evidence source.",
    setNewCommentBody: vi.fn(),
    onAddComment: vi.fn(),
    ...overrides,
  }
  return render( <ReviewIssuesPanel {...props} /> )
}

describe( 'ReviewIssuesPanel', () => {
  beforeEach( () => {
    aiAssistMocks.requestAiAssist.mockResolvedValue( { result: 'Short explanation.' } )
    slowUiActionMocks.measureSlowUiAction.mockImplementation( async ( _context, operation ) => operation() )
  } )

  it( 'measures explain-issue AI requests as non-modal review actions', async () => {
    renderPanel()

    fireEvent.click( screen.getByRole( 'button', { name: 'Explain issue' } ) )

    await waitFor( () => {
      expect( aiAssistMocks.requestAiAssist ).toHaveBeenCalledWith( {
        mode: 'explain_thread',
        threadId: 'thread-1',
      } )
    } )
    expect( slowUiActionMocks.measureSlowUiAction.mock.calls[0][0] ).toMatchObject( {
      action: 'review.explainIssue',
      page: 'Document Versions',
      projectId: 'project-1',
      docId: 'doc-1',
      versionId: 'version-1',
      threadId: 'thread-1',
    } )
  } )

  it( 'expands the selected issue card with one comments table', () => {
    renderPanel()

    expect( screen.getByRole( 'heading', { name: 'New Issue' } ) ).toBeTruthy()
    expect( screen.getByPlaceholderText( 'Describe what happened' ) ).toBeTruthy()
    expect( screen.getByText( 'AI will suggest the issue summary when you create it.' ) ).toBeTruthy()
    expect( screen.queryByPlaceholderText( 'New issue title' ) ).toBeNull()
    expect( screen.getByRole( 'button', { name: 'Create issue' } ) ).toBeTruthy()
    expect( screen.getByRole( 'heading', { name: 'Created Issues' } ) ).toBeTruthy()
    expect( screen.getByText( 'Conversation' ) ).toBeTruthy()
    expect( screen.queryByText( 'Comment view' ) ).toBeNull()
    expect( screen.getByRole( 'button', { name: /Comment/u } ) ).toBeTruthy()
    expect( screen.getAllByText( 'Please add evidence.' ) ).toHaveLength( 1 )
  } )

  it( 'expands the selected issue table row with one comments table', () => {
    renderPanel( { threadsViewMode: 'table' } )

    expect( screen.getByRole( 'heading', { name: 'Created Issues' } ) ).toBeTruthy()
    expect( screen.getByText( 'Conversation' ) ).toBeTruthy()
    expect( screen.getByRole( 'button', { name: /Comment/u } ) ).toBeTruthy()
    expect( screen.getAllByText( 'Please add evidence.' ) ).toHaveLength( 1 )
  } )
} )
