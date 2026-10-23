// src/pages/versions/threadOrdering.ts: Shared chronological issue ordering for all views and adjacent navigation.
import type { SortingState } from '@tanstack/react-table'
import type { ThreadSummary } from './types'

let hasReportedLegacyTimeZone = false

export function parseThreadDate( value: unknown ): Date | null {
  if( value instanceof Date ) return Number.isFinite( value.getTime() ) ? value : null
  if( value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ) {
    return parseThreadDate( value.toDate() )
  }
  if( typeof value !== 'string' || !value.trim() ) return null
  const text = value.trim().replace( ' ', 'T' )
  if( !/(?:Z|[+-]\d{2}:\d{2})$/i.test( text ) && !hasReportedLegacyTimeZone && /^\d{4}-\d{2}-\d{2}/.test( text ) ) {
    hasReportedLegacyTimeZone = true
    console.warn( 'Legacy issue timestamp normalized', {
      cause: 'Historical creation or activity timestamp has no time zone.',
      fallback: 'Interpret the stored timestamp as UTC, matching the numbering migration.',
      impact: 'Relative order is preserved for legacy dates sharing the same time zone; their original zone is unknown.',
    } )
  }
  // Match migration semantics for historical timestamps that omit their UTC offset.
  const date = new Date( /(?:Z|[+-]\d{2}:\d{2})$/i.test( text ) ? text : `${text}Z` )
  return Number.isFinite( date.getTime() ) ? date : null
}

export function deriveThreadActivityAt( thread: ThreadSummary ): Date | undefined {
  const dates = [ thread.createdAt, thread.updatedAt, thread.lastCommentAt ]
    .filter( ( date ): date is Date => date instanceof Date && Number.isFinite( date.getTime() ) )
  return dates.length ? new Date( Math.max( ...dates.map( ( date ) => date.getTime() ) ) ) : undefined
}

export function sortThreadsByTime( threads: ThreadSummary[], sorting: SortingState ): ThreadSummary[] {
  const order = sorting[0]
  if( !order || ( order.id !== 'createdAt' && order.id !== 'activityAt' ) ) {
    return threads
  }
  return [ ...threads ].sort( ( left, right ) => {
    const leftDate = order.id === 'createdAt' ? left.createdAt : deriveThreadActivityAt( left )
    const rightDate = order.id === 'createdAt' ? right.createdAt : deriveThreadActivityAt( right )
    if( !leftDate || !rightDate ) {
      return leftDate ? -1 : rightDate ? 1 : 0
    }
    return ( leftDate.getTime() - rightDate.getTime() ) * ( order.desc ? -1 : 1 )
  } )
}
