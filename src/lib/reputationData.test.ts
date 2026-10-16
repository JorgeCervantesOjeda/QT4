// src/lib/reputationData.test.ts: Verifies normalization of server reputation history records.

import { describe, expect, it } from 'vitest'

import { normalizeReputationEvent } from './reputationData'

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
} )
