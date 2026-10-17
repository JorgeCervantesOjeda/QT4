// src/components/BackStack.test.tsx: Verifies Account's return-only navigation preserves browser history.
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import BackStack from './BackStack'

vi.mock( '../auth/useAuth', () => ( {
  useAuth: () => ( {
    signOutUser: vi.fn(),
  } ),
} ) )

describe( 'BackStack', () => {
  it( 'shows only Return and goes back to the previous route in return-only mode', () => {
    render(
      <MemoryRouter initialEntries={[ '/projects', '/account' ]} initialIndex={1}>
        <Routes>
          <Route
            path="/account"
            element={<BackStack mode="return-only" links={[]} />}
          />
          <Route path="/projects" element={<p>Previous projects page</p>} />
        </Routes>
      </MemoryRouter>,
    )

    expect( screen.getByRole( 'button', { name: 'Return' } ) ).toBeTruthy()
    expect( screen.queryByRole( 'button', { name: 'Log out' } ) ).toBeNull()
    expect( screen.queryByRole( 'link', { name: 'Dashboard' } ) ).toBeNull()

    fireEvent.click( screen.getByRole( 'button', { name: 'Return' } ) )

    expect( screen.getByText( 'Previous projects page' ) ).toBeTruthy()
  } )
} )
