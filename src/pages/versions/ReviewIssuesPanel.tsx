// Issue and comment workspace for review-time collaboration on the selected version.
import type { ColumnDef, OnChangeFn, SortingState } from '@tanstack/react-table'
import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import { useState } from 'react'
import DataTable from '../../components/DataTable'
import { requestAiAssist } from '../../lib/aiAssist'
import { measureSlowUiAction } from '../../lib/slowUiAction'
import { formatTimeAgoWithTimestamp } from '../../lib/time'
import type { CommentSummary, ThreadSummary, VersionSummary } from './types'
import {
  areThreadsEqual,
  buildCommentAnchorId,
} from './utils'

type CommentWindowMeta = {
  state: string
  label: string
}

type AiAssistTextState = {
  entityId: string
  result: string
  error: string
}

type ReviewIssuesPanelProps = {
  projectId: string
  docId?: string
  selectedVersion: VersionSummary
  reviewIssuesPanelRef: RefObject<HTMLElement | null>
  formatUserLabel: (userId: string) => string
  newThreadTitle: string
  setNewThreadTitle: Dispatch<SetStateAction<string>>
  isBusy: boolean
  onCreateThread: () => void
  isLoadingThreads: boolean
  threads: ThreadSummary[]
  threadsViewMode: 'card' | 'table'
  setThreadsViewMode: Dispatch<SetStateAction<'card' | 'table'>>
  threadColumns: ColumnDef<ThreadSummary>[]
  threadsSorting: SortingState
  setThreadsSorting: OnChangeFn<SortingState>
  setVisibleThreadRows: Dispatch<SetStateAction<ThreadSummary[]>>
  getThreadCommentWindowMeta: (thread?: Pick<ThreadSummary, 'id' | 'status' | 'lastCommentAt'> | null) => CommentWindowMeta
  effectiveSelectedThreadId: string | null
  selectThreadKeepingViewport: (threadId: string) => void
  commentsByThread: Record<string, CommentSummary[]>
  requestThreadStatusChangeConfirmation: (thread: ThreadSummary) => void
  selectedThread: ThreadSummary | null
  threadNavigationStatusLabel: string
  onSelectAdjacentThread: (direction: -1 | 1) => void
  hasPreviousThread: boolean
  hasNextThread: boolean
  commentsViewMode: 'card' | 'table'
  setCommentsViewMode: Dispatch<SetStateAction<'card' | 'table'>>
  selectedThreadComments: CommentSummary[]
  commentColumns: ColumnDef<CommentSummary>[]
  commentsSorting: SortingState
  setCommentsSorting: OnChangeFn<SortingState>
  highlightedCommentId: string | null
  commentWindowCountdownLabel: string | null
  commentInputRef: RefObject<HTMLTextAreaElement | null>
  selectedCommentWindowState: string
  newCommentBody: string
  setNewCommentBody: Dispatch<SetStateAction<string>>
  onAddComment: () => void
}

