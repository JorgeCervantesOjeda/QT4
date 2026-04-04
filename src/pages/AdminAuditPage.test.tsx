import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDocMock,
  getDocsMock,
  loadAppRuntimeConfigMock,
  saveAppRuntimeConfigMock,
  currentUserState,
} = vi.hoisted( () => ( {
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  loadAppRuntimeConfigMock: vi.fn(),
  saveAppRuntimeConfigMock: vi.fn(),
  currentUserState: {
    user: {
      uid: 'user-member-1',
      email: 'member@example.com',
      displayName: 'Member User',
      getIdToken: vi.fn().mockResolvedValue( 'member-token' ),
    },
  },
} ) )

vi.mock( 'firebase/firestore', () => ( {
  collection: ( db: unknown, name: string ) => ( { kind: 'collection', db, name } ),
  doc: ( db: unknown, collectionName: string, id: string ) => ( { kind: 'doc', db, collection: collectionName, id } ),
  getDoc: (...args: unknown[]) => getDocMock( ...args ),
  getDocs: (...args: unknown[]) => getDocsMock( ...args ),
  orderBy: ( field: string, direction: string ) => ( { type: 'orderBy', field, direction } ),
  query: ( base: unknown, ...constraints: unknown[] ) => ( { kind: 'query', base, constraints } ),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn( () => 'server-timestamp' ),
  Timestamp: {
    fromDate: ( value: Date ) => value,
  },
  where: ( field: string, op: string, value: unknown ) => ( { type: 'where', field, op, value } ),
  writeBatch: vi.fn(),
} ) )

vi.mock( '../auth/useAuth', () => ( {
  useAuth: () => ( {
    user: currentUserState.user,
  } ),
} ) )

vi.mock( '../components/AppBrand', () => ( {
  default: ({ pageTitle }: { pageTitle: string }) => <h1>{pageTitle}</h1>,
} ) )

vi.mock( '../components/BackStack', () => ( {
  default: () => null,
} ) )

