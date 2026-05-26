import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  onSnapshotMock,
  getDocMock,
  getDocsMock,
  setDocMock,
  navigateMock,
  reportAbnormalErrorMock,
  logAuditMock,
} = vi.hoisted( () => ( {
  onSnapshotMock: vi.fn(),
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  setDocMock: vi.fn(),
  navigateMock: vi.fn(),
  reportAbnormalErrorMock: vi.fn(),
  logAuditMock: vi.fn(),
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
  setDoc: (...args: unknown[]) => setDocMock( ...args ),
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
    useParams: () => ( {
      projectId: 'project-1',
    } ),
  }
} )

vi.mock( '../components/AppBrand', () => ( {
  default: ({ pageTitle }: { pageTitle: string }) => <h1>{pageTitle}</h1>,
} ) )

vi.mock( '../components/BackStack', () => ( {
  default: () => null,
} ) )

vi.mock( '../components/DataTable', () => ( {
  default: () => <div data-testid="documents-table" />,
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

import ProjectDocumentsPage from './ProjectDocumentsPage'

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

const primeDocumentMocks = () => {
  onSnapshotMock.mockImplementation( (
    _query: unknown,
    onNext: (snapshot: ReturnType<typeof createQuerySnapshot>) => void,
  ) => {
    onNext(
      createQuerySnapshot( [
        {
          id: 'document-1',
          data: {
            projectId: 'project-1',
            title: 'Controlled Document',
            createdBy: 'user-reviewer-1',
            shortId: 17,
            createdAt: new Date( '2026-04-01T10:00:00.000Z' ),
            updatedAt: new Date( '2026-04-02T12:00:00.000Z' ),
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
    if( docRef.collection === 'userDirectory' && docRef.id === 'newmember@example.com' ) {
      return createDocSnapshot( {
        id: 'newmember@example.com',
        data: {
          userId: 'user-new-member',
          email: 'newmember@example.com',
        },
      } )
    }
    return createMissingSnapshot( docRef.id )
  } )

  getDocsMock.mockImplementation( async ( queryArg: unknown ) => {
    const collectionName = getCollectionName( queryArg )
    if( collectionName === 'versions' && getWhereValue( queryArg, 'projectId' ) === 'project-1' ) {
      return createQuerySnapshot( [
        {
          id: 'version-1',
          data: {
            projectId: 'project-1',
            docId: 'document-1',
            number: 1,
            status: 'In Review',
            createdBy: 'user-reviewer-1',
            reviewerIds: [ 'user-member-1' ],
            createdAt: new Date( '2026-04-01T10:00:00.000Z' ),
            reviewEndAt: new Date( '2026-04-03T09:00:00.000Z' ),
          },
        },
      ] )
    }
    if( collectionName === 'projectMembers' && getWhereValue( queryArg, 'projectId' ) === 'project-1' ) {
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

describe( 'pages/ProjectDocumentsPage', () => {
  beforeEach( () => {
    vi.clearAllMocks()
    primeDocumentMocks()
  } )

  it( 'renders the project label and loaded document summary', async () => {
    render( <ProjectDocumentsPage /> )

    expect( await screen.findByRole( 'heading', { name: 'Project Documents' }, { timeout: 10000 } ) ).toBeTruthy()
    expect( await screen.findByText( '42 - Alpha Project', {}, { timeout: 10000 } ) ).toBeTruthy()
    expect( await screen.findByRole( 'heading', { name: '17 - Controlled Document' }, { timeout: 10000 } ) ).toBeTruthy()
    expect( screen.getByText( 'Version 0.01 - In Review' ) ).toBeTruthy()
    expect( screen.getByText( 'Creator: Review Lead' ) ).toBeTruthy()
    expect( screen.getByRole( 'heading', { name: 'Project members' } ) ).toBeTruthy()
    expect( screen.getByRole( 'heading', { name: 'Project members' } ).compareDocumentPosition(
      screen.getByRole( 'heading', { name: 'Create document' } ),
    ) & Node.DOCUMENT_POSITION_FOLLOWING ).toBeTruthy()
    expect( screen.getByRole( 'button', { name: 'Expand' } ).getAttribute( 'aria-expanded' ) ).toBe( 'false' )
    expect( screen.queryByLabelText( 'Add member (email)' ) ).toBeNull()
    fireEvent.click( screen.getByRole( 'button', { name: 'Expand' } ) )
    expect( screen.getByText( 'Member User' ) ).toBeTruthy()
    expect( screen.getByText( 'Review Lead' ) ).toBeTruthy()
    expect( screen.getByRole( 'button', { name: 'Collapse' } ).getAttribute( 'aria-expanded' ) ).toBe( 'true' )
  }, 15000 )

  it( 'validates invalid member email locally on the documents page', async () => {
    render( <ProjectDocumentsPage /> )

    expect( await screen.findByRole( 'heading', { name: 'Project members' }, { timeout: 10000 } ) ).toBeTruthy()
    fireEvent.click( screen.getByRole( 'button', { name: 'Expand' } ) )

    getDocMock.mockClear()
    getDocsMock.mockClear()

    fireEvent.change( screen.getByLabelText( 'Add member (email)' ), { target: { value: 'not-an-email' } } )
    fireEvent.click( screen.getByRole( 'button', { name: 'Add member' } ) )

    expect( await screen.findByText( 'Provide a valid email address.' ) ).toBeTruthy()
    expect( getDocMock ).not.toHaveBeenCalled()
    expect( getDocsMock ).not.toHaveBeenCalled()
  }, 15000 )

  it( 'adds members from the documents page when the user is project leader', async () => {
    render( <ProjectDocumentsPage /> )

    expect( await screen.findByRole( 'heading', { name: 'Project members' }, { timeout: 10000 } ) ).toBeTruthy()
    fireEvent.click( screen.getByRole( 'button', { name: 'Expand' } ) )

    fireEvent.change( screen.getByLabelText( 'Add member (email)' ), { target: { value: 'newmember@example.com' } } )
    fireEvent.click( screen.getByRole( 'button', { name: 'Add member' } ) )

    await waitFor( () => {
      expect( setDocMock ).toHaveBeenCalled()
    } )
    expect( setDocMock.mock.calls[0][0] ).toEqual( {
      kind: 'doc',
      collection: 'projectMembers',
      id: 'project-1_user-new-member',
    } )
    expect( setDocMock.mock.calls[0][1] ).toMatchObject( {
      projectId: 'project-1',
      userId: 'user-new-member',
      role: 'member',
      email: 'newmember@example.com',
    } )
    expect( await screen.findByText( 'Member added successfully.' ) ).toBeTruthy()
  }, 15000 )

  it( 'shows a visible error when the documents subscription fails', async () => {
    onSnapshotMock.mockImplementation( (
      _query: unknown,
      _onNext: unknown,
      onError: (error: Error) => void,
    ) => {
      onError( new Error( 'Documents snapshot failed for testing.' ) )
      return () => undefined
    } )

    render( <ProjectDocumentsPage /> )

    await waitFor( () => {
      expect(
        screen.getByText( 'Project documents failed to load: Documents snapshot failed for testing.' ),
      ).toBeTruthy()
    } )
  }, 15000 )
} )
