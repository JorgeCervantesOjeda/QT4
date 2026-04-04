import { expect, test, type Page, type TestInfo } from '@playwright/test'

type FakeFault = {
  operation: string
  pathIncludes?: string
  message: string
  code?: string
  once?: boolean
}

const REVIEW_FLOW_DOCUMENT_ID = 'document-e2e-review-flow'
const REVIEW_GUARD_DOCUMENT_ID = 'document-e2e-review-guard'

const skipUnlessFakeBackend = (testInfo: TestInfo) => {
  test.skip(
    testInfo.project.use.baseURL !== 'http://127.0.0.1:4173',
    'This suite uses the fake backend fault injector.',
  )
}

const setFakeFaults = async (page: Page, faults: FakeFault[]) => {
  await page.evaluate( (nextFaults) => {
    window.localStorage.setItem( 'qt4_fake_faults_v1', JSON.stringify( nextFaults ) )
  }, faults )
}

const login = async (page: Page, email: string) => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email' ).fill( email )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
}

const openVersionsPage = async (page: Page, documentId: string) => {
  await page.goto( `/documents/${documentId}/versions` )
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible( { timeout: 10000 } )
}

test( 'versions page shows a visible error when the document snapshot fails', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'member@example.com' )
  await setFakeFaults( page, [
    {
      operation: 'firestore.onSnapshot',
      pathIncludes: `documents/${REVIEW_FLOW_DOCUMENT_ID}`,
      message: 'Document snapshot failed for testing.',
    },
  ] )

  await page.goto( `/documents/${REVIEW_FLOW_DOCUMENT_ID}/versions` )

  await expect( page.getByText( 'Document failed to load: Document snapshot failed for testing.' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )

test( 'versions page shows a visible error when the version subscription fails', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'member@example.com' )
  await setFakeFaults( page, [
    {
      operation: 'firestore.onSnapshot',
      pathIncludes: 'versions',
      message: 'Versions subscription failed for testing.',
    },
  ] )

  await page.goto( `/documents/${REVIEW_FLOW_DOCUMENT_ID}/versions` )

  await expect( page.getByText( 'Versions failed to load: Versions subscription failed for testing.' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )

test( 'versions page shows a visible error when the issues subscription fails', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'member@example.com' )
  await setFakeFaults( page, [
    {
      operation: 'firestore.onSnapshot',
      pathIncludes: 'threads',
      message: 'Issues subscription failed for testing.',
    },
  ] )

  await openVersionsPage( page, REVIEW_GUARD_DOCUMENT_ID )

  await expect( page.getByText( 'Issues failed to load: Issues subscription failed for testing.' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )

test( 'versions page shows a visible error when the comments subscription fails', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'member@example.com' )
  await setFakeFaults( page, [
    {
      operation: 'firestore.onSnapshot',
      pathIncludes: 'comments',
      message: 'Comments subscription failed for testing.',
    },
  ] )

  await openVersionsPage( page, REVIEW_GUARD_DOCUMENT_ID )

  await expect( page.getByText( 'Comments failed to load: Comments subscription failed for testing.' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )
