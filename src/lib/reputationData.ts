// src/lib/reputationData.ts: Loads server-generated project contribution summaries and history.

import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  type DocumentData,
} from 'firebase/firestore'
import { db } from './firebase'
import {
  BADGE_DEFINITIONS,
  type ReputationBadgeId,
  type ReputationCategory,
  type ReputationSummary,
} from './reputation'

export type ReputationEventRecord = {
  id: string
  projectId: string
  userId: string
  sourceType: string
  sourceId: string
  category: ReputationCategory
  points: number
  reason: string
  createdAt: unknown
  sequenceKey?: string
  sequenceNumber?: number
  sequenceIntervalStart?: number
  sequenceIntervalEnd?: number
  earnedBadgeIds?: ReputationBadgeId[]
}

export type UserReputationData = {
  summaries: ReputationSummary[]
  events: ReputationEventRecord[]
}

export const formatReputationPoints = (points: number): string => {
  if( !Number.isFinite( points ) ) {
    return '0'
  }
  const rounded = Number( points.toFixed( 2 ) )
  return Object.is( rounded, -0 ) ? '0' : String( rounded )
}

const asNonEmptyString = (value: unknown): string =>
  typeof value === 'string' && value.trim() ? value.trim() : ''

const asFiniteNumber = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : Number( value )
  return Number.isFinite( number ) ? number : null
}

const asBadgeIds = (value: unknown): ReputationBadgeId[] => {
  if( !Array.isArray( value ) ) {
    return []
  }
  return value.filter( (badgeId): badgeId is ReputationBadgeId =>
    typeof badgeId === 'string' && [
      'first-contribution',
      'issue-spotter',
      'helpful-collaborator',
      'reliable-reviewer',
      'quality-builder',
      'consistent-contributor',
    ].includes( badgeId ),
  )
}

const normalizeSummary = (id: string, data: DocumentData): ReputationSummary | null => {
  const projectId = asNonEmptyString( data.projectId )
  const userId = asNonEmptyString( data.userId )
  const numericFields = [
    'totalPoints',
    'collaborationPoints',
    'reviewPoints',
    'qualityPoints',
    'contributionCount',
    'threadCount',
    'commentCount',
    'goodReactionCount',
    'completedReviewCount',
    'acceptedVersionCount',
  ] as const
  if( !projectId || !userId ) {
    console.warn( 'Reputation summary skipped because its identity is incomplete.', { id } )
    return null
  }
  const summary = {
    projectId,
    userId,
    badgeIds: asBadgeIds( data.badgeIds ),
    updatedAt: data.updatedAt ?? null,
  } as ReputationSummary
  numericFields.forEach( (fieldName) => {
    const value = asFiniteNumber( data[fieldName] )
    summary[fieldName] = value ?? 0
  } )
  return summary
}

export const normalizeReputationEvent = (id: string, data: DocumentData): ReputationEventRecord | null => {
  const projectId = asNonEmptyString( data.projectId )
  const userId = asNonEmptyString( data.userId )
  const category = data.category as ReputationCategory
  const points = asFiniteNumber( data.points )
  if( !projectId || !userId || ![ 'collaboration', 'review', 'quality' ].includes( category ) || points === null ) {
    console.warn( 'Reputation event skipped because its data is incomplete.', { id } )
    return null
  }
  if( points === 0 ) {
    return null
  }
  const sequenceKey = asNonEmptyString( data.sequenceKey )
  const sequenceNumber = asFiniteNumber( data.sequenceNumber )
  const sequenceIntervalStart = asFiniteNumber( data.sequenceIntervalStart )
  const sequenceIntervalEnd = asFiniteNumber( data.sequenceIntervalEnd )
  const earnedBadgeIds = asBadgeIds( data.earnedBadgeIds )
  return {
    id,
    projectId,
    userId,
    sourceType: asNonEmptyString( data.sourceType ) || 'unknown',
    sourceId: asNonEmptyString( data.sourceId ) || id,
    category,
    points,
    reason: asNonEmptyString( data.reason ) || 'Contribution event',
    createdAt: data.createdAt ?? null,
    ...( sequenceKey ? { sequenceKey } : {} ),
    ...( sequenceNumber !== null ? { sequenceNumber } : {} ),
    ...( sequenceIntervalStart !== null ? { sequenceIntervalStart } : {} ),
    ...( sequenceIntervalEnd !== null ? { sequenceIntervalEnd } : {} ),
    ...( earnedBadgeIds.length ? { earnedBadgeIds } : {} ),
  }
}

type WaitForReputationEventParams = {
  projectId: string
  sourceId: string
  sourceType: string
  userId: string
  timeoutMs?: number
}

