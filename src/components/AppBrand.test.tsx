import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
} )