function ReviewIssuesPanel( props: ReviewIssuesPanelProps ) {
  const {
    selectedVersion,
    reviewIssuesPanelRef,
    formatUserLabel,
    newThreadTitle,
    setNewThreadTitle,
    isBusy,
    onCreateThread,
    isLoadingThreads,
    threads,
    threadsViewMode,
    setThreadsViewMode,
    threadColumns,
    threadsSorting,
    setThreadsSorting,
    setVisibleThreadRows,
    getThreadCommentWindowMeta,
    effectiveSelectedThreadId,
    selectThreadKeepingViewport,
    commentsByThread,
    requestThreadStatusChangeConfirmation,
    selectedThread,
    threadNavigationStatusLabel,
    onSelectAdjacentThread,
    hasPreviousThread,
    hasNextThread,
    commentsViewMode,
    setCommentsViewMode,
    selectedThreadComments,
    commentColumns,
    commentsSorting,
    setCommentsSorting,
    highlightedCommentId,
    commentWindowCountdownLabel,
    commentInputRef,
    selectedCommentWindowState,
    newCommentBody,
    setNewCommentBody,
    onAddComment,
  } = props

  return (
    <section ref={reviewIssuesPanelRef} className="panel stack">
      <h3>Review Issues</h3>
      <p className="muted">
        Reviewers:{' '}
        {( selectedVersion.reviewerIds ?? [] ).length > 0
          ? ( selectedVersion.reviewerIds ?? [] )
              .map( ( reviewerId ) => formatUserLabel( reviewerId ) )
              .join( ', ' )
          : 'None'}
      </p>
      <p className="muted">
        Issues: {selectedVersion.numThreads} - Open: {selectedVersion.numOpenThreads} - Comments: {selectedVersion.numComments}
      </p>
      <div className="stack issue-title-capture">
        <h4>New Issue</h4>
        <div className="actions actions--capture-row">
          <textarea
            className="comment-input comment-input--active"
            value={newThreadTitle}
            onChange={( event ) => setNewThreadTitle( event.target.value )}
            placeholder="Describe what happened"
            disabled={isBusy}
          />
          <button type="button" onClick={onCreateThread} disabled={isBusy}>
            Create issue
          </button>
        </div>
        <p className="issue-title-hint muted">
          AI will suggest the issue summary when you create it.
        </p>
      </div>
      {isLoadingThreads ? (
        <p className="muted">Loading issues...</p>
      ) : threads.length === 0 ? (
        <p className="muted">No issues yet for this version.</p>
      ) : (
        <ThreadBrowser
          selectedVersion={selectedVersion}
          threads={threads}
          threadsViewMode={threadsViewMode}
          setThreadsViewMode={setThreadsViewMode}
          threadColumns={threadColumns}
          threadsSorting={threadsSorting}
          setThreadsSorting={setThreadsSorting}
          setVisibleThreadRows={setVisibleThreadRows}
          getThreadCommentWindowMeta={getThreadCommentWindowMeta}
          effectiveSelectedThreadId={effectiveSelectedThreadId}
          selectThreadKeepingViewport={selectThreadKeepingViewport}
          commentsByThread={commentsByThread}
          requestThreadStatusChangeConfirmation={requestThreadStatusChangeConfirmation}
          formatUserLabel={formatUserLabel}
          isBusy={isBusy}
        />
      )}
      {selectedThread ? (
        <SelectedThreadComments
          selectedThread={selectedThread}
          selectedVersion={selectedVersion}
          projectId={props.projectId}
          docId={props.docId}
          threadNavigationStatusLabel={threadNavigationStatusLabel}
          onSelectAdjacentThread={onSelectAdjacentThread}
          hasPreviousThread={hasPreviousThread}
          hasNextThread={hasNextThread}
          requestThreadStatusChangeConfirmation={requestThreadStatusChangeConfirmation}
          isBusy={isBusy}
          commentsViewMode={commentsViewMode}
          setCommentsViewMode={setCommentsViewMode}
          selectedThreadComments={selectedThreadComments}
          commentColumns={commentColumns}
          commentsSorting={commentsSorting}
          setCommentsSorting={setCommentsSorting}
          highlightedCommentId={highlightedCommentId}
          formatUserLabel={formatUserLabel}
          commentWindowCountdownLabel={commentWindowCountdownLabel}
          commentInputRef={commentInputRef}
          selectedCommentWindowState={selectedCommentWindowState}
          newCommentBody={newCommentBody}
          setNewCommentBody={setNewCommentBody}
          onAddComment={onAddComment}
        />
      ) : null}
    </section>
  )
}

