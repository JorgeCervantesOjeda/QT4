import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let isAuthenticated = true

vi.mock( './auth/AuthContext', () => ( {
  AuthProvider: ( { children }: { children: ReactNode } ) => children,
} ) )

vi.mock( './components/ErrorMonitorBridge', () => ( {
  default: () => null,
} ) )

vi.mock( './giphy/GiphyProvider', () => ( {
  GiphyProvider: ( { children }: { children: ReactNode } ) => children,
} ) )

vi.mock( './auth/RequireAuth', async () => {
  const { Navigate } = await import( 'react-router-dom' )
  return {
    RequireAuth: ( { children }: { children: ReactNode } ) => (
      isAuthenticated ? children : <Navigate to="/login" replace />
    ),
  }
} )

vi.mock( './pages/DashboardPage', () => ( {
  default: () => <div>Dashboard Page</div>,
} ) )

vi.mock( './pages/LoginPage', () => ( {
  default: () => <div>Login Page</div>,
} ) )

vi.mock( './pages/ProjectDocumentsPage', () => ( {
  default: () => <div>Project Documents Page</div>,
} ) )

vi.mock( './pages/ProjectsPage', () => ( {
  default: () => <div>Projects Page</div>,
} ) )

vi.mock( './pages/RegisterPage', () => ( {
  default: () => <div>Register Page</div>,
} ) )

vi.mock( './pages/VersionsPage', () => ( {
  default: () => <div>Versions Page</div>,
} ) )

vi.mock( './pages/AdminAuditPage', () => ( {
  default: () => <div>Admin Audit Page</div>,
} ) )

import App from './App'
import { loadRouteWithChunkRetry } from './lib/routeChunkRetry'

describe( 'App routes', () => {
  beforeEach( () => {
    isAuthenticated = true
    window.history.replaceState( {}, '', '/' )
  } )

  it( 'redirects the root route to the dashboard shell', async () => {
    render( <App /> )

    expect( await screen.findByText( 'Dashboard Page' ) ).toBeTruthy()
    await waitFor( () => {
      expect( window.location.pathname ).toBe( '/app' )
    } )
  } )

  it( 'renders the public login route', async () => {
    window.history.replaceState( {}, '', '/login' )

    render( <App /> )

    expect( await screen.findByText( 'Login Page' ) ).toBeTruthy()
    expect( window.location.pathname ).toBe( '/login' )
  } )

  it( 'redirects unknown routes to login', async () => {
    window.history.replaceState( {}, '', '/missing-page' )

    render( <App /> )

    expect( await screen.findByText( 'Login Page' ) ).toBeTruthy()
    await waitFor( () => {
      expect( window.location.pathname ).toBe( '/login' )
    } )
  } )

  it( 'redirects protected routes to login when the user is not authenticated', async () => {
    isAuthenticated = false
    window.history.replaceState( {}, '', '/projects' )

    render( <App /> )

    expect( await screen.findByText( 'Login Page' ) ).toBeTruthy()
    await waitFor( () => {
      expect( window.location.pathname ).toBe( '/login' )
    } )
  } )

  it( 'reloads once when a route chunk cannot be fetched', async () => {
    const reload = vi.fn()
    const loading = loadRouteWithChunkRetry(
      () => Promise.reject( new TypeError( 'Failed to fetch dynamically imported module: https://example.test/assets/DashboardPage.js' ) ),
      {
        route: '/app',
        buildId: 'test-build',
        storage: window.sessionStorage,
        reload,
      },
    )

    const result = await Promise.race( [
      loading.then( () => 'resolved', () => 'rejected' ),
      new Promise<string>( (resolve) => {
        window.setTimeout( () => resolve( 'pending' ), 0 )
      } ),
    ] )

    expect( reload ).toHaveBeenCalledOnce()
    expect( window.sessionStorage.getItem( 'qt4:chunk-reload:test-build:/app' ) ).toBe( '1' )
    expect( result ).toBe( 'pending' )
  } )

  it( 'does not reload repeatedly when the same route chunk keeps failing', async () => {
    const reload = vi.fn()
    window.sessionStorage.setItem( 'qt4:chunk-reload:test-build:/app', '1' )

    await expect( loadRouteWithChunkRetry(
      () => Promise.reject( new TypeError( 'Failed to fetch dynamically imported module: https://example.test/assets/DashboardPage.js' ) ),
      {
        route: '/app',
        buildId: 'test-build',
        storage: window.sessionStorage,
        reload,
      },
    ) ).rejects.toThrow( 'Failed to fetch dynamically imported module' )

    expect( reload ).not.toHaveBeenCalled()
  } )
} )
