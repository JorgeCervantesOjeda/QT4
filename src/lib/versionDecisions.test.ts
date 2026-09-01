// src/lib/versionDecisions.test.ts
// Verifies authenticated client calls for transactional version decisions.
import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  authMock,
  consumeInjectedTestFaultMock,
  fetchMock,
} = vi.hoisted( () => ( {
  authMock: {
    currentUser: null as null | {
      getIdToken: (forceRefresh?: boolean) => Promise<string>
    },
  },
  consumeInjectedTestFaultMock: vi.fn(),
  fetchMock: vi.fn(),
} ) )

vi.mock( './firebase', () => ( {
  auth: authMock,
} ) )

vi.mock( './testFaults', () => ( {
  consumeInjectedTestFault: consumeInjectedTestFaultMock,
} ) )

import { requestVersionDecision } from './versionDecisions'

describe( 'lib/versionDecisions', () => {
  afterEach( () => {
    authMock.currentUser = null
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  } )

  it( 'posts an authenticated accept decision', async () => {
    vi.stubGlobal( 'fetch', fetchMock )
    authMock.currentUser = {
      getIdToken: vi.fn().mockResolvedValue( 'token-123' ),
    }
    fetchMock.mockResolvedValueOnce( {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue( {
        ok: true,
        decision: 'accept',
        projectId: 'project-1',
        docId: 'doc-1',
        versionId: 'version-1',
        promotedNumber: 100,
        replacedVersionIds: [],
      } ),
      text: vi.fn().mockResolvedValue( '' ),
      headers: { get: vi.fn().mockReturnValue( 'application/json' ) },
    } )

    const result = await requestVersionDecision(
      {
        decision: 'accept',
        projectId: 'project-1',
        docId: 'doc-1',
        versionId: 'version-1',
      },
      { functionUrl: 'https://example.test/version-decision' },
    )

    expect( result.promotedNumber ).toBe( 100 )
    expect( fetchMock ).toHaveBeenCalledWith(
      'https://example.test/version-decision',
      expect.objectContaining( {
        method: 'POST',
        headers: expect.objectContaining( {
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json',
        } ),
        body: JSON.stringify( {
          decision: 'accept',
          projectId: 'project-1',
          docId: 'doc-1',
          versionId: 'version-1',
        } ),
      } ),
    )
  } )

  it( 'keeps propagated error report failures from the backend response', async () => {
    vi.stubGlobal( 'fetch', fetchMock )
    authMock.currentUser = {
      getIdToken: vi.fn().mockResolvedValue( 'token-123' ),
    }
    fetchMock.mockResolvedValueOnce( {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue( {
        ok: true,
        decision: 'accept',
        projectId: 'project-1',
        docId: 'doc-1',
        versionId: 'version-1',
        promotedNumber: 100,
        replacedVersionIds: [],
        propagatedErrorReports: {
          createdCount: 0,
          skippedCount: 0,
          failedCount: 1,
          failures: [{ reason: 'storage_copy_failed' }],
        },
      } ),
      text: vi.fn().mockResolvedValue( '' ),
      headers: { get: vi.fn().mockReturnValue( 'application/json' ) },
    } )

    const result = await requestVersionDecision(
      {
        decision: 'accept',
        projectId: 'project-1',
        docId: 'doc-1',
        versionId: 'version-1',
      },
      { functionUrl: 'https://example.test/version-decision' },
    )

    expect( result.propagatedErrorReports?.failedCount ).toBe( 1 )
    expect( result.propagatedErrorReports?.failures[0]?.reason ).toBe( 'storage_copy_failed' )
  } )

  it( 'requires an active user session', async () => {
    await expect(
      requestVersionDecision(
        {
          decision: 'reject',
          projectId: 'project-1',
          docId: 'doc-1',
          versionId: 'version-1',
        },
        { functionUrl: 'https://example.test/version-decision' },
      ),
    ).rejects.toThrow( 'User session is required.' )
  } )

  it( 'throws injected version decision faults before calling the network', async () => {
    vi.stubGlobal( 'fetch', fetchMock )
    consumeInjectedTestFaultMock.mockReturnValueOnce( new Error( 'Injected decision failure.' ) )

    await expect(
      requestVersionDecision(
        {
          decision: 'accept',
          projectId: 'project-1',
          docId: 'doc-1',
          versionId: 'version-1',
        },
        { functionUrl: 'https://example.test/version-decision' },
      ),
    ).rejects.toThrow( 'Injected decision failure.' )

    expect( fetchMock ).not.toHaveBeenCalled()
  } )
} )