function ThreadBrowser( props: Pick<ReviewIssuesPanelProps,
  'selectedVersion' | 'threads' | 'threadsViewMode' | 'setThreadsViewMode' | 'threadColumns' |
  'threadsSorting' | 'setThreadsSorting' | 'setVisibleThreadRows' | 'getThreadCommentWindowMeta' |
  'effectiveSelectedThreadId' | 'selectThreadKeepingViewport' | 'commentsByThread' |
  'requestThreadStatusChangeConfirmation' | 'formatUserLabel' | 'isBusy'
> ) {
  const {
    selectedVersion,
    threads,
    threadsViewMode,
    setThreadsViewMode,
    threadColumns,
    threadsSorting,
    setThreadsSorting,
    setVisibleThreadRows,
    getThreadCommentWindowMeta,
    effectiveSelectedThreadId,
    selectThreadKeepingViewport,
    commentsByThread,
    requestThreadStatusChangeConfirmation,
    formatUserLabel,
    isBusy,
  } = props

  return (
    <div className="stack">
      <h4>Created Issues</h4>
      <div className="actions">
        <ViewToggle label="Issue view" value={threadsViewMode} onChange={setThreadsViewMode} />
      </div>
      {threadsViewMode === 'table' ? (
        <DataTable
          key={`qt4_table_versions_threads_${selectedVersion.id}`}
          columns={threadColumns}
          data={threads}
          sorting={threadsSorting}
          onSortingChange={setThreadsSorting}
          onVisibleRowsChange={( nextRows ) =>
            setVisibleThreadRows( ( previous ) => ( areThreadsEqual( previous, nextRows ) ? previous : nextRows ) )
          }
          tableClassName="data-table--threads"
          storageKey={`qt4_table_versions_threads_${selectedVersion.id}`}
          getRowClassName={( row ) => {
            const statusClassName = row.status === 'closed'
              ? 'thread-row--closed'
              : getThreadCommentWindowMeta( row ).state === 'expired'
                ? 'thread-row--open-expired'
                : 'thread-row--open'
            return `${statusClassName} ${
              effectiveSelectedThreadId === row.id ? 'data-table-row--selected' : ''
            }`.trim()
          }}
          onRowClick={( row ) => selectThreadKeepingViewport( row.id )}
        />
      ) : (
        <div className="project-grid">
          {threads.map( ( thread ) => {
            const commentWindowMeta = getThreadCommentWindowMeta( thread )
            const threadComments = commentsByThread[thread.id] ?? []
            const latestComment = threadComments[threadComments.length - 1]
            return (
              <details
                key={thread.id}
                open={effectiveSelectedThreadId === thread.id}
                className={`project-card ${
                  thread.status === 'open'
                    ? commentWindowMeta.state === 'expired'
                      ? 'project-card--thread-open-expired'
                      : 'project-card--thread-open'
                    : 'project-card--thread-closed'
                } ${effectiveSelectedThreadId === thread.id ? 'project-card--thread-selected' : ''}`}
              >
                <summary onClick={() => selectThreadKeepingViewport( thread.id )}>
                  <span>{thread.title}</span>
                </summary>
                <p className="muted">Status: {thread.status}</p>
                <p className="muted">Created by: {formatUserLabel( thread.createdBy )}</p>
                <p className="muted">Comments: {commentsByThread[thread.id]?.length ?? thread.commentCount}</p>
                {latestComment ? (
                  <p className="muted">Latest comment: {latestComment.body}</p>
                ) : null}
                <p className={`thread-window thread-window--${commentWindowMeta.state}`}>
                  Comment window: {commentWindowMeta.label}
                </p>
                <div className="thread-conversation">
                  <h5>Conversation</h5>
                  {threadComments.length === 0 ? (
                    <p className="muted">No comments yet.</p>
                  ) : (
                    <div className="comment-list comment-list--thread-card">
                      {threadComments.map( ( comment ) => (
                        <article key={comment.id} className="project-card">
                          <p className="muted">By: {formatUserLabel( comment.createdBy )}</p>
                          <p className="comment-body">{comment.body}</p>
                        </article>
                      ) )}
                    </div>
                  )}
                </div>
                <div className="actions">
                  <button
                    type="button"
                    onClick={( event ) => {
                      event.stopPropagation()
                      requestThreadStatusChangeConfirmation( thread )
                    }}
                    disabled={isBusy}
                  >
                    {thread.status === 'open' ? 'Close' : 'Reopen'}
                  </button>
                </div>
              </details>
            )
          } )}
        </div>
      )}
    </div>
  )
}

