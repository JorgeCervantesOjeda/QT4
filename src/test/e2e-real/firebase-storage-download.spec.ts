import { expect, test, type Page } from '@playwright/test'

const PROJECT_ID = 'KXVvkbmTnvvmMAbcPMCE'
const DOCUMENT_ID = '6fNBteoO2h5zcPVezB9u'
const VERSION_ID = 'IuEQoUwAXwLkidFtASoC'
const DOCUMENT_PATH = `/documents/${DOCUMENT_ID}/versions?projectId=${PROJECT_ID}&versionId=${VERSION_ID}`

const login = async ( page: Page, email: string, password: string ) => {
  if( !email || !password ) {
    throw new Error(
      'Firebase Storage E2E requires QT4_E2E_EMAIL and QT4_E2E_PASSWORD for a dedicated test account.',
    )
  }

  await page.goto( DOCUMENT_PATH )
  await page.getByLabel( 'Email' ).fill( email )
  await page.getByLabel( 'Password' ).fill( password )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  try {
    await page.waitForURL( new RegExp( `/documents/${DOCUMENT_ID}/versions` ), { timeout: 15000 } )
  } catch( error ) {
    const visibleAuthError = page.getByRole( 'dialog' ).locator( 'p.error' ).first()
    const authMessage = await visibleAuthError.textContent().catch( () => null )
    if( authMessage?.trim() ) {
      throw new Error( `Firebase login failed: ${authMessage.trim()}` )
    }
    throw error
  }
}

test( 'downloads the real Firebase Storage file from the production build without opening a tab', async ( { page }, testInfo ) => {
  const metadata = testInfo.config.metadata as Record<string, unknown>
  const email = typeof metadata.firebaseStorageE2eEmail === 'string'
    ? metadata.firebaseStorageE2eEmail.trim()
    : ''
  const password = typeof metadata.firebaseStorageE2ePassword === 'string'
    ? metadata.firebaseStorageE2ePassword
    : ''

  await login( page, email, password )
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible()
  await expect( page.getByText( 'From: Firebase Storage' ).last() ).toBeVisible()

  const currentUrl = page.url()
  const popupPromise = page.waitForEvent( 'popup', { timeout: 2000 } ).catch( () => null )
  const downloadPromise = page.waitForEvent( 'download' )

  await page.getByRole( 'button', { name: 'Download file' } ).last().click()

  const [ download, popup ] = await Promise.all( [ downloadPromise, popupPromise ] )
  expect( popup ).toBeNull()
  expect( page.url() ).toBe( currentUrl )
  expect( download.suggestedFilename() ).not.toBe( '' )

  const downloadedPath = await download.path()
  expect( downloadedPath ).not.toBeNull()
} )
