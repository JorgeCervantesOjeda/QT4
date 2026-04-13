import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  onSnapshotMock,
  getDocMock,
  getDocsMock,
  reportAbnormalErrorMock,
  logAuditMock,
  navigateMock,
} = vi.hoisted( () => ( {
  onSnapshotMock: vi.fn(),
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  reportAbnormalErrorMock: vi.fn(),
  logAuditMock: vi.fn(),
  navigateMock: vi.fn(),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  collection: ( db: unknown, name: string ) => ( { kind: 'collection', db, name } ),
  doc: ( parent: unknown, collectionName?: string, id?: string ) => {
    if( typeof collectionName === 'string' && typeof id === 'string' ) {
      return { kind: 'doc', collection: collectionName, id }
    }
    if( parent && typeof parent === 'object' && 'name' in ( parent as Record<string, unknown> ) ) {
      return { kind: 'doc', collection: String( ( parent as { name: string } ).name ), id: 'generated-doc' }
    }
    return { kind: 'doc', collection: 'unknown', id: String( id ?? collectionName ?? 'unknown-doc' ) }
  },
  getDoc: (...args: unknown[]) => getDocMock( ...args ),
  getDocs: (...args: unknown[]) => getDocsMock( ...args ),
  limit: ( value: number ) => ( { type: 'limit', value } ),
  onSnapshot: (...args: unknown[]) => onSnapshotMock( ...args ),
  query: ( base: unknown, ...constraints: unknown[] ) => ( { kind: 'query', base, constraints } ),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn( () => 'server-timestamp' ),
  setDoc: vi.fn(),
  where: ( field: string, op: string, value: unknown ) => ( { type: 'where', field, op, value } ),
} ) )

vi.mock( '../auth/useAuth', () => ( {
  useAuth: () => ( {
    user: {
      uid: 'user-member-1',
      email: 'member@example.com',
      displayName: 'Member User',
    },
  } ),
} ) )

vi.mock( 'react-router-dom', async () => {
  const actual = await vi.importActual<typeof import( 'react-router-dom' )>( 'react-router-dom' )
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
} )

vi.mock( '../components/AppBrand', () => ( {
  default: ({ pageTitle }: { pageTitle: string }) => <h1>{pageTitle}</h1>,
} ) )

vi.mock( '../components/BackStack', () => ( {
  default: () => null,
} ) )

vi.mock( '../components/DataTable', () => ( {
  default: () => <div data-testid="projects-table" />,
} ) )

vi.mock( '../components/ErrorChecklistModal', () => ( {
  default: ({ error }: { error: string }) => <div role="dialog">{error}</div>,
} ) )

vi.mock( '../components/ModalDialog', () => ( {
  default: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
} ) )

vi.mock( '../giphy/GiphyProvider', () => ( {
  GiphyInline: () => null,
} ) )

vi.mock( '../lib/audit', () => ( {
  logAudit: (...args: unknown[]) => logAuditMock( ...args ),
} ) )

vi.mock( '../lib/errorMonitor', () => ( {
  reportAbnormalError: (...args: unknown[]) => reportAbnormalErrorMock( ...args ),
} ) )

vi.mock( '../lib/firebase', () => ( {
  db: { kind: 'db' },
} ) )

import ProjectsPage from './ProjectsPage'

type FakeDocRecord = {
  id: string
  data: Record<string, unknown>
}

const createDocSnapshot = ( record: FakeDocRecord ) => ( {
  id: record.id,
  data: () => record.data,
  exists: () => true,
} )

const createMissingSnapshot = ( id: string ) => ( {
  id,
  data: () => ( {} ),
  exists: () => false,
} )

const createQuerySnapshot = ( records: FakeDocRecord[] ) => ( {
  docs: records.map( createDocSnapshot ),
} )

const getCollectionName = ( queryOrCollection: unknown ) => {
  if( queryOrCollection && typeof queryOrCollection === 'object' && 'kind' in ( queryOrCollection as Record<string, unknown> ) ) {
    const record = queryOrCollection as {
      kind?: string
      name?: string
      base?: { name?: string }
    }
    if( record.kind === 'collection' ) {
      return record.name ?? ''
    }
    if( record.kind === 'query' ) {
      return record.base?.name ?? ''
    }
  }
  return ''
}

const getWhereValue = ( queryArg: unknown, field: string ) => {
  if( !queryArg || typeof queryArg !== 'object' || !( 'constraints' in queryArg ) ) {
    return undefined
  }
  const queryRecord = queryArg as { constraints?: Array<{ type?: string; field?: string; value?: unknown }> }
  return queryRecord.constraints?.find( ( constraint ) => constraint.type === 'where' && constraint.field === field )?.value
}

