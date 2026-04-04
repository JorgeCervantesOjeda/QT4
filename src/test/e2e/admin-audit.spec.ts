import { expect, test } from '@playwright/test'

test( 'admin can open the audit page and run a report', async ( { page } ) => {
  await page.goto( '/login' )

  await page.getByLabel( 'Email' ).fill( 'admin@example.com' )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()

  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
  await page.goto( '/admin/audit' )

  await expect( page.getByText( 'Admin Audit' ) ).toBeVisible()
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
