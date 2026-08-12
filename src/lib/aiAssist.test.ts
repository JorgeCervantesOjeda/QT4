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

import { requestAiAssist } from './aiAssist'

describe( 'lib/aiAssist', () => {
  afterEach( () => {
    authMock.currentUser = null
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  } )

  it( 'posts an authenticated AI assist request', async () => {
    vi.stubGlobal( 'fetch', fetchMock )
    authMock.currentUser = {
      getIdToken: vi.fn().mockResolvedValue( 'token-123' ),
    }
    fetchMock.mockResolvedValueOnce( {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue( {
        ok: true,
        mode: 'explain_thread',
        result: 'Thread summary.',
      } ),
      text: vi.fn().mockResolvedValue( '' ),
    } )

    const response = await requestAiAssist(
      { mode: 'explain_thread', threadId: 'thread-1' },
      { functionUrl: 'https://example.test/ai-assist' },
    )

    expect( response.result ).toBe( 'Thread summary.' )
    expect( authMock.currentUser.getIdToken ).toHaveBeenCalledWith()
    expect( fetchMock ).toHaveBeenCalledWith(
      'https://example.test/ai-assist',
      expect.objectContaining( {
        method: 'POST',
        headers: expect.objectContaining( {
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json',
        } ),
        body: JSON.stringify( {
          mode: 'explain_thread',
          threadId: 'thread-1',
        } ),
      } ),
    )
  } )

  it( 'falls back to a forced token refresh when the cached token lookup fails', async () => {
    vi.stubGlobal( 'fetch', fetchMock )
    authMock.currentUser = {
      getIdToken: vi.fn()
        .mockRejectedValueOnce( new Error( 'cached token unavailable' ) )
        .mockResolvedValueOnce( 'token-refresh-123' ),
    }
    fetchMock.mockResolvedValueOnce( {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue( {
        ok: true,
        mode: 'improve_text',
        result: 'Improved text.',
      } ),
      text: vi.fn().mockResolvedValue( '' ),
    } )

    await requestAiAssist(
      { mode: 'improve_text', text: 'Please improve this.' },
      { functionUrl: 'https://example.test/ai-assist' },
    )

    expect( authMock.currentUser.getIdToken ).toHaveBeenNthCalledWith( 1 )
    expect( authMock.currentUser.getIdToken ).toHaveBeenNthCalledWith( 2, true )
    expect( fetchMock ).toHaveBeenCalledWith(
      'https://example.test/ai-assist',
      expect.objectContaining( {
        headers: expect.objectContaining( {
          Authorization: 'Bearer token-refresh-123',
        } ),
      } ),
    )
  } )

  it( 'sends thread context when improving draft text', async () => {
    vi.stubGlobal( 'fetch', fetchMock )
    authMock.currentUser = {
      getIdToken: vi.fn().mockResolvedValue( 'token-123' ),
    }
    fetchMock.mockResolvedValueOnce( {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue( {
        ok: true,
        mode: 'improve_text',
        result: 'Sí.',
      } ),
      text: vi.fn().mockResolvedValue( '' ),
    } )

    await requestAiAssist(
      { mode: 'improve_text', text: 'si', threadId: 'thread-1' },
      { functionUrl: 'https://example.test/ai-assist' },
    )

    expect( fetchMock ).toHaveBeenCalledWith(
      'https://example.test/ai-assist',
      expect.objectContaining( {
        body: JSON.stringify( {
          mode: 'improve_text',
          text: 'si',
          threadId: 'thread-1',
        } ),
      } ),
    )
  } )

  it( 'throws injected AI assist faults before calling the network', async () => {
    vi.stubGlobal( 'fetch', fetchMock )
    consumeInjectedTestFaultMock.mockReturnValueOnce( new Error( 'Injected AI failure.' ) )

    await expect(
      requestAiAssist(
        { mode: 'summarize_pending' },
        { functionUrl: 'https://example.test/ai-assist' },
      ),
    ).rejects.toThrow( 'Injected AI failure.' )

    expect( fetchMock ).not.toHaveBeenCalled()
  } )

  it( 'requires an active user session', async () => {
    await expect(
      requestAiAssist(
        { mode: 'explain_comment', commentId: 'comment-1' },
        { functionUrl: 'https://example.test/ai-assist' },
      ),
    ).rejects.toThrow( 'User session is required.' )
  } )
} )
