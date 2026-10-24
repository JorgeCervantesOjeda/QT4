// src/components/reputation/MyContributionCard.tsx: Provides a dashboard entry point for personal contributions.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { formatReputationPoints, loadUserReputation, type UserReputationData } from '../../lib/reputationData'
import ProgressModal from '../ProgressModal'
import { formatProjectDisplayLabel, loadProjectDisplayInfo, type ProjectDisplayInfo } from '../../lib/projectDisplay'
import ContributionStatus from './ContributionStatus'
import './reputation.css'

function MyContributionCard() {
  const { user } = useAuth()
  const userId = user?.uid ?? ''
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>( userId ? 'loading' : 'error' )
  const [data, setData] = useState<UserReputationData>( { summaries: [], events: [] } )
  const [projectDisplayInfo, setProjectDisplayInfo] = useState<Record<string, ProjectDisplayInfo>>( {} )
  const [errorMessage, setErrorMessage] = useState( userId ? '' : 'Sign in to view your contributions.' )

  useEffect( () => {
    let active = true
    if( !userId ) {
      return () => {
        active = false
      }
    }
    void loadUserReputation( userId ).then( async (data) => {
      const info = await loadProjectDisplayInfo( data.summaries.map( (summary) => summary.projectId ) )
      if( !active ) return
      setData( data )
      setProjectDisplayInfo( info )
      setStatus( data.summaries.length > 0 ? 'ready' : 'empty' )
    } ).catch( (err) => {
      if( !active ) return
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setErrorMessage( `Contribution summary could not be loaded: ${message}` )
      setStatus( 'error' )
    } )
    return () => {
      active = false
    }
  }, [ userId ] )

  const content = useMemo( () => {
    if( status === 'ready' ) {
      return <div className="stack">{data.summaries.map( (summary) => (
        <article key={summary.projectId}>
          <h3>{formatProjectDisplayLabel( summary.projectId, projectDisplayInfo[summary.projectId] )}</h3>
          <p className="contribution-card__metric"><strong>{formatReputationPoints( summary.totalPoints )} pts</strong> · {summary.badgeIds.length} badges</p>
        </article>
      ) )}</div>
    }
    if( status === 'empty' ) {
      return <ContributionStatus status="empty" message="Your first contribution will appear here." />
    }
    if( status === 'error' ) {
      return <ContributionStatus status="error" message={errorMessage} />
    }
    return null
  }, [ data.summaries, errorMessage, projectDisplayInfo, status ] )

  return (
    <section className="panel contribution-card" aria-label="My contribution">
      <div className="panel-header">
        <div>
          <h2>My contribution</h2>
          <p className="muted">Project-scoped points and badges.</p>
        </div>
        <Link className="link" to="/account/contributions">View details</Link>
      </div>
      {content}
      {status === 'loading' ? (
        <ProgressModal
          title="Loading contribution data"
          message="Loading your points and badges..."
        />
      ) : null}
    </section>
  )
}

export default MyContributionCard
