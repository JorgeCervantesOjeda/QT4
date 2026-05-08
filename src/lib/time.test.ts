import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatTimeAgo, formatTimeAgoWithTimestamp, formatTimestamp } from './time'

describe( 'lib/time', () => {
  beforeEach( () => {
    vi.useFakeTimers()
    vi.setSystemTime( new Date( '2026-04-04T12:00:00.000Z' ) )
  } )

  afterEach( () => {
    vi.useRealTimers()
  } )

  it( 'returns Unknown for empty values', () => {
    expect( formatTimeAgo() ).toBe( 'Unknown' )
    expect( formatTimestamp() ).toBe( 'Unknown' )
    expect( formatTimeAgoWithTimestamp() ).toBe( 'Unknown' )
  } )

  it( 'formats relative times for past and future dates', () => {
    expect( formatTimeAgo( new Date( '2026-04-04T11:55:00.000Z' ) ) ).toBe( '5 minutes ago' )
    expect( formatTimeAgo( new Date( '2026-04-04T14:00:00.000Z' ) ) ).toBe( 'in 2 hours' )
  } )

  it( 'formats timestamps using the shared formatter', () => {
    const value = new Date( '2026-04-04T12:00:00.000Z' )

    expect( formatTimestamp( value ) ).toBe(
      new Intl.DateTimeFormat( 'en', {
        dateStyle: 'medium',
        timeStyle: 'short',
      } ).format( value ),
    )
  } )

  it( 'combines relative time with the exact timestamp', () => {
    const value = new Date( '2026-04-04T11:30:00.000Z' )

    expect( formatTimeAgoWithTimestamp( value ) ).toBe(
      `${formatTimeAgo( value )} (${formatTimestamp( value )})`,
    )
  } )
} )
