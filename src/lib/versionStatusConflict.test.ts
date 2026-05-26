// Regression coverage for the expected issue-status conflict classifier used by VersionsPage.
import { describe, expect, it } from 'vitest'
import {
  THREAD_STATUS_CONFLICT_MESSAGE,
  isExpectedThreadStatusConflictError,
} from './versionStatusConflict'

describe( 'isExpectedThreadStatusConflictError', () => {
  it( 'classifies stale issue status conflicts as expected runtime state', () => {
    expect( isExpectedThreadStatusConflictError( new Error( THREAD_STATUS_CONFLICT_MESSAGE ) ) ).toBe( true )
  } )

  it( 'does not classify unrelated errors as expected conflicts', () => {
    expect( isExpectedThreadStatusConflictError( new Error( 'Permission denied.' ) ) ).toBe( false )
    expect( isExpectedThreadStatusConflictError( THREAD_STATUS_CONFLICT_MESSAGE ) ).toBe( false )
  } )
} )
