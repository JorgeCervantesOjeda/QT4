import { expect, test, type Page } from '@playwright/test'

const login = async ( page: Page, email: string ) => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email' ).fill( email )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
}

test( 'non-admin user can open the audit route without seeing admin-only controls', async ( { page } ) => {
  await login( page, 'member@example.com' )
  await page.goto( '/admin/audit' )

  await expect( page.getByText( 'My Activity' ) ).toBeVisible()
  await expect( page.getByText( 'Activity log' ) ).toBeVisible()
  await expect( page.getByText( 'Files API status' ) ).toBeHidden()
  await expect( page.getByText( 'Runtime providers' ) ).toBeHidden()
  await expect( page.getByText( 'Data model update' ) ).toBeHidden()
  await expect( page.getByText( 'Legacy timestamp repair' ) ).toBeHidden()
  await expect( page.getByLabel( 'User' ) ).toHaveValue( 'member@example.com' )
} )

test( 'admin gets a validation error when the audit date range is invalid', async ( { page } ) => {
  await login( page, 'admin@example.com' )
  await page.goto( '/admin/audit' )

  await expect( page.getByText( 'Admin Audit' ) ).toBeVisible()
  await page.getByLabel( 'User' ).selectOption( { label: 'Admin User' } )
  await page.getByLabel( 'Start date' ).fill( '2026-04-05' )
  await page.getByLabel( 'End date' ).fill( '2026-04-03' )
  await page.getByRole( 'button', { name: 'Run report' } ).click()

  await expect( page.getByText( 'Start date must be on or before end date.' ) ).toBeVisible()
  await page.keyboard.press( 'Escape' )
  await expect( page.getByText( 'Activity log' ) ).toBeVisible()
} )