vi.mock( '../components/DataTable', () => ( {
  default: ({ data }: { data: unknown[] }) => <div data-testid="audit-table">{data.length} rows</div>,
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

vi.mock( 'react-big-calendar', () => ( {
  Calendar: () => <div data-testid="calendar" />,
  dateFnsLocalizer: () => ( {} ),
} ) )

vi.mock( '../lib/errorChecklistBuilders', () => ( {
  buildAdminAuditErrorChecklist: () => [],
} ) )

vi.mock( '../lib/filesApi', () => ( {
  buildFilesApiUrl: ( path: string ) => `https://files.example.test${path}`,
  getFilesApiConfigSummary: () => 'proxy (/files-api)',
} ) )

vi.mock( '../lib/firebase', () => ( {
  db: { kind: 'db' },
} ) )

vi.mock( '../lib/runtimeConfig', () => ( {
  formatRuntimeConfigSummary: (config: { fileStorageProvider: string; emailProvider: string }) =>
    `Files: ${config.fileStorageProvider}; Email: ${config.emailProvider}`,
  getDefaultAppRuntimeConfig: () => ( {
    fileStorageProvider: 'files-api',
    emailProvider: 'files-api',
  } ),
  loadAppRuntimeConfig: (...args: unknown[]) => loadAppRuntimeConfigMock( ...args ),
  saveAppRuntimeConfig: (...args: unknown[]) => saveAppRuntimeConfigMock( ...args ),
} ) )

import AdminAuditPage from './AdminAuditPage'

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

const mockFetchOk = () => {
  vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( {
    ok: true,
    status: 200,
    json: async () => ( {
      projectId: 'demo-project',
      firebaseUid: currentUserState.user.uid,
      firebaseEmail: currentUserState.user.email,
      defaultExpireAfterDays: 30,
    } ),
  } ) )
}

describe( 'pages/AdminAuditPage', () => {
  beforeEach( () => {
    vi.clearAllMocks()
    currentUserState.user = {
      uid: 'user-member-1',
      email: 'member@example.com',
      displayName: 'Member User',
      getIdToken: vi.fn().mockResolvedValue( 'member-token' ),
    }
    loadAppRuntimeConfigMock.mockResolvedValue( {
      config: {
        fileStorageProvider: 'files-api',
        emailProvider: 'files-api',
      },
      source: 'defaults',
    } )
    saveAppRuntimeConfigMock.mockResolvedValue( undefined )
    getDocMock.mockImplementation( async ( docRef: { collection: string; id: string } ) => {
      if( docRef.collection === 'userProfiles' && docRef.id === currentUserState.user.uid ) {
        return createMissingSnapshot( docRef.id )
      }
      return createMissingSnapshot( docRef.id )
    } )
    getDocsMock.mockImplementation( async ( queryArg: unknown ) => {
      const collectionName = getCollectionName( queryArg )
      if( collectionName === 'userDirectory' ) {
        return createQuerySnapshot( [] )
      }
      if( collectionName === 'auditLogs' ) {
        return createQuerySnapshot( [] )
      }
      return createQuerySnapshot( [] )
    } )
    mockFetchOk()
  } )

  it( 'hides admin-only sections for a non-admin user', async () => {
    render( <AdminAuditPage /> )

    expect( await screen.findByRole( 'heading', { name: 'My Activity' }, { timeout: 10000 } ) ).toBeTruthy()
    expect( screen.queryByText( 'Files API status' ) ).toBeNull()
    expect( screen.queryByText( 'Runtime providers' ) ).toBeNull()
    expect( screen.queryByText( 'Data model update' ) ).toBeNull()
    expect( screen.queryByText( 'Legacy timestamp repair' ) ).toBeNull()
    expect( screen.getByText( 'Audit report' ) ).toBeTruthy()
  }, 15000 )

  it( 'shows empty audit and task states for an admin report with no matching logs', async () => {
    currentUserState.user = {
      uid: 'user-admin-1',
      email: 'admin@example.com',
      displayName: 'Admin User',
      getIdToken: vi.fn().mockResolvedValue( 'admin-token' ),
    }
    getDocMock.mockImplementation( async ( docRef: { collection: string; id: string } ) => {
      if( docRef.collection === 'userProfiles' && docRef.id === 'user-admin-1' ) {
        return createDocSnapshot( {
          id: 'user-admin-1',
          data: {
            isAdmin: true,
          },
        } )
      }
      return createMissingSnapshot( docRef.id )
    } )
    getDocsMock.mockImplementation( async ( queryArg: unknown ) => {
      const collectionName = getCollectionName( queryArg )
      if( collectionName === 'userDirectory' ) {
        return createQuerySnapshot( [
          {
            id: 'user-admin-1',
            data: {
              userId: 'user-admin-1',
              email: 'admin@example.com',
              displayName: 'Admin User',
            },
          },
        ] )
      }
      if( collectionName === 'auditLogs' ) {
        return createQuerySnapshot( [] )
      }
      return createQuerySnapshot( [] )
    } )
    loadAppRuntimeConfigMock.mockResolvedValue( {
      config: {
        fileStorageProvider: 'firebase-storage',
        emailProvider: 'files-api',
      },
      source: 'firestore',
    } )

    render( <AdminAuditPage /> )

    expect( await screen.findByRole( 'heading', { name: 'Admin Audit' }, { timeout: 10000 } ) ).toBeTruthy()
    await waitFor( () => {
      expect( ( screen.getByLabelText( 'User' ) as HTMLSelectElement ).value ).toBe( 'user-admin-1' )
    } )

    fireEvent.change( screen.getByLabelText( 'Start date' ), {
      target: { value: '2026-04-10' },
    } )
    fireEvent.change( screen.getByLabelText( 'End date' ), {
      target: { value: '2026-04-11' },
    } )
    fireEvent.click( screen.getByRole( 'button', { name: 'Run report' } ) )

    expect( await screen.findByText( /No audit entries for range:/, {}, { timeout: 10000 } ) ).toBeTruthy()
    expect( screen.getByText( '0 entries' ) ).toBeTruthy()
    expect( screen.getByText( 'No task lifecycle data for the selected range.' ) ).toBeTruthy()
  }, 15000 )
} )
