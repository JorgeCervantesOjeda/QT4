// src/test/e2e/reputation.emulator.spec.ts: Verifies reputation screens against real Firebase emulators.

import { expect, test, type Page } from '@playwright/test'

const login = async (page: Page) => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email' ).fill( 'member@example.com' )
  await page.getByRole( 'textbox', { name: 'Password' } ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  await expect( page.getByText( 'Dashboard', { exact: true } ) ).toBeVisible()
}

test( 'member sees reputation produced by real Functions triggers', async ( { page } ) => {
  await login( page )
  await page.goto( '/account/contributions' )

  await expect( page.getByRole( 'heading', { name: 'Your contribution summary' } ) ).toBeVisible()
  await expect( page.getByRole( 'article' ).filter( { hasText: 'Reputation Integration Project' } ) ).toBeVisible()
  await expect( page.getByRole( 'article' ).filter( { hasText: 'Reputation Integration Project' } ).getByText( '8.25 pts', { exact: true } ) ).toBeVisible()
  await expect( page.getByText( 'Created a discussion thread', { exact: true } ).first() ).toBeVisible()
  const first = page.getByRole( 'article' ).filter( { hasText: 'Reputation Integration Project' } )
  const second = page.getByRole( 'article' ).filter( { hasText: 'Second Reputation Project' } )
  await expect( second.getByText( '2.33 pts', { exact: true } ) ).toBeVisible()
  await expect( first.locator( '[data-badge-id="issue-spotter"]' ) ).toHaveClass( /badge-card--locked/ )
  await expect( second.locator( '[data-badge-id="issue-spotter"]' ) ).toHaveClass( /badge-card--unlocked/ )
  await expect( page.getByText( 'Points across all projects' ) ).toHaveCount( 0 )
  await expect( page.getByText( 'All project totals combined' ) ).toHaveCount( 0 )
} )

test( 'account and dashboard keep the same two project balances separate', async ( { page } ) => {
  await login( page )
  const dashboard = page.getByRole( 'region', { name: 'My contribution', exact: true } )
  await expect( dashboard.getByRole( 'article' ).filter( { hasText: 'Reputation Integration Project' } ).getByText( '8.25 pts', { exact: true } ) ).toBeVisible()
  await expect( dashboard.getByRole( 'article' ).filter( { hasText: 'Second Reputation Project' } ).getByText( '2.33 pts', { exact: true } ) ).toBeVisible()
  await expect( page.getByText( 'Points and badges by project', { exact: true } ) ).toBeVisible()
  await page.goto( '/account' )
  const first = page.getByRole( 'article' ).filter( { hasText: 'Reputation Integration Project' } )
  const second = page.getByRole( 'article' ).filter( { hasText: 'Second Reputation Project' } )
  await expect( first.getByText( '8.25 pts', { exact: true } ) ).toBeVisible()
  await expect( second.getByText( '2.33 pts', { exact: true } ) ).toBeVisible()
  await expect( first.locator( '[data-badge-id="issue-spotter"]' ) ).toHaveClass( /badge-card--locked/ )
  await expect( second.locator( '[data-badge-id="issue-spotter"]' ) ).toHaveClass( /badge-card--unlocked/ )
} )

test( 'member sees the project-scoped ranking produced by real Firestore data', async ( { page } ) => {
  await login( page )
  await page.goto( '/projects/project-e2e-reputation/contribution' )

  await expect( page.getByRole( 'heading', { name: 'Contribution ranking' } ) ).toBeVisible()
  await expect( page.getByText( 'Only this project is included. There is no global ranking.' ) ).toBeVisible()
  await expect( page.getByRole( 'listitem' ).filter( { hasText: 'You' } ).getByText( '8.25 pts' ) ).toBeVisible()
  await expect( page.getByText( 'You' ) ).toBeVisible()
} )
