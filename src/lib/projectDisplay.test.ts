// src/lib/projectDisplay.test.ts: Verifies human-readable project labels never fall back to Firebase IDs.
import { describe, expect, it, vi } from 'vitest'

const firestoreMocks = vi.hoisted( () => ( {
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
} ) )

vi.mock( 'firebase/firestore', () => ( {
  collection: firestoreMocks.collection,
  doc: firestoreMocks.doc,
  getDoc: firestoreMocks.getDoc,
  getDocs: firestoreMocks.getDocs,
  query: firestoreMocks.query,
  where: firestoreMocks.where,
} ) )

vi.mock( './firebase', () => ( {
  db: { name: 'test-db' },
} ) )

import {
  formatProjectDisplayLabel,
  getProjectContributionPath,
  loadProjectDisplayInfo,
  resolveProjectReference,
} from './projectDisplay'

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

  it( 'builds contribution routes from short IDs only', () => {
    expect( getProjectContributionPath( { name: 'Quality review', shortId: 7 } ) )
      .toBe( '/projects/7/contribution' )
    expect( getProjectContributionPath( { name: 'Quality review', shortId: null } ) ).toBeNull()
  } )

  it( 'resolves a short project reference to the internal project for data loading', async () => {
    const projectCollection = { collectionName: 'projects' }
    const shortIdFilter = { field: 'shortId', operator: '==', value: 7 }
    firestoreMocks.collection.mockReturnValue( projectCollection )
    firestoreMocks.where.mockReturnValue( shortIdFilter )
    firestoreMocks.query.mockReturnValue( { projectCollection, shortIdFilter } )
    firestoreMocks.getDocs.mockResolvedValue( {
      docs: [ {
        id: 'project-internal-1',
        data: () => ( { name: 'Quality review', shortId: 7 } ),
      } ],
    } )

    await expect( resolveProjectReference( '7' ) ).resolves.toEqual( {
      projectId: 'project-internal-1',
      displayInfo: { name: 'Quality review', shortId: 7 },
    } )
    expect( firestoreMocks.where ).toHaveBeenCalledWith( 'shortId', '==', 7 )
  } )
} )
