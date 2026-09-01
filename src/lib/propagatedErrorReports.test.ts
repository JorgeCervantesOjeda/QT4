// src/lib/propagatedErrorReports.test.ts
// Verifies authenticated client calls for propagated error-report retry.
import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  authMock,
  fetchMock,
} = vi.hoisted( () => ( {
  authMock: {
    currentUser: null as null | {
      getIdToken: (forceRefresh?: boolean) => Promise<string>
    },
  },
  fetchMock: vi.fn(),
} ) )

vi.mock( './firebase', () => ( {
  auth: authMock,
} ) )

import { requestRetryPropagatedErrorReports } from './propagatedErrorReports'

describe( 'lib/propagatedErrorReports', () => {
  afterEach( () => {
    authMock.currentUser = null
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  } )

  it( 'posts an authenticated retry request and preserves failures', async () => {
    vi.stubGlobal( 'fetch', fetchMock )
    authMock.currentUser = {
      getIdToken: vi.fn().mockResolvedValue( 'token-123' ),
    }
    fetchMock.mockResolvedValueOnce( {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue( {
        ok: true,
        projectId: 'project-1',
        docId: 'doc-1',
        versionId: 'version-1',
        createdCount: 0,
        skippedCount: 0,
        failedCount: 1,
        failures: [{ reason: 'storage_copy_failed' }],
      } ),
      text: vi.fn().mockResolvedValue( '' ),
      headers: { get: vi.fn().mockReturnValue( 'application/json' ) },
    } )

    const result = await requestRetryPropagatedErrorReports(
      {
        projectId: 'project-1',
        docId: 'doc-1',
        versionId: 'version-1',
      },
      { functionUrl: 'https://example.test/retry-propagated-error-reports' },
    )

    expect( result.failedCount ).toBe( 1 )
    expect( result.failures[0]?.reason ).toBe( 'storage_copy_failed' )
    expect( fetchMock ).toHaveBeenCalledWith(
      'https://example.test/retry-propagated-error-reports',
      expect.objectContaining( {
        method: 'POST',
        headers: expect.objectContaining( {
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json',
        } ),
      } ),
    )
  } )
} )
