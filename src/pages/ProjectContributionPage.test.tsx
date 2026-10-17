// src/pages/ProjectContributionPage.test.tsx: Verifies project-only leaderboard loading and empty feedback.

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/AuthContextStore'
import type { ReputationSummary } from '../lib/reputation'
import ProjectContributionPage from './ProjectContributionPage'

const reputationMocks = vi.hoisted( () => ( {
  loadProjectReputation: vi.fn(),
} ) )

const projectDisplayMocks = vi.hoisted( () => ( {
  loadProjectDisplayInfo: vi.fn(),
  resolveProjectReference: vi.fn(),
} ) )

const userDisplayMocks = vi.hoisted( () => ( {
  loadUserDisplayDirectory: vi.fn(),
  resolveUserDisplayLabel: vi.fn(),
} ) )

vi.mock( '../lib/reputationData', async () => {
  const actual = await vi.importActual<typeof import('../lib/reputationData')>( '../lib/reputationData' )
  return {
    ...actual,
    loadProjectReputation: reputationMocks.loadProjectReputation,
  }
} )
vi.mock( '../lib/projectDisplay', () => ( {
  formatProjectDisplayLabel: ( _projectId: string, info?: { name?: string } ) => info?.name || 'Project',
  loadProjectDisplayInfo: projectDisplayMocks.loadProjectDisplayInfo,
  resolveProjectReference: projectDisplayMocks.resolveProjectReference,
} ) )
vi.mock( '../lib/userDisplay', () => ( {
  loadUserDisplayDirectory: userDisplayMocks.loadUserDisplayDirectory,
  resolveUserDisplayLabel: userDisplayMocks.resolveUserDisplayLabel,
} ) )
vi.mock( '../components/AppBrand', () => ( {
  default: ( { pageTitle }: { pageTitle: string } ) => <h1>{pageTitle}</h1>,
} ) )
vi.mock( '../components/BackStack', () => ( {
  default: ( { mode }: { mode?: string } ) => <nav data-testid="back-stack">{mode ?? 'standard'}</nav>,
} ) )

const renderWithAuth = (children: ReactNode) => render(
  <AuthContext.Provider
    value={{
      user: { uid: 'user-1', email: 'member@example.com', displayName: 'Member User' } as never,
      loading: false,
      signOutUser: vi.fn(),
    }}
  >
    <MemoryRouter initialEntries={[ '/projects/12/contribution' ]}>
      <Routes><Route path="/projects/:projectId/contribution" element={children} /></Routes>
    </MemoryRouter>
  </AuthContext.Provider>,
)

const summary = (userId: string, totalPoints: number): ReputationSummary => ( {
  projectId: 'project-1',
  userId,
  totalPoints,
  collaborationPoints: totalPoints,
  reviewPoints: 0,
  qualityPoints: 0,
  contributionCount: 1,
  threadCount: 1,
  commentCount: 0,
  goodReactionCount: 0,
  completedReviewCount: 0,
  acceptedVersionCount: 0,
  badgeIds: [],
  updatedAt: null,
} )

describe( 'ProjectContributionPage', () => {
  it( 'shows the project-only ranking and current-user marker', async () => {
    reputationMocks.loadProjectReputation.mockResolvedValue( [ summary( 'user-2', 8 ), summary( 'user-1', 4 ) ] )
    userDisplayMocks.loadUserDisplayDirectory.mockResolvedValue( {
      'user-2': { displayName: 'Ana Reviewer' },
      'user-1': { displayName: 'Member User' },
    } )
    userDisplayMocks.resolveUserDisplayLabel.mockImplementation( (userId: string) => userId === 'user-1' ? 'You' : 'Ana Reviewer' )
    projectDisplayMocks.resolveProjectReference.mockResolvedValue( {
      projectId: 'project-1',
      displayInfo: { name: 'Project Alpha', shortId: 12 },
    } )
    renderWithAuth( <ProjectContributionPage /> )

    expect( await screen.findByText( 'Contribution ranking' ) ).toBeTruthy()
    expect( screen.getByText( 'You' ) ).toBeTruthy()
    expect( screen.getByText( 'Project Alpha' ) ).toBeTruthy()
    expect( screen.getByText( 'Ana Reviewer' ) ).toBeTruthy()
    expect( screen.queryByText( /···/u ) ).toBeNull()
    expect( screen.getByTestId( 'back-stack' ).textContent ).toBe( 'return-only' )
    expect( reputationMocks.loadProjectReputation ).toHaveBeenCalledWith( 'project-1' )
  } )

  it( 'shows an explicit empty state', async () => {
    reputationMocks.loadProjectReputation.mockResolvedValue( [] )
    projectDisplayMocks.resolveProjectReference.mockResolvedValue( {
      projectId: 'project-1',
      displayInfo: { name: '', shortId: 12 },
    } )
    renderWithAuth( <ProjectContributionPage /> )

    expect( await screen.findByText( 'No contributions recorded for this project yet.' ) ).toBeTruthy()
  } )
} )
