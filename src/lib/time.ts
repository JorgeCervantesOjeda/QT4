// src/lib/time.ts: Shared date and elapsed-time formatting helpers.
const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

export const formatTimeAgo = (value?: Date | null) => {
  if( !value ) {
    return 'Unknown'
  }
  const now = Date.now()
  const diffMs = value.getTime() - now
  const diffSeconds = Math.round( diffMs / 1000 )
  const ranges: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
    { unit: 'year', seconds: 60 * 60 * 24 * 365 },
    { unit: 'month', seconds: 60 * 60 * 24 * 30 },
    { unit: 'day', seconds: 60 * 60 * 24 },
    { unit: 'hour', seconds: 60 * 60 },
    { unit: 'minute', seconds: 60 },
    { unit: 'second', seconds: 1 },
  ]
  const formatter = new Intl.RelativeTimeFormat( 'en', { numeric: 'auto' } )
  for( const range of ranges ) {
    if( Math.abs( diffSeconds ) >= range.seconds ) {
      return formatter.format( Math.round( diffSeconds / range.seconds ), range.unit )
    }
  }
  return formatter.format( 0, 'second' )
}

export const formatElapsedWithDays = (value?: Date | null, nowMs = Date.now()) => {
  if( !value ) {
    return '--:--:--'
  }
  const secondsOfElapsed = Math.max( 0, Math.floor( ( nowMs - value.getTime() ) / MILLISECONDS_PER_SECOND ) )
  const days = Math.floor( secondsOfElapsed / ( SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY ) )
  const hours = Math.floor( ( secondsOfElapsed % ( SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY ) ) / ( SECONDS_PER_MINUTE * MINUTES_PER_HOUR ) )
  const minutes = Math.floor( ( secondsOfElapsed % ( SECONDS_PER_MINUTE * MINUTES_PER_HOUR ) ) / SECONDS_PER_MINUTE )
  const seconds = secondsOfElapsed % SECONDS_PER_MINUTE
  const clock = `${String( hours ).padStart( 2, '0' )}:${String( minutes ).padStart( 2, '0' )}:${String( seconds ).padStart( 2, '0' )}`
  if( days === 0 ) {
    return clock
  }
  return `${days} ${days === 1 ? 'day' : 'days'}, ${clock}`
}

export const formatTimestamp = (value?: Date | null) => {
  if( !value ) {
    return 'Unknown'
  }
  return new Intl.DateTimeFormat( 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  } ).format( value )
}

export const formatTimeAgoWithTimestamp = (value?: Date | null) => {
  if( !value ) {
    return 'Unknown'
  }
  return `${formatTimeAgo( value )} (${formatTimestamp( value )})`
}
