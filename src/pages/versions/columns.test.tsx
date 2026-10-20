// src/pages/versions/columns.test.tsx
// Verifies table columns expose user-facing review comment actions.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DataTable from '../../components/DataTable'
import { useCommentColumns } from './columns'
import type { CommentReactionKind, CommentSummary } from './types'

const comments: CommentSummary[] = [
  {
    id: 'comment-1',
    threadId: 'thread-1',
    body: 'Please add evidence.',
    createdBy: 'reviewer-1',
  },
]

function CommentTable( {
  body = comments[0].body,
  counts = { good: 0, regular: 0, bad: 0 },
  currentUserReaction = null,
  onSetCommentReaction,
}: {
  body?: string
  counts?: Record<CommentReactionKind, number>
  currentUserReaction?: CommentReactionKind | null
  onSetCommentReaction: ( comment: CommentSummary, reaction: CommentReactionKind ) => void
} ) {
  const columns = useCommentColumns( {
    formatUserLabel: ( userId: string ) => userId,
    commentReactionsByCommentId: {
      'comment-1': {
        counts,
        currentUserReaction,
      },
    },
    pendingCommentReactionIds: {},
    onSetCommentReaction,
  } )

  return (
    <DataTable
      columns={columns}
      data={[ { ...comments[0], body } ]}
      sorting={[]}
      onSortingChange={vi.fn()}
      tableClassName="data-table--comments"
    />
  )
}

describe( 'useCommentColumns', () => {
  // Integration counterpart: comments-formatting.spec.ts checks the browser's rendered paragraphs.
  it( 'preserves multiline comment text without interpreting markup', () => {
    const body = 'First line\r\n\r\nSecond <strong>paragraph</strong>\nThird line'
    const { container } = render( <CommentTable body={body} onSetCommentReaction={vi.fn()} /> )
    const comment = container.querySelector( '.comment-body-with-reactions > span' )
    expect( comment?.textContent ).toBe( body )
    expect( comment?.querySelector( 'strong' ) ).toBeNull()
  } )

  it( 'renders reaction faces next to the comment body without putting them in the controls', () => {
    const onSetCommentReaction = vi.fn()

    render(
      <CommentTable
        counts={{ good: 2, regular: 1, bad: 2 }}
        onSetCommentReaction={onSetCommentReaction}
      />,
    )

    const goodButton = screen.getByRole( 'button', {
      name: 'Good reaction for comment Please add evidence. 2 Good reactions',
    } )
    const commentCell = screen.getByText( 'Please add evidence.' ).closest( 'td' )
    const reactionCell = goodButton.closest( 'td' )
    expect( goodButton.textContent ).toBe( '😊' )
    expect( goodButton.querySelectorAll( '[data-comment-reaction-kind]' ) ).toHaveLength( 0 )
    expect( reactionCell?.querySelectorAll( '[data-comment-reaction-kind]' ) ).toHaveLength( 0 )
    expect( commentCell?.querySelectorAll( '[data-comment-reaction-kind="good"]' ) ).toHaveLength( 2 )
    expect( commentCell?.querySelectorAll( '[data-comment-reaction-kind="regular"]' ) ).toHaveLength( 1 )
    expect( commentCell?.querySelectorAll( '[data-comment-reaction-kind="bad"]' ) ).toHaveLength( 2 )

    fireEvent.click( goodButton )

    expect( onSetCommentReaction ).toHaveBeenCalledWith( comments[0], 'good' )
  } )

  it( 'shows the current user reaction state in the face controls', () => {
    render(
      <CommentTable
        counts={{ good: 1, regular: 3, bad: 0 }}
        currentUserReaction="regular"
        onSetCommentReaction={vi.fn()}
      />,
    )

    const regularButton = screen.getByRole( 'button', {
      name: 'Regular reaction for comment Please add evidence. 3 Regular reactions',
    } )
    const goodButton = screen.getByRole( 'button', {
      name: 'Good reaction for comment Please add evidence. 1 Good reaction',
    } )

    expect( regularButton.textContent ).toBe( '🤔' )
    expect( regularButton.getAttribute( 'aria-pressed' ) ).toBe( 'true' )
    expect( goodButton.getAttribute( 'aria-pressed' ) ).toBe( 'false' )
  } )

  it( 'does not render a zero-reaction marker next to comments', () => {
    render( <CommentTable onSetCommentReaction={vi.fn()} /> )

    const commentCell = screen.getByText( 'Please add evidence.' ).closest( 'td' )

    expect( commentCell?.querySelector( '.comment-reaction-empty' ) ).toBeNull()
    expect( commentCell?.querySelectorAll( '[data-comment-reaction-kind]' ) ).toHaveLength( 0 )
  } )
} )
