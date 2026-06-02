import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

  const {
    getDocMock,
    getDocsMock,
    loadAppRuntimeConfigMock,
    saveAppRuntimeConfigMock,
    lastAuditTableData,
    lastTaskTableData,
    currentUserState,
  } = vi.hoisted( () => ( {
    getDocMock: vi.fn(),
    getDocsMock: vi.fn(),
    loadAppRuntimeConfigMock: vi.fn(),
    saveAppRuntimeConfigMock: vi.fn(),
    lastAuditTableData: { current: [] as unknown[] },
    lastTaskTableData: { current: [] as unknown[] },
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
  default: ({ data, storageKey }: { data: unknown[]; storageKey?: string }) => {
    if( storageKey === 'qt4_table_audit_logs' ) {
      lastAuditTableData.current = data
    }
    if( storageKey === 'qt4_table_audit_tasks' ) {
      lastTaskTableData.current = data
    }
    return <div data-testid={storageKey === 'qt4_table_audit_tasks' ? 'audit-tasks-table' : 'audit-table'}>{data.length} rows</div>
  },
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

const getQueryWhereValue = ( queryArg: unknown, field: string ) => {
  if( !queryArg || typeof queryArg !== 'object' || !('kind' in queryArg) ) {
    return undefined
  }
  const record = queryArg as {
    kind?: string
    constraints?: Array<{ type?: string; field?: string; value?: unknown }>
  }
  if( record.kind !== 'query' ) {
    return undefined
  }
  return record.constraints?.find( ( constraint ) => constraint.type === 'where' && constraint.field === field )?.value
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

  it( 'shows the Files API connection summary for an admin user', async () => {
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

    render( <AdminAuditPage /> )

    expect( await screen.findByRole( 'heading', { name: 'Admin Audit' }, { timeout: 10000 } ) ).toBeTruthy()
    expect(
      await screen.findByText( /Connected: project demo-project, uid user-admin-1, email: admin@example.com/ ),
    ).toBeTruthy()
  }, 15000 )

  it( 'saves runtime providers with the selected values for an admin user', async () => {
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

    render( <AdminAuditPage /> )

    expect( await screen.findByRole( 'heading', { name: 'Admin Audit' }, { timeout: 10000 } ) ).toBeTruthy()
    fireEvent.change( screen.getByLabelText( 'File storage provider' ), {
      target: { value: 'firebase-storage' },
    } )
    fireEvent.change( screen.getByLabelText( 'Email provider' ), {
      target: { value: 'firebase-functions' },
    } )
    fireEvent.click( screen.getByRole( 'button', { name: 'Save providers' } ) )

    await waitFor( () => {
      expect( saveAppRuntimeConfigMock ).toHaveBeenCalledWith(
        {
          fileStorageProvider: 'firebase-storage',
          emailProvider: 'firebase-functions',
        },
        'user-admin-1',
      )
    } )
  }, 15000 )

  it( 'shows a visible runtime-config load error for an admin user', async () => {
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
    loadAppRuntimeConfigMock.mockRejectedValue( new Error( 'Runtime config fetch failed for testing.' ) )

    render( <AdminAuditPage /> )

    expect( await screen.findByRole( 'heading', { name: 'Admin Audit' }, { timeout: 10000 } ) ).toBeTruthy()
    expect(
      await screen.findByText( 'Runtime configuration failed to load: Runtime config fetch failed for testing.' ),
    ).toBeTruthy()
  }, 15000 )

  it( 'shows a visible date-range validation error when start date is after end date', async () => {
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

    render( <AdminAuditPage /> )

    expect( await screen.findByRole( 'heading', { name: 'Admin Audit' }, { timeout: 10000 } ) ).toBeTruthy()
    fireEvent.change( screen.getByLabelText( 'Start date' ), {
      target: { value: '2026-04-11' },
    } )
    fireEvent.change( screen.getByLabelText( 'End date' ), {
      target: { value: '2026-04-10' },
    } )
    fireEvent.click( screen.getByRole( 'button', { name: 'Run report' } ) )

    expect(
      await screen.findByText( 'Start date must be on or before end date.' ),
    ).toBeTruthy()
  }, 15000 )

  it( 'filters audit logs by actorId for the selected user', async () => {
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
        return createQuerySnapshot( [
          {
            id: 'audit-log-1',
            data: {
              actorId: 'user-admin-1',
              targetUserId: 'user-admin-1',
              action: 'updateVersion',
              entityType: 'version',
              entityId: 'version-1',
              createdAt: { toDate: () => new Date( '2026-04-10T12:00:00.000Z' ) },
            },
          },
        ] )
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

    await waitFor( () => {
      const auditLogsCall = getDocsMock.mock.calls.find( ( [ queryArg ] ) => getCollectionName( queryArg ) === 'auditLogs' )
      expect( auditLogsCall ).toBeTruthy()
      expect( getQueryWhereValue( auditLogsCall?.[0], 'actorId' ) ).toBe( 'user-admin-1' )
    } )
    expect( screen.getByTestId( 'audit-table' ).textContent ).toBe( '1 rows' )
    expect( lastAuditTableData.current ).toHaveLength( 1 )
    expect( lastAuditTableData.current[0] ).toEqual( expect.objectContaining( {
      id: 'audit-log-1',
      actorId: 'user-admin-1',
      targetUserId: 'user-admin-1',
      action: 'updateVersion',
      entityType: 'version',
      entityId: 'version-1',
    } ) )
  }, 15000 )

  it( 'renders audit activity for all users in the selected date range', async () => {
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
          {
            id: 'user-jorge-1',
            data: {
              userId: 'user-jorge-1',
              email: 'jorge.cervantes.ojeda@gmail.com',
              displayName: 'Jorge Cervantes Ojeda',
            },
          },
        ] )
      }
      if( collectionName === 'auditLogs' ) {
        return createQuerySnapshot( [
          {
            id: 'audit-log-admin-1',
            data: {
              actorId: 'user-admin-1',
              action: 'updateVersion',
              entityType: 'version',
              entityId: 'version-admin-1',
              createdAt: { toDate: () => new Date( '2026-02-15T09:00:00.000Z' ) },
            },
          },
          {
            id: 'audit-log-jorge-1',
            data: {
              actorId: 'user-jorge-1',
              action: 'updateVersion',
              entityType: 'version',
              entityId: 'version-jorge-1',
              createdAt: { toDate: () => new Date( '2026-02-15T10:00:00.000Z' ) },
            },
          },
          {
            id: 'audit-task-admin-appear',
            data: {
              actorId: 'user-admin-1',
              action: 'taskAppear',
              entityType: 'task',
              entityId: 'task-admin-1',
              metadata: {
                taskKey: 'task-admin-1',
                taskType: 'review',
              },
              createdAt: { toDate: () => new Date( '2026-02-15T10:30:00.000Z' ) },
            },
          },
          {
            id: 'audit-task-admin-complete',
            data: {
              actorId: 'user-admin-1',
              action: 'taskComplete',
              entityType: 'task',
              entityId: 'task-admin-1',
              metadata: {
                taskKey: 'task-admin-1',
                taskType: 'review',
              },
              createdAt: { toDate: () => new Date( '2026-02-15T11:00:00.000Z' ) },
            },
          },
          {
            id: 'audit-task-jorge-appear',
            data: {
              actorId: 'user-jorge-1',
              action: 'taskAppear',
              entityType: 'task',
              entityId: 'task-jorge-1',
              metadata: {
                taskKey: 'task-jorge-1',
                taskType: 'review',
              },
              createdAt: { toDate: () => new Date( '2026-02-15T11:30:00.000Z' ) },
            },
          },
          {
            id: 'audit-task-jorge-complete',
            data: {
              actorId: 'user-jorge-1',
              action: 'taskComplete',
              entityType: 'task',
              entityId: 'task-jorge-1',
              metadata: {
                taskKey: 'task-jorge-1',
                taskType: 'review',
              },
              createdAt: { toDate: () => new Date( '2026-02-15T12:00:00.000Z' ) },
            },
          },
        ] )
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

    fireEvent.change( screen.getByLabelText( 'User' ), {
      target: { value: '__all_users__' },
    } )
    fireEvent.change( screen.getByLabelText( 'Start date' ), {
      target: { value: '2026-02-01' },
    } )
    fireEvent.change( screen.getByLabelText( 'End date' ), {
      target: { value: '2026-02-28' },
    } )
    fireEvent.click( screen.getByRole( 'button', { name: 'Run report' } ) )

    await waitFor( () => {
      const auditLogsCall = getDocsMock.mock.calls.find( ( [ queryArg ] ) => getCollectionName( queryArg ) === 'auditLogs' )
      expect( auditLogsCall ).toBeTruthy()
      expect( getQueryWhereValue( auditLogsCall?.[0], 'actorId' ) ).toBeUndefined()
    } )
    expect( screen.getByTestId( 'audit-table' ).textContent ).toBe( '6 rows' )
    expect( lastAuditTableData.current ).toHaveLength( 6 )
    expect( lastAuditTableData.current ).toEqual( expect.arrayContaining( [
      expect.objectContaining( {
        actorId: 'user-jorge-1',
        actorLabel: 'Jorge Cervantes Ojeda (jorge.cervantes.ojeda@gmail.com)',
      } ),
      expect.objectContaining( {
        actorId: 'user-admin-1',
        actorLabel: 'Admin User (admin@example.com)',
      } ),
    ] ) )
    expect( screen.getByTestId( 'audit-tasks-table' ).textContent ).toBe( '2 rows' )
    expect( lastTaskTableData.current ).toHaveLength( 2 )
    expect( lastTaskTableData.current ).toEqual( expect.arrayContaining( [
      expect.objectContaining( {
        actorId: 'user-jorge-1',
        actorLabel: 'Jorge Cervantes Ojeda (jorge.cervantes.ojeda@gmail.com)',
      } ),
      expect.objectContaining( {
        actorId: 'user-admin-1',
        actorLabel: 'Admin User (admin@example.com)',
      } ),
    ] ) )
  }, 15000 )

  it( 'renders audit activity for a manually selected user and date range', async () => {
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
          {
            id: 'user-jorge-1',
            data: {
              userId: 'user-jorge-1',
              email: 'jorge.cervantes.ojeda@gmail.com',
              displayName: 'Jorge Cervantes Ojeda',
            },
          },
        ] )
      }
      if( collectionName === 'auditLogs' ) {
        return createQuerySnapshot( [
          {
            id: 'audit-log-jorge-1',
            data: {
              actorId: 'user-jorge-1',
              actorEmail: 'jorge.cervantes.ojeda@gmail.com',
              targetUserId: 'user-jorge-1',
              action: 'updateVersion',
              entityType: 'version',
              entityId: 'version-jorge-1',
              projectId: 'project-jorge-1',
              docId: 'document-jorge-1',
              versionId: 'version-jorge-1',
              createdAt: { toDate: () => new Date( '2026-02-15T10:00:00.000Z' ) },
            },
          },
        ] )
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

    fireEvent.change( screen.getByLabelText( 'User' ), {
      target: { value: 'user-jorge-1' },
    } )
    fireEvent.change( screen.getByLabelText( 'Start date' ), {
      target: { value: '2026-01-01' },
    } )
    fireEvent.change( screen.getByLabelText( 'End date' ), {
      target: { value: '2026-03-31' },
    } )
    fireEvent.click( screen.getByRole( 'button', { name: 'Run report' } ) )

    await waitFor( () => {
      const auditLogsCall = getDocsMock.mock.calls.find( ( [ queryArg ] ) => getCollectionName( queryArg ) === 'auditLogs' )
      expect( auditLogsCall ).toBeTruthy()
      expect( getQueryWhereValue( auditLogsCall?.[0], 'actorId' ) ).toBe( 'user-jorge-1' )
    } )
    expect( screen.getByTestId( 'audit-table' ).textContent ).toBe( '1 rows' )
    expect( lastAuditTableData.current ).toHaveLength( 1 )
    expect( lastAuditTableData.current[0] ).toEqual( expect.objectContaining( {
      id: 'audit-log-jorge-1',
      actorId: 'user-jorge-1',
      actorEmail: 'jorge.cervantes.ojeda@gmail.com',
      targetUserId: 'user-jorge-1',
      action: 'updateVersion',
      entityType: 'version',
      entityId: 'version-jorge-1',
      projectId: 'project-jorge-1',
      docId: 'document-jorge-1',
      versionId: 'version-jorge-1',
    } ) )
  }, 15000 )

  it( 'downloads the loaded audit report as CSV', async () => {
    currentUserState.user = {
      uid: 'user-admin-1',
      email: 'admin@example.com',
      displayName: 'Admin User',
      getIdToken: vi.fn().mockResolvedValue( 'admin-token' ),
    }
    const exportedBlobs: Blob[] = []
    const createObjectURLMock = vi.fn( ( blob: Blob ) => {
      exportedBlobs.push( blob )
      return 'blob:audit-csv'
    } )
    const revokeObjectURLMock = vi.fn()
    Object.defineProperty( URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURLMock,
    } )
    Object.defineProperty( URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURLMock,
    } )
    const anchorClickSpy = vi.spyOn( HTMLAnchorElement.prototype, 'click' ).mockImplementation( () => undefined )
    getDocMock.mockImplementation( async ( docRef: { collection: string; id: string } ) => {
      if( docRef.collection === 'userProfiles' && docRef.id === 'user-admin-1' ) {
        return createDocSnapshot( {
          id: 'user-admin-1',
          data: {
            isAdmin: true,
          },
        } )
      }
      if( docRef.collection === 'projects' && docRef.id === 'project-jorge-1' ) {
        return createDocSnapshot( {
          id: 'project-jorge-1',
          data: {
            name: 'Quality Project',
          },
        } )
      }
      if( docRef.collection === 'documents' && docRef.id === 'document-jorge-1' ) {
        return createDocSnapshot( {
          id: 'document-jorge-1',
          data: {
            shortId: 12,
            title: 'Audit Document',
            type: 'document',
          },
        } )
      }
      if( docRef.collection === 'versions' && docRef.id === 'version-jorge-1' ) {
        return createDocSnapshot( {
          id: 'version-jorge-1',
          data: {
            number: 1,
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
          {
            id: 'user-jorge-1',
            data: {
              userId: 'user-jorge-1',
              email: 'jorge.cervantes.ojeda@gmail.com',
              displayName: 'Jorge Cervantes Ojeda',
            },
          },
        ] )
      }
      if( collectionName === 'auditLogs' ) {
        return createQuerySnapshot( [
          {
            id: 'audit-log-jorge-1',
            data: {
              actorId: 'user-jorge-1',
              actorEmail: 'jorge.cervantes.ojeda@gmail.com',
              targetUserId: 'user-admin-1',
              action: 'updateVersion',
              entityType: 'version',
              entityId: 'version-jorge-1',
              projectId: 'project-jorge-1',
              docId: 'document-jorge-1',
              versionId: 'version-jorge-1',
              metadata: {
                note: 'Moved, approved',
              },
              createdAt: { toDate: () => new Date( '2026-02-15T10:00:00.000Z' ) },
            },
          },
        ] )
      }
      return createQuerySnapshot( [] )
    } )

    render( <AdminAuditPage /> )

    expect( await screen.findByRole( 'heading', { name: 'Admin Audit' }, { timeout: 10000 } ) ).toBeTruthy()
    await waitFor( () => {
      expect( ( screen.getByLabelText( 'User' ) as HTMLSelectElement ).value ).toBe( 'user-admin-1' )
    } )
    fireEvent.change( screen.getByLabelText( 'User' ), {
      target: { value: 'user-jorge-1' },
    } )
    fireEvent.change( screen.getByLabelText( 'Start date' ), {
      target: { value: '2026-02-01' },
    } )
    fireEvent.change( screen.getByLabelText( 'End date' ), {
      target: { value: '2026-02-28' },
    } )
    fireEvent.click( screen.getByRole( 'button', { name: 'Run report' } ) )

    await waitFor( () => {
      expect( screen.getByTestId( 'audit-table' ).textContent ).toBe( '1 rows' )
    } )
    fireEvent.click( screen.getByRole( 'button', { name: 'Download CSV' } ) )

    expect( createObjectURLMock ).toHaveBeenCalled()
    expect( anchorClickSpy ).toHaveBeenCalled()
    expect( revokeObjectURLMock ).toHaveBeenCalledWith( 'blob:audit-csv' )
    expect( exportedBlobs ).toHaveLength( 1 )
    const csvText = await exportedBlobs[0].text()
    expect( csvText ).toContain( 'when,actor,actorEmail,action,entityType,project,document,version,threadOrComment,targetUser,entityId,metadata' )
    expect( csvText ).toContain( '2026-02-15T10:00:00.000Z,Jorge Cervantes Ojeda (jorge.cervantes.ojeda@gmail.com),jorge.cervantes.ojeda@gmail.com,updateVersion,version,Quality Project,12 - Audit Document,0.01,-,Admin User (admin@example.com),version-jorge-1' )
    expect( csvText ).toContain( '""Moved, approved""' )
  }, 15000 )
} )
