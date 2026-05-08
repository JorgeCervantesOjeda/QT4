import { afterEach, describe, expect, it, vi } from 'vitest'

const { authMock } = vi.hoisted( () => ( {
  authMock: {
  currentUser: null as null | {
    getIdToken: (forceRefresh?: boolean) => Promise<string>
  },
  },
} ) )

vi.mock( './firebase', () => ( {
  auth: authMock,
} ) )

import {
  buildFileKey,
  buildFilesApiUrl,
  deleteFile,
  downloadFile,
  getFilesApiConfigSummary,
  notifyEmail,
  uploadFile,
} from './filesApi'

describe( 'lib/filesApi', () => {
  afterEach( () => {
    authMock.currentUser = null
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  } )

  it( 'retries token refresh and sends the authorization header on upload', async () => {
    const getIdToken = vi
      .fn< (forceRefresh?: boolean) => Promise<string> >()
      .mockRejectedValueOnce( new Error( 'token expired' ) )
      .mockResolvedValueOnce( 'fresh-token' )
    authMock.currentUser = { getIdToken }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify( {
          fileKey: 'qt4/project/doc/version/spec.txt',
        } ),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )
    vi.stubGlobal( 'fetch', fetchMock )

    const result = await uploadFile(
      'qt4/project/doc/version/spec.txt',
      new File( [ 'draft' ], 'spec.txt', { type: 'text/plain' } ),
    )

    expect( result ).toEqual( {
      fileKey: 'qt4/project/doc/version/spec.txt',
    } )
    expect( getIdToken ).toHaveBeenNthCalledWith( 1 )
    expect( getIdToken ).toHaveBeenNthCalledWith( 2, true )
    expect( fetchMock ).toHaveBeenCalledWith(
      expect.stringMatching( /\/files\/qt4%2Fproject%2Fdoc%2Fversion%2Fspec\.txt$/ ),
      expect.objectContaining( {
        method: 'PUT',
        headers: expect.any( Headers ),
      } ),
    )
    const request = fetchMock.mock.calls[0]?.[1] as { headers: Headers }
    expect( request.headers.get( 'Authorization' ) ).toBe( 'Bearer fresh-token' )
    expect( request.headers.get( 'Content-Type' ) ).toBe( 'application/octet-stream' )
  } )

  it( 'surfaces permission errors returned by the upload endpoint', async () => {
    authMock.currentUser = {
      getIdToken: vi.fn().mockResolvedValue( 'token-123' ),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response( 'missing or insufficient permissions', {
          status: 403,
          statusText: 'Forbidden',
        } ),
      ),
    )

    await expect(
      uploadFile(
        'qt4/project/doc/version/spec.txt',
        new File( [ 'draft' ], 'spec.txt', { type: 'text/plain' } ),
      ),
    ).rejects.toThrow( 'Upload failed (403): missing or insufficient permissions' )
  } )

  it( 'throws when the download endpoint reports a missing file', async () => {
    authMock.currentUser = {
      getIdToken: vi.fn().mockResolvedValue( 'token-123' ),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response( '', {
          status: 404,
          statusText: 'Not Found',
        } ),
      ),
    )

    await expect( downloadFile( 'qt4/project/doc/version/missing.txt' ) ).rejects.toThrow( 'File not found.' )
  } )

  it( 'propagates network failures while deleting files', async () => {
    authMock.currentUser = {
      getIdToken: vi.fn().mockResolvedValue( 'token-123' ),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue( new Error( 'Network down' ) ),
    )

    await expect( deleteFile( 'qt4/project/doc/version/spec.txt' ) ).rejects.toThrow( 'Network down' )
  } )

  it( 'reports notify endpoint failures with the server response body', async () => {
    authMock.currentUser = {
      getIdToken: vi.fn().mockResolvedValue( 'token-123' ),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response( 'Mail relay unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
        } ),
      ),
    )

    await expect(
      notifyEmail( {
        to: [ 'reviewer@example.com' ],
        subject: 'Review needed',
        text: 'Please review version 1.',
      } ),
    ).rejects.toThrow( 'Notify failed (503): Mail relay unavailable' )
  } )

  it( 'builds file keys with sanitized path segments and file names', () => {
    expect(
      buildFileKey( {
        projectId: 'Proyecto Ágil',
        documentId: 'Spec / Main',
        versionId: 'V 1.0',
        fileName: 'Plan de pruebas final.pdf',
      } ),
    ).toBe( 'qt4/Proyecto_Agil/Spec_Main/V_1.0/Plan_de_pruebas_final.pdf' )
  } )

  it( 'truncates long file names while preserving the extension', () => {
    const longFileName = `${'a'.repeat( 300 )}.pdf`
    const fileKey = buildFileKey( {
      projectId: 'project',
      documentId: 'document',
      versionId: 'version',
      fileName: longFileName,
    } )

    expect( fileKey.length ).toBeLessThanOrEqual( 255 )
    expect( fileKey.endsWith( '.pdf' ) ).toBe( true )
  } )

  it( 'builds normalized URLs for the active files API mode', () => {
    expect( getFilesApiConfigSummary() ).toMatch( /^(proxy|direct) \(.+\)$/ )
    expect( buildFilesApiUrl( 'notify' ) ).toMatch( /\/notify$/ )
    expect( buildFilesApiUrl( '/files/test.txt' ) ).toMatch( /\/files\/test\.txt$/ )
  } )
} )
