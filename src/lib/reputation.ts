// src/lib/reputation.ts: Defines the approved project-scoped contribution policy.

export type ReputationCategory = 'collaboration' | 'review' | 'quality';

export type ReputationEventType =
  | 'threadCreated'
  | 'commentCreated'
  | 'goodReactionReceived'
  | 'reviewCompleted'
  | 'acceptedVersion'
  | 'acceptedErrorReport';

export type CommentReaction = 'good' | 'regular' | 'bad';

export type ReputationBadgeId =
  | 'first-contribution'
  | 'issue-spotter'
  | 'helpful-collaborator'
  | 'reliable-reviewer'
  | 'quality-builder'
  | 'consistent-contributor';

export type ReputationSummary = {
  projectId: string;
  userId: string;
  totalPoints: number;
  collaborationPoints: number;
  reviewPoints: number;
  qualityPoints: number;
  contributionCount: number;
  threadCount: number;
  commentCount: number;
  goodReactionCount: number;
  completedReviewCount: number;
  acceptedVersionCount: number;
  badgeIds: ReputationBadgeId[];
  updatedAt: unknown;
};

export type ReputationPointRule = {
  category: ReputationCategory;
  points: number;
  reason: string;
};

export type ReputationBadgeDefinition = {
  id: ReputationBadgeId;
  label: string;
  description: string;
};

export const BADGE_DEFINITIONS: ReputationBadgeDefinition[] = [
  {
    id: 'first-contribution',
    label: 'First contribution',
    description: 'Make your first contribution to this project.',
  },
  {
    id: 'issue-spotter',
    label: 'Issue spotter',
    description: 'Create three discussion threads in this project.',
  },
  {
    id: 'helpful-collaborator',
    label: 'Helpful collaborator',
    description: 'Receive three good reactions on your comments.',
  },
  {
    id: 'reliable-reviewer',
    label: 'Reliable reviewer',
    description: 'Complete three reviews in this project.',
  },
  {
    id: 'quality-builder',
    label: 'Quality builder',
    description: 'Have one version accepted in this project.',
  },
  {
    id: 'consistent-contributor',
    label: 'Consistent contributor',
    description: 'Reach ten contribution events in this project.',
  },
];

const POINT_RULES: Record<ReputationEventType, ReputationPointRule> = {
  threadCreated: {
    category: 'collaboration',
    points: 1,
    reason: 'Created a discussion thread',
  },
  commentCreated: {
    category: 'collaboration',
    points: 1,
    reason: 'Added a comment',
  },
  goodReactionReceived: {
    category: 'collaboration',
    points: 2,
    reason: 'Received a good reaction on a comment',
  },
  reviewCompleted: {
    category: 'review',
    points: 4,
    reason: 'Completed a review',
  },
  acceptedVersion: {
    category: 'quality',
    points: 5,
    reason: 'Created an accepted version',
  },
  acceptedErrorReport: {
    category: 'quality',
    points: 6,
    reason: 'Created an accepted error report',
  },
};

export const getContributionPoints = (
  eventType: ReputationEventType,
): ReputationPointRule => POINT_RULES[eventType];

export const getCommentReactionPointsDelta = (
  previousReaction: CommentReaction | null,
  nextReaction: CommentReaction,
): number => {
  const previousPoints = previousReaction === 'good' ? 2 : 0;
  const nextPoints = nextReaction === 'good' ? 2 : 0;
  return nextPoints - previousPoints;
};

export const deriveBadgeIds = (
  summary: Pick<
    ReputationSummary,
    | 'totalPoints'
    | 'contributionCount'
    | 'threadCount'
    | 'goodReactionCount'
    | 'completedReviewCount'
    | 'acceptedVersionCount'
  >,
): ReputationBadgeId[] => {
  const badgeIds: ReputationBadgeId[] = [];

  if( summary.contributionCount >= 1 ) {
    badgeIds.push( 'first-contribution' );
  }
  if( summary.threadCount >= 3 ) {
    badgeIds.push( 'issue-spotter' );
  }
  if( summary.goodReactionCount >= 3 ) {
    badgeIds.push( 'helpful-collaborator' );
  }
  if( summary.completedReviewCount >= 3 ) {
    badgeIds.push( 'reliable-reviewer' );
  }
  if( summary.acceptedVersionCount >= 1 ) {
    badgeIds.push( 'quality-builder' );
  }
  if( summary.contributionCount >= 10 ) {
    badgeIds.push( 'consistent-contributor' );
  }

  return badgeIds;
};
