import { expect, test, type Page, type TestInfo } from '@playwright/test'

type EmulatorFault = {
  operation: string
  pathIncludes?: string
  message: string
  code?: string
  once?: boolean
}

const UI_NOTIFY_DOCUMENT_ID = 'document-e2e-ui-notify'

const skipUnlessEmulatorBackend = (testInfo: TestInfo) => {
  test.skip(
    testInfo.project.use.baseURL !== 'http://127.0.0.1:4174',
    'This suite targets the Firebase emulator backend.',
  )
}

const setEmulatorFaults = async (page: Page, faults: EmulatorFault[]) => {
  await page.evaluate( (nextFaults) => {
    window.localStorage.setItem( 'qt4_test_faults_v1', JSON.stringify( nextFaults ) )
  }, faults )
}

const login = async (page: Page, email: string) => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email' ).fill( email )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
}

const openVersionsPage = async ( page: Page, documentId: string ) => {
  await page.goto( `/documents/${documentId}/versions` )
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible( { timeout: 10000 } )
  await expect( page.getByRole( 'heading', { name: 'Versions' } ) ).toBeVisible( { timeout: 10000 } )
}

const closeSuccessModal = async ( page: Page, message: string ) => {
  await expect( page.getByText( message ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'OK' } ).click()
  await expect( page.getByText( message ) ).toBeHidden()
}

const createDocumentVersion = async (page: Page, label: string) => {
  const projectName = `${label} Project`
  const documentTitle = `${label} Document`

  await page.getByRole( 'link', { name: 'Go to Projects' } ).click()
  await expect( page.getByText( 'Projects' ) ).toBeVisible()

  await page.getByLabel( 'Name' ).fill( projectName )
  await page.getByRole( 'button', { name: 'Create project' } ).click()
  await expect( page.getByText( 'Project created successfully.' ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'OK' } ).click()
  await page.locator( 'article.project-card h3' ).filter( { hasText: projectName } ).click()

  await expect( page.getByText( 'Project Documents' ) ).toBeVisible()
  await page.getByLabel( 'Title' ).fill( documentTitle )
  await page.getByRole( 'button', { name: 'Create document' } ).click()
  await expect( page.getByText( 'Document created successfully.' ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'OK' } ).click()
  await page.locator( 'article.project-card h3' ).filter( { hasText: documentTitle } ).click()

  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( page.getByText( 'Version 0.01' ) ).toBeVisible()
}

test( 'dashboard shows a visible error when refresh fails on emulators', async ( { page }, testInfo ) => {
  skipUnlessEmulatorBackend( testInfo )
  await login( page, 'member@example.com' )

  await setEmulatorFaults( page, [
    {
      operation: 'dashboard.refresh',
      message: 'Dashboard refresh blocked for testing.',
    },
  ] )

  await page.getByRole( 'button', { name: 'Refresh all sections' } ).click()

  await expect( page.getByText( 'Dashboard tasks failed: Dashboard refresh blocked for testing.' ).first() ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )

test( 'dashboard shows a visible error when task listeners fail on emulators', async ( { page }, testInfo ) => {
  skipUnlessEmulatorBackend( testInfo )

  await page.goto( '/login' )
  await setEmulatorFaults( page, [
    {
      operation: 'dashboard.tasks.onSnapshot',
      pathIncludes: 'dashboard/user-member-1/tasks',
      message: 'Dashboard tasks snapshot failed for testing.',
    },
  ] )

  await page.getByLabel( 'Email' ).fill( 'member@example.com' )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()

  await expect( page.getByText( 'Dashboard tasks failed to load: Dashboard tasks snapshot failed for testing.' ).first() ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )

test( 'versions page shows a visible error when upload fails on emulators', async ( { page }, testInfo ) => {
  skipUnlessEmulatorBackend( testInfo )
  await login( page, 'member@example.com' )
  await createDocumentVersion( page, 'Emulator Upload Error' )

  await setEmulatorFaults( page, [
    {
      operation: 'storage.uploadBytes',
      message: 'Upload blocked for testing.',
    },
  ] )

  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v1.txt' )

  await expect( page.getByText( 'Upload blocked for testing.' ).first() ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Close' } ) ).toBeVisible()
} )

test( 'versions page shows a visible error when download fails on emulators', async ( { page }, testInfo ) => {
  skipUnlessEmulatorBackend( testInfo )
  await login( page, 'member@example.com' )
  await createDocumentVersion( page, 'Emulator Download Error' )

  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v1.txt' )
  await expect( page.getByText( 'Uploaded: draft-v1.txt' ) ).toBeVisible()

  await setEmulatorFaults( page, [
    {
      operation: 'storage.getDownloadURL',
      message: 'Download blocked for testing.',
    },
  ] )

  await page.getByRole( 'button', { name: 'Download file' } ).last().click()

  await expect( page.getByText( 'Download blocked for testing.' ).first() ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )

test( 'versions page shows a visible warning when notify fails on emulators', async ( { page }, testInfo ) => {
  skipUnlessEmulatorBackend( testInfo )
  await login( page, 'reviewer@example.com' )
  await openVersionsPage( page, UI_NOTIFY_DOCUMENT_ID )

  await setEmulatorFaults( page, [
    {
      operation: 'notifications.notifyEmail',
      message: 'Notify failed (503): Simulated notify outage.',
    },
  ] )

  const issueTitle = 'Emulator notify failure issue'
  await page.getByPlaceholder( 'New issue title' ).fill( issueTitle )
  await page.getByRole( 'button', { name: 'Create issue' } ).click()
  await closeSuccessModal( page, 'Issue created successfully.' )

  await page.getByPlaceholder( 'Write a comment' ).fill( 'This comment should trigger a notification failure.' )
  await page.getByRole( 'button', { name: 'Add comment' } ).click()
  await closeSuccessModal( page, 'The comment was added successfully.' )

  await expect(
    page.getByText( 'Comment added, but email notification failed: Notify failed (503): Simulated notify outage.' ),
  ).toBeVisible()
} )
