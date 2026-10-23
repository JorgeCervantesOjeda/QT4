// src/test/e2e/issue-ordering.spec.ts: System coverage linked to ReviewIssuesPanel integration and threadOrdering unit tests.
import { expect, test } from '@playwright/test'

test( 'issue creation and activity order persists across cards, table and focus', async ( { page } ) => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email' ).fill( 'reviewer@example.com' )
  await page.getByLabel( 'Password', { exact: true } ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
  await page.goto( '/documents/document-e2e-review-guard/versions' )
  const panel = page.locator( 'section.panel' ).filter( { has: page.getByRole( 'heading', { name: 'Review Issues', exact: true } ) } ).last()
  const order = panel.getByRole( 'combobox', { name: 'Issue order' } )
  await expect( order ).toBeVisible()

  for( const criterion of [ 'createdAt', 'activityAt' ] ) {
    for( const direction of [ 'asc', 'desc' ] ) {
      const expectedFirst = direction === 'asc' ? 'Seeded resolved issue' : 'Seeded follow-up issue'
      const expectedNumber = direction === 'asc' ? 1 : 2
      await order.selectOption( `${criterion}:${direction}` )
      await panel.locator( '.view-toggle button' ).filter( { hasText: /^Cards$/ } ).click()
      await expect( panel.locator( 'article.project-card h4' ).first() ).toHaveText( expectedFirst )
      await expect( panel.locator( 'article.project-card' ).first() ).toContainText( `Issue ID: ${expectedNumber}` )
      await panel.getByRole( 'button', { name: 'Table', exact: true } ).click()
      await expect( order ).toHaveValue( `${criterion}:${direction}` )
      await expect( panel.locator( 'tbody tr' ).first() ).toContainText( expectedFirst )
      await expect( panel.locator( 'tbody tr' ).first().getByRole( 'cell', { name: String( expectedNumber ), exact: true } ).last() ).toBeVisible()
      await panel.getByRole( 'button', { name: 'Focus', exact: true } ).click()
      await expect( order ).toHaveValue( `${criterion}:${direction}` )
      await expect( panel.locator( '.focus-context-carousel__content h4' ).first() ).toHaveText( expectedFirst )
      await expect( panel.locator( '.focus-context-carousel__content' ).first() ).toContainText( `Issue ID: ${expectedNumber}` )
    }
  }
} )
