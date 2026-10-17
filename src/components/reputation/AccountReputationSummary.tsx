// src/components/reputation/AccountReputationSummary.tsx: Shows compact points and badge totals beside Account.

import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { formatReputationPoints, loadUserReputation } from '../../lib/reputationData'

type SummaryStatus = 'loading' | 'ready' | 'empty' | 'error'

function AccountReputationSummary() {
  const { user } = useAuth()
  const userId = user?.uid ?? ''
  const [status, setStatus] = useState<SummaryStatus>( userId ? 'loading' : 'empty' )
  const [loadedUserId, setLoadedUserId] = useState<string | null>( userId ? null : '' )
  const [totalPoints, setTotalPoints] = useState( 0 )
  const [badgeCount, setBadgeCount] = useState( 0 )

  useEffect( () => {
    let active = true
    if( !userId ) {
      return () => {
        active = false
      }
    }
    void loadUserReputation( userId ).then( (data) => {
      if( !active ) return
      setTotalPoints( data.summaries.reduce( (sum, summary) => sum + summary.totalPoints, 0 ) )
      setBadgeCount( data.summaries.reduce( (count, summary) => count + summary.badgeIds.length, 0 ) )
      setLoadedUserId( userId )
      setStatus( data.summaries.length > 0 ? 'ready' : 'empty' )
    } ).catch( (err) => {
      if( !active ) return
      const message = err instanceof Error ? err.message : 'Unexpected error'
      console.warn( 'Compact account reputation summary could not load.', {
        action: 'brand.loadAccountReputationSummary',
        cause: message,
        fallback: 'show_account_reputation_unavailable',
        impact: 'The Account link remains available, but its compact points summary is unavailable.',
        userId,
      } )
      setLoadedUserId( userId )
      setStatus( 'error' )
    } )
    return () => {
      active = false
    }
  }, [ userId ] )

  const displayedStatus = !userId ? 'empty' : loadedUserId === userId ? status : 'loading'

  if( displayedStatus === 'loading' ) {
    return <span className="brand-account-summary" aria-label="Account reputation summary">Loading points…</span>
  }
  if( displayedStatus === 'error' ) {
    return <span className="brand-account-summary brand-account-summary--error" aria-label="Account reputation summary">Points unavailable</span>
  }
  if( displayedStatus === 'empty' ) {
    return <span className="brand-account-summary" aria-label="Account reputation summary">0 badges · 0 pts</span>
  }
  return (
    <span className="brand-account-summary" aria-label="Account reputation summary">
      ✦ {badgeCount} badge{badgeCount === 1 ? '' : 's'} · {formatReputationPoints( totalPoints )} pts
    </span>
  )
}

export default AccountReputationSummary
