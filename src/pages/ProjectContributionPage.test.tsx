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
  loadProjectDisplayInfo: vi.fn(),
} ) )

vi.mock( '../lib/reputationData', async () => {
  const actual = await vi.importActual<typeof import('../lib/reputationData')>( '../lib/reputationData' )
  return {
    ...actual,
    loadProjectReputation: reputationMocks.loadProjectReputation,
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
vi.mock( '../components/BackStack', () => ( { default: () => null } ) )

const renderWithAuth = (children: ReactNode) => render(
  <AuthContext.Provider
    value={{
      user: { uid: 'user-1', email: 'member@example.com', displayName: 'Member User' } as never,
      loading: false,
      signOutUser: vi.fn(),
    }}
  >
    <MemoryRouter initialEntries={[ '/projects/project-1/contribution' ]}>
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
    reputationMocks.loadProjectDisplayInfo.mockResolvedValue( {
      'project-1': { name: 'Project Alpha', shortId: 12 },
    } )
    renderWithAuth( <ProjectContributionPage /> )

    expect( await screen.findByText( 'Contribution ranking' ) ).toBeTruthy()
    expect( screen.getByText( 'You' ) ).toBeTruthy()
    expect( screen.getByText( 'Project Alpha' ) ).toBeTruthy()
  } )

  it( 'shows an explicit empty state', async () => {
    reputationMocks.loadProjectReputation.mockResolvedValue( [] )
    reputationMocks.loadProjectDisplayInfo.mockResolvedValue( {
      'project-1': { name: '', shortId: 12 },
    } )
    renderWithAuth( <ProjectContributionPage /> )

    expect( await screen.findByText( 'No contributions recorded for this project yet.' ) ).toBeTruthy()
  } )
} )
