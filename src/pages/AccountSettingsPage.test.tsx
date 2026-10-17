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

const reputationMocks = vi.hoisted( () => ( {
  loadUserReputation: vi.fn(),
  loadProjectDisplayInfo: vi.fn(),
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

vi.mock( '../lib/reputationData', async () => {
  const actual = await vi.importActual<typeof import( '../lib/reputationData' )>( '../lib/reputationData' )
  return {
    ...actual,
    loadUserReputation: reputationMocks.loadUserReputation,
    loadProjectDisplayInfo: reputationMocks.loadProjectDisplayInfo,
  }
} )

vi.mock( '../lib/projectDisplay', () => ( {
  formatProjectDisplayLabel: ( _projectId: string, info?: { name?: string } ) => info?.name || 'Project',
  loadProjectDisplayInfo: reputationMocks.loadProjectDisplayInfo,
} ) )

vi.mock( '../components/AppBrand', () => ( {
  default: ( { pageTitle }: { pageTitle: string } ) => <h1>{pageTitle}</h1>,
} ) )
vi.mock( '../components/ProgressModal', () => ( {
  default: ( { title, message }: { title: string; message?: string } ) => (
    <div role="dialog"><h3>{title}</h3>{message ? <p>{message}</p> : null}</div>
  ),
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
  it( 'shows a progress modal while points and badges are loading', () => {
    firestoreMocks.getDoc.mockResolvedValue( profileSnapshot( undefined ) )
    reputationMocks.loadUserReputation.mockReturnValue( new Promise( () => undefined ) )
    renderWithAuth( <AccountSettingsPage /> )

    expect( screen.getByRole( 'dialog' ) ).toBeTruthy()
    expect( screen.getByRole( 'heading', { name: 'Loading points and badges' } ) ).toBeTruthy()
  } )

  it( 'shows points and badges directly without opening Contributions', async () => {
    firestoreMocks.getDoc.mockResolvedValue( profileSnapshot( {
      notificationPreferences: {
        commentEmailEnabled: true,
        hourlyActivityDigestEnabled: false,
      },
    } ) )
    reputationMocks.loadUserReputation.mockResolvedValue( {
      summaries: [ {
        projectId: 'project-1',
        userId: 'user-1',
        totalPoints: 1.33,
        collaborationPoints: 1.33,
        reviewPoints: 0,
        qualityPoints: 0,
        contributionCount: 2,
        threadCount: 1,
        commentCount: 1,
        goodReactionCount: 0,
        completedReviewCount: 0,
        acceptedVersionCount: 0,
        badgeIds: [ 'first-contribution' ],
        updatedAt: null,
      } ],
      events: [],
    } )
    reputationMocks.loadProjectDisplayInfo.mockResolvedValue( {
      'project-1': { name: 'Quality review', shortId: 7 },
    } )

    renderWithAuth( <AccountSettingsPage /> )

    expect( await screen.findByRole( 'heading', { name: 'Points and badges' } ) ).toBeTruthy()
    expect( screen.getAllByText( '1.33' ).length ).toBeGreaterThan( 0 )
    expect( screen.getByText( 'First contribution' ) ).toBeTruthy()
    expect( screen.getByText( 'Quality review' ) ).toBeTruthy()
    expect( screen.queryByText( 'Project project-1' ) ).toBeNull()
  } )

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

