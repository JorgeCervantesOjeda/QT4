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
