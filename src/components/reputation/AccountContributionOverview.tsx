// src/components/reputation/AccountContributionOverview.tsx: Shows points and badges directly in Account.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import {
  formatReputationPoints,
  loadUserReputation,
  type UserReputationData,
} from '../../lib/reputationData'
import { formatProjectDisplayLabel, loadProjectDisplayInfo, type ProjectDisplayInfo } from '../../lib/projectDisplay'
import BadgeGrid from './BadgeGrid'
import ContributionStatus from './ContributionStatus'
import ContributionSummary from './ContributionSummary'
import ProgressModal from '../ProgressModal'
import './reputation.css'

const emptyData: UserReputationData = { summaries: [], events: [] }

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
          <div className="account-contribution-overview__projects">
            {data.summaries.map( (summary) => (
              <article className="account-contribution-overview__project" key={`${summary.projectId}-${summary.userId}`}>
                <div className="contribution-project-card__header">
                  <h3>{formatProjectDisplayLabel( summary.projectId, projectDisplayInfo[summary.projectId] )}</h3>
                  <strong>{formatReputationPoints( summary.totalPoints )} pts</strong>
                </div>
                <p className="muted">{summary.badgeIds.length} badges earned in this project.</p>
                <ContributionSummary summary={summary} title="Project contribution summary" />
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
