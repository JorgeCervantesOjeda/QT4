// src/lib/userDisplay.test.ts: Verifies safe user labels and directory loading fallbacks.
import { describe, expect, it } from 'vitest'
import { resolveUserDisplayLabel } from './userDisplay'

describe( 'user display labels', () => {
  it( 'uses a name or email and never falls back to an internal identifier', () => {
    expect( resolveUserDisplayLabel( 'user-1', { 'user-1': { displayName: 'Ana' } } ) ).toBe( 'Ana' )
    expect( resolveUserDisplayLabel( 'user-2', { 'user-2': { email: 'member@example.com' } } ) ).toBe( 'member@example.com' )
    expect( resolveUserDisplayLabel( 'firebase-internal-id', {} ) ).toBe( 'Project member' )
    expect( resolveUserDisplayLabel( 'user-1', {}, { uid: 'user-1', displayName: 'Current user' } ) ).toBe( 'You' )
  } )
} )
