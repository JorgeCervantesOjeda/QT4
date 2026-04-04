import { expect, test, type Page } from '@playwright/test'

const loginAdmin = async ( page: Page ) => {
  await page.goto( '/login' )

  await page.getByLabel( 'Email' ).fill( 'admin@example.com' )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()

  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
  await page.goto( '/admin/audit' )
  await expect( page.getByText( 'Admin Audit' ) ).toBeVisible()
}

test( 'admin can open the audit page and run a report', async ( { page } ) => {
  await loginAdmin( page )

  await expect( page.getByText( 'Files API status' ) ).toBeVisible()
  await expect( page.getByText( 'Audit report' ) ).toBeVisible()

  await page.getByLabel( 'User' ).selectOption( { label: 'Admin User' } )
  await page.getByLabel( 'Start date' ).fill( '2026-04-01' )
  await page.getByLabel( 'End date' ).fill( '2026-04-03' )
  await page.getByRole( 'button', { name: 'Run report' } ).click()

  await expect( page.getByText( 'Activity log' ) ).toBeVisible()
  await expect( page.getByText( '1 entries' ) ).toBeVisible()
  await expect( page.getByText( 'Source: firestore. Defaults:' ) ).toBeVisible()
} )

test( 'admin can reload runtime providers from Firestore', async ( { page } ) => {
  await loginAdmin( page )

  await page.getByLabel( 'File storage provider' ).selectOption( 'files-api' )
  await page.getByLabel( 'Email provider' ).selectOption( 'firebase-functions' )
  await page.getByRole( 'button', { name: 'Reload config' } ).click()

  await expect( page.getByLabel( 'File storage provider' ) ).toHaveValue( 'firebase-storage' )
  await expect( page.getByLabel( 'Email provider' ) ).toHaveValue( 'files-api' )
  await expect( page.getByText( /Source: firestore\./ ) ).toBeVisible()
} )

test( 'admin audit shows an empty-range message when no logs match the report', async ( { page } ) => {
  await loginAdmin( page )

  await page.getByLabel( 'User' ).selectOption( { label: 'Admin User' } )
  await page.getByLabel( 'Start date' ).fill( '2026-04-10' )
  await page.getByLabel( 'End date' ).fill( '2026-04-11' )
  await page.getByRole( 'button', { name: 'Run report' } ).click()

  await expect( page.getByText( /No audit entries for range:/ ) ).toBeVisible()
  await expect( page.getByText( '0 entries' ) ).toBeVisible()
} )
