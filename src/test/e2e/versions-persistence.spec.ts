import { expect, test, type Page, type TestInfo } from '@playwright/test'

type FakeFault = {
  operation: string
  pathIncludes?: string
  message: string
  code?: string
  once?: boolean
}

const ERROR_REPORT_TRANSITION_DOCUMENT_ID = 'document-e2e-error-report-transition'

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
  await expect( page.getByRole( 'heading', { name: 'Versions' } ) ).toBeVisible( { timeout: 10000 } )
}

const closeSuccessModal = async (page: Page, message: string) => {
  await expect( page.getByText( message ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'OK' } ).click()
  await expect( page.getByText( message ) ).toBeHidden()
}

const closeErrorModal = async (page: Page, message: string) => {
  await expect( page.getByText( message ) ).toBeVisible()
  await page.keyboard.press( 'Escape' )
  await expect( page.getByText( message ) ).toBeHidden()
}

const createInCreationDocumentWithReviewer = async (page: Page, label: string) => {
  const projectName = `${label} Project`
  const documentTitle = `${label} Document`

  await page.getByRole( 'link', { name: 'Go to Projects' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Projects' } ) ).toBeVisible()

  await page.getByLabel( 'Name' ).fill( projectName )
  await page.getByRole( 'button', { name: 'Create project' } ).click()
  await closeSuccessModal( page, 'Project created successfully.' )

  const projectCard = page.locator( 'article.project-card' ).filter( { hasText: projectName } )
  await expect( projectCard ).toBeVisible()
  await projectCard.getByRole( 'textbox', { name: 'Add member (email)' } ).fill( 'reviewer@example.com' )
  await projectCard.getByRole( 'button', { name: 'Add member' } ).click()
  await closeSuccessModal( page, 'Member added successfully.' )

  await projectCard.getByRole( 'heading', { name: new RegExp( projectName ) } ).click()
  await expect( page.getByText( 'Project Documents' ) ).toBeVisible()

  await page.getByLabel( 'Title' ).fill( documentTitle )
  await page.getByRole( 'button', { name: 'Create document' } ).click()
  await closeSuccessModal( page, 'Document created successfully.' )

  await page.locator( 'article.project-card h3' ).filter( { hasText: documentTitle } ).click()
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( page.getByText( 'Version 0.01' ) ).toBeVisible()
}

const reviewerRow = (page: Page) => page.locator( 'tr' ).filter( { hasText: 'reviewer@example.com' } )

test( 'reviewer assignment persists after a full page reload', async ( { page } ) => {
  await login( page, 'member@example.com' )
  await createInCreationDocumentWithReviewer( page, 'Reviewer Persistence' )

  const reviewerCheckbox = reviewerRow( page ).locator( 'input[type="checkbox"]' )
  await reviewerCheckbox.click()
  await expect( reviewerCheckbox ).toBeChecked()
  await expect( page.getByText( 'Reviewers: 1' ).last() ).toBeVisible()

  await page.reload()
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( reviewerCheckbox ).toBeChecked()
  await expect( page.getByText( 'Reviewers: 1' ).last() ).toBeVisible()
} )

test( 'author reassignment persists after reload and removes the new author from reviewers', async ( { page } ) => {
  await login( page, 'member@example.com' )
  await createInCreationDocumentWithReviewer( page, 'Author Persistence' )

  const reviewerCheckbox = reviewerRow( page ).locator( 'input[type="checkbox"]' )
  await reviewerCheckbox.click()
  await expect( reviewerCheckbox ).toBeChecked()

  const reviewerRadio = reviewerRow( page ).locator( 'input[type="radio"]' )
  await reviewerRadio.click()
  await expect( reviewerRadio ).toBeChecked()
  await expect( reviewerCheckbox ).not.toBeChecked()

  await page.reload()
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( reviewerRadio ).toBeChecked()
  await expect( reviewerCheckbox ).not.toBeChecked()
  await expect( page.getByText( 'Reviewers: 0' ).last() ).toBeVisible()
} )

test( 'replace-file failure keeps the existing linked file visible', async ( { page }, testInfo ) => {
  skipUnlessFakeBackend( testInfo )
  await login( page, 'member@example.com' )
  await createInCreationDocumentWithReviewer( page, 'Replace Rollback' )

  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v1.txt' )
  await expect( page.getByText( 'Uploaded: draft-v1.txt' ) ).toBeVisible()
  await expect( page.getByText( 'Name: draft-v1.txt' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Replace file' } ) ).toBeVisible()

  await setFakeFaults( page, [
    {
      operation: 'storage.uploadBytes',
      message: 'Replacement blocked for testing.',
    },
  ] )

  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v2.txt' )
  await expect( page.getByRole( 'heading', { name: 'Replace file' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()

  await expect( page.getByText( 'Replacement blocked for testing.' ).first() ).toBeVisible()
  await expect( page.getByText( 'Name: draft-v1.txt' ) ).toBeVisible()
  await expect( page.getByText( 'Name: draft-v2.txt' ) ).toHaveCount( 0 )
} )

test( 'start review stays blocked until file and reviewers are ready, then persists after reload', async ( { page } ) => {
  const startReviewGuardMessage =
    'To start review, the version must be In Creation, have linked file metadata (fileRefId), have at least one reviewer, and you must be the author or leader.'

  await login( page, 'member@example.com' )
  await createInCreationDocumentWithReviewer( page, 'Review Transition' )

  await page.getByRole( 'button', { name: 'Start review' } ).click()
  await closeErrorModal( page, startReviewGuardMessage )

  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v1.txt' )
  await expect( page.getByText( 'Uploaded: draft-v1.txt' ) ).toBeVisible()
  await expect( page.getByText( 'Name: draft-v1.txt' ) ).toBeVisible()

  await page.getByRole( 'button', { name: 'Start review' } ).click()
  await closeErrorModal( page, startReviewGuardMessage )

  const reviewerCheckbox = reviewerRow( page ).locator( 'input[type="checkbox"]' )
  await reviewerCheckbox.click()
  await expect( reviewerCheckbox ).toBeChecked()
  await expect( page.getByText( 'Reviewers: 1' ).last() ).toBeVisible()

  await page.getByRole( 'button', { name: 'Start review' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Start review' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Review started successfully.' )

  await expect( page.getByLabel( 'Selected version' ).locator( 'option:checked' ) ).toContainText( '0.01 - In Review' )
  await expect( page.getByText( 'Reviewer Assignment (Before Review)' ) ).toHaveCount( 0 )

  await page.reload()
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( page.getByLabel( 'Selected version' ).locator( 'option:checked' ) ).toContainText( '0.01 - In Review' )
  await expect( page.getByText( 'Name: draft-v1.txt' ) ).toBeVisible()
  await expect( page.getByText( 'Issues: 0 - Open: 0 - Comments: 0' ).last() ).toBeVisible()
} )

test( 'accepted version can create the next version, upload, assign reviewers, and start review after reload-safe transitions', async ( { page } ) => {
  await login( page, 'member@example.com' )
  await openVersionsPage( page, ERROR_REPORT_TRANSITION_DOCUMENT_ID )

  await expect( page.getByText( 'Accepted transition error report' ) ).toBeVisible( { timeout: 15000 } )
  await expect( page.getByRole( 'button', { name: 'Create next version' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Create next version' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Create new version' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Version created successfully.' )

  const selectedVersionInput = page.getByLabel( 'Selected version' )
  await expect( selectedVersionInput ).toContainText( '0.02 - In Creation' )
  await selectedVersionInput.selectOption( { label: '0.02 - In Creation' } )
  await expect( selectedVersionInput.locator( 'option:checked' ) ).toContainText( '0.02 - In Creation' )
  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v2.txt' )
  await expect( page.getByText( 'Uploaded: draft-v2.txt' ) ).toBeVisible()
  await expect( page.getByText( 'Name: draft-v2.txt' ) ).toBeVisible()

  await page.getByRole( 'checkbox', { name: 'Select all reviewers' } ).check()
  await expect( page.getByText( 'Reviewers: 1' ).last() ).toBeVisible()

  await page.getByRole( 'button', { name: 'Start review' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Start review' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Review started successfully.' )

  await expect( page.getByLabel( 'Selected version' ).locator( 'option:checked' ) ).toContainText( '0.02 - In Review' )
  await expect( page.getByText( 'Issues: 0 - Open: 0 - Comments: 0' ).last() ).toBeVisible()

  await page.reload()
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( selectedVersionInput.locator( 'option:checked' ) ).toContainText( '0.02 - In Review' )
  await expect( page.getByText( 'Name: draft-v2.txt' ) ).toBeVisible()
  await expect( page.getByText( /Reviewers: (Reviewer User|reviewer@example\.com)/ ) ).toBeVisible()
} )

test( 'selected version can switch between states, and reload returns to the latest version', async ( { page } ) => {
  await login( page, 'member@example.com' )
  await createInCreationDocumentWithReviewer( page, 'Version Selection' )

  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v1.txt' )
  await expect( page.getByText( 'Uploaded: draft-v1.txt' ) ).toBeVisible()

  const reviewerCheckbox = reviewerRow( page ).locator( 'input[type="checkbox"]' )
  await reviewerCheckbox.click()
  await expect( reviewerCheckbox ).toBeChecked()

  await page.getByRole( 'button', { name: 'Start review' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Start review' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Review started successfully.' )

  await page.getByRole( 'button', { name: 'Create next version' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Create new version' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Version created successfully.' )

  const selectedVersionInput = page.getByLabel( 'Selected version' )
  await expect( selectedVersionInput ).toContainText( '0.01 - Reviewed' )
  await expect( selectedVersionInput ).toContainText( '0.02 - In Creation' )

  await selectedVersionInput.selectOption( { label: '0.02 - In Creation' } )
  await expect( selectedVersionInput.locator( 'option:checked' ) ).toContainText( '0.02 - In Creation' )
  await expect( page.getByText( 'Uploaded: No' ).last() ).toBeVisible()

  await selectedVersionInput.selectOption( { label: '0.01 - Reviewed' } )
  await expect( selectedVersionInput.locator( 'option:checked' ) ).toContainText( '0.01 - Reviewed' )
  await expect( page.getByText( 'Name: draft-v1.txt' ) ).toBeVisible()

  await page.reload()
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( selectedVersionInput.locator( 'option:checked' ) ).toContainText( '0.02 - In Creation' )
  await expect( page.getByText( 'Uploaded: No' ).last() ).toBeVisible()
} )

test( 'switching versions clears stale issue and comment deep-link state', async ( { page } ) => {
  await login( page, 'member@example.com' )
  await createInCreationDocumentWithReviewer( page, 'Version Query Cleanup' )

  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v1.txt' )
  await expect( page.getByText( 'Uploaded: draft-v1.txt' ) ).toBeVisible()

  const reviewerCheckbox = reviewerRow( page ).locator( 'input[type="checkbox"]' )
  await reviewerCheckbox.click()
  await expect( reviewerCheckbox ).toBeChecked()

  await page.getByRole( 'button', { name: 'Start review' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Start review' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Review started successfully.' )

  await page.getByPlaceholder( 'New issue title' ).fill( 'Query cleanup issue' )
  await page.getByRole( 'button', { name: 'Create issue' } ).click()
  await closeSuccessModal( page, 'Issue created successfully.' )
  await expect( page.locator( '.selected-thread-title' ) ).toContainText( 'Query cleanup issue' )

  await page.getByPlaceholder( 'Write a comment' ).fill( 'Comment that should not leak into another version.' )
  await page.getByRole( 'button', { name: 'Add comment' } ).click()
  await closeSuccessModal( page, 'The comment was added successfully.' )

  await page.locator( 'article.project-card' ).filter( { hasText: 'Query cleanup issue' } ).click( {
    position: { x: 16, y: 16 },
  } )
  await expect( page ).toHaveURL( /threadId=/ )

  const sourceUrl = new URL( page.url() )
  const threadId = sourceUrl.searchParams.get( 'threadId' )
  const commentAnchorId = await page
    .locator( '.comment-list article' )
    .filter( { hasText: 'Comment that should not leak into another version.' } )
    .getAttribute( 'id' )
  if( !threadId || !commentAnchorId ) {
    throw new Error( 'Expected issue/comment identifiers after creating the deep-link source state.' )
  }
  const commentId = commentAnchorId.replace( 'qt4-comment-', '' )

  await page.goto(
    `${sourceUrl.pathname}?projectId=${sourceUrl.searchParams.get( 'projectId' ) ?? ''}&threadId=${threadId}&commentId=${commentId}&focus=comments`,
  )
  await expect( page.locator( '.selected-thread-title' ) ).toContainText( 'Query cleanup issue' )
  await expect( page.locator( `#qt4-comment-${commentId}` ) ).toHaveClass( /comment-card--highlight/ )

  await page.getByRole( 'button', { name: 'Create next version' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Create new version' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Version created successfully.' )

  const selectedVersionInput = page.getByLabel( 'Selected version' )
  await selectedVersionInput.selectOption( { label: '0.02 - In Creation' } )
  await expect( selectedVersionInput.locator( 'option:checked' ) ).toContainText( '0.02 - In Creation' )
  await expect( page ).not.toHaveURL( /threadId=/ )
  await expect( page ).not.toHaveURL( /commentId=/ )
  await expect( page.getByText( 'Issues: 0 - Open: 0 - Comments: 0' ).last() ).toBeVisible()
  await expect( page.locator( '.selected-thread-title' ) ).toHaveCount( 0 )

  await page.reload()
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( selectedVersionInput.locator( 'option:checked' ) ).toContainText( '0.02 - In Creation' )
  await expect( page ).not.toHaveURL( /threadId=/ )
  await expect( page ).not.toHaveURL( /commentId=/ )
  await expect( page.locator( '.selected-thread-title' ) ).toHaveCount( 0 )
} )

test( 'opening another version from the version cards clears stale deep-link issue state', async ( { page } ) => {
  await login( page, 'member@example.com' )
  await createInCreationDocumentWithReviewer( page, 'Version Card Query Cleanup' )

  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v1.txt' )
  await expect( page.getByText( 'Uploaded: draft-v1.txt' ) ).toBeVisible()

  const reviewerCheckbox = reviewerRow( page ).locator( 'input[type="checkbox"]' )
  await reviewerCheckbox.click()
  await expect( reviewerCheckbox ).toBeChecked()

  await page.getByRole( 'button', { name: 'Start review' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Start review' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Review started successfully.' )

  await page.getByPlaceholder( 'New issue title' ).fill( 'Version card cleanup issue' )
  await page.getByRole( 'button', { name: 'Create issue' } ).click()
  await closeSuccessModal( page, 'Issue created successfully.' )
  await page.getByPlaceholder( 'Write a comment' ).fill( 'Comment tied to the reviewed version card.' )
  await page.getByRole( 'button', { name: 'Add comment' } ).click()
  await closeSuccessModal( page, 'The comment was added successfully.' )

  await page.locator( 'article.project-card' ).filter( { hasText: 'Version card cleanup issue' } ).click( {
    position: { x: 16, y: 16 },
  } )
  await expect( page ).toHaveURL( /threadId=/ )

  await page.getByRole( 'button', { name: 'Create next version' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Create new version' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Version created successfully.' )

  const nextVersionCard = page.locator( 'article.version-card' ).filter( { hasText: 'Version 0.02' } )
  await nextVersionCard.click( { position: { x: 16, y: 16 } } )

  await expect( page.getByLabel( 'Selected version' ).locator( 'option:checked' ) ).toContainText( '0.02 - In Creation' )
  await expect( page ).not.toHaveURL( /threadId=/ )
  await expect( page ).not.toHaveURL( /commentId=/ )
  await expect( page.locator( '.selected-thread-title' ) ).toHaveCount( 0 )
  await expect( page.getByText( 'Issues: 0 - Open: 0 - Comments: 0' ).last() ).toBeVisible()
} )

test( 'keyboard Home navigation clears stale deep-link issue state', async ( { page } ) => {
  await login( page, 'member@example.com' )
  await createInCreationDocumentWithReviewer( page, 'Version Keyboard Query Cleanup' )

  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v1.txt' )
  await expect( page.getByText( 'Uploaded: draft-v1.txt' ) ).toBeVisible()

  const reviewerCheckbox = reviewerRow( page ).locator( 'input[type="checkbox"]' )
  await reviewerCheckbox.click()
  await expect( reviewerCheckbox ).toBeChecked()

  await page.getByRole( 'button', { name: 'Start review' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Start review' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Review started successfully.' )

  await page.getByPlaceholder( 'New issue title' ).fill( 'Version keyboard cleanup issue' )
  await page.getByRole( 'button', { name: 'Create issue' } ).click()
  await closeSuccessModal( page, 'Issue created successfully.' )
  await page.getByPlaceholder( 'Write a comment' ).fill( 'Comment tied to keyboard navigation cleanup.' )
  await page.getByRole( 'button', { name: 'Add comment' } ).click()
  await closeSuccessModal( page, 'The comment was added successfully.' )

  await page.locator( 'article.project-card' ).filter( { hasText: 'Version keyboard cleanup issue' } ).click( {
    position: { x: 16, y: 16 },
  } )
  await expect( page ).toHaveURL( /threadId=/ )

  await page.getByRole( 'button', { name: 'Create next version' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Create new version' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Version created successfully.' )

  const selectedVersionInput = page.getByLabel( 'Selected version' )
  await expect( selectedVersionInput.locator( 'option:checked' ) ).toContainText( '0.01 - Reviewed' )
  await selectedVersionInput.focus()
  await selectedVersionInput.press( 'Home' )

  await expect( selectedVersionInput.locator( 'option:checked' ) ).toContainText( '0.02 - In Creation' )
  await expect( page ).not.toHaveURL( /threadId=/ )
  await expect( page ).not.toHaveURL( /commentId=/ )
  await expect( page.locator( '.selected-thread-title' ) ).toHaveCount( 0 )
  await expect( page.getByText( 'Issues: 0 - Open: 0 - Comments: 0' ).last() ).toBeVisible()
} )

test( 'direct versionId deep link keeps an older version selected across reload', async ( { page } ) => {
  await login( page, 'member@example.com' )
  await createInCreationDocumentWithReviewer( page, 'Version Query Deep Link' )

  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v1.txt' )
  await expect( page.getByText( 'Uploaded: draft-v1.txt' ) ).toBeVisible()

  const reviewerCheckbox = reviewerRow( page ).locator( 'input[type="checkbox"]' )
  await reviewerCheckbox.click()
  await expect( reviewerCheckbox ).toBeChecked()

  await page.getByRole( 'button', { name: 'Start review' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Start review' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Review started successfully.' )

  await page.getByRole( 'button', { name: 'Create next version' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Create new version' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Version created successfully.' )

  const selectedVersionInput = page.getByLabel( 'Selected version' )
  await expect( selectedVersionInput ).toContainText( '0.01 - Reviewed' )
  await expect( selectedVersionInput ).toContainText( '0.02 - In Creation' )

  const sourceUrl = new URL( page.url() )
  const olderVersionId = await selectedVersionInput.locator( 'option' ).nth( 1 ).getAttribute( 'value' )
  if( !olderVersionId ) {
    throw new Error( 'Expected an older version option for the direct versionId deep link.' )
  }

  await page.goto(
    `${sourceUrl.pathname}?projectId=${sourceUrl.searchParams.get( 'projectId' ) ?? ''}&versionId=${olderVersionId}`,
  )
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( selectedVersionInput.locator( 'option:checked' ) ).toContainText( '0.01 - Reviewed' )
  await expect( page.getByText( 'Name: draft-v1.txt' ) ).toBeVisible()
  await expect( page ).toHaveURL( new RegExp( `versionId=${olderVersionId}` ) )

  await page.reload()
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( selectedVersionInput.locator( 'option:checked' ) ).toContainText( '0.01 - Reviewed' )
  await expect( page.getByText( 'Name: draft-v1.txt' ) ).toBeVisible()
  await expect( page ).toHaveURL( new RegExp( `versionId=${olderVersionId}` ) )
} )

test( 'versionId deep links ignore stale thread and comment ids from another version', async ( { page } ) => {
  await login( page, 'member@example.com' )
  await createInCreationDocumentWithReviewer( page, 'Version Mixed Query Deep Link' )

  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v1.txt' )
  await expect( page.getByText( 'Uploaded: draft-v1.txt' ) ).toBeVisible()

  const reviewerCheckbox = reviewerRow( page ).locator( 'input[type="checkbox"]' )
  await reviewerCheckbox.click()
  await expect( reviewerCheckbox ).toBeChecked()

  await page.getByRole( 'button', { name: 'Start review' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Start review' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Review started successfully.' )

  await page.getByPlaceholder( 'New issue title' ).fill( 'Mixed query issue' )
  await page.getByRole( 'button', { name: 'Create issue' } ).click()
  await closeSuccessModal( page, 'Issue created successfully.' )
  await expect( page.locator( '.selected-thread-title' ) ).toContainText( 'Mixed query issue' )

  await page.getByPlaceholder( 'Write a comment' ).fill( 'Comment bound to the reviewed version only.' )
  await page.getByRole( 'button', { name: 'Add comment' } ).click()
  await closeSuccessModal( page, 'The comment was added successfully.' )

  await page.locator( 'article.project-card' ).filter( { hasText: 'Mixed query issue' } ).click( {
    position: { x: 16, y: 16 },
  } )
  await expect( page ).toHaveURL( /threadId=/ )

  await page.getByRole( 'button', { name: 'Create next version' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Create new version' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()
  await closeSuccessModal( page, 'Version created successfully.' )

  const selectedVersionInput = page.getByLabel( 'Selected version' )
  const newerVersionId = await selectedVersionInput.locator( 'option' ).first().getAttribute( 'value' )
  const sourceUrl = new URL( page.url() )
  const threadId = sourceUrl.searchParams.get( 'threadId' )
  const commentAnchorId = await page
    .locator( '.comment-list article' )
    .filter( { hasText: 'Comment bound to the reviewed version only.' } )
    .getAttribute( 'id' )

  if( !newerVersionId || !threadId || !commentAnchorId ) {
    throw new Error( 'Expected mixed-query identifiers before opening the stale deep link.' )
  }

  const commentId = commentAnchorId.replace( 'qt4-comment-', '' )
  await page.goto(
    `${sourceUrl.pathname}?projectId=${sourceUrl.searchParams.get( 'projectId' ) ?? ''}&versionId=${newerVersionId}&threadId=${threadId}&commentId=${commentId}&focus=comments`,
  )

  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( selectedVersionInput.locator( 'option:checked' ) ).toContainText( '0.02 - In Creation' )
  await expect( page.getByText( 'Issues: 0 - Open: 0 - Comments: 0' ).last() ).toBeVisible()
  await expect( page.locator( '.selected-thread-title' ) ).toHaveCount( 0 )
  await expect( page.locator( `#qt4-comment-${commentId}` ) ).toHaveCount( 0 )

  await page.reload()
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( selectedVersionInput.locator( 'option:checked' ) ).toContainText( '0.02 - In Creation' )
  await expect( page.getByText( 'Issues: 0 - Open: 0 - Comments: 0' ).last() ).toBeVisible()
  await expect( page.locator( '.selected-thread-title' ) ).toHaveCount( 0 )
  await expect( page.locator( `#qt4-comment-${commentId}` ) ).toHaveCount( 0 )
} )