export const waitForReputationEvent = ({
  projectId,
  sourceId,
  sourceType,
  userId,
  timeoutMs = 5000,
}: WaitForReputationEventParams): Promise<ReputationEventRecord | null> => new Promise( (resolve) => {
  let unsubscribe: (() => void) | null = null
  let settled = false
  let cleanupRequestedBeforeSubscription = false
  const timeout = setTimeout( () => {
    console.warn( 'Reputation event wait timed out; showing pending feedback.', {
      action: 'reputation.waitForEvent',
      cause: 'server_event_timeout',
      fallback: 'show_pending_points_message',
      impact: 'The saved action remains intact; the modal directs the user to Contributions.',
      projectId,
      sourceId,
      sourceType,
      timeoutMs,
      userId,
    } )
    finish( null )
  }, timeoutMs )

  const finish = (event: ReputationEventRecord | null) => {
    if( settled ) {
      return
    }
    settled = true
    clearTimeout( timeout )
    if( unsubscribe ) {
      unsubscribe()
    } else {
      cleanupRequestedBeforeSubscription = true
    }
    resolve( event )
  }

  try {
    unsubscribe = onSnapshot(
      query( collection( db, 'reputationEvents' ), where( 'userId', '==', userId ) ),
      (snapshot) => {
        const event = snapshot.docs
          .map( (item) => normalizeReputationEvent( item.id, item.data() ) )
          .find( (item): item is ReputationEventRecord => Boolean(
            item && item.projectId === projectId && item.sourceType === sourceType && item.sourceId === sourceId,
          ) )
        if( event ) {
          finish( event )
        }
      },
      (error) => {
        console.warn( 'Reputation event listener failed; showing pending feedback.', {
          action: 'reputation.waitForEvent',
          cause: error instanceof Error ? error.message : String( error ),
          fallback: 'show_pending_points_message',
          impact: 'The saved action remains intact; the modal directs the user to Contributions.',
          projectId,
          sourceId,
          sourceType,
          userId,
        } )
        finish( null )
      },
    )
    if( cleanupRequestedBeforeSubscription ) {
      unsubscribe()
    }
  } catch( error ) {
    console.warn( 'Reputation event listener could not start; showing pending feedback.', {
      action: 'reputation.waitForEvent',
      cause: error instanceof Error ? error.message : String( error ),
      fallback: 'show_pending_points_message',
      impact: 'The saved action remains intact; the modal directs the user to Contributions.',
      projectId,
      sourceId,
      sourceType,
      userId,
    } )
    finish( null )
  }
} )

export const buildReputationAwardMessage = (
  prefix: string,
  event: ReputationEventRecord | null,
): string => {
  if( !event ) {
    return `${prefix} The action was saved, but the exact points are still being processed. Check Contributions for the final result.`
  }
  const formattedPoints = formatReputationPoints( event.points )
  const signedPoints = event.points > 0 ? `+${formattedPoints}` : formattedPoints
  const pointLabel = Math.abs( event.points ) === 1 ? 'point' : 'points'
  const badgeLabels = ( event.earnedBadgeIds || [] )
    .map( (badgeId) => BADGE_DEFINITIONS.find( (definition) => definition.id === badgeId )?.label )
    .filter( (label): label is string => Boolean( label ) )
  const badgeMessage = badgeLabels.length
    ? ` New badge${badgeLabels.length === 1 ? '' : 's'}: ${badgeLabels.join( ', ' )}.`
    : ''
  return event.points > 0
    ? `${prefix} You earned ${signedPoints} ${pointLabel}.${badgeMessage}`
    : `${prefix} Your reputation changed by ${signedPoints} ${pointLabel}.${badgeMessage}`
}

const byDescendingPoints = (left: ReputationSummary, right: ReputationSummary): number => {
  if( right.totalPoints !== left.totalPoints ) {
    return right.totalPoints - left.totalPoints
  }
  return left.userId.localeCompare( right.userId )
}

export const toReputationDate = (value: unknown): Date | null => {
  if( value instanceof Date ) {
    return value
  }
  if( value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ) {
    return value.toDate()
  }
  return null
}

export const loadProjectReputation = async (projectId: string): Promise<ReputationSummary[]> => {
  if( !projectId ) {
    return []
  }
  const snapshot = await getDocs( query(
    collection( db, 'reputationSummaries' ),
    where( 'projectId', '==', projectId ),
  ) )
  return snapshot.docs
    .map( (item) => normalizeSummary( item.id, item.data() ) )
    .filter( (summary): summary is ReputationSummary => Boolean( summary ) )
    .sort( byDescendingPoints )
}

export const loadUserReputation = async (userId: string): Promise<UserReputationData> => {
  if( !userId ) {
    return { summaries: [], events: [] }
  }
  const [ summarySnapshot, eventSnapshot ] = await Promise.all( [
    getDocs( query( collection( db, 'reputationSummaries' ), where( 'userId', '==', userId ) ) ),
    getDocs( query( collection( db, 'reputationEvents' ), where( 'userId', '==', userId ) ) ),
  ] )
  const summaries = summarySnapshot.docs
    .map( (item) => normalizeSummary( item.id, item.data() ) )
    .filter( (summary): summary is ReputationSummary => Boolean( summary ) )
    .sort( byDescendingPoints )
  const events = eventSnapshot.docs
    .map( (item) => normalizeReputationEvent( item.id, item.data() ) )
    .filter( (event): event is ReputationEventRecord => Boolean( event ) )
    .sort( (left, right) => {
      const leftDate = toReputationDate( left.createdAt )?.getTime() ?? 0
      const rightDate = toReputationDate( right.createdAt )?.getTime() ?? 0
      return rightDate - leftDate
    } )
  return { summaries, events }
}
