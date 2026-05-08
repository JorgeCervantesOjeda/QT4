import { expect, test, type Page } from '@playwright/test'

const REVIEW_GUARD_DOCUMENT_ID = 'document-e2e-review-guard'
const REVIEW_GUARD_THREAD_ID = 'thread-e2e-review-guard'
const REVIEW_GUARD_THREAD_2_ID = 'thread-e2e-review-guard-2'
const REVIEW_GUARD_COMMENT_2_ID = 'comment-e2e-review-guard-2'
const REVIEW_GRACE_DOCUMENT_ID = 'document-e2e-review-grace'

const login = async ( page: Page, email: string ) => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email' ).fill( email )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
}

const closeSuccessModal = async ( page: Page, message: string ) => {
  await expect( page.getByText( message ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'OK' } ).click()
  await expect( page.getByText( message ) ).toBeHidden()
}

const openVersionsPage = async ( page: Page, documentId: string ) => {
  await page.goto( `/documents/${documentId}/versions` )
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible( { timeout: 10000 } )
  await expect( page.getByRole( 'heading', { name: 'Versions' } ) ).toBeVisible( { timeout: 10000 } )
}

test( 'author is blocked from reopening a closed issue after review expiry but can still reject during grace', async ( { page } ) => {
  await login( page, 'member@example.com' )
  await openVersionsPage( page, REVIEW_GRACE_DOCUMENT_ID )

  await expect( page.getByText( 'Issues: 1 - Open: 0 - Comments: 2' ).last() ).toBeVisible()
  await page.getByText( 'Seeded grace issue' ).first().click()
  await expect( page.locator( '.selected-thread-title' ) ).toContainText( 'Seeded grace issue' )

  await page.getByRole( 'button', { name: 'Reopen issue' } ).click()
  await expect(
    page.getByText( 'To close or reopen issues, the version must be in active review time or grace and you must be the author, leader, or reviewer.' ),
  ).toBeVisible()
  await page.keyboard.press( 'Escape' )

  await expect( page.getByText( 'Issues: 1 - Open: 0 - Comments: 2' ).last() ).toBeVisible()
  await page.getByRole( 'button', { name: 'Reject latest' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Reject latest version' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Latest version rejected successfully.' )

  await expect( page.getByLabel( 'Selected version' ).locator( 'option:checked' ) ).toContainText( 'Rejected' )
} )

test( 'deep link query selects the seeded issue comment and restores card highlight even after table view was selected', async ( { page } ) => {
  const commentCard = page.locator( `#qt4-comment-${REVIEW_GUARD_COMMENT_2_ID}` )

  await login( page, 'member@example.com' )
  await openVersionsPage( page, REVIEW_GUARD_DOCUMENT_ID )

  await expect( page.locator( '.selected-thread-title' ) ).toContainText( 'Seeded resolved issue' )
  await page.getByRole( 'button', { name: 'Table' } ).last().click()

  await page.goto(
    `/documents/${REVIEW_GUARD_DOCUMENT_ID}/versions?threadId=${REVIEW_GUARD_THREAD_ID}&commentId=${REVIEW_GUARD_COMMENT_2_ID}&focus=comments`,
  )

  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( page.locator( '.selected-thread-title' ) ).toContainText( 'Seeded resolved issue' )
  await expect( commentCard ).toBeVisible()
  await expect( commentCard ).toContainText( 'Author seeded resolution comment' )
  await expect( commentCard ).toHaveClass( /comment-card--highlight/ )

  await page.reload()
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( page.locator( '.selected-thread-title' ) ).toContainText( 'Seeded resolved issue' )
  await expect( commentCard ).toBeVisible()
  await expect( commentCard ).toContainText( 'Author seeded resolution comment' )
  await expect( commentCard ).toHaveClass( /comment-card--highlight/ )
} )

test( 'changing seeded issues after a deep link clears the old comment target and keeps the new issue selected', async ( { page } ) => {
  const highlightedCommentCard = page.locator( `#qt4-comment-${REVIEW_GUARD_COMMENT_2_ID}` )

  await login( page, 'member@example.com' )
  await page.goto(
    `/documents/${REVIEW_GUARD_DOCUMENT_ID}/versions?threadId=${REVIEW_GUARD_THREAD_ID}&commentId=${REVIEW_GUARD_COMMENT_2_ID}&focus=comments`,
  )

  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( page.locator( '.selected-thread-title' ) ).toContainText( 'Seeded resolved issue' )
  await expect( highlightedCommentCard ).toHaveClass( /comment-card--highlight/ )

  await page.locator( 'article.project-card' ).filter( { hasText: 'Seeded follow-up issue' } ).click( {
    position: { x: 16, y: 16 },
  } )
  await expect( page.locator( '.selected-thread-title' ) ).toContainText( 'Seeded follow-up issue' )
  await expect( page.getByText( 'Author seeded follow-up comment' ) ).toBeVisible()
  await expect( page ).toHaveURL( new RegExp( `threadId=${REVIEW_GUARD_THREAD_2_ID}` ) )
  await expect( page ).not.toHaveURL( /commentId=/ )
  await expect( highlightedCommentCard ).toHaveCount( 0 )

  await page.reload()
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( page.locator( '.selected-thread-title' ) ).toContainText( 'Seeded follow-up issue' )
  await expect( page.getByText( 'Author seeded follow-up comment' ) ).toBeVisible()
  await expect( page ).toHaveURL( new RegExp( `threadId=${REVIEW_GUARD_THREAD_2_ID}` ) )
  await expect( page ).not.toHaveURL( /commentId=/ )
} )
