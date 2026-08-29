// src/lib/reviewWindow.ts
// Provides review window duration, expiry, and grace-period helpers.
export const ONE_HOUR_MS = 60 * 60 * 1000
export const MILLISECONDS_PER_DAY = 24 * ONE_HOUR_MS
export const MIN_REVIEW_DURATION_DAYS = 1
export const MAX_REVIEW_DURATION_DAYS = 30
export const DEFAULT_REVIEW_DURATION_DAYS = 1
export const REVIEW_WINDOW_MS = DEFAULT_REVIEW_DURATION_DAYS * MILLISECONDS_PER_DAY

type CommentWindowInput = {
  versionStatus: string
  reviewEndAt?: Date | null
  threadStatus: 'open' | 'closed' | string
  lastThreadCommentAt?: Date | null
  canParticipate: boolean
  hasBody: boolean
  nowMs?: number
}

type ReviewCompletionInput = {
  versionStatus: string
  reviewEndAt?: Date | null
  latestVersionCommentAt?: Date | null
  hasAnyComments: boolean
  nowMs?: number
}

const isFiniteDate = (value?: Date | null): value is Date => Boolean( value && Number.isFinite( value.getTime() ) )

export const numOfReviewDurationDays = (value: unknown): number => {
  const numericValue = typeof value === 'number' ? value : Number( value )
  if( !Number.isFinite( numericValue ) ) {
    return DEFAULT_REVIEW_DURATION_DAYS
  }
  return Math.min(
    MAX_REVIEW_DURATION_DAYS,
    Math.max( MIN_REVIEW_DURATION_DAYS, Math.trunc( numericValue ) ),
  )
}

export const calculateReviewEndAt = (
  reviewDurationDays: unknown,
  startMs: number = Date.now(),
): Date => new Date( startMs + numOfReviewDurationDays( reviewDurationDays ) * MILLISECONDS_PER_DAY )

export const isReviewExpired = (reviewEndAt?: Date | null, nowMs: number = Date.now()): boolean => {
  if( !isFiniteDate( reviewEndAt ) ) {
    return false
  }
  return nowMs >= reviewEndAt.getTime()
}

export const canAddCommentInWindow = (input: CommentWindowInput): boolean => {
  const nowMs = input.nowMs ?? Date.now()
  if( !input.canParticipate || !input.hasBody ) {
    return false
  }
  if( input.versionStatus !== 'In Review' ) {
    return false
  }
  if( input.threadStatus !== 'open' ) {
    return false
  }
  if( !isFiniteDate( input.reviewEndAt ) ) {
    return true
  }
  if( nowMs < input.reviewEndAt.getTime() ) {
    return true
  }
  if( !isFiniteDate( input.lastThreadCommentAt ) ) {
    return false
  }
  return nowMs - input.lastThreadCommentAt.getTime() < ONE_HOUR_MS
}

export const shouldAutoSetReviewed = (input: ReviewCompletionInput): boolean => {
  const nowMs = input.nowMs ?? Date.now()
  if( input.versionStatus !== 'In Review' ) {
    return false
  }
  if( !isFiniteDate( input.reviewEndAt ) ) {
    return false
  }
  if( nowMs < input.reviewEndAt.getTime() ) {
    return false
  }
  if( !input.hasAnyComments ) {
    return true
  }
  if( !isFiniteDate( input.latestVersionCommentAt ) ) {
    return true
  }
  return nowMs - input.latestVersionCommentAt.getTime() >= ONE_HOUR_MS
}

export const getCommentWindowRemainingMs = (
  versionStatus: string,
  reviewEndAt?: Date | null,
  lastThreadCommentAt?: Date | null,
  nowMs: number = Date.now(),
): number | null => {
  if( versionStatus !== 'In Review' ) {
    return null
  }
  if( isFiniteDate( reviewEndAt ) && nowMs < reviewEndAt.getTime() ) {
    return reviewEndAt.getTime() - nowMs
  }
  if( !isFiniteDate( reviewEndAt ) ) {
    return null
  }
  if( !isFiniteDate( lastThreadCommentAt ) ) {
    return 0
  }
  const remaining = ONE_HOUR_MS - ( nowMs - lastThreadCommentAt.getTime() )
  return remaining > 0 ? remaining : 0
}

export const formatApproxCountdown = (remainingMs: number): string => {
  if( remainingMs <= 0 ) {
    return '0m'
  }
  const totalMinutes = Math.ceil( remainingMs / 60000 )
  const hours = Math.floor( totalMinutes / 60 )
  const minutes = totalMinutes % 60
  if( hours > 0 ) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}
