// src/pages/versions/documentTitleEditing.test.ts: Verifies title editing telemetry at the Firestore boundary.
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentSummary } from './types'

const firestoreMocks = vi.hoisted( () => ( {
  doc: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  serverTimestamp: vi.fn( () => 'server-timestamp' ),
  updateDoc: vi.fn<() => Promise<void>>(),
} ) )

const slowUiActionMocks = vi.hoisted( () => ( {
  measureSlowUiAction: vi.fn( async ( _metadata: unknown, callback: () => Promise<unknown> ) => callback() ),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  doc: firestoreMocks.doc,
  serverTimestamp: firestoreMocks.serverTimestamp,
  updateDoc: firestoreMocks.updateDoc,
} ) )

vi.mock( '../../lib/audit', () => ( {
  logAudit: vi.fn( () => Promise.resolve() ),
} ) )

vi.mock( '../../lib/firebase', () => ( {
  db: { app: 'test' },
} ) )

vi.mock( '../../lib/slowUiAction', () => ( {
  measureSlowUiAction: slowUiActionMocks.measureSlowUiAction,
} ) )

import useDocumentTitleEditing from './documentTitleEditing'

const documentData: DocumentSummary = {
  id: 'doc-1',
  projectId: 'project-1',
  title: 'Protocol',
  createdBy: 'author-1',
  type: 'document',
  shortId: 42,
}

describe( 'useDocumentTitleEditing', () => {
  beforeEach( () => {
    vi.clearAllMocks()
    firestoreMocks.updateDoc.mockResolvedValue( undefined )
  } )

  it( 'records title updates as modal-protected', async () => {
    const params = {
      docId: 'doc-1',
      projectId: 'project-1',
      documentData,
      latestVersionId: 'version-1',
      userId: 'author-1',
      userEmail: 'author@example.com',
      canEditDocumentTitle: true,
      setDocumentData: vi.fn(),
      setIsBusy: vi.fn(),
      setSuccessEmailRecipients: vi.fn(),
      setSuccessMessage: vi.fn(),
      setError: vi.fn(),
    }
    const { result } = renderHook( () => useDocumentTitleEditing( params ) )

    act( () => {
      result.current.requestDocumentTitleEdit()
      result.current.setDocumentTitleDraft( 'Updated protocol' )
    } )
    await act( async () => {
      await result.current.handleSaveDocumentTitle()
    } )

    expect( slowUiActionMocks.measureSlowUiAction ).toHaveBeenCalledWith(
      expect.objectContaining( {
        action: 'versions.updateDocumentTitle',
        hasModal: true,
      } ),
      expect.any( Function ),
    )
  } )
} )
