// src/pages/versions/ReviewIssuesPanel.test.tsx: Verifies slow-action instrumentation in review issue AI controls.
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { createRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewIssuesPanel from './ReviewIssuesPanel'
import { useThreadColumns } from './columns'
import type { CommentSummary, ThreadSummary, VersionSummary } from './types'

const aiAssistMocks = vi.hoisted( () => ( {
  requestAiAssist: vi.fn(),
} ) )

const slowUiActionMocks = vi.hoisted( () => ( {
  measureSlowUiAction: vi.fn(),
} ) )

const scrollIntoViewMock = vi.fn()

vi.mock( '../../lib/aiAssist', () => ( {
  requestAiAssist: aiAssistMocks.requestAiAssist,
} ) )

vi.mock( '../../lib/slowUiAction', () => ( {
  measureSlowUiAction: slowUiActionMocks.measureSlowUiAction,
} ) )

vi.mock( '../../giphy/GiphyProvider', () => ( {
  GiphyInline: () => null,
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

const secondThread: ThreadSummary = {
  id: 'thread-2',
  status: 'open',
  title: 'Another issue',
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

const secondThreadComments: CommentSummary[] = [
  {
    id: 'comment-2',
    threadId: 'thread-2',
    body: 'Please clarify scope.',
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
  // System counterpart: issue-ordering.spec.ts checks the same ID in all browser views.
  it.each( [ 'card', 'table', 'focus' ] as const )( 'shows the permanent issue number in %s', ( threadsViewMode ) => {
    const { result } = renderHook( () => useThreadColumns( {
      formatUserLabel: ( userId ) => userId,
      getThreadCommentWindowMeta: () => ( { label: 'Open' } ),
      requestThreadStatusChangeConfirmation: vi.fn(), isBusy: false,
    } ) )
    renderPanel( { threadsViewMode, threadColumns: result.current,
      threads: [ { ...selectedThread, issueNumber: 7 } ] } )
    if( threadsViewMode === 'table' ) {
      expect( screen.getByRole( 'cell', { name: '7' } ) ).toBeTruthy()
    } else {
      expect( screen.getByText( 'Issue ID: 7' ) ).toBeTruthy()
    }
  } )
  // Linked to threadOrdering.test.ts and issue-ordering.spec.ts system coverage.
  it.each( [ 'card', 'table', 'focus' ] as const )( 'offers both time criteria in %s view', ( threadsViewMode ) => {
    const setThreadsSorting = vi.fn()
    renderPanel( { threadsViewMode, setThreadsSorting } )
    const control = screen.getByRole( 'combobox', { name: 'Issue order' } )
    for( const [ value, id, desc ] of [
      [ 'createdAt:desc', 'createdAt', true ],
      [ 'createdAt:asc', 'createdAt', false ],
      [ 'activityAt:desc', 'activityAt', true ],
      [ 'activityAt:asc', 'activityAt', false ],
    ] as const ) {
      fireEvent.change( control, { target: { value } } )
      expect( setThreadsSorting ).toHaveBeenLastCalledWith( [ { id, desc } ] )
    }
  } )

  it.each( [ 'card', 'table', 'focus' ] as const )( 'renders chronological order in %s with real columns', ( threadsViewMode ) => {
    const { result } = renderHook( () => useThreadColumns( {
      formatUserLabel: ( userId ) => userId,
      getThreadCommentWindowMeta: () => ( { label: 'Open' } ),
      requestThreadStatusChangeConfirmation: vi.fn(),
      isBusy: false,
    } ) )
    const threads = [
      { ...selectedThread, createdAt: new Date( 1000 ), updatedAt: new Date( 5000 ) },
      { ...secondThread, createdAt: new Date( 2000 ), updatedAt: new Date( 3000 ) },
    ]
    const { container, rerender } = renderPanel( {
      threads, threadsViewMode, threadColumns: result.current,
      threadsSorting: [ { id: 'createdAt', desc: true } ],
    } )
    const issueElements = threadsViewMode === 'table'
      ? container.querySelectorAll( 'tbody tr:not(.data-table-row--expanded)' )
      : container.querySelectorAll( threadsViewMode === 'card' ? 'article.project-card' : '.focus-context-carousel__content' )
    expect( issueElements[0]?.textContent ).toContain( secondThread.title )
    expect( issueElements[1]?.textContent ).toContain( selectedThread.title )
    expect( screen.getByRole( 'combobox', { name: 'Issue order' } ) ).toHaveProperty( 'value', 'createdAt:desc' )
    // A fresh render with the same inputs isolates activity ordering from creation ordering.
    rerender( <></> )
    const activity = renderPanel( {
      threads, threadsViewMode, threadColumns: result.current,
      threadsSorting: [ { id: 'activityAt', desc: true } ],
    } )
    const activityElements = activity.container.querySelectorAll( threadsViewMode === 'table'
      ? 'tbody tr:not(.data-table-row--expanded)'
      : threadsViewMode === 'card' ? 'article.project-card' : '.focus-context-carousel__content' )
    expect( activityElements[0]?.textContent ).toContain( selectedThread.title )
    expect( activityElements[1]?.textContent ).toContain( secondThread.title )
  } )

  beforeEach( () => {
    scrollIntoViewMock.mockClear()
    Object.defineProperty( HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    } )
    aiAssistMocks.requestAiAssist.mockResolvedValue( { result: 'Short explanation.' } )
    slowUiActionMocks.measureSlowUiAction.mockImplementation( async ( _context, operation ) => operation() )
  } )

  it( 'measures explain-issue AI requests as modal-protected review actions', async () => {
    renderPanel()

    fireEvent.click( screen.getByRole( 'button', { name: 'Show comments' } ) )
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
      hasModal: true,
      projectId: 'project-1',
      docId: 'doc-1',
      versionId: 'version-1',
      threadId: 'thread-1',
    } )
  }, 30000 )

  it( 'shows writing progress before the AI request starts', async () => {
    let progressVisibleBeforeOperation = false
    let measurementMarkedModal = false
    slowUiActionMocks.measureSlowUiAction.mockImplementationOnce( async ( context, operation ) => {
      progressVisibleBeforeOperation = Boolean( screen.queryByRole( 'heading', { name: 'Improving writing' } ) )
      measurementMarkedModal = context.hasModal === true
      return operation()
    } )

    renderPanel()

    fireEvent.click( screen.getByRole( 'button', { name: 'Show comments' } ) )
    await waitFor( () => {
      expect( screen.getByPlaceholderText( 'Write a comment' ) ).toBeTruthy()
    } )
    expect( ( screen.getByPlaceholderText( 'Write a comment' ) as HTMLTextAreaElement ).value ).toBe( 'Please clarify the evidence source.' )
    expect( ( screen.getByText( 'Improve writing' ).closest( 'button' ) as HTMLButtonElement ).disabled ).toBe( false )
    fireEvent.click( screen.getByText( 'Improve writing' ).closest( 'button' ) as HTMLButtonElement )

    await waitFor( () => {
      expect( aiAssistMocks.requestAiAssist ).toHaveBeenCalledWith( {
        mode: 'improve_text',
        text: 'Please clarify the evidence source.',
        threadId: 'thread-1',
      } )
    } )
    expect( progressVisibleBeforeOperation ).toBe( true )
    expect( measurementMarkedModal ).toBe( true )
  }, 30000 )

  it( 'keeps selected issue card comments hidden by default and lets the user show them', () => {
    renderPanel()

    expect( screen.getByRole( 'heading', { name: 'New Issue' } ) ).toBeTruthy()
    expect( screen.getByPlaceholderText( 'Describe what happened' ) ).toBeTruthy()
    expect( screen.getByText( 'AI will suggest the issue summary when you create it.' ) ).toBeTruthy()
    expect( screen.queryByPlaceholderText( 'New issue title' ) ).toBeNull()
    expect( screen.getByRole( 'button', { name: 'Create issue' } ) ).toBeTruthy()
    expect( screen.getByRole( 'heading', { name: 'Created Issues' } ) ).toBeTruthy()
    expect( screen.queryByText( 'Conversation' ) ).toBeNull()
    expect( screen.queryByText( 'Comment view' ) ).toBeNull()
    expect( screen.getByRole( 'button', { name: 'Show comments' } ) ).toBeTruthy()
    expect( screen.queryByText( 'Please add evidence.' ) ).toBeNull()

    fireEvent.click( screen.getByRole( 'button', { name: 'Show comments' } ) )

    expect( scrollIntoViewMock ).toHaveBeenCalledWith( {
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    } )
    expect( screen.getByRole( 'button', { name: 'Hide comments' } ) ).toBeTruthy()
    expect( screen.getByRole( 'button', { name: /Comment/u } ) ).toBeTruthy()
    expect( screen.getAllByText( 'Please add evidence.' ) ).toHaveLength( 1 )

    fireEvent.click( screen.getByRole( 'button', { name: 'Hide comments' } ) )

    expect( screen.queryByText( 'Please add evidence.' ) ).toBeNull()
    expect( screen.getByRole( 'button', { name: 'Show comments' } ) ).toBeTruthy()
  } )

  it( 'keeps selected issue table comments hidden by default and lets the user show them', () => {
    renderPanel( { threadsViewMode: 'table' } )

    expect( screen.getByRole( 'heading', { name: 'Created Issues' } ) ).toBeTruthy()
    expect( screen.queryByText( 'Conversation' ) ).toBeNull()
    expect( screen.getByRole( 'button', { name: 'Show comments' } ) ).toBeTruthy()
    expect( screen.queryByText( 'Please add evidence.' ) ).toBeNull()

    fireEvent.click( screen.getByRole( 'button', { name: 'Show comments' } ) )

    expect( scrollIntoViewMock ).toHaveBeenCalledWith( {
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    } )
    expect( screen.getByRole( 'button', { name: 'Hide comments' } ) ).toBeTruthy()
    expect( screen.getByRole( 'button', { name: /Comment/u } ) ).toBeTruthy()
    expect( screen.getAllByText( 'Please add evidence.' ) ).toHaveLength( 1 )
  } )

  it( 'offers focus navigation for issue review while keeping comments outside the carousel', () => {
    const selectThreadKeepingViewport = vi.fn()
    renderPanel( {
      threads: [ selectedThread, secondThread ],
      threadsViewMode: 'focus',
      selectThreadKeepingViewport,
    } )

    expect( screen.getByRole( 'region', { name: 'Review issues in focus view' } ) ).toBeTruthy()
    expect( screen.getByText( 'Item 1 of 2' ) ).toBeTruthy()
    expect( screen.getByRole( 'button', { name: 'Show comments' } ) ).toBeTruthy()
    expect( screen.queryByText( 'Please add evidence.' ) ).toBeNull()

    fireEvent.click( screen.getByRole( 'button', { name: /Missing evidence/u } ) )

    expect( screen.getByRole( 'button', { name: 'Hide comments' } ) ).toBeTruthy()

    fireEvent.click( screen.getByRole( 'button', { name: 'Next item' } ) )

    expect( selectThreadKeepingViewport ).toHaveBeenCalledWith( 'thread-2' )
  } )

  it( 'keeps the comment visibility preference when selecting another issue', () => {
    function StatefulPanel() {
      const [selectedThreadId, setSelectedThreadId] = useState( selectedThread.id )
      const threads = [ selectedThread, secondThread ]
      const commentsByThread = {
        [selectedThread.id]: selectedThreadComments,
        [secondThread.id]: secondThreadComments,
      }
      const activeThread = threads.find( ( thread ) => thread.id === selectedThreadId ) ?? selectedThread
      return (
        <ReviewIssuesPanel
          projectId="project-1"
          docId="doc-1"
          selectedVersion={{ ...selectedVersion, numThreads: 2, numOpenThreads: 2, numComments: 2 }}
          reviewIssuesPanelRef={createRef<HTMLElement>()}
          formatUserLabel={( userId ) => userId}
          newThreadTitle=""
          setNewThreadTitle={vi.fn()}
          isBusy={false}
          onCreateThread={vi.fn()}
          isLoadingThreads={false}
          threads={threads}
          threadsViewMode="card"
          setThreadsViewMode={vi.fn()}
          threadColumns={[]}
          threadsSorting={[]}
          setThreadsSorting={vi.fn()}
          setVisibleThreadRows={vi.fn()}
          getThreadCommentWindowMeta={() => ( { state: 'active', label: 'Open' } )}
          effectiveSelectedThreadId={selectedThreadId}
          selectThreadKeepingViewport={setSelectedThreadId}
          commentsByThread={commentsByThread}
          requestThreadStatusChangeConfirmation={vi.fn()}
          selectedThread={activeThread}
          threadNavigationStatusLabel="1 of 2"
          onSelectAdjacentThread={vi.fn()}
          hasPreviousThread={false}
          hasNextThread={true}
          commentsViewMode="card"
          setCommentsViewMode={vi.fn()}
          selectedThreadComments={commentsByThread[activeThread.id] ?? []}
          commentColumns={[ { header: 'Comment', accessorKey: 'body' } ]}
          commentsSorting={[]}
          setCommentsSorting={vi.fn()}
          highlightedCommentId={null}
          commentWindowCountdownLabel={null}
          commentInputRef={createRef<HTMLTextAreaElement>()}
          selectedCommentWindowState="active"
          newCommentBody=""
          setNewCommentBody={vi.fn()}
          onAddComment={vi.fn()}
        />
      )
    }

    render( <StatefulPanel /> )

    expect( screen.queryByText( 'Please add evidence.' ) ).toBeNull()

    fireEvent.click( screen.getByRole( 'button', { name: 'Show comments' } ) )
    expect( screen.getByText( 'Please add evidence.' ) ).toBeTruthy()

    fireEvent.click( screen.getByRole( 'button', { name: 'Select issue Another issue' } ) )

    expect( screen.queryByText( 'Please add evidence.' ) ).toBeNull()
    expect( screen.getByText( 'Please clarify scope.' ) ).toBeTruthy()
    expect( screen.getByRole( 'button', { name: 'Hide comments' } ) ).toBeTruthy()
  } )
} )
