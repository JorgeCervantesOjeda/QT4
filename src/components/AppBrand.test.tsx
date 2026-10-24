// src/components/AppBrand.test.tsx: Verifies help and About affordances in the brand banner.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_METADATA } from '../lib/appMetadata'
import AppBrand from './AppBrand'

const authMocks = vi.hoisted( () => ( {
  user: null as unknown,
} ) )

const reputationMocks = vi.hoisted( () => ( {
  loadUserReputation: vi.fn(),
} ) )

vi.mock( '../auth/useAuth', () => ( {
  useAuth: () => ( {
    user: authMocks.user,
  } ),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  doc: vi.fn(),
  getDoc: vi.fn(),
} ) )

vi.mock( '../lib/firebase', () => ( {
  db: {},
} ) )

vi.mock( '../lib/reputationData', async () => {
  const actual = await vi.importActual<typeof import( '../lib/reputationData' )>( '../lib/reputationData' )
  return {
    ...actual,
    loadUserReputation: reputationMocks.loadUserReputation,
  }
} )

describe( 'AppBrand', () => {
  beforeEach( () => {
    authMocks.user = null
    reputationMocks.loadUserReputation.mockReset()
  } )

  it( 'shows a compact points and badges summary beside Account', async () => {
    authMocks.user = {
      uid: 'user-1',
      displayName: 'Member User',
    }
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

    render( <MemoryRouter><AppBrand pageTitle="Dashboard" /></MemoryRouter> )

    const summary = await screen.findByLabelText( 'Account reputation summary' )
    expect( summary.textContent ).toContain( 'Points and badges by project' )
    expect( summary.textContent ).not.toContain( '1.33' )
    expect( screen.getByRole( 'link', { name: 'Account' } ).getAttribute( 'href' ) ).toBe( '/account' )
  } )

  it( 'shows the NotebookLM help link for usage questions', () => {
    render( <MemoryRouter><AppBrand pageTitle="Dashboard" /></MemoryRouter> )

    expect( screen.getByText( 'Ask questions about how to use QualiTeam.' ) ).toBeTruthy()
    const helpLink = screen.getByRole( 'link', { name: 'Open the QualiTeam help assistant' } )
    expect( helpLink.getAttribute( 'href' ) ).toBe(
      'https://notebooklm.google.com/notebook/a602cd8e-4c62-4baa-b559-53ae95facaef',
    )
  } )

  it( 'opens the About dialog with the synchronized project version', () => {
    render( <MemoryRouter><AppBrand pageTitle="Dashboard" /></MemoryRouter> )

    fireEvent.click( screen.getByRole( 'button', { name: 'About' } ) )

    const aboutDialog = screen.getByRole( 'dialog' )

    expect( within( aboutDialog ).getByRole( 'heading', { name: 'QualiTeam' } ) ).toBeTruthy()
    expect( within( aboutDialog ).getByText( 'Version' ) ).toBeTruthy()
    expect( within( aboutDialog ).getByText( APP_METADATA.appVersion ) ).toBeTruthy()
  } )
} )
