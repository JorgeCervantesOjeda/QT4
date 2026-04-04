import { expect, test, type Page } from '@playwright/test'

const installShortInactivityTimer = async ( page: Page ) => {
  await page.addInitScript( () => {
    const realSetTimeout = window.setTimeout.bind( window )
    window.setTimeout = ( (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const nextTimeout = timeout === 30 * 60 * 1000 ? 3000 : timeout
      return realSetTimeout( handler, nextTimeout, ...args )
    } ) as typeof window.setTimeout
  } )
}

const login = async ( page: Page, email: string ) => {
  await page.goto( '/login' )
  await page.getByLabel( 'Email' ).fill( email )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  await expect( page ).toHaveURL( /\/app/ )
}

test( 'user is redirected to login after real inactivity timeout', async ( { page } ) => {
  await installShortInactivityTimer( page )
  await login( page, 'member@example.com' )

  await expect( page ).toHaveURL( /\/login\?reason=inactive/ )
  await expect( page.getByText( 'Session expired due to inactivity. Please log in again.' ) ).toBeVisible()
  await expect( page.getByRole( 'button', { name: 'Log in' } ) ).toBeVisible()
} )
