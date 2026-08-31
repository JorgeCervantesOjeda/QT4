// src/lib/changeRequests.test.ts
// Verifies change-request creation rules before they touch Firestore.
import { describe, expect, it } from 'vitest'
import {
  buildChangeRequestTitle,
  validateChangeRequestCreation,
} from './changeRequests'

describe( 'lib/changeRequests', () => {
  it( 'rejects a same-project base with the report guidance message', () => {
    const result = validateChangeRequestCreation( {
      targetProjectId: 'project-1',
      baseProjectId: 'project-1',
      baseDocId: 'doc-1',
      baseVersionId: 'version-1',
      baseVersionStatus: 'Accepted',
      title: 'Client variation',
      userId: 'user-1',
    } )

    expect( result ).toEqual( {
      ok: false,
      message: 'For changes to accepted requirements inside this same project, create an error report instead.',
    } )
  } )

  it( 'accepts an accepted base version from another project', () => {
    const result = validateChangeRequestCreation( {
      targetProjectId: 'project-2',
      baseProjectId: 'project-1',
      baseDocId: 'doc-1',
      baseVersionId: 'version-1',
      baseVersionStatus: 'Accepted',
      title: 'Client variation',
      userId: 'user-1',
    } )

    expect( result ).toEqual( { ok: true } )
  } )

  it( 'rejects non-accepted base versions', () => {
    const result = validateChangeRequestCreation( {
      targetProjectId: 'project-2',
      baseProjectId: 'project-1',
      baseDocId: 'doc-1',
      baseVersionId: 'version-1',
      baseVersionStatus: 'In Review',
      title: 'Client variation',
      userId: 'user-1',
    } )

    expect( result ).toEqual( {
      ok: false,
      message: 'Select an accepted base version before creating a change request.',
    } )
  } )

  it( 'builds the default title from the base document title', () => {
    expect( buildChangeRequestTitle( 'Core requirements' ) ).toBe( 'Change request - Core requirements' )
  } )

  it( 'includes the selected accepted base version in the default title', () => {
    expect( buildChangeRequestTitle( 'Core requirements', 200 ) )
      .toBe( 'Change request - v2.00 - Core requirements' )
  } )
} )
