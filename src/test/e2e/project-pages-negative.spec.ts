import { expect, test, type Page, type TestInfo } from '@playwright/test'

type FakeFault = {
  operation: string
  pathIncludes?: string
  message: string
  code?: string
  once?: boolean
}

const REVIEW_FLOW_PROJECT_ID = 'project-e2e-review-flow'

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

test( 'projects page validates add-member input and blocks unknown or duplicate members', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'member@example.com' )
  await page.goto( '/projects' )

  await expect( page.getByRole( 'heading', { name: 'My projects' } ) ).toBeVisible()
  const leaderProjectForm = page.locator( 'form' ).filter( { has: page.getByRole( 'combobox', { name: 'Project' } ) } )
  await page.getByRole( 'combobox', { name: 'Project' } ).selectOption( { label: '201 - Seeded Review Flow Project' } )

  const memberInput = leaderProjectForm.getByRole( 'textbox', { name: 'Add member (email)' } )
  await memberInput.fill( 'not-an-email' )
  await leaderProjectForm.getByRole( 'button', { name: 'Add member' } ).click()
  await expect( leaderProjectForm.getByText( 'Provide a valid email address.' ) ).toBeVisible()

  await memberInput.fill( 'missing-user@example.com' )
  await leaderProjectForm.getByRole( 'button', { name: 'Add member' } ).click()
  await expect( leaderProjectForm.getByText( 'No user found for that email address.' ) ).toBeVisible()

  await memberInput.fill( 'reviewer@example.com' )
  await leaderProjectForm.getByRole( 'button', { name: 'Add member' } ).click()
  await expect( leaderProjectForm.getByText( 'That user is already a project member.' ) ).toBeVisible()
} )

test( 'projects page shows a visible error when project lookup fails', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'member@example.com' )
  await setFakeFaults( page, [
    {
      operation: 'firestore.getDoc',
      pathIncludes: 'projects/project-e2e-review-flow',
      message: 'Project lookup failed for testing.',
    },
  ] )

  await page.goto( '/projects' )

  await expect( page.getByText( 'Project lookup failed for testing.' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )

test( 'project documents page shows a visible error when creator directory lookup fails', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'member@example.com' )
  await setFakeFaults( page, [
    {
      operation: 'firestore.getDocs',
      pathIncludes: 'userDirectory',
      message: 'Document creator lookup failed for testing.',
    },
  ] )

  await page.goto( `/projects/${REVIEW_FLOW_PROJECT_ID}/documents` )

  await expect( page.getByText( 'Project documents failed at user-directory: Document creator lookup failed for testing.' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )

test( 'project documents page shows a visible error when latest version lookup fails', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'member@example.com' )
  await setFakeFaults( page, [
    {
      operation: 'firestore.getDocs',
      pathIncludes: 'versions',
      message: 'Latest versions lookup failed for testing.',
    },
  ] )

  await page.goto( `/projects/${REVIEW_FLOW_PROJECT_ID}/documents` )

  await expect( page.getByText( 'Project documents failed at latest-versions: Latest versions lookup failed for testing.' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )
