// src/lib/projectDisplay.test.ts: Verifies human-readable project labels never fall back to Firebase IDs.
import { describe, expect, it, vi } from 'vitest'

const firestoreMocks = vi.hoisted( () => ( {
  doc: vi.fn(),
  getDoc: vi.fn(),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  doc: firestoreMocks.doc,
  getDoc: firestoreMocks.getDoc,
} ) )

vi.mock( './firebase', () => ( {
  db: { name: 'test-db' },
} ) )

import { formatProjectDisplayLabel, loadProjectDisplayInfo } from './projectDisplay'

describe( 'project display labels', () => {
  it( 'prefers the project name and then its short ID without exposing the internal ID', () => {
    expect( formatProjectDisplayLabel( 'project-internal-1', { name: 'Quality review', shortId: 7 } ) )
      .toBe( 'Quality review' )
    expect( formatProjectDisplayLabel( 'project-internal-1', { name: '', shortId: 7 } ) )
      .toBe( 'Project 7' )
    expect( formatProjectDisplayLabel( 'project-internal-1', undefined ) ).toBe( 'Project' )
    expect( formatProjectDisplayLabel( 'all-projects', undefined ) ).toBe( 'All projects' )
  } )

  it( 'loads project names and short IDs keyed internally without returning raw IDs as labels', async () => {
    firestoreMocks.doc.mockImplementation( ( _db: unknown, collectionName: string, projectId: string ) => ( {
      collectionName,
      projectId,
    } ) )
    firestoreMocks.getDoc.mockResolvedValue( {
      exists: () => true,
      data: () => ( { name: 'Quality review', shortId: 7 } ),
    } )

    await expect( loadProjectDisplayInfo( [ 'project-internal-1' ] ) ).resolves.toEqual( {
      'project-internal-1': { name: 'Quality review', shortId: 7 },
    } )
  } )
} )
