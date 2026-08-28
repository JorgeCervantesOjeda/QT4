// src/lib/storageChangeRequestRules.test.ts
// Guards Storage rule text for project-scoped version file access.
import { describe, expect, it } from 'vitest'
import storageRules from '../../storage.rules?raw'

describe( 'storage.rules change-request base downloads', () => {
  it( 'guards qt4 version files by project membership or admin access', () => {
    expect( storageRules ).toContain( 'function isProjectMember(projectId)' )
    expect( storageRules ).toContain( 'firestore.get(/databases/(default)/documents/projectMembers/$(projectId + \'_\' + request.auth.uid))' )
    expect( storageRules ).toContain( 'allow read, write: if isProjectMember(projectId) || isAdmin();' )
    expect( storageRules ).not.toContain( 'allow read, write: if isSignedIn();' )
  } )
} )
