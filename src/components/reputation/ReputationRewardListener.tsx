// src/components/reputation/ReputationRewardListener.tsx: Shows newly earned review badges.
import { useEffect, useRef, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { useAuth } from '../../auth/useAuth'
import ModalDialog from '../ModalDialog'
import {
  buildReputationAwardMessage,
  normalizeReputationEvent,
  type ReputationEventRecord,
} from '../../lib/reputationData'
import { db } from '../../lib/firebase'

const isReviewBadgeAward = (event: ReputationEventRecord | null): event is ReputationEventRecord =>
  Boolean(
    event &&
    event.sourceType === 'versionReview' &&
    event.points === 0 &&
    (event.earnedBadgeIds?.length ?? 0) > 0,
  )

function ReputationRewardListener() {
  const { user } = useAuth()
  const [badgeState, setBadgeState] = useState<{
    event: ReputationEventRecord | null
    userId: string
  }>( { event: null, userId: '' } )
  const seenEventIdsRef = useRef<Set<string>>( new Set() )

  useEffect( () => {
    seenEventIdsRef.current = new Set()
    if( !user?.uid ) {
      return
    }

    let isInitialSnapshot = true
    let unsubscribe: (() => void) | null = null
    try {
      unsubscribe = onSnapshot(
        query(
          collection( db, 'reputationEvents' ),
          where( 'userId', '==', user.uid ),
        ),
        (snapshot) => {
          let nextBadgeEvent: ReputationEventRecord | null = null
          snapshot.docChanges().forEach( (change) => {
            const event = normalizeReputationEvent( change.doc.id, change.doc.data() )
            if( !event || seenEventIdsRef.current.has( event.id ) ) {
              return
            }
            seenEventIdsRef.current.add( event.id )
            if( !isInitialSnapshot && isReviewBadgeAward( event ) && !nextBadgeEvent ) {
              nextBadgeEvent = event
            }
          } )
          isInitialSnapshot = false
          if( nextBadgeEvent ) {
            setBadgeState( { event: nextBadgeEvent, userId: user.uid } )
          }
        },
        (error) => {
          console.warn( 'Reputation badge listener failed; continuing without a live reward modal.', {
            action: 'reputation.listenForReviewBadge',
            cause: error instanceof Error ? error.message : String( error ),
            fallback: 'show_badge_on_next_contribution_load',
            impact: 'The review badge remains stored in the user contribution history.',
            userId: user.uid,
          } )
        },
      )
    } catch( error ) {
      console.warn( 'Reputation badge listener could not start; continuing without a live reward modal.', {
        action: 'reputation.listenForReviewBadge',
        cause: error instanceof Error ? error.message : String( error ),
        fallback: 'show_badge_on_next_contribution_load',
        impact: 'The review badge remains stored in the user contribution history.',
        userId: user.uid,
      } )
    }

    return () => {
      unsubscribe?.()
    }
  }, [ user?.uid ] )

  const badgeEvent = badgeState.userId === user?.uid ? badgeState.event : null
  if( !badgeEvent ) {
    return null
  }

  return (
    <ModalDialog onClose={() => setBadgeState( (current) => ( { ...current, event: null } ) )}>
      <h3>Contribution recognized</h3>
      <p className="muted">
        {buildReputationAwardMessage( 'Your review participation was recognized.', badgeEvent )}
      </p>
      <button type="button" onClick={() => setBadgeState( (current) => ( { ...current, event: null } ) )}>OK</button>
    </ModalDialog>
  )
}

export default ReputationRewardListener
