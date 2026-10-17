// src/pages/ContributionPage.tsx: Shows a signed-in user's project-scoped contribution history.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import AppBrand from '../components/AppBrand'
import BackStack from '../components/BackStack'
import BadgeGrid from '../components/reputation/BadgeGrid'
import ContributionHistoryTable from '../components/reputation/ContributionHistoryTable'
import ContributionStatus from '../components/reputation/ContributionStatus'
import ContributionSummary from '../components/reputation/ContributionSummary'
import { formatReputationPoints, loadUserReputation, type UserReputationData } from '../lib/reputationData'

const emptyData: UserReputationData = { summaries: [], events: [] }

function ContributionPage() {
  const { user } = useAuth()
  const userId = user?.uid ?? ''
  const [data, setData] = useState<UserReputationData>( emptyData )
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>( userId ? 'loading' : 'error' )
  const [errorMessage, setErrorMessage] = useState( userId ? '' : 'Sign in to view your contributions.' )

  useEffect( () => {
    let active = true
    if( !userId ) {
      return () => {
        active = false
      }
    }
    void loadUserReputation( userId ).then( (nextData) => {
      if( !active ) return
      setData( nextData )
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

  const aggregateSummary = useMemo( () => data.summaries.reduce(
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
    {
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
    },
  ), [ data.summaries, userId ] )

  return (
    <div className="app-shell">
      <header className="app-header">
        <AppBrand pageTitle="My Contributions" />
        <BackStack links={[ { label: 'Account Settings', to: '/account' }, { label: 'Dashboard', to: '/app' } ]} />
      </header>
      <main className="app-main">
        {status === 'loading' ? <ContributionStatus status="loading" /> : null}
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
              <ContributionSummary
                summary={aggregateSummary}
                title="Contribution totals across projects"
                totalLabel="Points across all projects"
              />
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
                      <h3>Project {summary.projectId}</h3>
                      <strong>{formatReputationPoints( summary.totalPoints )} pts</strong>
                    </div>
                    <p className="muted">{summary.contributionCount} contributions · {summary.badgeIds.length} badges earned</p>
                    <Link className="link" to={`/projects/${summary.projectId}/contribution`}>Open project ranking</Link>
                  </article>
                ) )}
              </div>
            </section>
            <section className="panel stack">
              <div className="panel-header">
                <div>
                  <h2>Your badges</h2>
                  <p className="muted">Badges are earned separately in each project.</p>
                </div>
              </div>
              {data.summaries.map( (summary) => (
                <div className="stack" key={`badges-${summary.projectId}`}>
                  <h3>Project {summary.projectId}</h3>
                  <BadgeGrid unlockedBadgeIds={summary.badgeIds} />
                </div>
              ) )}
            </section>
            <section className="panel stack">
              <div className="panel-header">
                <div>
                  <h2>Recent activity</h2>
                  <p className="muted">Each row explains what changed your score.</p>
                </div>
              </div>
              <ContributionHistoryTable events={data.events} />
            </section>
          </>
        ) : null}
      </main>
    </div>
  )
}

export default ContributionPage
