// src/pages/versions/documentAndFileHooks.test.tsx: Regression coverage for referenced project identity during live error-report refreshes.
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentSubscription } from './documentAndFileHooks'

const firestoreMocks = vi.hoisted( () => ( {
  getDocFromServer: vi.fn(), onSnapshot: vi.fn(),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  doc: ( _db: unknown, collectionName: string, id: string ) => ( { collectionName, id } ),
  getDoc: vi.fn(), getDocFromServer: firestoreMocks.getDocFromServer,
  onSnapshot: firestoreMocks.onSnapshot,
} ) )
vi.mock( '../../lib/firebase', () => ( { db: {} } ) )
vi.mock( '../../lib/diagnostics/firestoreListeners', () => ( {
  trackFirestoreListener: () => ( { recordSnapshot: vi.fn(), recordError: vi.fn(), dispose: vi.fn() } ),
} ) )

const reportSnapshot = {
  id: 'report-1', exists: () => true,
  metadata: { fromCache: false, hasPendingWrites: false },
  data: () => ( { projectId: 'project-17', type: 'errorReport',
    baseDocId: 'base-4', baseVersionId: 'base-version-200', title: 'Report' } ),
}

describe( 'live error-report base project identity', () => {
  beforeEach( () => {
    vi.clearAllMocks()
    firestoreMocks.onSnapshot.mockImplementation( ( _reference, onNext ) => {
      onNext( reportSnapshot )
      return vi.fn()
    } )
    firestoreMocks.getDocFromServer.mockImplementation( async ( reference ) => {
      const data = reference.collectionName === 'documents'
        ? { projectId: 'project-17', shortId: 4, title: 'Reglas de documentación' }
        : reference.collectionName === 'versions'
          ? { projectId: 'project-17', docId: 'base-4', number: 200 }
          : { shortId: 17 }
      return { id: reference.id, exists: () => true, data: () => data }
    } )
  } )

  // Integration counterpart: base-document-reference.spec.ts checks the header after a real page reload.
  it( 'loads the project from the base document when baseProjectId is not stored and retains it on refresh', async () => {
    const setBaseDocumentData = vi.fn()
    renderHook( () => useDocumentSubscription( {
      docId: 'report-1', projectIdFromQuery: '', setDocumentData: vi.fn(),
      setVersions: vi.fn(), setBaseDocumentData, setError: vi.fn(),
    } ) )
    await waitFor( () => expect( setBaseDocumentData ).toHaveBeenLastCalledWith( expect.objectContaining( {
      projectId: 'project-17', projectShortId: 17, shortId: 4, versionNumber: 200,
    } ) ) )
    expect( firestoreMocks.getDocFromServer ).toHaveBeenCalledWith( { collectionName: 'projects', id: 'project-17' } )
    await act( async () => firestoreMocks.onSnapshot.mock.calls[0][1]( reportSnapshot ) )
    expect( setBaseDocumentData ).toHaveBeenCalledTimes( 2 )
    expect( setBaseDocumentData ).toHaveBeenLastCalledWith( expect.objectContaining( { projectShortId: 17 } ) )
  } )
} )
