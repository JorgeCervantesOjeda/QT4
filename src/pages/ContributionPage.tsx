// src/pages/ContributionPage.tsx: Shows a signed-in user's project-scoped contribution history.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import AppBrand from '../components/AppBrand'
import BackStack from '../components/BackStack'
import BadgeGrid from '../components/reputation/BadgeGrid'
import ContributionHistoryTable from '../components/reputation/ContributionHistoryTable'
import ContributionStatus from '../components/reputation/ContributionStatus'
import ContributionSummary from '../components/reputation/ContributionSummary'
import ProgressModal from '../components/ProgressModal'
import {
  formatProjectDisplayLabel,
  getProjectContributionPath,
  loadProjectDisplayInfo,
  type ProjectDisplayInfo,
} from '../lib/projectDisplay'
import { formatReputationPoints, loadUserReputation, type UserReputationData } from '../lib/reputationData'

const emptyData: UserReputationData = { summaries: [], events: [] }

function ContributionPage() {
  const { user } = useAuth()
  const userId = user?.uid ?? ''
  const [data, setData] = useState<UserReputationData>( emptyData )
  const [projectDisplayInfo, setProjectDisplayInfo] = useState<Record<string, ProjectDisplayInfo>>( {} )
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>( userId ? 'loading' : 'error' )
  const [errorMessage, setErrorMessage] = useState( userId ? '' : 'Sign in to view your contributions.' )

  useEffect( () => {
    let active = true
    if( !userId ) {
      return () => {
        active = false
      }
    }
    void loadUserReputation( userId ).then( async (nextData) => {
      if( !active ) return
      setData( nextData )
      setProjectDisplayInfo( await loadProjectDisplayInfo( nextData.summaries.map( (summary) => summary.projectId ) ) )
      setStatus( nextData.summaries.length > 0 ? 'ready' : 'empty' )
    } ).catch( (err) => {
      if( !active ) return
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setErrorMessage( `Contribution data could not be loaded: ${message}` )
      setStatus( 'error' )
    } )
    return () => {
      active = false
    }
  }, [ userId ] )

  return (
    <div className="app-shell">
      <header className="app-header">
        <AppBrand pageTitle="My Contributions" />
        <BackStack mode="return-only" links={[]} />
      </header>
      <main className="app-main">
        {status === 'loading' ? (
          <ProgressModal
            title="Loading contributions"
            message="Loading your points, badges, and history..."
          />
        ) : null}
        {status === 'error' ? <ContributionStatus status="error" message={errorMessage} /> : null}
        {status === 'empty' ? (
          <section className="panel stack">
            <h2>My contributions</h2>
            <ContributionStatus status="empty" message="No project contributions have been recorded yet." />
            <Link className="link" to="/projects">Open projects</Link>
          </section>
        ) : null}
        {status === 'ready' ? (
          <>
            <section className="panel stack">
              <div className="panel-header">
                <div>
                  <h2>Your contribution summary</h2>
                  <p className="muted">What you did, what it earned, and your progress by project.</p>
                </div>
              </div>
            </section>
            <section className="panel stack">
              <div className="panel-header">
                <div>
                  <h2>Your projects</h2>
                  <p className="muted">Points and badges are calculated separately for each project.</p>
                </div>
              </div>
              <div className="project-grid">
                {data.summaries.map( (summary) => (
                  <article className="project-card contribution-project-card" key={`${summary.projectId}-${summary.userId}`}>
                    <div className="contribution-project-card__header">
                      <h3>{formatProjectDisplayLabel( summary.projectId, projectDisplayInfo[summary.projectId] )}</h3>
                      <strong>{formatReputationPoints( summary.totalPoints )} pts</strong>
                    </div>
                    <p className="muted">{summary.contributionCount} contributions · {summary.badgeIds.length} badges earned</p>
                    <ContributionSummary summary={summary} title="Project contribution summary" />
                    <BadgeGrid unlockedBadgeIds={summary.badgeIds} />
                    {getProjectContributionPath( projectDisplayInfo[summary.projectId] ) ? (
                      <Link
                        className="link"
                        to={getProjectContributionPath( projectDisplayInfo[summary.projectId] ) ?? '/account/contributions'}
                      >
                        Open project ranking
                      </Link>
                    ) : (
                      <span className="muted">Project ranking unavailable</span>
                    )}
                  </article>
                ) )}
              </div>
            </section>
            <section className="panel stack">
              <div className="panel-header">
                <div>
                  <h2>Recent activity</h2>
                  <p className="muted">Each row explains what changed your score.</p>
                </div>
              </div>
              {data.summaries.map( (summary) => (
                <section className="stack" key={summary.projectId}>
                  <h3>{formatProjectDisplayLabel( summary.projectId, projectDisplayInfo[summary.projectId] )}</h3>
                  <ContributionHistoryTable events={data.events.filter( (event) => event.projectId === summary.projectId )} />
                </section>
              ) )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  )
}

export default ContributionPage
