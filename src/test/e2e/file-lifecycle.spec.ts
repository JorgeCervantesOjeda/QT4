import { expect, test, type Page } from '@playwright/test'

const login = async ( page: Page, email: string ) => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email' ).fill( email )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
}

test( 'member can upload a version file and continue working even when linked metadata is unavailable', async ( { page } ) => {
  await login( page, 'member@example.com' )

  await page.getByRole( 'link', { name: 'Go to Projects' } ).click()
  await expect( page.getByText( 'Projects' ) ).toBeVisible()

  await page.getByLabel( 'Name' ).fill( 'File Lifecycle Project' )
  await page.getByRole( 'button', { name: 'Create project' } ).click()
  await expect( page.getByText( 'Project created successfully.' ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'OK' } ).click()
  await page.locator( 'article.project-card h3' ).filter( { hasText: 'File Lifecycle Project' } ).click()

  await expect( page.getByText( 'Project Documents' ) ).toBeVisible()
  await page.getByLabel( 'Title' ).fill( 'File Lifecycle Document' )
  await page.getByRole( 'button', { name: 'Create document' } ).click()
  await expect( page.getByText( 'Document created successfully.' ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'OK' } ).click()
  await page.locator( 'article.project-card h3' ).filter( { hasText: 'File Lifecycle Document' } ).click()

  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( page.getByText( 'No file linked yet.' ) ).toBeVisible()

  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v1.txt' )

  await expect( page.getByText( 'Uploaded: draft-v1.txt' ) ).toBeVisible()
  const replaceButton = page.getByRole( 'button', { name: 'Replace file' } )
  if( await replaceButton.isVisible().catch( () => false ) ) {
    await expect( page.getByText( 'Name: draft-v1.txt' ) ).toBeVisible()
    await expect( page.getByRole( 'button', { name: 'Download file' } ).last() ).toBeVisible()

    await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v2.txt' )
    await expect( page.getByRole( 'heading', { name: 'Replace file' } ) ).toBeVisible()
    await page.getByRole( 'button', { name: 'Confirm' } ).click()

    await expect( page.getByText( 'Name: draft-v2.txt' ) ).toBeVisible()
    await expect( page.getByText( 'Uploaded: draft-v2.txt' ) ).toBeVisible()
    return
  }

  await expect( page.getByText( 'A file is linked to this version, but its metadata is not available in this view.' ) ).toBeVisible()
  await expect( page.getByText( 'You do not have permission to read linked file metadata for this version.' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Upload file' } ) ).toBeVisible()

  await page.locator( 'input[type="file"]' ).setInputFiles( 'src/test/e2e/fixtures/draft-v2.txt' )
  await expect( page.getByText( 'Uploaded: draft-v2.txt' ) ).toBeVisible()
} )