const primeProjectsMocks = () => {
  onSnapshotMock.mockImplementation( (
    _query: unknown,
    onNext: (snapshot: ReturnType<typeof createQuerySnapshot>) => void,
  ) => {
    onNext(
      createQuerySnapshot( [
        {
          id: 'project-member-1',
          data: {
            projectId: 'project-1',
            userId: 'user-member-1',
            role: 'leader',
            email: 'member@example.com',
          },
        },
      ] ),
    )
    return () => undefined
  } )

  getDocMock.mockImplementation( async ( docRef: { collection: string; id: string } ) => {
    if( docRef.collection === 'projects' && docRef.id === 'project-1' ) {
      return createDocSnapshot( {
        id: 'project-1',
        data: {
          shortId: 42,
          name: 'Alpha Project',
          leaderId: 'user-member-1',
        },
      } )
    }
    if( docRef.collection === 'userProfiles' && docRef.id === 'user-reviewer-1' ) {
      return createDocSnapshot( {
        id: 'user-reviewer-1',
        data: {
          displayName: 'Review Lead',
        },
      } )
    }
    return createMissingSnapshot( docRef.id )
  } )

  getDocsMock.mockImplementation( async ( queryArg: unknown ) => {
    const collectionName = getCollectionName( queryArg )
    if( collectionName === 'projectMembers' ) {
      return createQuerySnapshot( [
        {
          id: 'project-1_user-member-1',
          data: {
            projectId: 'project-1',
            userId: 'user-member-1',
            role: 'leader',
            email: 'member@example.com',
          },
        },
        {
          id: 'project-1_user-reviewer-1',
          data: {
            projectId: 'project-1',
            userId: 'user-reviewer-1',
            role: 'member',
            email: 'reviewer@example.com',
          },
        },
      ] )
    }
    if( collectionName === 'userDirectory' ) {
      const requestedUserIds = getWhereValue( queryArg, 'userId' )
      if( Array.isArray( requestedUserIds ) && requestedUserIds.includes( 'user-reviewer-1' ) ) {
        return createQuerySnapshot( [
          {
            id: 'user-reviewer-1',
            data: {
              userId: 'user-reviewer-1',
              email: 'reviewer@example.com',
            },
          },
        ] )
      }
      return createQuerySnapshot( [] )
    }
    return createQuerySnapshot( [] )
  } )
}

describe( 'pages/ProjectsPage', () => {
  beforeEach( () => {
    vi.clearAllMocks()
    primeProjectsMocks()
  } )

  afterEach( () => {
    vi.clearAllMocks()
  } )

  it( 'renders loaded projects with resolved leader and member labels', async () => {
    render( <ProjectsPage /> )

    expect( await screen.findByRole( 'heading', { name: 'Projects' }, { timeout: 10000 } ) ).toBeTruthy()
    expect( await screen.findByRole( 'heading', { name: '42 - Alpha Project' }, { timeout: 10000 } ) ).toBeTruthy()
    expect( screen.getByText( 'Leader: Member User (member@example.com)' ) ).toBeTruthy()
    expect( screen.getByText( 'Review Lead (reviewer@example.com)' ) ).toBeTruthy()
    expect( screen.getByText( '(member)' ) ).toBeTruthy()
  }, 15000 )

  it( 'validates invalid member email locally without querying Firestore', async () => {
    render( <ProjectsPage /> )

    const projectCard = await screen.findByRole( 'heading', { name: '42 - Alpha Project' }, { timeout: 10000 } )
    const projectArticle = projectCard.closest( 'article' )
    expect( projectArticle ).toBeTruthy()

    getDocMock.mockClear()
    getDocsMock.mockClear()

    fireEvent.change(
      within( projectArticle as HTMLElement ).getByLabelText( 'Add member (email)' ),
      { target: { value: 'not-an-email' } },
    )
    fireEvent.click( within( projectArticle as HTMLElement ).getByRole( 'button', { name: 'Add member' } ) )

    await waitFor( () => {
      expect(
        within( projectArticle as HTMLElement ).getByText( 'Provide a valid email address.' ),
      ).toBeTruthy()
    } )
    expect( getDocMock ).not.toHaveBeenCalled()
    expect( getDocsMock ).not.toHaveBeenCalled()
  }, 15000 )

  it( 'does not report offline project loads as abnormal errors', async () => {
    getDocMock.mockRejectedValueOnce( new Error( 'Failed to get document because the client is offline.' ) )

    render( <ProjectsPage /> )

    expect( await screen.findByText( 'Failed to get document because the client is offline.' ) ).toBeTruthy()
    expect( reportAbnormalErrorMock ).not.toHaveBeenCalled()
  }, 15000 )
} )
