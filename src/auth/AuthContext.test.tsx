import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useContext } from 'react'

const {
  onAuthStateChangedMock,
  signOutMock,
  disableNetworkMock,
  enableNetworkMock,
} = vi.hoisted( () => ( {
  onAuthStateChangedMock: vi.fn(),
  signOutMock: vi.fn(),
  disableNetworkMock: vi.fn(),
  enableNetworkMock: vi.fn(),
} ) )

vi.mock( 'firebase/auth', () => ( {
  onAuthStateChanged: onAuthStateChangedMock,
  signOut: signOutMock,
} ) )

vi.mock( 'firebase/firestore', () => ( {
  disableNetwork: disableNetworkMock,
  enableNetwork: enableNetworkMock,
} ) )

vi.mock( '../lib/firebase', () => ( {
  auth: { name: 'auth' },
  db: { name: 'db' },
} ) )

import { AuthProvider } from './AuthContext'
import { AuthContext } from './AuthContextStore'

const TestConsumer = () => {
  const context = useContext( AuthContext )
  if( !context ) {
    return null
  }
  return (
    <div>
      <span>{context.loading ? 'loading' : context.user?.uid ?? 'signed-out'}</span>
      <button type="button" onClick={() => void context.signOutUser()}>
        Sign out
      </button>
    </div>
  )
}

describe( 'auth/AuthContext', () => {
  const fakeUser = {
    uid: 'user-member-1',
    email: 'member@example.com',
    displayName: 'Member User',
  }
  let locationAssignMock: ReturnType<typeof vi.fn>

  beforeEach( () => {
    vi.useFakeTimers()
    vi.setSystemTime( new Date( '2026-04-04T12:00:00.000Z' ) )
    onAuthStateChangedMock.mockImplementation( (auth, callback) => {
      void auth
      callback( fakeUser )
      return () => undefined
    } )
    signOutMock.mockResolvedValue( undefined )
    disableNetworkMock.mockResolvedValue( undefined )
    enableNetworkMock.mockResolvedValue( undefined )
    window.localStorage.clear()
    window.localStorage.setItem( 'qt4_giphy_last_member@example.com', 'cached-gif' )
    locationAssignMock = vi.fn()
    vi.stubGlobal( 'location', {
      assign: locationAssignMock,
    } )
  } )

  afterEach( () => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  } )

  it( 'automatically signs the user out after the inactivity timeout', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )

    expect( screen.getByText( 'user-member-1' ) ).toBeTruthy()

    await vi.advanceTimersByTimeAsync( 30 * 60 * 1000 )

    expect( signOutMock ).toHaveBeenCalledTimes( 1 )
    expect( locationAssignMock ).toHaveBeenCalledWith( '/login?reason=inactive' )
    expect( window.localStorage.getItem( 'qt4_giphy_last_member@example.com' ) ).toBeNull()
  } )

  it( 'resets the inactivity timer after user activity', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )

    expect( screen.getByText( 'user-member-1' ) ).toBeTruthy()

    await vi.advanceTimersByTimeAsync( ( 30 * 60 * 1000 ) - 1000 )
    fireEvent.pointerDown( window )
    await vi.advanceTimersByTimeAsync( 1500 )

    expect( signOutMock ).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync( ( 30 * 60 * 1000 ) - 1000 )

    expect( signOutMock ).toHaveBeenCalledTimes( 1 )
    expect( locationAssignMock ).toHaveBeenCalledWith( '/login?reason=inactive' )
  } )
} )
