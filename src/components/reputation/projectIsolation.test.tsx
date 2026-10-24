// src/components/reputation/projectIsolation.test.tsx: Links project-only summaries to Account and dashboard integration coverage.

import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { ReputationSummary } from '../../lib/reputation'
import AccountContributionOverview from './AccountContributionOverview'
import AccountReputationSummary from './AccountReputationSummary'
import MyContributionCard from './MyContributionCard'
import ContributionSummary from './ContributionSummary'

const mocks = vi.hoisted( () => ( { loadUserReputation: vi.fn() } ) )
vi.mock( '../ProgressModal', () => ( { default: () => <div role="dialog">Loading</div> } ) )
vi.mock( '../../auth/useAuth', () => ( { useAuth: () => ( { user: { uid: 'member' } } ) } ) )
vi.mock( '../../lib/reputationData', async () => ( {
  ...await vi.importActual( '../../lib/reputationData' ),
  loadUserReputation: mocks.loadUserReputation,
} ) )
vi.mock( '../../lib/projectDisplay', () => ( {
  loadProjectDisplayInfo: async () => ( { first: { name: 'First project' }, second: { name: 'Second project' } } ),
  formatProjectDisplayLabel: (id: string, info?: { name: string }) => info?.name ?? id,
} ) )

const first: ReputationSummary = {
  projectId: 'first', userId: 'member', totalPoints: 5, collaborationPoints: 5,
  reviewPoints: 0, qualityPoints: 0, contributionCount: 3, threadCount: 3,
  commentCount: 0, goodReactionCount: 0, completedReviewCount: 0, acceptedVersionCount: 0,
  badgeIds: [ 'first-contribution', 'issue-spotter' ], updatedAt: null,
}
const second: ReputationSummary = { ...first, projectId: 'second', totalPoints: 20, collaborationPoints: 20, badgeIds: [] }

describe( 'project reputation isolation (system: reputation.emulator.spec.ts)', () => {
  it( 'labels a single summary as belonging only to its project', () => {
    render( <ContributionSummary summary={first} /> )
    expect( screen.getByText( 'Only this project is included.' ) ).toBeTruthy()
    expect( screen.queryByText( 'All project totals combined' ) ).toBeNull()
  } )

  it.each( [ [ 'Account', AccountContributionOverview ], [ 'Dashboard', MyContributionCard ] ] as const )( 'renders each project without an account-wide sum in %s', async (_name, Component) => {
    mocks.loadUserReputation.mockResolvedValue( { summaries: [ first, second ], events: [] } )
    render( <MemoryRouter><Component /></MemoryRouter> )
    const firstCard = ( await screen.findByRole( 'heading', { name: 'First project' } ) ).closest( 'article' )!
    const secondCard = screen.getByRole( 'heading', { name: 'Second project' } ).closest( 'article' )!
    expect( within( firstCard ).getByText( '5 pts' ) ).toBeTruthy()
    expect( within( secondCard ).getByText( '20 pts' ) ).toBeTruthy()
    expect( screen.queryByText( '25' ) ).toBeNull()
    expect( screen.queryByText( /points across/i ) ).toBeNull()
  } )

  it( 'does not combine badges or points in the account banner', async () => {
    mocks.loadUserReputation.mockResolvedValue( { summaries: [ first, second ], events: [] } )
    render( <MemoryRouter><AccountReputationSummary /></MemoryRouter> )
    expect( await screen.findByText( 'Points and badges by project' ) ).toBeTruthy()
    expect( screen.queryByText( /25 pts/ ) ).toBeNull()
  } )
} )
