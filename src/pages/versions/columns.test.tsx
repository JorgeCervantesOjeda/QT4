// src/pages/versions/columns.test.tsx
// Verifies table columns expose user-facing review comment actions.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DataTable from '../../components/DataTable'
import { useCommentColumns } from './columns'
import type { CommentSummary } from './types'

const comments: CommentSummary[] = [
  {
    id: 'comment-1',
    threadId: 'thread-1',
    body: 'Please add evidence.',
    createdBy: 'reviewer-1',
  },
]

function CommentTable( {
  count,
  likedByCurrentUser = false,
  onToggleCommentLike,
}: {
  count: number
  likedByCurrentUser?: boolean
  onToggleCommentLike: (comment: CommentSummary) => void
} ) {
  const columns = useCommentColumns( {
    formatUserLabel: ( userId: string ) => userId,
    commentLikesByCommentId: {
      'comment-1': {
        count,
        likedByCurrentUser,
      },
    },
    pendingCommentLikeIds: {},
    onToggleCommentLike,
  } )

  return (
    <DataTable
      columns={columns}
      data={comments}
      sorting={[]}
      onSortingChange={vi.fn()}
      tableClassName="data-table--comments"
    />
  )
}

describe( 'useCommentColumns', () => {
  it( 'renders a like count action for each comment', () => {
    const onToggleCommentLike = vi.fn()

    render( <CommentTable count={2} onToggleCommentLike={onToggleCommentLike} /> )

    const likeButton = screen.getByRole( 'button', {
      name: 'Like comment Please add evidence. 2 likes',
    } )
    const commentCell = screen.getByText( 'Please add evidence.' ).closest( 'td' )
    const likeCell = likeButton.closest( 'td' )
    expect( likeButton.textContent ).toBe( 'Like' )
    expect( likeButton.querySelectorAll( '[data-like-value="1"]' ) ).toHaveLength( 0 )
    expect( likeCell?.querySelectorAll( '[data-like-value="1"]' ) ).toHaveLength( 0 )
    expect( commentCell?.querySelectorAll( '[data-like-value="1"]' ) ).toHaveLength( 2 )

    fireEvent.click( likeButton )

    expect( onToggleCommentLike ).toHaveBeenCalledWith( comments[0] )
  } )

  it( 'shows the current user like state in the button', () => {
    render( <CommentTable count={2} likedByCurrentUser={true} onToggleCommentLike={vi.fn()} /> )

    const likeButton = screen.getByRole( 'button', {
      name: 'Unlike comment Please add evidence. 2 likes',
    } )

    expect( likeButton.textContent ).toBe( 'Unlike' )
    expect( likeButton.getAttribute( 'aria-pressed' ) ).toBe( 'true' )
  } )

  it( 'substitutes every ten individual like hands with a ten-value hand', () => {
    render( <CommentTable count={24} onToggleCommentLike={vi.fn()} /> )

    const likeButton = screen.getByRole( 'button', {
      name: 'Like comment Please add evidence. 24 likes',
    } )

    const commentCell = screen.getByText( 'Please add evidence.' ).closest( 'td' )
    const likeCell = likeButton.closest( 'td' )
    expect( likeButton.querySelectorAll( '[data-like-value]' ) ).toHaveLength( 0 )
    expect( likeCell?.querySelectorAll( '[data-like-value]' ) ).toHaveLength( 0 )
    expect( commentCell?.querySelectorAll( '[data-like-value="100"]' ) ).toHaveLength( 0 )
    expect( commentCell?.querySelectorAll( '[data-like-value="10"]' ) ).toHaveLength( 2 )
    expect( commentCell?.querySelectorAll( '[data-like-value="1"]' ) ).toHaveLength( 4 )
  } )

  it( 'substitutes every hundred likes with a hundred-value hand', () => {
    render( <CommentTable count={117} onToggleCommentLike={vi.fn()} /> )

    const likeButton = screen.getByRole( 'button', {
      name: 'Like comment Please add evidence. 117 likes',
    } )

    const commentCell = screen.getByText( 'Please add evidence.' ).closest( 'td' )
    const likeCell = likeButton.closest( 'td' )
    expect( likeButton.querySelectorAll( '[data-like-value]' ) ).toHaveLength( 0 )
    expect( likeCell?.querySelectorAll( '[data-like-value]' ) ).toHaveLength( 0 )
    expect( commentCell?.querySelectorAll( '[data-like-value="100"]' ) ).toHaveLength( 1 )
    expect( commentCell?.querySelectorAll( '[data-like-value="10"]' ) ).toHaveLength( 1 )
    expect( commentCell?.querySelectorAll( '[data-like-value="1"]' ) ).toHaveLength( 7 )
  } )

  it( 'does not render a zero-like marker next to comments', () => {
    render( <CommentTable count={0} onToggleCommentLike={vi.fn()} /> )

    const commentCell = screen.getByText( 'Please add evidence.' ).closest( 'td' )

    expect( commentCell?.querySelector( '.comment-like-empty' ) ).toBeNull()
    expect( commentCell?.querySelectorAll( '[data-like-value]' ) ).toHaveLength( 0 )
  } )
} )
