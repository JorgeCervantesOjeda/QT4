import { describe, expect, it } from 'vitest'
import {
  assertValidStateForVersionNumber,
  FIRST_VERSION_NUMBER,
  isIntegerVersionNumber,
  versionNumberToString,
} from './types'

describe( 'domain/types', () => {
  it( 'identifies integer version numbers correctly', () => {
    expect( isIntegerVersionNumber( FIRST_VERSION_NUMBER ) ).toBe( false )
    expect( isIntegerVersionNumber( 100 ) ).toBe( true )
    expect( isIntegerVersionNumber( 101 ) ).toBe( false )
  } )

  it( 'formats stored version numbers as readable strings', () => {
    expect( versionNumberToString( 1 ) ).toBe( '0.01' )
    expect( versionNumberToString( 100 ) ).toBe( '1.00' )
    expect( versionNumberToString( 305 ) ).toBe( '3.05' )
  } )

  it( 'allows only accepted or replaced states for integer versions', () => {
    expect( () => assertValidStateForVersionNumber( 100, 'Accepted' ) ).not.toThrow()
    expect( () => assertValidStateForVersionNumber( 100, 'Replaced' ) ).not.toThrow()
    expect( () => assertValidStateForVersionNumber( 100, 'In Review' ) ).toThrow(
      "Invalid state 'In Review' for integer version 1.00",
    )
  } )

  it( 'rejects accepted or replaced states for non-integer versions', () => {
    expect( () => assertValidStateForVersionNumber( 101, 'Accepted' ) ).toThrow(
      "Invalid state 'Accepted' for non-integer version 1.01",
    )
    expect( () => assertValidStateForVersionNumber( 101, 'Replaced' ) ).toThrow(
      "Invalid state 'Replaced' for non-integer version 1.01",
    )
  } )
} )
