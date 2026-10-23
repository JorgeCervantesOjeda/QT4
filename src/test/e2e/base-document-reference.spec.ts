// src/test/e2e/base-document-reference.spec.ts: Browser regression linked to documentAndFileHooks.test.tsx for report base-project identity.
import { expect, test } from '@playwright/test'

test( 'an error-report reference keeps the base project number after loading and reloading', async ( { page } ) => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email', { exact: true } ).fill( 'member@example.com' )
  await page.getByLabel( 'Password', { exact: true } ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in', exact: true } ).click()
  await expect( page.getByText( 'Dashboard', { exact: true } ) ).toBeVisible()
  await page.goto( '/documents/document-e2e-error-report-transition-linked/versions' )
  const reference = page.locator( '.base-document-reference' )
  await expect( reference ).toContainText( 'This document is an error report for:' )
  await expect( reference ).toContainText( /P\d+ \/ D\d+ \/ v/u )
  await page.reload()
  await expect( reference ).toContainText( /P\d+ \/ D\d+ \/ v/u )
  await expect( reference ).not.toContainText( 'P?' )
} )
