// src/lib/errorMonitor.test.ts
// Verifies abnormal client error classification and suppression rules.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authMock } = vi.hoisted( () => ( {
  authMock: {
    currentUser: {
      uid: 'user-1',
      email: 'user@example.com',
      getIdToken: vi.fn().mockResolvedValue( 'token-1' ),
    },
  },
} ) )

vi.mock( './firebase', () => ( {
  auth: authMock,
} ) )

vi.mock( './diagnostics/firestoreListeners', () => ( {
  getActiveFirestoreListeners: () => [],
} ) )

describe( 'lib/errorMonitor', () => {
  beforeEach( () => {
    vi.resetModules()
    vi.stubEnv( 'VITE_FIREBASE_MONITOR_FUNCTION_URL', 'https://example.com/monitor' )
    vi.stubEnv( 'VITE_APP_BUILD', 'test' )
    window.history.replaceState(
      {},
      '',
      '/documents/doc-1/versions?projectId=project-1',
    )
    authMock.currentUser.getIdToken.mockClear()
  } )

  it( 'does not report Firebase Auth IndexedDB lifecycle rejections while the page is closing or hidden', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal( 'fetch', fetchMock )
    const { reportAbnormalError } = await import( './errorMonitor' )
    const { getRecentDiagnostics } = await import( './diagnostics/clientDiagnostics' )
    const error = new Error( 'Database is closing/hidden' )
    error.stack = [
      '_openDb@https://qualiteam-plus.web.app/assets/vendor-firebase.js:1:86252',
      '_withRetries@https://qualiteam-plus.web.app/assets/vendor-firebase.js:1:86474',
      'setCurrentUser@https://qualiteam-plus.web.app/assets/vendor-firebase.js:1:45853',
      'directlySetCurrentUser@https://qualiteam-plus.web.app/assets/vendor-firebase.js:1:60234',
      'reloadAndSetCurrentUserOrClear@https://qualiteam-plus.web.app/assets/vendor-firebase.js:1:55487',
    ].join( '\n' )

    const reported = await reportAbnormalError( {
      error,
      source: 'ui',
      action: 'global.unhandledrejection',
    } )

    expect( reported ).toBe( false )
    expect( fetchMock ).not.toHaveBeenCalled()
    expect( authMock.currentUser.getIdToken ).not.toHaveBeenCalled()
    expect( getRecentDiagnostics() ).toEqual(
      expect.arrayContaining( [
        expect.objectContaining( {
          type: 'firebase.auth_lifecycle_rejection_suppressed',
        } ),
      ] ),
    )
  } )

  it( 'still reports unrelated global unhandled rejections', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response( '', {
        status: 200,
      } ),
    )
    vi.stubGlobal( 'fetch', fetchMock )
    const { reportAbnormalError } = await import( './errorMonitor' )
    const error = new Error( 'Unexpected runtime failure' )
    error.stack = 'at renderSomething (https://example.com/app.js:1:1)'

    const reported = await reportAbnormalError( {
      error,
      source: 'ui',
      action: 'global.unhandledrejection',
    } )

    expect( reported ).toBe( true )
    expect( authMock.currentUser.getIdToken ).toHaveBeenCalledTimes( 1 )
    expect( fetchMock ).toHaveBeenCalledWith(
      'https://example.com/monitor',
      expect.objectContaining( {
        method: 'POST',
        headers: expect.any( Object ),
        body: expect.any( String ),
      } ),
    )
    const payload = JSON.parse( String( fetchMock.mock.calls[0]?.[1]?.body ) )
    const { APP_METADATA } = await import( './appMetadata' )
    expect( payload ).toEqual(
      expect.objectContaining( {
        action: 'global.unhandledrejection',
        messageRaw: 'Unexpected runtime failure',
        projectId: 'project-1',
        docId: 'doc-1',
        appBuild: APP_METADATA.appVersion,
        appVersion: APP_METADATA.appVersion,
        diagnosticDetails: expect.objectContaining( {
          diagnosticVersion: 1,
          operation: expect.objectContaining( {
            action: 'global.unhandledrejection',
            source: 'ui',
          } ),
          resources: expect.objectContaining( {
            projectId: 'project-1',
            docId: 'doc-1',
          } ),
          session: expect.objectContaining( {
            authenticated: expect.any( Boolean ),
          } ),
        } ),
      } ),
    )
  } )
} )
