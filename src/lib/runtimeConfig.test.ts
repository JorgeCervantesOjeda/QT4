import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  docMock,
  getDocMock,
  serverTimestampMock,
  setDocMock,
  dbMock,
} = vi.hoisted( () => ( {
  docMock: vi.fn( (db: unknown, ...segments: string[]) => ( {
    db,
    path: segments.join( '/' ),
    id: segments.at( -1 ) ?? '',
  } ) ),
  getDocMock: vi.fn(),
  serverTimestampMock: vi.fn( () => 'SERVER_TIMESTAMP' ),
  setDocMock: vi.fn(),
  dbMock: { name: 'db' },
} ) )

vi.mock( 'firebase/firestore', () => ( {
  doc: docMock,
  getDoc: getDocMock,
  serverTimestamp: serverTimestampMock,
  setDoc: setDocMock,
} ) )

vi.mock( './firebase', () => ( {
  db: dbMock,
} ) )

import {
  formatRuntimeConfigSummary,
  getDefaultAppRuntimeConfig,
  loadAppRuntimeConfig,
  normalizeEmailProvider,
  normalizeFileStorageProvider,
  saveAppRuntimeConfig,
} from './runtimeConfig'

describe( 'lib/runtimeConfig', () => {
  afterEach( () => {
    vi.clearAllMocks()
  } )

  it( 'normalizes unknown providers back to the supported defaults', () => {
    expect( normalizeFileStorageProvider( 'firebase-storage' ) ).toBe( 'firebase-storage' )
    expect( normalizeFileStorageProvider( 'unknown-provider' ) ).toBe( 'files-api' )
    expect( normalizeEmailProvider( 'firebase-functions' ) ).toBe( 'firebase-functions' )
    expect( normalizeEmailProvider( 'unknown-provider' ) ).toBe( 'files-api' )
  } )

  it( 'returns the default config when Firestore has no runtime document', async () => {
    getDocMock.mockResolvedValueOnce( {
      exists: () => false,
      data: () => ( {} ),
    } )

    const result = await loadAppRuntimeConfig()

    expect( result ).toEqual( {
      config: getDefaultAppRuntimeConfig(),
      source: 'defaults',
    } )
  } )

  it( 'loads and normalizes the Firestore runtime config', async () => {
    getDocMock.mockResolvedValueOnce( {
      exists: () => true,
      data: () => ( {
        fileStorageProvider: 'firebase-storage',
        emailProvider: 'firebase-functions',
      } ),
    } )

    const result = await loadAppRuntimeConfig()

    expect( result ).toEqual( {
      config: {
        fileStorageProvider: 'firebase-storage',
        emailProvider: 'firebase-functions',
      },
      source: 'firestore',
    } )
  } )

  it( 'falls back to defaults when loading the runtime config throws', async () => {
    getDocMock.mockRejectedValueOnce( new Error( 'firestore unavailable' ) )

    const result = await loadAppRuntimeConfig()

    expect( result ).toEqual( {
      config: getDefaultAppRuntimeConfig(),
      source: 'defaults',
    } )
  } )

  it( 'requires a signed-in user to save the runtime config', async () => {
    await expect(
      saveAppRuntimeConfig(
        {
          fileStorageProvider: 'firebase-storage',
          emailProvider: 'firebase-functions',
        },
        '',
      ),
    ).rejects.toThrow( 'User session is required.' )
  } )

  it( 'saves the normalized runtime config with merge enabled', async () => {
    setDocMock.mockResolvedValueOnce( undefined )

    await saveAppRuntimeConfig(
      {
        fileStorageProvider: 'firebase-storage',
        emailProvider: 'firebase-functions',
      },
      'user-admin-1',
    )

    expect( serverTimestampMock ).toHaveBeenCalledTimes( 1 )
    expect( setDocMock ).toHaveBeenCalledWith(
      expect.objectContaining( { path: 'systemConfig/runtime' } ),
      expect.objectContaining( {
        fileStorageProvider: 'firebase-storage',
        emailProvider: 'firebase-functions',
        updatedAt: 'SERVER_TIMESTAMP',
        updatedBy: 'user-admin-1',
      } ),
      { merge: true },
    )
  } )

  it( 'formats a readable runtime config summary', () => {
    expect(
      formatRuntimeConfigSummary( {
        fileStorageProvider: 'files-api',
        emailProvider: 'firebase-functions',
      } ),
    ).toBe( 'Files: files-api; Email: firebase-functions' )
  } )
} )
