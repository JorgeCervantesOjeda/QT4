// src/lib/reputation.test.ts: Contract tests for project-scoped contribution points and badges.

import { describe, expect, it } from 'vitest';

import {
  BADGE_DEFINITIONS,
  deriveBadgeIds,
  getCommentReactionPointsDelta,
  getContributionPoints,
  getSequenceInterval,
  getSequencePoints,
  type ReputationSummary,
} from './reputation';

describe('contribution point policy', () => {
  // Integration: reputation_functions_emulator.mjs; system: reputation.emulator.spec.ts.
  it.each( [
    [ 'acceptedVersion', 3 ], [ 'acceptedErrorReport', 3 ],
    [ 'reviewAbsence', 0.25 ], [ 'acceptedErrorReportPenalty', 0.5 ],
  ] as const )( 'defines the approved multiplier for %s', (eventType, pointMultiplier) => {
    expect( getContributionPoints( eventType ).pointMultiplier ).toBe( pointMultiplier );
  } );
  it.each([
    ['threadCreated', 'collaboration', 1],
    ['commentCreated', 'collaboration', 1],
    ['goodReactionReceived', 'collaboration', 1],
    ['reviewCompleted', 'review', 0],
    ['reviewAbsence', 'review', -1],
    ['acceptedVersion', 'quality', 1],
    ['acceptedErrorReport', 'quality', 1],
    ['acceptedErrorReportPenalty', 'quality', -2],
  ] as const)('assigns %s to %s with %d points', (eventType, category, points) => {
    expect(getContributionPoints(eventType)).toMatchObject({ category, points });
  });

  it.each([
    [1, { start: 1, end: 1 }, 1],
    [2, { start: 2, end: 2 }, 1],
    [3, { start: 3, end: 5 }, 1 / 3],
    [5, { start: 3, end: 5 }, 1 / 3],
    [6, { start: 6, end: 10 }, 1 / 5],
    [10, { start: 6, end: 10 }, 1 / 5],
    [11, { start: 11, end: 20 }, 1 / 10],
    [20, { start: 11, end: 20 }, 1 / 10],
    [21, { start: 21, end: 50 }, 1 / 30],
    [50, { start: 21, end: 50 }, 1 / 30],
    [51, { start: 51, end: 100 }, 1 / 50],
    [100, { start: 51, end: 100 }, 1 / 50],
    [101, { start: 101, end: 200 }, 1 / 100],
    [200, { start: 101, end: 200 }, 1 / 100],
    [201, { start: 201, end: 500 }, 1 / 300],
    [500, { start: 201, end: 500 }, 1 / 300],
    [501, { start: 501, end: 1000 }, 1 / 500],
  ] as const)('assigns position %d to its interval and fraction', (position, interval, points) => {
    expect(getSequenceInterval(position)).toEqual(interval);
    expect(getSequencePoints(position)).toBe(points);
  });

  it('gives reactions a quarter weight without negative reaction deductions', () => {
    expect(getCommentReactionPointsDelta(null, 'good')).toBe(0.25);
    expect(getCommentReactionPointsDelta('good', 'regular')).toBe(0);
    expect(getCommentReactionPointsDelta('regular', 'good')).toBe(0.25);
    expect(getCommentReactionPointsDelta('good', 'bad')).toBe(0);
    expect(getCommentReactionPointsDelta('bad', 'regular')).toBe(0);
  });
});

describe('project-scoped badges', () => {
  const emptySummary: ReputationSummary = {
    projectId: 'project-1',
    userId: 'user-1',
    totalPoints: 0,
    collaborationPoints: 0,
    reviewPoints: 0,
    qualityPoints: 0,
    contributionCount: 0,
    threadCount: 0,
    commentCount: 0,
    goodReactionCount: 0,
    completedReviewCount: 0,
    acceptedVersionCount: 0,
    badgeIds: [],
    updatedAt: null,
  };

  it('defines only the approved badge identifiers', () => {
    expect(BADGE_DEFINITIONS.map((badge) => badge.id)).toEqual([
      'first-contribution',
      'issue-spotter',
      'helpful-collaborator',
      'reliable-reviewer',
      'quality-builder',
      'consistent-contributor',
    ]);
  });

  it('derives badges from project-local contribution counters', () => {
    expect(
      deriveBadgeIds({
        ...emptySummary,
        contributionCount: 10,
        threadCount: 3,
        goodReactionCount: 3,
        completedReviewCount: 3,
        acceptedVersionCount: 1,
      }),
    ).toEqual([
      'first-contribution',
      'issue-spotter',
      'helpful-collaborator',
      'reliable-reviewer',
      'quality-builder',
      'consistent-contributor',
    ]);
  });

  it('describes reliable reviewers by completed active reviews', () => {
    expect(BADGE_DEFINITIONS.find((badge) => badge.id === 'reliable-reviewer')).toMatchObject({
      description: 'Participate in three completed reviews in this project.',
    });
  });

  it('does not award badges from unrelated counters', () => {
    expect(deriveBadgeIds({ ...emptySummary, totalPoints: 100 })).toEqual([]);
  });
});
