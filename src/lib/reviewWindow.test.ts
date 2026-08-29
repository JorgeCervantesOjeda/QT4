// src/lib/reviewWindow.test.ts
// Verifies review-window helpers and supported duration boundaries.
import { describe, expect, it } from 'vitest'
import {
  ONE_HOUR_MS,
  calculateReviewEndAt,
  canAddCommentInWindow,
  formatApproxCountdown,
  getCommentWindowRemainingMs,
  isReviewExpired,
  numOfReviewDurationDays,
  shouldAutoSetReviewed,
} from './reviewWindow'

describe( 'lib/reviewWindow', () => {
  const reviewEndAt = new Date( '2026-04-03T18:00:00.000Z' )

  it( 'detects when a review has expired', () => {
    expect( isReviewExpired( reviewEndAt, reviewEndAt.getTime() - 1 ) ).toBe( false )
    expect( isReviewExpired( reviewEndAt, reviewEndAt.getTime() ) ).toBe( true )
  } )

  it( 'allows comments during the active review period', () => {
    expect(
      canAddCommentInWindow( {
        versionStatus: 'In Review',
        reviewEndAt,
        threadStatus: 'open',
        lastThreadCommentAt: null,
        canParticipate: true,
        hasBody: true,
        nowMs: reviewEndAt.getTime() - 1000,
      } ),
    ).toBe( true )
  } )

  it( 'allows comments during the one-hour grace window after the review ends', () => {
    expect(
      canAddCommentInWindow( {
        versionStatus: 'In Review',
        reviewEndAt,
        threadStatus: 'open',
        lastThreadCommentAt: new Date( reviewEndAt.getTime() + 30 * 60 * 1000 ),
        canParticipate: true,
        hasBody: true,
        nowMs: reviewEndAt.getTime() + 45 * 60 * 1000,
      } ),
    ).toBe( true )
  } )

  it( 'blocks comments after the grace window closes', () => {
    expect(
      canAddCommentInWindow( {
        versionStatus: 'In Review',
        reviewEndAt,
        threadStatus: 'open',
        lastThreadCommentAt: new Date( reviewEndAt.getTime() - 5 * 60 * 1000 ),
        canParticipate: true,
        hasBody: true,
        nowMs: reviewEndAt.getTime() + ONE_HOUR_MS + 1,
      } ),
    ).toBe( false )
  } )

  it( 'auto-completes a review after the deadline when the last comment is at least one hour old', () => {
    expect(
      shouldAutoSetReviewed( {
        versionStatus: 'In Review',
        reviewEndAt,
        latestVersionCommentAt: new Date( reviewEndAt.getTime() - ONE_HOUR_MS - 1 ),
        hasAnyComments: true,
        nowMs: reviewEndAt.getTime(),
      } ),
    ).toBe( true )
  } )

  it( 'returns the remaining time before the window closes', () => {
    expect(
      getCommentWindowRemainingMs(
        'In Review',
        reviewEndAt,
        null,
        reviewEndAt.getTime() - 15 * 60 * 1000,
      ),
    ).toBe( 15 * 60 * 1000 )

    expect(
      getCommentWindowRemainingMs(
        'In Review',
        reviewEndAt,
        new Date( reviewEndAt.getTime() + 30 * 60 * 1000 ),
        reviewEndAt.getTime() + 45 * 60 * 1000,
      ),
    ).toBe( 45 * 60 * 1000 )
  } )

  it( 'formats countdowns in minutes and hours', () => {
    expect( formatApproxCountdown( 0 ) ).toBe( '0m' )
    expect( formatApproxCountdown( 20 * 60 * 1000 ) ).toBe( '20m' )
    expect( formatApproxCountdown( 95 * 60 * 1000 ) ).toBe( '1h 35m' )
  } )

  it( 'normalizes review duration days to the supported range', () => {
    expect( numOfReviewDurationDays( 0 ) ).toBe( 1 )
    expect( numOfReviewDurationDays( 7 ) ).toBe( 7 )
    expect( numOfReviewDurationDays( 31 ) ).toBe( 30 )
  } )

  it( 'calculates review end time from selected duration days', () => {
    const startMs = new Date( '2026-04-03T09:00:00.000Z' ).getTime()

    expect( calculateReviewEndAt( 3, startMs ).toISOString() ).toBe(
      '2026-04-06T09:00:00.000Z',
    )
  } )
} )
