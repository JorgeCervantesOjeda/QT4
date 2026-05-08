import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  addDocMock,
  collectionMock,
  serverTimestampMock,
  dbMock,
} = vi.hoisted( () => ( {
  addDocMock: vi.fn(),
  collectionMock: vi.fn( (db: unknown, ...segments: string[]) => ( {
    db,
    path: segments.join( '/' ),
  } ) ),
  serverTimestampMock: vi.fn( () => 'SERVER_TIMESTAMP' ),
  dbMock: { name: 'db' },
} ) )

vi.mock( 'firebase/firestore', () => ( {
  addDoc: addDocMock,
  collection: collectionMock,
  serverTimestamp: serverTimestampMock,
} ) )

vi.mock( './firebase', () => ( {
  db: dbMock,
} ) )

import { logAudit } from './audit'

describe( 'lib/audit', () => {
  afterEach( () => {
    vi.clearAllMocks()
  } )

  it( 'skips audit writes when actorId is missing', async () => {
    await logAudit( {
      actorId: '',
      action: 'updateVersion',
      entityType: 'version',
      entityId: 'version-1',
    } )

    expect( addDocMock ).not.toHaveBeenCalled()
  } )

  it( 'writes the audit entry with a server timestamp', async () => {
    addDocMock.mockResolvedValueOnce( undefined )

    await logAudit( {
      actorId: 'user-member-1',
      actorEmail: 'member@example.com',
      action: 'updateVersion',
      entityType: 'version',
      entityId: 'version-1',
      projectId: 'project-1',
    } )

    expect( collectionMock ).toHaveBeenCalledWith( dbMock, 'auditLogs' )
    expect( serverTimestampMock ).toHaveBeenCalledTimes( 1 )
    expect( addDocMock ).toHaveBeenCalledWith(
      expect.objectContaining( { path: 'auditLogs' } ),
      expect.objectContaining( {
        actorId: 'user-member-1',
        actorEmail: 'member@example.com',
        action: 'updateVersion',
        entityType: 'version',
        entityId: 'version-1',
        projectId: 'project-1',
        createdAt: 'SERVER_TIMESTAMP',
      } ),
    )
  } )

  it( 'warns instead of failing when the audit write fails', async () => {
    addDocMock.mockRejectedValueOnce( new Error( 'audit down' ) )
    const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => undefined )

    await expect(
      logAudit( {
        actorId: 'user-member-1',
        action: 'updateVersion',
        entityType: 'version',
        entityId: 'version-1',
      } ),
    ).resolves.toBeUndefined()

    expect( warnSpy ).toHaveBeenCalledWith( 'Audit log write failed:', expect.any( Error ) )
  } )
} )
