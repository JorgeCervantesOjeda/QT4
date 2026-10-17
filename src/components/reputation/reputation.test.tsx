// src/components/reputation/reputation.test.tsx: Verifies visible contribution badges and project ranking states.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BadgeGrid from './BadgeGrid'
import ProjectLeaderboard from './ProjectLeaderboard'
import type { ReputationSummary } from '../../lib/reputation'

const summary = (userId: string, totalPoints: number, badgeIds: ReputationSummary['badgeIds'] = []): ReputationSummary => ( {
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
  badgeIds,
  updatedAt: null,
} )

describe( 'reputation components', () => {
  it( 'shows unlocked and locked badge states', () => {
    render( <BadgeGrid unlockedBadgeIds={[ 'first-contribution' ]} /> )

    expect( screen.getByText( 'First contribution' ).closest( '[data-badge-id]' )?.className ).toContain( 'badge-card--unlocked' )
    expect( screen.getByText( 'Issue spotter' ).closest( '[data-badge-id]' )?.className ).toContain( 'badge-card--locked' )
  } )

  it( 'shows the project-only ranking and highlights the current user', () => {
    render(
      <ProjectLeaderboard
        summaries={[ summary( 'user-2', 8 ), summary( 'user-1', 1 / 3, [ 'first-contribution' ] ) ]}
        currentUserId="user-1"
        resolveUserLabel={(userId) => userId === 'user-1' ? 'You' : 'Reviewer' }
      />,
    )

    expect( screen.getByText( 'Reviewer' ) ).toBeTruthy()
    expect( screen.getByText( 'You' ).closest( 'li' )?.className ).toContain( 'project-leaderboard__row--current' )
    expect( screen.getByText( '8 pts' ) ).toBeTruthy()
    expect( screen.getByText( '0.33 pts' ) ).toBeTruthy()
  } )

  it( 'does not expose a raw user ID when no label formatter is provided', () => {
    render(
      <ProjectLeaderboard
        summaries={[ summary( 'firebase-user-internal-id', 1 ) ]}
        currentUserId="different-user"
      />,
    )

    expect( screen.getByText( 'Member' ) ).toBeTruthy()
    expect( screen.queryByText( 'firebase-user-internal-id' ) ).toBeNull()
  } )
} )
