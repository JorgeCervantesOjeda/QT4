// src/pages/AccountSettingsPage.test.tsx: Verifies account notification preference controls and save feedback.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/AuthContextStore'
import AccountSettingsPage from './AccountSettingsPage'

const firestoreMocks = vi.hoisted( () => ( {
  doc: vi.fn( ( _db: unknown, collectionName: string, documentId: string ) => ( {
    collectionName,
    documentId,
  } ) ),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  doc: firestoreMocks.doc,
  getDoc: firestoreMocks.getDoc,
  serverTimestamp: () => 'server-timestamp',
  updateDoc: firestoreMocks.updateDoc,
} ) )

vi.mock( '../lib/firebase', () => ( {
  db: {},
} ) )

vi.mock( '../components/AppBrand', () => ( {
  default: ( { pageTitle }: { pageTitle: string } ) => <h1>{pageTitle}</h1>,
} ) )

const renderWithAuth = (children: ReactNode) => render(
  <AuthContext.Provider
    value={{
      user: {
        uid: 'user-1',
        email: 'member@example.com',
        displayName: 'Member User',
      } as never,
      loading: false,
      signOutUser: vi.fn(),
    }}
  >
    <MemoryRouter>
      {children}
    </MemoryRouter>
  </AuthContext.Provider>,
)

const profileSnapshot = (data: Record<string, unknown> | undefined) => ( {
  exists: () => Boolean( data ),
  data: () => data,
} )

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>( (promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  } )
  return { promise, reject, resolve }
}

describe( 'AccountSettingsPage', () => {
  it( 'loads legacy notification defaults when profile preferences are missing', async () => {
    firestoreMocks.getDoc.mockResolvedValue( profileSnapshot( {
      email: 'member@example.com',
      displayName: 'Member User',
    } ) )

    renderWithAuth( <AccountSettingsPage /> )

    expect(
      ( await screen.findByRole( 'checkbox', { name: /Email me for each related comment/i } ) as HTMLInputElement )
        .checked,
    ).toBe( true )
    expect(
      ( screen.getByRole( 'checkbox', { name: /Email me an hourly activity summary/i } ) as HTMLInputElement )
        .checked,
    ).toBe( false )
  } )

  it( 'shows visible save feedback when a preference is saved', async () => {
    const save = createDeferred<void>()
    firestoreMocks.getDoc.mockResolvedValue( profileSnapshot( {
      notificationPreferences: {
        commentEmailEnabled: true,
        hourlyActivityDigestEnabled: false,
      },
    } ) )
    firestoreMocks.updateDoc.mockReturnValue( save.promise )

    renderWithAuth( <AccountSettingsPage /> )

    const digestCheckbox = await screen.findByRole(
      'checkbox',
      { name: /Email me an hourly activity summary/i },
    )
    fireEvent.click( digestCheckbox )

    expect( ( digestCheckbox as HTMLInputElement ).checked ).toBe( true )
    expect( screen.getByText( 'Saving notification preferences...' ) ).toBeTruthy()
    expect( firestoreMocks.updateDoc ).toHaveBeenCalledWith(
      expect.objectContaining( { collectionName: 'userProfiles', documentId: 'user-1' } ),
      expect.objectContaining( {
        notificationPreferences: {
          commentEmailEnabled: true,
          hourlyActivityDigestEnabled: true,
        },
      } ),
    )

    save.resolve()

    expect( await screen.findByText( 'Notification preferences saved.' ) ).toBeTruthy()
  } )

  it( 'keeps a visible error and restores persisted values when save fails', async () => {
    firestoreMocks.getDoc.mockResolvedValue( profileSnapshot( {
      notificationPreferences: {
        commentEmailEnabled: true,
        hourlyActivityDigestEnabled: false,
      },
    } ) )
    firestoreMocks.updateDoc.mockRejectedValue( new Error( 'permission denied' ) )

    renderWithAuth( <AccountSettingsPage /> )

    const commentCheckbox = await screen.findByRole(
      'checkbox',
      { name: /Email me for each related comment/i },
    )
    fireEvent.click( commentCheckbox )

    await waitFor( () => {
      expect( screen.getByText( /Notification preferences could not be saved: permission denied/i ) ).toBeTruthy()
    } )
    expect( ( commentCheckbox as HTMLInputElement ).checked ).toBe( true )
  } )
} )

