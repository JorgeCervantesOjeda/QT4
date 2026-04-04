import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireAuth } from './RequireAuth'
import { useAuth } from './useAuth'

vi.mock( './useAuth', () => ( {
  useAuth: vi.fn(),
} ) )

const mockedUseAuth = vi.mocked( useAuth )

const LoginProbe = () => {
  const location = useLocation()
  const fromPath = ( location.state as { from?: { pathname?: string } } | null )?.from?.pathname ?? 'none'
  return <div>Login Page from {fromPath}</div>
}

describe( 'auth/RequireAuth', () => {
  beforeEach( () => {
    mockedUseAuth.mockReturnValue( {
      user: null,
      loading: false,
      signOutUser: vi.fn(),
    } )
  } )

  it( 'shows a loading screen while the session is being resolved', () => {
    mockedUseAuth.mockReturnValue( {
      user: null,
      loading: true,
      signOutUser: vi.fn(),
    } )

    render(
      <MemoryRouter initialEntries={[ '/projects' ]}>
        <RequireAuth>
          <div>Protected content</div>
        </RequireAuth>
      </MemoryRouter>,
    )

    expect( screen.getByText( 'Loading session' ) ).toBeTruthy()
    expect( screen.getByText( 'Checking credentials...' ) ).toBeTruthy()
  } )

  it( 'redirects unauthenticated users to login and preserves the original route', () => {
    render(
      <MemoryRouter initialEntries={[ '/projects' ]}>
        <Routes>
          <Route
            path="/projects"
            element={
              <RequireAuth>
                <div>Protected content</div>
              </RequireAuth>
            }
          />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    expect( screen.getByText( 'Login Page from /projects' ) ).toBeTruthy()
  } )

  it( 'renders children for authenticated users', () => {
    mockedUseAuth.mockReturnValue( {
      user: { uid: 'user-1' } as never,
      loading: false,
      signOutUser: vi.fn(),
    } )

    render(
      <MemoryRouter initialEntries={[ '/projects' ]}>
        <RequireAuth>
          <div>Protected content</div>
        </RequireAuth>
      </MemoryRouter>,
    )

    expect( screen.getByText( 'Protected content' ) ).toBeTruthy()
  } )
} )
