// src/lib/reputationData.test.ts: Verifies normalization of server reputation history records.

import { describe, expect, it, vi } from 'vitest'

const firestoreMocks = vi.hoisted( () => ( {
  onSnapshot: vi.fn(),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  collection: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  getDocs: vi.fn(),
  onSnapshot: firestoreMocks.onSnapshot,
  query: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  where: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
} ) )

vi.mock( './firebase', () => ( {
  db: { app: 'test' },
} ) )

import {
  buildReputationAwardMessage,
  formatReputationPoints,
  normalizeReputationEvent,
  waitForReputationEvent,
} from './reputationData'

describe( 'reputation history normalization', () => {
  it( 'hides zero-point internal counter events from user history', () => {
    expect( normalizeReputationEvent( 'reviewCompleted:version-1:user-1', {
      projectId: 'project-1',
      userId: 'user-1',
      category: 'review',
      points: 0,
      reason: 'Completed an active review',
    } ) ).toBeNull()
  } )

  it( 'keeps negative penalty events visible in user history', () => {
    expect( normalizeReputationEvent( 'penalty-1', {
      projectId: 'project-1',
      userId: 'user-1',
      category: 'quality',
      points: -2,
      reason: 'An authored version received an accepted error report',
    } ) ).toMatchObject( { id: 'penalty-1', points: -2 } )
  } )

  it( 'keeps badge awards attached to the server event', () => {
    expect( normalizeReputationEvent( 'threadCreated:thread-1', {
      projectId: 'project-1',
      userId: 'user-1',
      category: 'collaboration',
      points: 1,
      reason: 'Created a discussion thread',
      earnedBadgeIds: [ 'first-contribution', 'not-a-real-badge' ],
    } ) ).toMatchObject( {
      earnedBadgeIds: [ 'first-contribution' ],
    } )
  } )

  it( 'keeps a badge-only review event available for reward feedback', () => {
    expect( normalizeReputationEvent( 'reviewCompleted:version-1:user-1', {
      projectId: 'project-1',
      userId: 'user-1',
      category: 'review',
      points: 0,
      reason: 'Completed an active review',
      sourceType: 'versionReview',
      sourceId: 'version-1',
      earnedBadgeIds: [ 'reliable-reviewer' ],
    } ) ).toMatchObject( {
      points: 0,
      earnedBadgeIds: [ 'reliable-reviewer' ],
    } )
  } )

  it( 'formats whole, fractional, zero, and negative points consistently', () => {
    expect( formatReputationPoints( 1 ) ).toBe( '1' )
    expect( formatReputationPoints( 1 / 3 ) ).toBe( '0.33' )
    expect( formatReputationPoints( 0 ) ).toBe( '0' )
    expect( formatReputationPoints( -2 ) ).toBe( '-2' )
  } )

  it( 'waits for the exact server event without requiring a composite index', async () => {
    firestoreMocks.onSnapshot.mockImplementationOnce( ( _query, onNext ) => {
      onNext( {
        docs: [ {
          id: 'threadCreated:thread-1',
          data: () => ( {
            projectId: 'project-1',
            userId: 'user-1',
            sourceType: 'thread',
            sourceId: 'thread-1',
            category: 'collaboration',
            points: 1,
            reason: 'Created a discussion thread',
          } ),
        } ],
      } )
      return vi.fn()
    } )

    await expect( waitForReputationEvent( {
      projectId: 'project-1',
      sourceId: 'thread-1',
      sourceType: 'thread',
      userId: 'user-1',
    } ) ).resolves.toMatchObject( {
      id: 'threadCreated:thread-1',
      points: 1,
    } )
  } )

  it( 'formats the exact awarded points and newly earned badges for a modal', () => {
    expect( buildReputationAwardMessage( 'Issue created successfully.', {
      id: 'threadCreated:thread-1',
      projectId: 'project-1',
      userId: 'user-1',
      sourceType: 'thread',
      sourceId: 'thread-1',
      category: 'collaboration',
      points: 1 / 3,
      reason: 'Created a discussion thread',
      createdAt: null,
      earnedBadgeIds: [ 'first-contribution' ],
    } ) ).toBe(
      'Issue created successfully. You earned +0.33 points. New badge: First contribution.',
    )
  } )

  it( 'formats badge-only rewards without claiming that points were awarded', () => {
    expect( buildReputationAwardMessage( 'Review completed successfully.', {
      id: 'reviewCompleted:version-1:user-1',
      projectId: 'project-1',
      userId: 'user-1',
      sourceType: 'versionReview',
      sourceId: 'version-1',
      category: 'review',
      points: 0,
      reason: 'Completed an active review',
      createdAt: null,
      earnedBadgeIds: [ 'reliable-reviewer' ],
    } ) ).toBe(
      'Review completed successfully. You earned a new badge: Reliable reviewer.',
    )
  } )
} )
