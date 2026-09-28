// src/lib/notificationPreferences.test.ts: Verifies account notification preference defaults and normalization.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  resolveNotificationPreferences,
} from './notificationPreferences'

describe( 'notificationPreferences', () => {
  it( 'uses legacy defaults when preferences are missing', () => {
    expect( DEFAULT_NOTIFICATION_PREFERENCES ).toEqual( {
      commentEmailEnabled: true,
      hourlyActivityDigestEnabled: false,
    } )
    expect( resolveNotificationPreferences( undefined ) ).toEqual( {
      commentEmailEnabled: true,
      hourlyActivityDigestEnabled: false,
    } )
  } )

  it( 'keeps explicit boolean preferences', () => {
    expect( resolveNotificationPreferences( {
      commentEmailEnabled: false,
      hourlyActivityDigestEnabled: true,
    } ) ).toEqual( {
      commentEmailEnabled: false,
      hourlyActivityDigestEnabled: true,
    } )
  } )

  it( 'ignores non-boolean preference values', () => {
    expect( resolveNotificationPreferences( {
      commentEmailEnabled: 'no',
      hourlyActivityDigestEnabled: 'yes',
    } ) ).toEqual( {
      commentEmailEnabled: true,
      hourlyActivityDigestEnabled: false,
    } )
  } )
} )

