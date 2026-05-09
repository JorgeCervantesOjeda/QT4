// src/components/AppBrand.test.tsx: Verifies help and About affordances in the brand banner.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { APP_METADATA } from '../lib/appMetadata'
import AppBrand from './AppBrand'

vi.mock( '../auth/useAuth', () => ( {
  useAuth: () => ( {
    user: null,
  } ),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  doc: vi.fn(),
  getDoc: vi.fn(),
} ) )

vi.mock( '../lib/firebase', () => ( {
  db: {},
} ) )

describe( 'AppBrand', () => {
  it( 'shows the NotebookLM help link for usage questions', () => {
    render( <AppBrand pageTitle="Dashboard" /> )

    expect( screen.getByText( 'Ask questions about how to use QualiTeam.' ) ).toBeTruthy()
    const helpLink = screen.getByRole( 'link', { name: 'Open the QualiTeam help assistant' } )
    expect( helpLink.getAttribute( 'href' ) ).toBe(
      'https://notebooklm.google.com/notebook/a602cd8e-4c62-4baa-b559-53ae95facaef',
    )
  } )

  it( 'opens the About dialog with the synchronized project version', () => {
    render( <AppBrand pageTitle="Dashboard" /> )

    fireEvent.click( screen.getByRole( 'button', { name: 'About' } ) )

    const aboutDialog = screen.getByRole( 'dialog' )

    expect( within( aboutDialog ).getByRole( 'heading', { name: 'QualiTeam' } ) ).toBeTruthy()
    expect( within( aboutDialog ).getByText( 'Version' ) ).toBeTruthy()
    expect( within( aboutDialog ).getByText( APP_METADATA.appVersion ) ).toBeTruthy()
  } )
} )
