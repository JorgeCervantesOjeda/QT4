import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReputationRewardListener from './ReputationRewardListener'

const firestoreMocks = vi.hoisted( () => ( {
  collection: vi.fn( () => ( { collection: 'reputationEvents' } ) ),
  onSnapshot: vi.fn(),
  query: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  where: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
} ) )

const authMocks = vi.hoisted( () => ( {
  user: { uid: 'user-1' },
} ) )

vi.mock( 'firebase/firestore', () => ( {
  collection: firestoreMocks.collection,
  onSnapshot: firestoreMocks.onSnapshot,
  query: firestoreMocks.query,
  where: firestoreMocks.where,
} ) )

vi.mock( '../../auth/useAuth', () => ( {
  useAuth: () => authMocks,
} ) )

vi.mock( '../../lib/firebase', () => ( {
  db: { app: 'test' },
} ) )

describe( 'ReputationRewardListener', () => {
  beforeEach( () => {
    vi.clearAllMocks()
  } )

  it( 'ignores existing events and shows a new badge-only review reward in a modal', () => {
    let onNext: ((snapshot: { docChanges: () => unknown[] }) => void) | undefined
    firestoreMocks.onSnapshot.mockImplementationOnce( ( _query, next ) => {
      onNext = next
      return vi.fn()
    } )

    const { rerender } = render( <ReputationRewardListener /> )
    const badgeEvent = {
      id: 'reviewCompleted:version-1:user-1',
      data: () => ( {
        projectId: 'project-1',
        userId: 'user-1',
        sourceType: 'versionReview',
        sourceId: 'version-1',
        category: 'review',
        points: 0,
        reason: 'Completed an active review',
        earnedBadgeIds: [ 'reliable-reviewer' ],
      } ),
    }

    onNext?.( { docChanges: () => [ { type: 'added', doc: badgeEvent } ] } )
    expect( screen.queryByText( /Your review participation was recognized/ ) ).toBeNull()

    const newBadgeEvent = {
      ...badgeEvent,
      id: 'reviewCompleted:version-2:user-1',
      data: () => ( {
        ...badgeEvent.data(),
        sourceId: 'version-2',
      } ),
    }
    onNext?.( { docChanges: () => [ { type: 'added', doc: newBadgeEvent } ] } )
    rerender( <ReputationRewardListener /> )
    expect( screen.getByText( /You earned a new badge: Reliable reviewer/ ) ).toBeTruthy()
  } )
} )
