// src/pages/versions/realtimeHooks.test.tsx
// Verifies issue/comment subscriptions do not reset modal state on query-only navigation.
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useThreadsAndCommentsSubscription } from './realtimeHooks'

const firestoreMocks = vi.hoisted( () => ( {
  onSnapshot: vi.fn(),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  collection: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  doc: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  onSnapshot: firestoreMocks.onSnapshot,
  orderBy: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  query: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  where: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
} ) )

vi.mock( '../../lib/diagnostics/firestoreListeners', () => ( {
  trackFirestoreListener: () => ( {
    dispose: vi.fn(),
    recordError: vi.fn(),
    recordSnapshot: vi.fn(),
  } ),
} ) )

vi.mock( '../../lib/firebase', () => ( {
  db: { app: 'test' },
} ) )

const emptySnapshot = {
  docs: [],
  metadata: {
    fromCache: false,
    hasPendingWrites: false,
  },
}

describe( 'useThreadsAndCommentsSubscription', () => {
  it( 'keeps pending issue status confirmation when only the thread query changes', () => {
    firestoreMocks.onSnapshot.mockImplementation( ( _query, onNext ) => {
      onNext( emptySnapshot )
      return vi.fn()
    } )
    const setPendingThreadStatusChange = vi.fn()
    const baseProps = {
      selectedVersionId: 'version-1',
      projectId: 'project-1',
      docId: 'doc-1',
      threadIdFromQuery: '',
      commentsRetryToken: 0,
      commentsRetryTimeoutRef: { current: null },
      reportVersionsErrorRef: { current: vi.fn() },
      setThreads: vi.fn(),
      setVisibleThreadRows: vi.fn(),
      setCommentsByThread: vi.fn(),
      setSelectedThreadId: vi.fn(),
      setNewThreadTitle: vi.fn(),
      setNewCommentBody: vi.fn(),
      setPendingThreadStatusChange,
      setIsLoadingThreads: vi.fn(),
      setCommentsRetryToken: vi.fn(),
      setError: vi.fn(),
      lastAppliedThreadQueryRef: { current: null },
    }

    const { rerender } = renderHook(
      ( props ) => useThreadsAndCommentsSubscription( props ),
      { initialProps: baseProps },
    )
    const initialPendingClearCalls = setPendingThreadStatusChange.mock.calls.length
    const initialSubscriptionCalls = firestoreMocks.onSnapshot.mock.calls.length

    rerender( { ...baseProps, threadIdFromQuery: 'thread-1' } )

    expect( setPendingThreadStatusChange ).toHaveBeenCalledTimes( initialPendingClearCalls )
    expect( firestoreMocks.onSnapshot ).toHaveBeenCalledTimes( initialSubscriptionCalls )
  } )
} )
