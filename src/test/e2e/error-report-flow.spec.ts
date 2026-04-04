import { expect, test, type Page } from '@playwright/test'

const ERROR_REPORT_BASE_DOCUMENT_ID = 'document-e2e-error-report-base'
const ERROR_REPORT_UNLOCK_DOCUMENT_ID = 'document-e2e-error-report-unlock'
const ERROR_REPORT_BASE_PROJECT_ID = 'project-e2e-error-report-base'

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

const closeErrorModal = async ( page: Page, message: string ) => {
  await expect( page.getByText( message ) ).toBeVisible()
  await page.keyboard.press( 'Escape' )
  await expect( page.getByText( message ) ).toBeHidden()
}

const openVersionsPage = async ( page: Page, documentId: string ) => {
  await page.goto( `/documents/${documentId}/versions` )
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible( { timeout: 10000 } )
  await expect( page.getByRole( 'heading', { name: 'Versions' } ) ).toBeVisible( { timeout: 10000 } )
}

test( 'accepted parent version allows creating an error report from the UI', async ( { page } ) => {
  const reportTitle = 'Playwright Created Error Report'

  await login( page, 'member@example.com' )
  await openVersionsPage( page, ERROR_REPORT_BASE_DOCUMENT_ID )

  await expect( page.getByText( 'No accepted error reports are linked to this version.' ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Create next version' } ).click()
  await closeErrorModal(
    page,
    'To create the next version from an Accepted version, at least one related error report must have latest version in Accepted.',
  )

  await page.getByRole( 'button', { name: 'Create error report' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Create error report' } ) ).toBeVisible()
  await page.getByLabel( 'Title' ).fill( reportTitle )
  await page.getByRole( 'button', { name: 'Confirm' } ).click()

  await expect( page ).toHaveURL( new RegExp( `/documents/[^/]+/versions\\?projectId=${ERROR_REPORT_BASE_PROJECT_ID}$` ) )
  await expect( page.getByText( reportTitle ) ).toBeVisible()
  await expect( page.getByLabel( 'Selected version' ).locator( 'option:checked' ) ).toContainText( 'In Creation' )
} )

test( 'accepted linked error report unlocks next version creation on the parent document', async ( { page } ) => {
  await login( page, 'member@example.com' )
  await openVersionsPage( page, ERROR_REPORT_UNLOCK_DOCUMENT_ID )

  await expect( page.getByText( 'Accepted linked error report' ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Create next version' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Create new version' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Version created successfully.' )

  await expect( page.getByLabel( 'Selected version' ) ).toContainText( '0.02 - In Creation' )
} )
