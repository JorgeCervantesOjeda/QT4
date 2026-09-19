import { beforeEach, describe, expect, it, vi } from 'vitest'

const uploadBytesMock = vi.fn()
const getDownloadURLMock = vi.fn()
const deleteObjectMock = vi.fn()
const uploadFileMock = vi.fn()
const downloadFileMock = vi.fn()
const deleteFileMock = vi.fn()
const loadAppRuntimeConfigMock = vi.fn()

vi.mock( 'firebase/storage', () => ( {
  ref: ( storage: unknown, path: string ) => ( { storage, path } ),
  uploadBytes: (...args: unknown[]) => uploadBytesMock( ...args ),
  getDownloadURL: (...args: unknown[]) => getDownloadURLMock( ...args ),
  deleteObject: (...args: unknown[]) => deleteObjectMock( ...args ),
} ) )

vi.mock( './firebase', () => ( {
  storage: { kind: 'mock-storage' },
} ) )

vi.mock( './filesApi', () => ( {
  buildFileKey: vi.fn(),
  uploadFile: (...args: unknown[]) => uploadFileMock( ...args ),
  downloadFile: (...args: unknown[]) => downloadFileMock( ...args ),
  deleteFile: (...args: unknown[]) => deleteFileMock( ...args ),
} ) )

vi.mock( './runtimeConfig', () => ( {
  loadAppRuntimeConfig: (...args: unknown[]) => loadAppRuntimeConfigMock( ...args ),
  normalizeFileStorageProvider: ( value: string ) => value,
} ) )

import { deleteFileByProvider, downloadFileByProvider, uploadFileUsingActiveProvider } from './fileStorage'

describe( 'lib/fileStorage', () => {
  beforeEach( () => {
    uploadBytesMock.mockReset()
    getDownloadURLMock.mockReset()
    deleteObjectMock.mockReset()
    uploadFileMock.mockReset()
    downloadFileMock.mockReset()
    deleteFileMock.mockReset()
    loadAppRuntimeConfigMock.mockReset()
    loadAppRuntimeConfigMock.mockResolvedValue( {
      config: {
        fileStorageProvider: 'firebase-storage',
      },
    } )
  } )

  it( 'uploads through Firebase Storage when that provider is active', async () => {
    uploadBytesMock.mockResolvedValue( { ref: { path: 'qt4/test/file.txt' } } )
    const file = new File( [ 'draft content' ], 'draft.txt', { type: 'text/plain' } )

    const result = await uploadFileUsingActiveProvider( 'qt4/test/file.txt', file )

    expect( uploadBytesMock ).toHaveBeenCalledTimes( 1 )
    expect( result ).toEqual( {
      sizeBytes: file.size,
      isPermanent: true,
      expireAfterDays: null,
      storageProvider: 'firebase-storage',
    } )
  } )

  it( 'downloads Firebase Storage URLs through an anchor without opening a new tab', async () => {
    getDownloadURLMock.mockResolvedValue( 'https://example.com/download/draft.txt' )
    const openMock = vi.fn()
    vi.stubGlobal( 'open', openMock )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response( 'draft content', {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
          },
        } ),
      ),
    )
    const blobUrl = 'blob:firebase-download'
    const createObjectURLMock = vi.fn().mockReturnValue( blobUrl )
    const revokeObjectURLMock = vi.fn()
    const OriginalURL = URL
    vi.stubGlobal( 'URL', Object.assign(
      function URLMock( value: string | URL, base?: string | URL ) {
        return new OriginalURL( value, base )
      },
      OriginalURL,
      {
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock,
      },
    ) )
    const clickSpy = vi
      .spyOn( HTMLAnchorElement.prototype, 'click' )
      .mockImplementation( function clickMock( this: HTMLAnchorElement ) {
        void this
      } )

    await downloadFileByProvider( 'qt4/test/file.txt', 'draft.txt', 'firebase-storage' )

    expect( getDownloadURLMock ).toHaveBeenCalledTimes( 1 )
    expect( openMock ).not.toHaveBeenCalled()
    expect( clickSpy ).toHaveBeenCalledTimes( 1 )
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement
    expect( anchor.download ).toBe( 'draft.txt' )
    expect( anchor.href ).toBe( 'blob:firebase-download' )
    expect( revokeObjectURLMock ).toHaveBeenCalledWith( blobUrl )
  } )

  it( 'uses the file key name when a Firebase Storage download has no suggested name', async () => {
    getDownloadURLMock.mockResolvedValue( 'https://example.com/download/draft.txt' )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response( 'draft content', {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
          },
        } ),
      ),
    )
    const OriginalURL = URL
    vi.stubGlobal( 'URL', Object.assign(
      function URLMock( value: string | URL, base?: string | URL ) {
        return new OriginalURL( value, base )
      },
      OriginalURL,
      {
        createObjectURL: vi.fn().mockReturnValue( 'blob:firebase-download' ),
        revokeObjectURL: vi.fn(),
      },
    ) )
    const clickSpy = vi
      .spyOn( HTMLAnchorElement.prototype, 'click' )
      .mockImplementation( function clickMock( this: HTMLAnchorElement ) {
        void this
      } )

    await downloadFileByProvider( 'qt4/test/file.txt', undefined, 'firebase-storage' )

    expect( clickSpy ).toHaveBeenCalledTimes( 1 )
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement
    expect( anchor.download ).toBe( 'file.txt' )
    expect( anchor.href ).toBe( 'blob:firebase-download' )
  } )

  it( 'falls back to the direct Firebase URL when blob fetching is blocked by the browser', async () => {
    getDownloadURLMock.mockResolvedValue( 'https://example.com/download/draft.txt' )
    vi.stubGlobal( 'fetch', vi.fn().mockRejectedValue( new TypeError( 'NetworkError when attempting to fetch resource.' ) ) )
    const clickSpy = vi
      .spyOn( HTMLAnchorElement.prototype, 'click' )
      .mockImplementation( function clickMock( this: HTMLAnchorElement ) {
        void this
      } )

    await downloadFileByProvider( 'qt4/test/file.txt', 'draft.txt', 'firebase-storage' )

    expect( clickSpy ).toHaveBeenCalledTimes( 1 )
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement
    expect( anchor.href ).toBe( 'https://example.com/download/draft.txt' )
    expect( anchor.download ).toBe( 'draft.txt' )
  } )

  it( 'ignores missing Firebase Storage objects during delete cleanup', async () => {
    deleteObjectMock.mockRejectedValue( Object.assign( new Error( 'missing' ), {
      code: 'storage/object-not-found',
    } ) )

    await expect( deleteFileByProvider( 'qt4/test/file.txt', 'firebase-storage' ) ).resolves.toBeUndefined()
    expect( deleteFileMock ).not.toHaveBeenCalled()
  } )
} )
