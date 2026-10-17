// src/test/e2e/reputation.emulator.spec.ts: Verifies reputation screens against real Firebase emulators.

import { expect, test, type Page } from '@playwright/test'

const login = async (page: Page) => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email' ).fill( 'member@example.com' )
  await page.getByRole( 'textbox', { name: 'Password' } ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
}

test( 'member sees reputation produced by real Functions triggers', async ( { page } ) => {
  await login( page )
  await page.goto( '/account/contributions' )

  await expect( page.getByRole( 'heading', { name: 'Your contribution summary' } ) ).toBeVisible()
  await expect( page.getByRole( 'article' ).filter( { hasText: 'Project project-e2e-reputation' } ) ).toBeVisible()
  await expect( page.getByText( '3 pts' ) ).toBeVisible()
  await expect( page.getByText( 'Created a discussion thread' ) ).toBeVisible()
} )

test( 'member sees the project-scoped ranking produced by real Firestore data', async ( { page } ) => {
  await login( page )
  await page.goto( '/projects/project-e2e-reputation/contribution' )

  await expect( page.getByRole( 'heading', { name: 'Contribution ranking' } ) ).toBeVisible()
  await expect( page.getByText( 'Only this project is included. There is no global ranking.' ) ).toBeVisible()
  await expect( page.getByRole( 'listitem' ).filter( { hasText: 'You' } ).getByText( '3 pts' ) ).toBeVisible()
  await expect( page.getByText( 'You' ) ).toBeVisible()
} )
