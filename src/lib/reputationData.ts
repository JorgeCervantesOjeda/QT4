// src/lib/reputationData.ts: Loads server-generated project contribution summaries and history.

import {
  collection,
  getDocs,
  query,
  where,
  type DocumentData,
} from 'firebase/firestore'
import { db } from './firebase'
import type { ReputationBadgeId, ReputationCategory, ReputationSummary } from './reputation'

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
}

export type UserReputationData = {
  summaries: ReputationSummary[]
  events: ReputationEventRecord[]
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
  }
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
