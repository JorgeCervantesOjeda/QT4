// src/components/reputation/AccountContributionOverview.tsx: Shows points and badges directly in Account.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import {
  formatReputationPoints,
  loadUserReputation,
  type UserReputationData,
} from '../../lib/reputationData'
import type { ReputationSummary } from '../../lib/reputation'
import { formatProjectDisplayLabel, loadProjectDisplayInfo, type ProjectDisplayInfo } from '../../lib/projectDisplay'
import BadgeGrid from './BadgeGrid'
import ContributionStatus from './ContributionStatus'
import ContributionSummary from './ContributionSummary'
import ProgressModal from '../ProgressModal'
import './reputation.css'

const emptyData: UserReputationData = { summaries: [], events: [] }

const createEmptySummary = (userId: string): ReputationSummary => ( {
  projectId: 'all-projects',
  userId,
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
} )

const buildAggregateSummary = (
  summaries: ReputationSummary[],
  userId: string,
): ReputationSummary => summaries.reduce(
  (aggregate, summary) => ( {
    ...aggregate,
    totalPoints: aggregate.totalPoints + summary.totalPoints,
    collaborationPoints: aggregate.collaborationPoints + summary.collaborationPoints,
    reviewPoints: aggregate.reviewPoints + summary.reviewPoints,
    qualityPoints: aggregate.qualityPoints + summary.qualityPoints,
    contributionCount: aggregate.contributionCount + summary.contributionCount,
    threadCount: aggregate.threadCount + summary.threadCount,
    commentCount: aggregate.commentCount + summary.commentCount,
    goodReactionCount: aggregate.goodReactionCount + summary.goodReactionCount,
    completedReviewCount: aggregate.completedReviewCount + summary.completedReviewCount,
    acceptedVersionCount: aggregate.acceptedVersionCount + summary.acceptedVersionCount,
  } ),
  createEmptySummary( userId ),
)

function AccountContributionOverview() {
  const { user } = useAuth()
  const userId = user?.uid ?? ''
  const [data, setData] = useState<UserReputationData>( emptyData )
  const [projectDisplayInfo, setProjectDisplayInfo] = useState<Record<string, ProjectDisplayInfo>>( {} )
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>( userId ? 'loading' : 'error' )
  const [loadedUserId, setLoadedUserId] = useState<string | null>( userId ? null : '' )
  const [errorMessage, setErrorMessage] = useState( userId ? '' : 'Sign in to view your points and badges.' )

  useEffect( () => {
    let active = true
    if( !userId ) {
      return () => {
        active = false
      }
    }
    void loadUserReputation( userId ).then( async (nextData) => {
      const nextProjectDisplayInfo = await loadProjectDisplayInfo(
        nextData.summaries.map( (summary) => summary.projectId ),
      )
      if( !active ) return
      setData( nextData )
      setProjectDisplayInfo( nextProjectDisplayInfo )
      setLoadedUserId( userId )
      setStatus( nextData.summaries.length > 0 ? 'ready' : 'empty' )
    } ).catch( (err) => {
      if( !active ) return
      const message = err instanceof Error ? err.message : 'Unexpected error'
      console.warn( 'Account contribution overview could not load.', {
        action: 'account.loadContributionOverview',
        cause: message,
        fallback: 'show_account_contribution_error',
        impact: 'Account remains available, but points and badges are temporarily hidden.',
        userId,
      } )
      setLoadedUserId( userId )
      setErrorMessage( `Points and badges could not be loaded: ${message}` )
      setStatus( 'error' )
    } )
    return () => {
      active = false
    }
  }, [ userId ] )

  const aggregateSummary = useMemo(
    () => buildAggregateSummary( data.summaries, userId ),
    [ data.summaries, userId ],
  )
  const badgeCount = data.summaries.reduce( (count, summary) => count + summary.badgeIds.length, 0 )
  const displayedStatus = !userId ? 'error' : loadedUserId === userId ? status : 'loading'

  return (
    <section className="panel stack account-contribution-overview" aria-labelledby="account-contribution-heading">
      <div className="panel-header">
        <div>
          <h2 id="account-contribution-heading">Points and badges</h2>
          <p className="muted">Your project-scoped progress is visible here without opening another page.</p>
        </div>
        <Link className="link" to="/account/contributions">View full history</Link>
      </div>
      {displayedStatus === 'loading' ? (
        <ProgressModal
          title="Loading points and badges"
          message="Loading your contribution summary..."
        />
      ) : null}
      {displayedStatus === 'error' ? <ContributionStatus status="error" message={errorMessage} /> : null}
      {displayedStatus === 'empty' ? <ContributionStatus status="empty" message="Your points and badges will appear after your first contribution." /> : null}
      {displayedStatus === 'ready' ? (
        <>
          <ContributionSummary
            summary={aggregateSummary}
            title="Points across projects"
            totalLabel="Total points across projects"
          />
          <div className="account-contribution-overview__metrics" aria-label="Account contribution totals">
            <div>
              <strong>{badgeCount}</strong>
              <span>Project badges earned</span>
            </div>
            <div>
              <strong>{data.summaries.length}</strong>
              <span>Projects with contributions</span>
            </div>
          </div>
          <div className="account-contribution-overview__projects">
            {data.summaries.map( (summary) => (
              <article className="account-contribution-overview__project" key={`${summary.projectId}-${summary.userId}`}>
                <div className="contribution-project-card__header">
                  <h3>{formatProjectDisplayLabel( summary.projectId, projectDisplayInfo[summary.projectId] )}</h3>
                  <strong>{formatReputationPoints( summary.totalPoints )} pts</strong>
                </div>
                <p className="muted">{summary.badgeIds.length} badges earned in this project.</p>
                <BadgeGrid unlockedBadgeIds={summary.badgeIds} />
              </article>
            ) )}
          </div>
        </>
      ) : null}
    </section>
  )
}

export default AccountContributionOverview
