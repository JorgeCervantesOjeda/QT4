// src/pages/ContributionPage.test.tsx: Verifies personal contribution loading, empty, and ready states.

import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/AuthContextStore'
import type { UserReputationData } from '../lib/reputationData'
import ContributionPage from './ContributionPage'

const reputationMocks = vi.hoisted( () => ( {
  loadUserReputation: vi.fn(),
  loadProjectDisplayInfo: vi.fn(),
} ) )

vi.mock( '../lib/reputationData', async () => {
  const actual = await vi.importActual<typeof import('../lib/reputationData')>( '../lib/reputationData' )
  return {
    ...actual,
    loadUserReputation: reputationMocks.loadUserReputation,
    loadProjectDisplayInfo: reputationMocks.loadProjectDisplayInfo,
  }
} )

vi.mock( '../lib/projectDisplay', () => ( {
  formatProjectDisplayLabel: ( _projectId: string, info?: { name?: string } ) => info?.name || 'Project',
  getProjectContributionPath: ( info?: { shortId?: number | null } ) => info?.shortId ? `/projects/${info.shortId}/contribution` : null,
  loadProjectDisplayInfo: reputationMocks.loadProjectDisplayInfo,
} ) )

vi.mock( '../components/AppBrand', () => ( {
  default: ( { pageTitle }: { pageTitle: string } ) => <h1>{pageTitle}</h1>,
} ) )
vi.mock( '../components/BackStack', () => ( {
  default: ( { mode }: { mode?: string } ) => <nav data-testid="back-stack">{mode ?? 'standard'}</nav>,
} ) )
vi.mock( '../components/ProgressModal', () => ( {
  default: ( { title, message }: { title: string; message?: string } ) => (
    <div role="dialog"><h3>{title}</h3>{message ? <p>{message}</p> : null}</div>
  ),
} ) )

const renderWithAuth = (children: ReactNode) => render(
  <AuthContext.Provider
    value={{
      user: { uid: 'user-1', email: 'member@example.com', displayName: 'Member User' } as never,
      loading: false,
      signOutUser: vi.fn(),
    }}
  >
    <MemoryRouter>{children}</MemoryRouter>
  </AuthContext.Provider>,
)

const data: UserReputationData = {
  summaries: [ {
    projectId: 'project-1',
    userId: 'user-1',
    totalPoints: 5,
    collaborationPoints: 1,
    reviewPoints: 0,
    qualityPoints: 4,
    contributionCount: 2,
    threadCount: 1,
    commentCount: 1,
    goodReactionCount: 0,
    completedReviewCount: 0,
    acceptedVersionCount: 0,
    badgeIds: [ 'first-contribution' ],
    updatedAt: null,
  } ],
  events: [ {
    id: 'event-1',
    projectId: 'project-1',
    userId: 'user-1',
    sourceType: 'comment',
    sourceId: 'comment-1',
    category: 'collaboration',
    points: 1 / 3,
    reason: 'Added a comment',
    createdAt: null,
  } ],
}

describe( 'ContributionPage', () => {
  it( 'shows a progress modal while contribution data is loading', () => {
    reputationMocks.loadUserReputation.mockReturnValue( new Promise( () => undefined ) )
    renderWithAuth( <ContributionPage /> )

    expect( screen.getByRole( 'dialog' ) ).toBeTruthy()
    expect( screen.getByRole( 'heading', { name: 'Loading contributions' } ) ).toBeTruthy()
  } )

  it( 'shows project-scoped totals, badges, and history', async () => {
    reputationMocks.loadUserReputation.mockResolvedValue( data )
    reputationMocks.loadProjectDisplayInfo.mockResolvedValue( {
      'project-1': { name: 'Quality review', shortId: 7 },
    } )
    renderWithAuth( <ContributionPage /> )

    expect( await screen.findByText( 'Your contribution summary' ) ).toBeTruthy()
    expect( screen.getByText( 'What you did, what it earned, and your progress by project.' ) ).toBeTruthy()
    expect( screen.queryByText( 'Points across all projects' ) ).toBeNull()
    expect( screen.getByText( 'Your projects' ) ).toBeTruthy()
    expect( screen.getByText( 'First contribution' ) ).toBeTruthy()
    expect( screen.getByText( 'Recent activity' ) ).toBeTruthy()
    expect( screen.getByRole( 'columnheader', { name: 'What happened' } ) ).toBeTruthy()
    expect( screen.getByRole( 'columnheader', { name: 'Area' } ) ).toBeTruthy()
    expect( screen.getAllByText( 'Quality review' ).length ).toBeGreaterThan( 0 )
    expect( screen.queryByText( 'Project project-1' ) ).toBeNull()
    expect( screen.getByTestId( 'back-stack' ).textContent ).toBe( 'return-only' )
    expect( screen.getByRole( 'link', { name: 'Open project ranking' } ).getAttribute( 'href' ) )
      .toBe( '/projects/7/contribution' )
    expect( screen.getByRole( 'link', { name: 'Open project ranking' } ).getAttribute( 'href' ) )
      .not.toContain( 'project-1' )
    expect( screen.getByText( 'Added a comment' ) ).toBeTruthy()
    expect( screen.getByText( '+0.33' ) ).toBeTruthy()
  } )

  it( 'shows a visible empty state when no project summary exists', async () => {
    reputationMocks.loadUserReputation.mockResolvedValue( { summaries: [], events: [] } )
    renderWithAuth( <ContributionPage /> )

    expect( await screen.findByText( 'No project contributions have been recorded yet.' ) ).toBeTruthy()
  } )

  it( 'keeps points, dimensions, and badges separate for two projects', async () => {
    reputationMocks.loadUserReputation.mockResolvedValue( {
      summaries: [ data.summaries[0], {
        ...data.summaries[0], projectId: 'project-2', totalPoints: 20,
        collaborationPoints: 20, qualityPoints: 0, badgeIds: [],
      } ], events: data.events,
    } )
    reputationMocks.loadProjectDisplayInfo.mockResolvedValue( {
      'project-1': { name: 'Quality review', shortId: 7 },
      'project-2': { name: 'Second project', shortId: 8 },
    } )
    renderWithAuth( <ContributionPage /> )
    const first = ( await screen.findAllByRole( 'heading', { name: 'Quality review' } ) )[0].closest( 'article' )!
    const second = screen.getAllByRole( 'heading', { name: 'Second project' } )[0].closest( 'article' )!
    expect( within( first ).getByText( '5 pts' ) ).toBeTruthy()
    expect( within( second ).getByText( '20 pts' ) ).toBeTruthy()
    expect( within( first ).getByText( 'First contribution' ).closest( '[data-badge-id]' )?.className ).toContain( 'badge-card--unlocked' )
    expect( within( second ).getByText( 'First contribution' ).closest( '[data-badge-id]' )?.className ).toContain( 'badge-card--locked' )
    expect( screen.queryByText( '25' ) ).toBeNull()
    expect( screen.queryByText( 'Points across all projects' ) ).toBeNull()
    expect( screen.queryByText( 'All project totals combined' ) ).toBeNull()
  } )
} )
