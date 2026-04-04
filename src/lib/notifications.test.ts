import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  notifyEmailWithFilesApiMock,
  authMock,
  loadAppRuntimeConfigMock,
  consumeInjectedTestFaultMock,
  fetchMock,
} = vi.hoisted( () => ( {
  notifyEmailWithFilesApiMock: vi.fn(),
  authMock: {
    currentUser: null as null | {
      getIdToken: (forceRefresh?: boolean) => Promise<string>
    },
  },
  loadAppRuntimeConfigMock: vi.fn(),
  consumeInjectedTestFaultMock: vi.fn(),
  fetchMock: vi.fn(),
} ) )

vi.mock( './filesApi', () => ( {
  notifyEmail: notifyEmailWithFilesApiMock,
} ) )

vi.mock( './firebase', () => ( {
  auth: authMock,
} ) )

vi.mock( './runtimeConfig', () => ( {
  loadAppRuntimeConfig: loadAppRuntimeConfigMock,
} ) )

vi.mock( './testFaults', () => ( {
  consumeInjectedTestFault: consumeInjectedTestFaultMock,
} ) )

import { notifyEmailUsingActiveProvider } from './notifications'

describe( 'lib/notifications', () => {
  afterEach( () => {
    authMock.currentUser = null
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  } )

  it( 'uses the Files API provider when explicitly requested', async () => {
    notifyEmailWithFilesApiMock.mockResolvedValueOnce( undefined )

    await notifyEmailUsingActiveProvider(
      {
        to: [ 'reviewer@example.com' ],
        subject: 'Review needed',
        text: 'Please review the version.',
      },
      'files-api',
    )

    expect( loadAppRuntimeConfigMock ).not.toHaveBeenCalled()
    expect( notifyEmailWithFilesApiMock ).toHaveBeenCalledWith( {
      to: [ 'reviewer@example.com' ],
      subject: 'Review needed',
      text: 'Please review the version.',
    } )
  } )

  it( 'uses the runtime-config provider when no provider is passed', async () => {
    loadAppRuntimeConfigMock.mockResolvedValueOnce( {
      config: {
        fileStorageProvider: 'files-api',
        emailProvider: 'files-api',
      },
      source: 'firestore',
    } )
    notifyEmailWithFilesApiMock.mockResolvedValueOnce( undefined )

    await notifyEmailUsingActiveProvider( {
      to: [ 'reviewer@example.com' ],
      subject: 'Review needed',
      text: 'Please review the version.',
    } )

    expect( loadAppRuntimeConfigMock ).toHaveBeenCalledTimes( 1 )
    expect( notifyEmailWithFilesApiMock ).toHaveBeenCalledTimes( 1 )
  } )

  it( 'throws the injected emulator fault before resolving the provider', async () => {
    consumeInjectedTestFaultMock.mockReturnValueOnce( new Error( 'Injected notify failure.' ) )

    await expect(
      notifyEmailUsingActiveProvider( {
        to: [ 'reviewer@example.com' ],
        subject: 'Injected failure',
        text: 'Please review the version.',
      } ),
    ).rejects.toThrow( 'Injected notify failure.' )

    expect( loadAppRuntimeConfigMock ).not.toHaveBeenCalled()
    expect( notifyEmailWithFilesApiMock ).not.toHaveBeenCalled()
  } )

  it( 'fails fast when firebase-functions is selected without a configured URL', async () => {
    vi.stubGlobal( 'fetch', fetchMock )
    const notifyUrl = ( import.meta.env.VITE_FIREBASE_NOTIFY_FUNCTION_URL ?? '' ).trim()

    if( !notifyUrl ) {
      await expect(
        notifyEmailUsingActiveProvider(
          {
            to: [ 'reviewer@example.com' ],
            subject: 'Review needed',
            text: 'Please review the version.',
          },
          'firebase-functions',
        ),
      ).rejects.toThrow(
        'Email provider firebase-functions is enabled but VITE_FIREBASE_NOTIFY_FUNCTION_URL is missing.',
      )

      expect( fetchMock ).not.toHaveBeenCalled()
      return
    }

    authMock.currentUser = {
      getIdToken: vi.fn().mockResolvedValue( 'token-123' ),
    }
    fetchMock.mockResolvedValueOnce( {
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue( '' ),
    } )

    await notifyEmailUsingActiveProvider(
      {
        to: [ 'reviewer@example.com' ],
        subject: 'Review needed',
        text: 'Please review the version.',
      },
      'firebase-functions',
    )

    expect( authMock.currentUser.getIdToken ).toHaveBeenCalledWith( true )
    expect( fetchMock ).toHaveBeenCalledWith(
      notifyUrl,
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
