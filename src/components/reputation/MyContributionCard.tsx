// src/components/reputation/MyContributionCard.tsx: Provides a dashboard entry point for personal contributions.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { formatReputationPoints, loadUserReputation } from '../../lib/reputationData'
import ProgressModal from '../ProgressModal'
import ContributionStatus from './ContributionStatus'
import './reputation.css'

function MyContributionCard() {
  const { user } = useAuth()
  const userId = user?.uid ?? ''
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>( userId ? 'loading' : 'error' )
  const [totalPoints, setTotalPoints] = useState( 0 )
  const [projectCount, setProjectCount] = useState( 0 )
  const [errorMessage, setErrorMessage] = useState( userId ? '' : 'Sign in to view your contributions.' )

  useEffect( () => {
    let active = true
    if( !userId ) {
      return () => {
        active = false
      }
    }
    void loadUserReputation( userId ).then( (data) => {
      if( !active ) return
      const nextTotal = data.summaries.reduce( (sum, summary) => sum + summary.totalPoints, 0 )
      setTotalPoints( nextTotal )
      setProjectCount( data.summaries.length )
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
      return <p className="contribution-card__metric"><strong>{formatReputationPoints( totalPoints )}</strong> points across {projectCount} project{projectCount === 1 ? '' : 's'}</p>
    }
    if( status === 'empty' ) {
      return <ContributionStatus status="empty" message="Your first contribution will appear here." />
    }
    if( status === 'error' ) {
      return <ContributionStatus status="error" message={errorMessage} />
    }
    return null
  }, [ errorMessage, projectCount, status, totalPoints ] )

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
