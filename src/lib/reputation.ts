// src/lib/reputation.ts: Defines the approved project-scoped contribution policy.

export type ReputationCategory = 'collaboration' | 'review' | 'quality';

export type ReputationSequenceKey = 'reviewParticipation' | 'goodReaction' | 'acceptedDocument';

export type ReputationSequenceInterval = {
  start: number;
  end: number;
};

export type ReputationEventType =
  | 'threadCreated'
  | 'commentCreated'
  | 'goodReactionReceived'
  | 'reviewCompleted'
  | 'reviewAbsence'
  | 'acceptedVersion'
  | 'acceptedErrorReport'
  | 'acceptedErrorReportPenalty';

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
  pointMultiplier?: number;
  reason: string;
  sequenceKey?: ReputationSequenceKey;
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
    description: 'Participate in three completed reviews in this project.',
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
    sequenceKey: 'reviewParticipation',
  },
  commentCreated: {
    category: 'collaboration',
    points: 1,
    reason: 'Added a comment',
    sequenceKey: 'reviewParticipation',
  },
  goodReactionReceived: {
    category: 'collaboration',
    points: 1,
    pointMultiplier: 0.25,
    reason: 'Received a good reaction on a comment',
    sequenceKey: 'goodReaction',
  },
  reviewCompleted: {
    category: 'review',
    points: 0,
    reason: 'Completed an active review',
  },
  reviewAbsence: {
    category: 'review',
    points: -1,
    pointMultiplier: 0.25,
    reason: 'Did not participate in an assigned review',
  },
  acceptedVersion: {
    category: 'quality',
    points: 1,
    pointMultiplier: 3,
    reason: 'Created an accepted version',
    sequenceKey: 'acceptedDocument',
  },
  acceptedErrorReport: {
    category: 'quality',
    points: 1,
    pointMultiplier: 3,
    reason: 'Created an accepted error report',
    sequenceKey: 'acceptedDocument',
  },
  acceptedErrorReportPenalty: {
    category: 'quality',
    points: -2,
    pointMultiplier: 0.5,
    reason: 'An authored version received an accepted error report',
  },
};

const SEQUENCE_BOUNDARY_TEMPLATES = [1, 2, 5] as const;

export const getSequenceInterval = (sequenceNumber: number): ReputationSequenceInterval => {
  if( !Number.isSafeInteger( sequenceNumber ) || sequenceNumber < 1 ) {
    throw new RangeError( 'Sequence number must be a positive safe integer.' );
  }

  let previousBoundary = 0;
  for( let powerOfTen = 1; ; powerOfTen *= 10 ) {
    for( const boundaryTemplate of SEQUENCE_BOUNDARY_TEMPLATES ) {
      const boundary = boundaryTemplate * powerOfTen;
      if( sequenceNumber <= boundary ) {
        return { start: previousBoundary + 1, end: boundary };
      }
      previousBoundary = boundary;
    }
    if( powerOfTen > Number.MAX_SAFE_INTEGER / 10 ) {
      throw new RangeError( 'Sequence number is too large to calculate safely.' );
    }
  }
};

export const getSequencePoints = (sequenceNumber: number): number => {
  const interval = getSequenceInterval( sequenceNumber );
  return 1 / ( interval.end - interval.start + 1 );
};

export const getContributionPoints = (
  eventType: ReputationEventType,
): ReputationPointRule => POINT_RULES[eventType];

export const getCommentReactionPointsDelta = (
  previousReaction: CommentReaction | null,
  nextReaction: CommentReaction,
): number => {
  return previousReaction !== 'good' && nextReaction === 'good' ? 0.25 : 0;
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
