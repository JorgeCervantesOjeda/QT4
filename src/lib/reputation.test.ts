// src/lib/reputation.test.ts: Contract tests for project-scoped contribution points and badges.

import { describe, expect, it } from 'vitest';

import {
  BADGE_DEFINITIONS,
  deriveBadgeIds,
  getCommentReactionPointsDelta,
  getContributionPoints,
  type ReputationSummary,
} from './reputation';

describe('contribution point policy', () => {
  it.each([
    ['threadCreated', 'collaboration', 1],
    ['commentCreated', 'collaboration', 1],
    ['goodReactionReceived', 'collaboration', 2],
    ['reviewCompleted', 'review', 0],
    ['reviewAbsence', 'review', -1],
    ['acceptedVersion', 'quality', 5],
    ['acceptedErrorReport', 'quality', 2],
    ['acceptedErrorReportPenalty', 'quality', -2],
  ] as const)('assigns %s to %s with %d points', (eventType, category, points) => {
    expect(getContributionPoints(eventType)).toMatchObject({ category, points });
  });

  it('reverses only the active good-reaction contribution', () => {
    expect(getCommentReactionPointsDelta(null, 'good')).toBe(2);
    expect(getCommentReactionPointsDelta('good', 'regular')).toBe(-2);
    expect(getCommentReactionPointsDelta('regular', 'good')).toBe(2);
    expect(getCommentReactionPointsDelta('good', 'bad')).toBe(-2);
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
