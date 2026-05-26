// Derived review permissions, timers, comment-window state, and selected issue aggregates.
import { useCallback, useMemo } from 'react'
import {
  canAddCommentInWindow,
  formatApproxCountdown,
  getCommentWindowRemainingMs,
  ONE_HOUR_MS,
} from '../../lib/reviewWindow'
import type { CommentSummary, ThreadSummary, VersionSummary } from './types'

type UseReviewDerivedStateParams = {
  selectedVersion: VersionSummary | null
  latestVersion: VersionSummary | null
  selectedThread: ThreadSummary | null
  commentsByThread: Record<string, CommentSummary[]>
  threads: ThreadSummary[]
  canParticipateReview: boolean
  newThreadTitle: string
  newCommentBody: string
  clockNowMs: number
}

function useReviewDerivedState( {
  selectedVersion,
  latestVersion,
  selectedThread,
  commentsByThread,
  threads,
  canParticipateReview,
  newThreadTitle,
  newCommentBody,
  clockNowMs,
}: UseReviewDerivedStateParams ) {
  const selectedThreadComments = useMemo(
    () => ( selectedThread ? commentsByThread[selectedThread.id] ?? [] : [] ),
    [ commentsByThread, selectedThread ],
  )

  const getLatestCommentAtFromList = useCallback( (comments: CommentSummary[]) =>
    comments.reduce<Date | null>(
      ( latest, comment ) => {
        if( !comment.createdAt ) {
          return latest
        }
        if( !latest || comment.createdAt.getTime() > latest.getTime() ) {
          return comment.createdAt
        }
        return latest
      },
      null,
    ), [] )

  const getThreadLatestCommentAt = useCallback( (thread?: Pick<ThreadSummary, 'id' | 'lastCommentAt'> | null) => {
    if( !thread ) {
      return null
    }
    const fromThread = thread.lastCommentAt ?? null
    if( fromThread ) {
      return fromThread
    }
    return getLatestCommentAtFromList( commentsByThread[thread.id] ?? [] )
  }, [ commentsByThread, getLatestCommentAtFromList ] )

  const selectedThreadLatestCommentAt = useMemo(
    () => getThreadLatestCommentAt( selectedThread ),
    [ selectedThread, getThreadLatestCommentAt ],
  )

  const latestVersionIsSelected = Boolean( latestVersion && selectedVersion && latestVersion.id === selectedVersion.id )

  const latestSelectedVersionCommentAt = useMemo( () => {
    const comments = Object.values( commentsByThread ).flat()
    return comments.reduce<Date | null>( ( latest, comment ) => {
      if( !comment.createdAt ) {
        return latest
      }
      if( !latest || comment.createdAt.getTime() > latest.getTime() ) {
        return comment.createdAt
      }
      return latest
    }, null )
  }, [ commentsByThread ] )

  const selectedVersionRecentCommentGraceRemainingMs = useMemo( () => {
    if( !selectedVersion?.reviewEndAt || !latestSelectedVersionCommentAt ) {
      return 0
    }
    if( selectedVersion.reviewEndAt.getTime() > clockNowMs ) {
      return 0
    }
    const remainingMs = ONE_HOUR_MS - ( clockNowMs - latestSelectedVersionCommentAt.getTime() )
    return remainingMs > 0 ? remainingMs : 0
  }, [ selectedVersion, latestSelectedVersionCommentAt, clockNowMs ] )

  const selectedVersionGraceRemainingMs = useMemo( () => {
    if( !selectedVersion || selectedVersion.status !== 'In Review' || !selectedVersion.reviewEndAt ) {
      return 0
    }
    if( selectedVersion.reviewEndAt.getTime() > clockNowMs ) {
      return 0
    }
    return threads.reduce( ( maxRemaining, thread ) => {
      if( thread.status !== 'open' ) {
        return maxRemaining
      }
      const remainingMs = getCommentWindowRemainingMs(
        selectedVersion.status,
        selectedVersion.reviewEndAt,
        getThreadLatestCommentAt( thread ),
        clockNowMs,
      )
      if( remainingMs === null || remainingMs <= 0 ) {
        return maxRemaining
      }
      return Math.max( maxRemaining, remainingMs )
    }, 0 )
  }, [ selectedVersion, threads, clockNowMs, getThreadLatestCommentAt ] )

  const selectedVersionHasGraceIssues = selectedVersionGraceRemainingMs > 0
  const selectedVersionReviewGraceRemainingMs = Math.max(
    selectedVersionGraceRemainingMs,
    selectedVersionRecentCommentGraceRemainingMs,
  )
  const selectedVersionHasReviewGrace = selectedVersionReviewGraceRemainingMs > 0

  const selectedVersionInActiveReview = Boolean(
    selectedVersion &&
    selectedVersion.status === 'In Review' &&
    (
      !selectedVersion.reviewEndAt ||
      selectedVersion.reviewEndAt.getTime() > clockNowMs ||
      selectedVersionHasGraceIssues
    ),
  )

  const latestVersionInReviewDecisionWindow = Boolean(
    latestVersion &&
    (
      latestVersion.status === 'In Review' ||
      ( latestVersion.status === 'Reviewed' && latestVersionIsSelected && selectedVersionHasReviewGrace )
    ) &&
    (
      !latestVersion.reviewEndAt ||
      latestVersion.reviewEndAt.getTime() > clockNowMs ||
      ( latestVersionIsSelected && selectedVersionHasReviewGrace )
    ),
  )

  const canCreateThread = Boolean(
    selectedVersion &&
    selectedVersionInActiveReview &&
    canParticipateReview &&
    newThreadTitle.trim().length > 0,
  )

  const canAddComment = Boolean(
    selectedVersion &&
    selectedThread &&
    canAddCommentInWindow( {
      versionStatus: selectedVersion.status,
      reviewEndAt: selectedVersion.reviewEndAt,
      threadStatus: selectedThread.status,
      lastThreadCommentAt: selectedThreadLatestCommentAt,
      canParticipate: canParticipateReview,
      hasBody: newCommentBody.trim().length > 0,
      nowMs: clockNowMs,
    } ),
  )

  const getThreadCommentWindowMeta = useCallback(
    (thread?: Pick<ThreadSummary, 'id' | 'status' | 'lastCommentAt'> | null) => {
      if( !selectedVersion ) {
        return { label: 'Unavailable', state: 'unavailable' as const }
      }
      if( selectedVersion.status !== 'In Review' ) {
        return { label: 'Closed (version is not In Review)', state: 'expired' as const }
      }
      if( thread?.status !== 'open' ) {
        return { label: 'Closed issue', state: 'closed' as const }
      }
      if( !selectedVersion.reviewEndAt ) {
        return { label: 'No expiration configured', state: 'active' as const }
      }
      const remainingMs = getCommentWindowRemainingMs(
        selectedVersion.status,
        selectedVersion.reviewEndAt,
        getThreadLatestCommentAt( thread ),
        clockNowMs,
      )
      if( remainingMs === null ) {
        return { label: 'Unavailable', state: 'unavailable' as const }
      }
      if( selectedVersion.reviewEndAt.getTime() > clockNowMs ) {
        return { label: formatApproxCountdown( remainingMs ), state: 'active' as const }
      }
      if( remainingMs <= 0 ) {
        return { label: 'Expired', state: 'expired' as const }
      }
      return { label: `Grace ${formatApproxCountdown( remainingMs )}`, state: 'grace' as const }
    },
    [ selectedVersion, clockNowMs, getThreadLatestCommentAt ],
  )

  const commentWindowCountdownLabel = useMemo( () => {
    if( !selectedVersion || !selectedThread ) {
      return null
    }
    const meta = getThreadCommentWindowMeta( selectedThread )
    return `Selected issue comment window: ${meta.label}.`
  }, [ selectedVersion, selectedThread, getThreadCommentWindowMeta ] )

  const selectedCommentWindowState = useMemo( () => {
    if( !selectedVersion || !selectedThread ) {
      return 'unavailable' as const
    }
    return getThreadCommentWindowMeta( selectedThread ).state
  }, [ selectedVersion, selectedThread, getThreadCommentWindowMeta ] )

  const hasSelectedVersionComments = useMemo(
    () => Object.values( commentsByThread ).some( ( threadComments ) => threadComments.length > 0 ),
    [ commentsByThread ],
  )

  return {
    selectedThreadComments,
    getThreadLatestCommentAt,
    selectedThreadLatestCommentAt,
    latestVersionIsSelected,
    latestSelectedVersionCommentAt,
    selectedVersionReviewGraceRemainingMs,
    selectedVersionHasReviewGrace,
    selectedVersionInActiveReview,
    latestVersionInReviewDecisionWindow,
    canCreateThread,
    canAddComment,
    getThreadCommentWindowMeta,
    commentWindowCountdownLabel,
    selectedCommentWindowState,
    hasSelectedVersionComments,
  }
}

export default useReviewDerivedState
