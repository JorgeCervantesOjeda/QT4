import { expect, test, type Page } from '@playwright/test'

const REVIEW_FLOW_DOCUMENT_ID = 'document-e2e-review-flow'
const REVIEW_GUARD_DOCUMENT_ID = 'document-e2e-review-guard'

const login = async ( page: Page, email: string ) => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email' ).fill( email )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
}

const logout = async ( page: Page ) => {
  await page.getByRole( 'button', { name: 'Log out' } ).click()
  await expect( page ).toHaveURL( /\/login/ )
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

test( 'reviewer and author can resolve an issue and accept the latest version', async ( { page } ) => {
  const issueTitle = 'Playwright seeded issue'

  await login( page, 'reviewer@example.com' )
  await openVersionsPage( page, REVIEW_FLOW_DOCUMENT_ID )
  await expect( page.getByText( 'Review Issues' ) ).toBeVisible()

  await page.getByPlaceholder( 'New issue title' ).fill( issueTitle )
  await page.getByRole( 'button', { name: 'Create issue' } ).click()
  await closeSuccessModal( page, 'Issue created successfully.' )

  await expect( page.locator( '.selected-thread-title' ) ).toContainText( issueTitle )
  await page.getByPlaceholder( 'Write a comment' ).fill( 'Reviewer opens the issue for discussion.' )
  await page.getByRole( 'button', { name: 'Add comment' } ).click()
  await closeSuccessModal( page, 'The comment was added successfully.' )

  await logout( page )

  await login( page, 'member@example.com' )
  await openVersionsPage( page, REVIEW_FLOW_DOCUMENT_ID )

  await expect( page.getByText( issueTitle ).first() ).toBeVisible()
  await page.getByText( issueTitle ).first().click()
  await page.getByPlaceholder( 'Write a comment' ).fill( 'Author confirms the issue is resolved.' )
  await page.getByRole( 'button', { name: 'Add comment' } ).click()
  await closeSuccessModal( page, 'The comment was added successfully.' )

  await expect( page.getByText( 'Issues: 1 - Open: 1 - Comments: 2' ).last() ).toBeVisible()
  await page.getByRole( 'button', { name: 'Close issue' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Close issue' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Issue closed successfully.' )

  await expect( page.getByText( 'Issues: 1 - Open: 0 - Comments: 2' ).last() ).toBeVisible()
  await page.getByRole( 'button', { name: 'Accept latest' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Accept latest version' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Latest version accepted successfully.' )

  await expect( page.getByLabel( 'Selected version' ).locator( 'option:checked' ) ).toContainText( 'Accepted' )
} )

test( 'reviewer cannot accept the latest version without author or leader privileges', async ( { page } ) => {
  await login( page, 'reviewer@example.com' )
  await openVersionsPage( page, REVIEW_GUARD_DOCUMENT_ID )

  await expect( page.getByText( 'Issues: 2 - Open: 1 - Comments: 3' ).last() ).toBeVisible()
  await page.getByRole( 'button', { name: 'Accept latest' } ).click()

  await expect(
    page.getByText( 'you must be author, leader, or admin.' ),
  ).toBeVisible()
  await page.keyboard.press( 'Escape' )

  await expect( page.getByLabel( 'Selected version' ).locator( 'option:checked' ) ).toContainText( 'In Review' )
} )

test( 'review issue state stays synchronized across two open tabs without reload', async ( { page } ) => {
  const issueTitle = 'Concurrent snapshot issue'
  const reviewerComment = 'Reviewer opens a live multi-tab discussion.'
  const followUpComment = 'Reviewer resolves the discussion from the second tab.'

  await login( page, 'reviewer@example.com' )
  await openVersionsPage( page, REVIEW_FLOW_DOCUMENT_ID )

  const mirrorPage = await page.context().newPage()
  try {
    await openVersionsPage( mirrorPage, REVIEW_FLOW_DOCUMENT_ID )

    await page.getByPlaceholder( 'New issue title' ).fill( issueTitle )
    await page.getByRole( 'button', { name: 'Create issue' } ).click()
    await closeSuccessModal( page, 'Issue created successfully.' )
    await expect( page.locator( '.selected-thread-title' ) ).toContainText( issueTitle )

    await page.getByPlaceholder( 'Write a comment' ).fill( reviewerComment )
    await page.getByRole( 'button', { name: 'Add comment' } ).click()
    await closeSuccessModal( page, 'The comment was added successfully.' )

    const mirrorIssueCard = mirrorPage.locator( 'article.project-card' ).filter( { hasText: issueTitle } )
    await expect( mirrorIssueCard ).toBeVisible( { timeout: 10000 } )
    await expect( mirrorPage.getByText( 'Issues: 1 - Open: 1 - Comments: 1' ).last() ).toBeVisible()

    await mirrorIssueCard.click( { position: { x: 16, y: 16 } } )
    await expect( mirrorPage.locator( '.selected-thread-title' ) ).toContainText( issueTitle )
    await expect( mirrorPage.getByText( reviewerComment ) ).toBeVisible()

    await mirrorPage.getByPlaceholder( 'Write a comment' ).fill( followUpComment )
    await mirrorPage.getByRole( 'button', { name: 'Add comment' } ).click()
    await closeSuccessModal( mirrorPage, 'The comment was added successfully.' )

    await expect( page.locator( '.selected-thread-title' ) ).toContainText( issueTitle )
    await expect( page.getByText( followUpComment ) ).toBeVisible( { timeout: 10000 } )
    await expect( page.getByText( 'Issues: 1 - Open: 1 - Comments: 2' ).last() ).toBeVisible()

    await mirrorPage.getByRole( 'button', { name: 'Close issue' } ).click()
    await expect( mirrorPage.getByRole( 'heading', { name: 'Close issue' } ) ).toBeVisible()
    await mirrorPage.getByRole( 'button', { name: 'Confirm' } ).click()
    await closeSuccessModal( mirrorPage, 'Issue closed successfully.' )
    await expect( mirrorPage.getByText( 'Issues: 1 - Open: 0 - Comments: 2' ).last() ).toBeVisible()

    await expect( page.locator( '.selected-thread-title' ) ).toContainText( issueTitle )
    await expect( page.getByText( 'Issues: 1 - Open: 0 - Comments: 2' ).last() ).toBeVisible( { timeout: 10000 } )
    await expect( page.getByRole( 'button', { name: 'Reopen issue' } ) ).toBeVisible()
    await expect( page.getByText( followUpComment ) ).toBeVisible()
  } finally {
    await mirrorPage.close()
  }
} )
