export const ONE_HOUR_MS = 60 * 60 * 1000
export const REVIEW_WINDOW_MS = 24 * ONE_HOUR_MS

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
