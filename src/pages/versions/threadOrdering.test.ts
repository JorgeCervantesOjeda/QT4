// src/pages/versions/threadOrdering.test.ts: Date ordering linked to ReviewIssuesPanel integration and issue-ordering system tests.
import { describe, expect, it } from 'vitest'
import { deriveThreadActivityAt, parseThreadDate, sortThreadsByTime } from './threadOrdering'
import type { ThreadSummary } from './types'

describe( 'issue time ordering', () => {
  it( 'normalizes migrated dates and preserves explicit time zones', () => {
    expect( parseThreadDate( '2026-04-01 12:00:00' )?.toISOString() ).toBe( '2026-04-01T12:00:00.000Z' )
    expect( parseThreadDate( '2026-04-01T06:00:00-06:00' )?.toISOString() ).toBe( '2026-04-01T12:00:00.000Z' )
    expect( parseThreadDate( 'invalid' ) ).toBeNull()
  } )
  const early = { id: 'early', title: 'Early', status: 'open', createdBy: 'user', commentCount: 0,
    createdAt: new Date( 1000 ), updatedAt: new Date( 5000 ) } satisfies ThreadSummary
  const late = { ...early, id: 'late', createdAt: new Date( 2000 ), updatedAt: new Date( 2000 ), lastCommentAt: new Date( 3000 ) }
  const unknown = { id: 'unknown', title: 'Unknown', status: 'open', createdBy: 'user', commentCount: 0 } satisfies ThreadSummary

  it( 'uses the latest creation, update or comment as activity', () => {
    expect( deriveThreadActivityAt( early )?.getTime() ).toBe( 5000 )
    expect( deriveThreadActivityAt( late )?.getTime() ).toBe( 3000 )
    expect( deriveThreadActivityAt( unknown ) ).toBeUndefined()
  } )

  it.each( [
    [ 'createdAt', false, [ 'early', 'late', 'unknown' ] ],
    [ 'createdAt', true, [ 'late', 'early', 'unknown' ] ],
    [ 'activityAt', false, [ 'late', 'early', 'unknown' ] ],
    [ 'activityAt', true, [ 'early', 'late', 'unknown' ] ],
  ] )( 'orders %s descending=%s, keeping missing dates last', ( id, desc, expected ) => {
    const input = [ unknown, late, early ]
    expect( sortThreadsByTime( input, [ { id, desc } ] ).map( ( thread ) => thread.id ) ).toEqual( expected )
    expect( input[0] ).toBe( unknown )
  } )
} )
