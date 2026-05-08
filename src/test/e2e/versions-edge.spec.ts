import { expect, test, type Page, type TestInfo } from '@playwright/test'

type FakeFault = {
  operation: string
  pathIncludes?: string
  message: string
  code?: string
  once?: boolean
}

const ERROR_REPORT_UNLOCK_DOCUMENT_ID = 'document-e2e-error-report-unlock'

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

const closeSuccessModal = async (page: Page, message: string) => {
  await expect( page.getByText( message ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'OK' } ).click()
  await expect( page.getByText( message ) ).toBeHidden()
}

const createInCreationDocumentWithReviewer = async (page: Page, label: string) => {
  const projectName = `${label} Project`
  const documentTitle = `${label} Document`

  await page.getByRole( 'link', { name: 'Go to Projects' } ).click()
  await expect( page.getByText( 'Projects' ) ).toBeVisible()

  await page.getByLabel( 'Name' ).fill( projectName )
  await page.getByRole( 'button', { name: 'Create project' } ).click()
  await closeSuccessModal( page, 'Project created successfully.' )

  const projectCard = page.locator( 'article.project-card' ).filter( { hasText: projectName } )
  await expect( projectCard ).toBeVisible()
  await projectCard.getByRole( 'textbox', { name: 'Add member (email)' } ).fill( 'reviewer@example.com' )
  await projectCard.getByRole( 'button', { name: 'Add member' } ).click()
  await expect( page.getByText( 'Member added successfully.' ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'OK' } ).click()
  await expect( page.getByText( 'Member added successfully.' ) ).toBeHidden()

  await projectCard.getByRole( 'heading', { name: new RegExp( projectName ) } ).click()
  await expect( page.getByText( 'Project Documents' ) ).toBeVisible()

  await page.getByLabel( 'Title' ).fill( documentTitle )
  await page.getByRole( 'button', { name: 'Create document' } ).click()
  await closeSuccessModal( page, 'Document created successfully.' )

  await page.locator( 'article.project-card h3' ).filter( { hasText: documentTitle } ).click()
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( page.getByText( 'Version 0.01' ) ).toBeVisible()
}

test( 'versions page shows the accepted-error-report fallback when linked reports fail to load', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'member@example.com' )
  await setFakeFaults( page, [
    {
      operation: 'firestore.getDocs',
      pathIncludes: 'documents',
      message: 'Accepted error reports lookup failed for testing.',
      once: false,
    },
  ] )

  await page.goto( `/documents/${ERROR_REPORT_UNLOCK_DOCUMENT_ID}/versions` )

  await expect( page.getByText( 'Accepted error reports could not be loaded right now.' ) ).toBeVisible()
} )

test( 'versions page shows a visible error when reviewer assignment is denied', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'member@example.com' )
  await createInCreationDocumentWithReviewer( page, 'Reviewer Permission Error' )
  await setFakeFaults( page, [
    {
      operation: 'firestore.updateDoc',
      pathIncludes: 'versions/',
      message: 'Missing or insufficient permissions.',
      code: 'permission-denied',
    },
  ] )

  const reviewerRow = page.locator( 'tr' ).filter( { hasText: 'reviewer@example.com' } )
  await reviewerRow.locator( 'input[type="checkbox"]' ).click()

  await expect( page.getByText( 'Missing or insufficient permissions.' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )

test( 'versions page shows a visible error when author assignment is denied', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'member@example.com' )
  await createInCreationDocumentWithReviewer( page, 'Author Permission Error' )
  await setFakeFaults( page, [
    {
      operation: 'firestore.writeBatch.commit',
      pathIncludes: 'documents/',
      message: 'Author assignment failed for testing.',
      code: 'permission-denied',
    },
  ] )

  const reviewerRow = page.locator( 'tr' ).filter( { hasText: 'reviewer@example.com' } )
  await reviewerRow.locator( 'input[type="radio"]' ).click()

  await expect( page.getByText( 'Author assignment failed for testing.' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )
