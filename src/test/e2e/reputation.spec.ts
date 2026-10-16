// src/test/e2e/reputation.spec.ts: Verifies contribution routes and visible empty states in the fake system.

import { expect, test, type Page } from '@playwright/test'

const login = async (page: Page) => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email' ).fill( 'member@example.com' )
  await page.getByRole( 'textbox', { name: 'Password' } ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
}

test( 'member can open personal contributions and see an explicit empty state', async ( { page } ) => {
  await login( page )
  await page.goto( '/account/contributions' )

  await expect( page.getByRole( 'heading', { name: 'My Contributions' } ) ).toBeVisible()
  await expect( page.getByText( 'No project contributions have been recorded yet.' ) ).toBeVisible()
} )

test( 'member can open a project-only contribution ranking', async ( { page } ) => {
  await login( page )
  await page.goto( '/projects/project-e2e-review-flow/contribution' )

  await expect( page.getByText( 'Contribution ranking' ) ).toBeVisible()
  await expect( page.getByText( 'Only this project is included. There is no global ranking.' ) ).toBeVisible()
  await expect( page.getByText( 'No contributions recorded for this project yet.' ) ).toBeVisible()
} )
