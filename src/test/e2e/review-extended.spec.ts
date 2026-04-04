import { expect, test, type Page } from '@playwright/test'

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
