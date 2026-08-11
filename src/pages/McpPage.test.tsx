import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const { onSnapshotMock } = vi.hoisted( () => ( {
  onSnapshotMock: vi.fn(),
} ) )

vi.mock( '../auth/useAuth', () => ( {
  useAuth: () => ( {
    user: {
      uid: 'user-1',
      email: 'member@example.com',
      getIdToken: vi.fn().mockResolvedValue( 'test-token' ),
    },
  } ),
} ) )

vi.mock( '../lib/firebase', () => ( {
  db: {},
} ) )

vi.mock( 'firebase/firestore', () => ( {
  collection: (...args: unknown[]) => ( { kind: 'collection', args } ),
  doc: (...args: unknown[]) => ( { kind: 'doc', args } ),
  onSnapshot: (...args: unknown[]) => onSnapshotMock( ...args ),
  orderBy: (...args: unknown[]) => ( { kind: 'orderBy', args } ),
  query: (...args: unknown[]) => ( { kind: 'query', args } ),
  serverTimestamp: () => ( { kind: 'serverTimestamp' } ),
  updateDoc: vi.fn(),
  where: (...args: unknown[]) => ( { kind: 'where', args } ),
} ) )

import McpPage from './McpPage'

describe( 'McpPage', () => {
  it( 'shows connection details and pending MCP actions', async () => {
    onSnapshotMock.mockImplementation( ( _query, onNext ) => {
      onNext( {
        docs: [
          {
            id: 'action-1',
            data: () => ( {
              kind: 'accept_version',
              summary: 'Accept version 1.00',
              status: 'pending',
              createdAt: { toDate: () => new Date( '2026-08-11T12:00:00Z' ) },
            } ),
          },
        ],
      } )
      return vi.fn()
    } )

    render(
      <MemoryRouter>
        <McpPage />
      </MemoryRouter>,
    )

    expect( ( await screen.findAllByText( 'QT4 MCP' ) ).length ).toBeGreaterThan( 0 )
    expect( screen.getByText( /https?:\/\/.*\/mcp/ ) ).toBeTruthy()
    expect( screen.getByText( 'Accept version 1.00' ) ).toBeTruthy()
  } )
} )
