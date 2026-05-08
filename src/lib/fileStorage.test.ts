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

  it( 'triggers an anchor download for Firebase Storage URLs', async () => {
    getDownloadURLMock.mockResolvedValue( 'https://example.com/download/draft.txt' )
    const clickSpy = vi
      .spyOn( HTMLAnchorElement.prototype, 'click' )
      .mockImplementation( function clickMock( this: HTMLAnchorElement ) {
        void this
      } )

    await downloadFileByProvider( 'qt4/test/file.txt', 'draft.txt', 'firebase-storage' )

    expect( getDownloadURLMock ).toHaveBeenCalledTimes( 1 )
    expect( clickSpy ).toHaveBeenCalledTimes( 1 )
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement
    expect( anchor.download ).toBe( 'draft.txt' )
    expect( anchor.href ).toBe( 'https://example.com/download/draft.txt' )
  } )

  it( 'ignores missing Firebase Storage objects during delete cleanup', async () => {
    deleteObjectMock.mockRejectedValue( Object.assign( new Error( 'missing' ), {
      code: 'storage/object-not-found',
    } ) )

    await expect( deleteFileByProvider( 'qt4/test/file.txt', 'firebase-storage' ) ).resolves.toBeUndefined()
    expect( deleteFileMock ).not.toHaveBeenCalled()
  } )
} )
