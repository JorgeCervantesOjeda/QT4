import { expect, test, type Page } from '@playwright/test'

const REVIEW_FLOW_PROJECT_ID = 'project-e2e-review-flow'

const login = async (page: Page, email: string, password: string = 'password123') => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email' ).fill( email )
  await page.getByLabel( 'Password' ).fill( password )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
}

const openPasswordReset = async ( page: Page, email?: string ) => {
  await page.goto( '/login' )
  if( email !== undefined ) {
    await page.getByLabel( 'Email' ).fill( email )
  }
  await page.getByRole( 'button', { name: 'Reset password' } ).click()
}

test( 'guest is redirected to login and returns to the requested protected route after sign in', async ( { page } ) => {
  await page.goto( `/projects/${REVIEW_FLOW_PROJECT_ID}/documents` )
  await expect( page ).toHaveURL( /\/login/ )

  await page.getByLabel( 'Email' ).fill( 'member@example.com' )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()

  await expect( page ).toHaveURL( new RegExp( `/projects/${REVIEW_FLOW_PROJECT_ID}/documents$` ) )
  await expect( page.getByText( 'Project Documents' ) ).toBeVisible()
} )

test( 'user can register a new account and reaches the dashboard', async ( { page } ) => {
  const uniqueEmail = `new-user-${Date.now()}@example.com`

  await page.goto( '/register' )
  await page.getByLabel( 'Email' ).fill( uniqueEmail )
  await page.getByLabel( 'Name visible' ).fill( 'Fresh User' )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Create account' } ).click()

  await expect( page ).toHaveURL( /\/app/ )
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
  await expect( page.getByText( 'Signed in as Fresh User' ) ).toBeVisible()
} )

test( 'register shows a visible error when the email is already in use', async ( { page } ) => {
  await page.goto( '/register' )
  await page.getByLabel( 'Email' ).fill( 'member@example.com' )
  await page.getByLabel( 'Name visible' ).fill( 'Duplicate User' )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Create account' } ).click()

  await expect(
    page
      .getByRole( 'dialog' )
      .locator( 'p' )
      .filter( { hasText: /The email address is already in use\.|Firebase: Error \(auth\/email-already-in-use\)\./ } )
      .first(),
  ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )

test( 'logged-in user can log out back to the login page', async ( { page } ) => {
  await login( page, 'member@example.com' )
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()

  await page.getByRole( 'button', { name: 'Log out' } ).click()

  await expect( page ).toHaveURL( /\/login/ )
  await expect( page.getByRole( 'button', { name: 'Log in' } ) ).toBeVisible()
} )

test( 'login page shows the inactivity expiration notice from the query string', async ( { page } ) => {
  await page.goto( '/login?reason=inactive' )

  await expect( page.getByText( 'Session expired due to inactivity. Please log in again.' ) ).toBeVisible()
} )

test( 'login page validates password reset when email is missing', async ( { page } ) => {
  await openPasswordReset( page )

  await expect( page.getByText( 'Enter your email to request a password reset.' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )

test( 'login page validates password reset when email format is invalid', async ( { page } ) => {
  await openPasswordReset( page, 'invalid-email' )

  await expect( page.getByText( 'Enter a valid email address before requesting a password reset.' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )

test( 'login page shows a success notice after requesting a password reset', async ( { page } ) => {
  await openPasswordReset( page, 'member@example.com' )

  await expect(
    page.getByText( 'Password reset email sent to member@example.com. Check your inbox.' ),
  ).toBeVisible()
} )

test( 'login page shows a visible error when the password reset email is unknown', async ( { page } ) => {
  await openPasswordReset( page, 'missing-user@example.com' )

  await expect(
    page
      .getByRole( 'dialog' )
      .locator( 'p' )
      .filter( { hasText: /No user found for that email address\.|Firebase: Error \(auth\/user-not-found\)\./ } )
      .first(),
  ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Report to admin' } ) ).toBeVisible()
} )
