import { expect, test, type Page, type TestInfo } from '@playwright/test'

type FakeFault = {
  operation: string
  pathIncludes?: string
  message: string
  code?: string
  once?: boolean
}

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

const login = async ( page: Page, email: string ) => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email' ).fill( email )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
}

test( 'admin audit shows a visible Files API connection error', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'admin@example.com' )
  await page.route( '**/files-api/me', async ( route ) => {
    await route.fulfill( {
      status: 503,
      contentType: 'text/plain',
      body: 'Simulated Files API outage.',
    } )
  } )

  await page.goto( '/admin/audit' )

  await expect( page.getByText( 'Files API error (503): Simulated Files API outage.' ) ).toBeVisible()
} )

test( 'admin audit shows a visible error when saving runtime providers fails', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'admin@example.com' )
  await setFakeFaults( page, [
    {
      operation: 'firestore.setDoc',
      pathIncludes: 'systemConfig/runtime',
      message: 'Runtime config save failed for testing.',
    },
  ] )

  await page.goto( '/admin/audit' )
  await expect( page.getByText( 'Runtime providers' ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Save providers' } ).click()

  await expect(
    page.getByText( 'Runtime configuration failed to save: Runtime config save failed for testing.' ),
  ).toBeVisible()
} )

test( 'admin audit shows a visible error when the data model update fails', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'admin@example.com' )
  await setFakeFaults( page, [
    {
      operation: 'firestore.getDocs',
      pathIncludes: 'projects',
      message: 'Data model scan failed for testing.',
    },
  ] )

  await page.goto( '/admin/audit' )
  await expect( page.getByText( 'Data model update' ) ).toBeVisible()
  await page.getByRole( 'button', { name: /Update existing data/ } ).click()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()

  await expect( page.getByText( 'Data model update failed: Data model scan failed for testing.' ) ).toBeVisible()
} )

test( 'admin audit shows a visible error when legacy timestamp repair fails', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'admin@example.com' )
  await setFakeFaults( page, [
    {
      operation: 'firestore.getDocs',
      pathIncludes: 'versions',
      message: 'Legacy timestamp scan failed for testing.',
    },
  ] )

  await page.goto( '/admin/audit' )
  await expect( page.getByText( 'Legacy timestamp repair' ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Repair legacy document and version timestamps' } ).click()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()

  await expect(
    page.getByText( 'Legacy timestamp repair failed: Legacy timestamp scan failed for testing.' ),
  ).toBeVisible()
} )

test( 'admin audit calendar view can open a selected log entry', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'admin@example.com' )
  await page.goto( '/admin/audit' )

  await expect( page.getByText( 'Admin Audit' ) ).toBeVisible()
  await page.getByLabel( 'User' ).selectOption( { label: 'Admin User' } )
  await page.getByRole( 'button', { name: 'Run report' } ).click()

  await expect( page.getByText( 'seedAudit' ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Calendar' } ).click()
  await page.getByText( 'seedAudit (system)' ).click()

  await expect( page.getByText( 'Selected log' ) ).toBeVisible()
  await expect( page.getByText( 'Action:' ) ).toBeVisible()
  await expect( page.getByText( 'Entity:' ) ).toBeVisible()
} )
