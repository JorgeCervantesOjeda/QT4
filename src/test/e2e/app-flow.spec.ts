import { expect, test } from '@playwright/test'

test( 'member can log in, create a project and create a document', async ( { page } ) => {
  await page.goto( '/login' )

  await page.getByLabel( 'Email' ).fill( 'member@example.com' )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()

  await expect( page.getByText( 'Dashboard' ) ).toBeVisible()
  await page.getByRole( 'link', { name: 'Go to Projects' } ).click()

  await expect( page.getByText( 'Projects' ) ).toBeVisible()
  await page.getByLabel( 'Name' ).fill( 'E2E Project' )
  await page.getByRole( 'button', { name: 'Create project' } ).click()

  await expect( page.getByText( 'Project created successfully.' ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'OK' } ).click()
  await expect( page.locator( 'article.project-card h3' ).filter( { hasText: 'E2E Project' } ) ).toBeVisible()
  await page.locator( 'article.project-card h3' ).filter( { hasText: 'E2E Project' } ).click()

  await expect( page.getByText( 'Project Documents' ) ).toBeVisible()
  await page.getByLabel( 'Title' ).fill( 'E2E Document' )
  await page.getByRole( 'button', { name: 'Create document' } ).click()

  await expect( page.getByText( 'Document created successfully.' ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'OK' } ).click()
  await expect( page.locator( 'article.project-card h3' ).filter( { hasText: 'E2E Document' } ) ).toBeVisible()
  await page.locator( 'article.project-card h3' ).filter( { hasText: 'E2E Document' } ).click()

  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( page.getByRole( 'heading', { name: 'Versions' } ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Create next version' } ) ).toBeVisible()
  await expect( page.getByText( 'Version 0.01' ) ).toBeVisible()
} )
