// src/pages/DashboardPage.test.tsx
// Verifies dashboard user feedback for long-running actions.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from './DashboardPage'

const aiAssistMocks = vi.hoisted( () => ( {
  requestAiAssist: vi.fn(),
} ) )

vi.mock( '../auth/useAuth', () => ( {
  useAuth: () => ( {
    user: {
      uid: 'user-1',
      email: 'user@example.com',
    },
  } ),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  collection: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  doc: vi.fn( ( ...segments: unknown[] ) => ( { segments } ) ),
  onSnapshot: vi.fn( () => () => undefined ),
} ) )

vi.mock( '../lib/firebase', () => ( {
  db: { app: 'test' },
} ) )

vi.mock( '../lib/aiAssist', () => ( {
  requestAiAssist: aiAssistMocks.requestAiAssist,
} ) )

vi.mock( '../lib/errorMonitor', () => ( {
  reportAbnormalError: vi.fn(),
} ) )

vi.mock( '../giphy/GiphyProvider', () => ( {
  GiphyInline: () => <div aria-label="Working animation" />,
} ) )

describe( 'DashboardPage', () => {
  let nextPaintCallback: FrameRequestCallback | null = null

  beforeEach( () => {
    aiAssistMocks.requestAiAssist.mockReturnValue( new Promise( () => undefined ) )
    nextPaintCallback = null
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn( (callback: FrameRequestCallback) => {
        nextPaintCallback = callback
        return 1
      } ),
    )
  } )

  afterEach( () => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  } )

  it( 'shows a working modal before starting urgency analysis', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    fireEvent.click( screen.getByRole( 'button', { name: 'Analyze urgency' } ) )

    expect( screen.getByRole( 'dialog' ) ).toBeTruthy()
    expect(
      screen.getByRole( 'heading', { name: 'Analyzing urgency' } ),
    ).toBeTruthy()
    expect( aiAssistMocks.requestAiAssist ).not.toHaveBeenCalled()

    if( !nextPaintCallback ) {
      throw new Error( 'Expected urgency analysis to wait for visible feedback.' )
    }
    act( () => {
      nextPaintCallback?.( 0 )
    } )

    await waitFor( () => {
      expect( aiAssistMocks.requestAiAssist ).toHaveBeenCalledWith( {
        mode: 'summarize_pending',
      } )
    } )
  } )
} )