function SelectedThreadComments( props: Pick<ReviewIssuesPanelProps,
  'selectedThread' | 'selectedVersion' | 'projectId' | 'docId' | 'threadNavigationStatusLabel' | 'onSelectAdjacentThread' | 'hasPreviousThread' |
  'hasNextThread' | 'requestThreadStatusChangeConfirmation' | 'isBusy' | 'commentsViewMode' |
  'setCommentsViewMode' | 'selectedThreadComments' | 'commentColumns' | 'commentsSorting' |
  'setCommentsSorting' | 'highlightedCommentId' | 'formatUserLabel' | 'commentWindowCountdownLabel' |
  'commentInputRef' | 'selectedCommentWindowState' | 'newCommentBody' | 'setNewCommentBody' | 'onAddComment'
> ) {
  const {
    selectedThread,
    selectedVersion,
    projectId,
    docId,
    threadNavigationStatusLabel,
    onSelectAdjacentThread,
    hasPreviousThread,
    hasNextThread,
    requestThreadStatusChangeConfirmation,
    isBusy,
    commentsViewMode,
    setCommentsViewMode,
    selectedThreadComments,
    commentColumns,
    commentsSorting,
    setCommentsSorting,
    highlightedCommentId,
    formatUserLabel,
    commentWindowCountdownLabel,
    commentInputRef,
    selectedCommentWindowState,
    newCommentBody,
    setNewCommentBody,
    onAddComment,
  } = props
  const [activeAiRequest, setActiveAiRequest] = useState<string | null>( null )
  const [threadAiState, setThreadAiState] = useState<AiAssistTextState | null>( null )
  const [commentAiStates, setCommentAiStates] = useState<Record<string, AiAssistTextState>>( {} )
  const [draftAiState, setDraftAiState] = useState<AiAssistTextState | null>( null )

  if( !selectedThread ) {
    return null
  }

  const explainSelectedThread = async () => {
    const requestKey = `thread:${selectedThread.id}`
    setActiveAiRequest( requestKey )
    setThreadAiState( { entityId: selectedThread.id, result: '', error: '' } )
    try {
      const response = await measureSlowUiAction(
        {
          action: 'review.explainIssue',
          page: 'Document Versions',
          projectId,
          docId,
          versionId: selectedVersion.id,
          threadId: selectedThread.id,
        },
        () => requestAiAssist( {
          mode: 'explain_thread',
          threadId: selectedThread.id,
        } ),
      )
      setThreadAiState( { entityId: selectedThread.id, result: response.result, error: '' } )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected AI error'
      setThreadAiState( { entityId: selectedThread.id, result: '', error: message } )
    } finally {
      setActiveAiRequest( null )
    }
  }

  const explainComment = async (commentId: string) => {
    const requestKey = `comment:${commentId}`
    setActiveAiRequest( requestKey )
    setCommentAiStates( ( previous ) => ( {
      ...previous,
      [commentId]: { entityId: commentId, result: '', error: '' },
    } ) )
    try {
      const response = await measureSlowUiAction(
        {
          action: 'review.explainComment',
          page: 'Document Versions',
          projectId,
          docId,
          versionId: selectedVersion.id,
          threadId: selectedThread.id,
        },
        () => requestAiAssist( {
          mode: 'explain_comment',
          commentId,
        } ),
      )
      setCommentAiStates( ( previous ) => ( {
        ...previous,
        [commentId]: { entityId: commentId, result: response.result, error: '' },
      } ) )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected AI error'
      setCommentAiStates( ( previous ) => ( {
        ...previous,
        [commentId]: { entityId: commentId, result: '', error: message },
      } ) )
    } finally {
      setActiveAiRequest( null )
    }
  }

  const improveDraft = async () => {
    const trimmedBody = newCommentBody.trim()
    if( !trimmedBody ) {
      setDraftAiState( { entityId: selectedThread.id, result: '', error: 'Write text before improving it.' } )
      return
    }
    const requestKey = `draft:${selectedThread.id}`
    setActiveAiRequest( requestKey )
    setDraftAiState( { entityId: selectedThread.id, result: '', error: '' } )
    try {
      const response = await measureSlowUiAction(
        {
          action: 'review.improveWriting',
          page: 'Document Versions',
          projectId,
          docId,
          versionId: selectedVersion.id,
          threadId: selectedThread.id,
        },
        () => requestAiAssist( {
          mode: 'improve_text',
          text: trimmedBody,
          threadId: selectedThread.id,
        } ),
      )
      setDraftAiState( { entityId: selectedThread.id, result: response.result, error: '' } )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected AI error'
      setDraftAiState( { entityId: selectedThread.id, result: '', error: message } )
    } finally {
      setActiveAiRequest( null )
    }
  }

  const selectedThreadAiState = threadAiState?.entityId === selectedThread.id ? threadAiState : null
  const selectedDraftAiState = draftAiState?.entityId === selectedThread.id ? draftAiState : null
  const threadRequestKey = `thread:${selectedThread.id}`
  const draftRequestKey = `draft:${selectedThread.id}`

  return (
    <div className="stack">
      <p className="muted selected-thread-title">
        Selected issue: <span>{selectedThread.title}</span>
      </p>
      <div className="actions actions--thread-navigation">
        <p className="thread-navigation-status muted">{threadNavigationStatusLabel}</p>
        <div className="thread-navigation-buttons">
          <button type="button" onClick={() => onSelectAdjacentThread( -1 )} disabled={isBusy || !hasPreviousThread}>
            Previous issue
          </button>
          <button type="button" onClick={() => onSelectAdjacentThread( 1 )} disabled={isBusy || !hasNextThread}>
            Next issue
          </button>
        </div>
      </div>
      <div className="actions">
        <button type="button" onClick={() => requestThreadStatusChangeConfirmation( selectedThread )} disabled={isBusy}>
          {selectedThread.status === 'open' ? 'Close issue' : 'Reopen issue'}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={explainSelectedThread}
          disabled={isBusy || activeAiRequest !== null}
        >
          {activeAiRequest === threadRequestKey ? 'Explaining issue...' : 'Explain issue'}
        </button>
      </div>
      {selectedThreadAiState || activeAiRequest === threadRequestKey ? (
        <AiAssistPanel
          title="Issue explanation"
          isLoading={activeAiRequest === threadRequestKey}
          result={selectedThreadAiState?.result ?? ''}
          error={selectedThreadAiState?.error ?? ''}
        />
      ) : null}
      <div className="actions">
        <ViewToggle label="Comment view" value={commentsViewMode} onChange={setCommentsViewMode} />
      </div>
      {selectedThreadComments.length === 0 ? (
        <p className="muted">No comments yet.</p>
      ) : commentsViewMode === 'table' ? (
        <DataTable
          key={`qt4_table_versions_thread_comments_${selectedThread.id}`}
          columns={commentColumns}
          data={selectedThreadComments}
          sorting={commentsSorting}
          onSortingChange={setCommentsSorting}
          tableClassName="data-table--comments"
          storageKey={`qt4_table_versions_thread_comments_${selectedThread.id}`}
          getRowClassName={( row ) =>
            highlightedCommentId === row.id ? 'data-table-row--selected comment-row--highlight' : ''
          }
        />
      ) : (
        <div className="comment-list">
          {selectedThreadComments.map( ( comment ) => (
            <article
              id={buildCommentAnchorId( comment.id )}
              key={comment.id}
              className={`project-card ${highlightedCommentId === comment.id ? 'comment-card--highlight' : ''}`.trim()}
            >
              <p className="muted">By: {formatUserLabel( comment.createdBy )}</p>
              <p className="muted">{formatTimeAgoWithTimestamp( comment.createdAt )}</p>
              <p className="comment-body">{comment.body}</p>
              <div className="actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => explainComment( comment.id )}
                  disabled={isBusy || activeAiRequest !== null}
                >
                  {activeAiRequest === `comment:${comment.id}` ? 'Explaining comment...' : 'Explain comment'}
                </button>
              </div>
              {commentAiStates[comment.id] || activeAiRequest === `comment:${comment.id}` ? (
                <AiAssistPanel
                  title="Comment explanation"
                  isLoading={activeAiRequest === `comment:${comment.id}`}
                  result={commentAiStates[comment.id]?.result ?? ''}
                  error={commentAiStates[comment.id]?.error ?? ''}
                />
              ) : null}
            </article>
          ) )}
        </div>
      )}
      {commentWindowCountdownLabel ? <p className="muted">{commentWindowCountdownLabel}</p> : null}
      <div className="actions actions--capture-row">
        <textarea
          ref={commentInputRef}
          className={`comment-input comment-input--${selectedCommentWindowState}`}
          value={newCommentBody}
          onChange={( event ) => setNewCommentBody( event.target.value )}
          placeholder="Write a comment"
          disabled={isBusy}
        />
        <button type="button" onClick={onAddComment} disabled={isBusy}>
          Add comment
        </button>
        <button
          type="button"
          className="ghost"
          onClick={improveDraft}
          disabled={isBusy || activeAiRequest !== null || !newCommentBody.trim()}
        >
          {activeAiRequest === draftRequestKey ? 'Improving writing...' : 'Improve writing'}
        </button>
      </div>
      {selectedDraftAiState || activeAiRequest === draftRequestKey ? (
        <AiAssistPanel
          title="Writing suggestion"
          isLoading={activeAiRequest === draftRequestKey}
          result={selectedDraftAiState?.result ?? ''}
          error={selectedDraftAiState?.error ?? ''}
          action={selectedDraftAiState?.result ? (
            <button type="button" className="ghost" onClick={() => setNewCommentBody( selectedDraftAiState.result )}>
              Use improved text
            </button>
          ) : null}
        />
      ) : null}
    </div>
  )
}

function AiAssistPanel( {
  title,
  isLoading,
  result,
  error,
  action,
}: {
  title: string
  isLoading: boolean
  result: string
  error: string
  action?: ReactNode
} ) {
  return (
    <div className="ai-assist-panel">
      <div className="panel-header">
        <h4>{title}</h4>
        {action ? <div className="actions">{action}</div> : null}
      </div>
      {isLoading ? <p className="muted">Working...</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {result ? <p className="ai-assist-result">{result}</p> : null}
    </div>
  )
}

function ViewToggle( {
  label,
  value,
  onChange,
}: {
  label: string
  value: 'card' | 'table'
  onChange: Dispatch<SetStateAction<'card' | 'table'>>
} ) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="view-toggle">
        <button type="button" aria-pressed={value === 'card'} onClick={() => onChange( 'card' )}>
          Cards
        </button>
        <button type="button" aria-pressed={value === 'table'} onClick={() => onChange( 'table' )}>
          Table
        </button>
      </div>
    </label>
  )
}

export default ReviewIssuesPanel
