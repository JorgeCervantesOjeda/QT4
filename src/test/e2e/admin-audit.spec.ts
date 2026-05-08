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

test( 'admin audit calendar view shows the empty detail prompt before selecting an event', async ( { page } ) => {
  await loginAdmin( page )

  await page.getByLabel( 'User' ).selectOption( { label: 'Admin User' } )
  await page.getByLabel( 'Start date' ).fill( '2026-04-01' )
  await page.getByLabel( 'End date' ).fill( '2026-04-03' )
  await page.getByRole( 'button', { name: 'Run report' } ).click()
  await page.getByRole( 'button', { name: 'Calendar' } ).click()

  await expect( page.getByText( 'Select an event to view full log details.' ) ).toBeVisible()
} )

test( 'admin audit calendar navigation switches views and updates the visible period', async ( { page } ) => {
  await loginAdmin( page )

  await page.getByLabel( 'User' ).selectOption( { label: 'Admin User' } )
  await page.getByLabel( 'Start date' ).fill( '2026-04-01' )
  await page.getByLabel( 'End date' ).fill( '2026-04-03' )
  await page.getByRole( 'button', { name: 'Run report' } ).click()
  await page.getByRole( 'button', { name: 'Calendar' } ).click()

  const periodLabel = page.locator( '.audit-calendar-controls p.muted' ).first()
  const monthLabel = ( await periodLabel.textContent() ) ?? ''
  expect( monthLabel ).toMatch( /^[A-Za-z]+ \d{4}$/ )

  await page.getByRole( 'button', { name: 'Week', exact: true } ).click()
  await expect( page.getByRole( 'button', { name: 'Week', exact: true } ) ).toHaveAttribute( 'aria-pressed', 'true' )
  const weekLabel = ( await periodLabel.textContent() ) ?? ''
  expect( weekLabel ).not.toBe( monthLabel )

  await page.getByRole( 'button', { name: 'Day', exact: true } ).click()
  await expect( page.getByRole( 'button', { name: 'Day', exact: true } ) ).toHaveAttribute( 'aria-pressed', 'true' )
  const dayLabel = ( await periodLabel.textContent() ) ?? ''
  expect( dayLabel ).not.toBe( weekLabel )

  await page.getByRole( 'button', { name: 'Agenda', exact: true } ).click()
  await expect( page.getByRole( 'button', { name: 'Agenda', exact: true } ) ).toHaveAttribute( 'aria-pressed', 'true' )
  const agendaDateLabel = page.getByText( /^Agenda date:/ )
  const initialAgendaDate = ( await agendaDateLabel.textContent() ) ?? ''
  await expect( agendaDateLabel ).toBeVisible()

  await page.getByRole( 'button', { name: 'Next' } ).click()
  await expect( agendaDateLabel ).not.toHaveText( initialAgendaDate )
} )

test( 'admin can cancel the data model update confirmation', async ( { page } ) => {
  await loginAdmin( page )

  await page.getByRole( 'button', { name: /Update existing data/ } ).click()
  await expect( page.getByRole( 'heading', { name: /Update data model v/ } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Cancel' } ).click()

  await expect( page.getByRole( 'heading', { name: /Update data model v/ } ) ).toBeHidden()
  await expect( page.getByText( /Updater version: v/ ) ).toBeVisible()
} )

test( 'admin can cancel the legacy timestamp repair confirmation', async ( { page } ) => {
  await loginAdmin( page )

  await page.getByRole( 'button', { name: 'Repair legacy document and version timestamps' } ).click()
  await expect( page.getByRole( 'heading', { name: 'Repair legacy timestamps' } ) ).toBeVisible()
  await page.getByRole( 'button', { name: 'Cancel' } ).click()

  await expect( page.getByRole( 'heading', { name: 'Repair legacy timestamps' } ) ).toBeHidden()
  await expect(
    page.getByText( /Repairs legacy timestamps by backfilling missing `documents\.createdAt`/ ),
  ).toBeVisible()
} )

test( 'admin can run the data model update and see repaired counters summary', async ( { page } ) => {
  await loginAdmin( page )

  await page.getByRole( 'button', { name: /Update existing data/ } ).click()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()

  await expect( page.getByText( /Data model update v\d+ completed\./ ) ).toBeVisible()
  await expect(
    page.getByText( /Projects updated: 1\. Documents updated: 1\./ ),
  ).toBeVisible()
} )

test( 'admin can repair legacy timestamps and see the repair summary', async ( { page } ) => {
  await loginAdmin( page )

  await page.getByRole( 'button', { name: 'Repair legacy document and version timestamps' } ).click()
  await page.getByRole( 'button', { name: 'Confirm' } ).click()

  await expect( page.getByText( 'Legacy timestamp repair completed.' ) ).toBeVisible()
  await expect(
    page.getByText( /document createdAt repaired: 1/ ),
  ).toBeVisible()
  await expect(
    page.getByText( /version createdAt repaired: 1/ ),
  ).toBeVisible()
  await expect(
    page.getByText( /version reviewEndAt repaired: 1/ ),
  ).toBeVisible()
} )
