import { describe, expect, it } from 'vitest'
import {
  acceptLatestRevision,
  createFirstVersion,
  createNextVersion,
  rejectDocument,
  type DocumentAggregate,
} from './useCases'
import type { Document, DocumentVersion } from './types'

const NOW = '2026-04-03T18:00:00.000Z'

const buildDocument = (): Document => ( {
  id: 'doc-1',
  projectId: 'project-1',
  title: 'Specification',
  createdBy: 'user-1',
  createdAt: '2026-04-01T10:00:00.000Z',
  updatedAt: '2026-04-01T10:00:00.000Z',
} )

const buildVersion = (overrides: Partial<DocumentVersion>): DocumentVersion => ( {
  id: overrides.id ?? 'version-1',
  documentId: overrides.documentId ?? 'doc-1',
  versionNumber: overrides.versionNumber ?? 1,
  state: overrides.state ?? 'In Creation',
  createdBy: overrides.createdBy ?? 'user-1',
  reviewerIds: overrides.reviewerIds ?? [],
  reviewStartAt: overrides.reviewStartAt ?? null,
  reviewEndAt: overrides.reviewEndAt ?? null,
  createdAt: overrides.createdAt ?? '2026-04-01T10:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-04-01T10:00:00.000Z',
  fileRefId: overrides.fileRefId ?? null,
  hasFile: overrides.hasFile ?? false,
  acceptedErrorReportId: overrides.acceptedErrorReportId ?? null,
} )

describe( 'domain/useCases', () => {
  it( 'creates the first draft version for a new document', () => {
    const result = createFirstVersion( buildDocument(), 'version-1', 'user-2', NOW )

    expect( result.ok ).toBe( true )
    expect( result.error ).toBeNull()
    expect( result.data?.version.versionNumber ).toBe( 1 )
    expect( result.data?.version.state ).toBe( 'In Creation' )
    expect( result.data?.version.createdBy ).toBe( 'user-2' )
    expect( result.data?.document.updatedAt ).toBe( NOW )
  } )

  it( 'increments the latest draft version number when creating the next version', () => {
    const aggregate: DocumentAggregate = {
      document: buildDocument(),
      versions: [
        buildVersion( { id: 'version-1', versionNumber: 1 } ),
        buildVersion( { id: 'version-2', versionNumber: 2 } ),
      ],
    }

    const result = createNextVersion( aggregate, 'version-3', 'user-3', NOW )

    expect( result.ok ).toBe( true )
    expect( result.data?.version.versionNumber ).toBe( 3 )
    expect( result.data?.version.state ).toBe( 'In Creation' )
    expect( result.data?.version.createdBy ).toBe( 'user-3' )
  } )

  it( 'accepts the latest revision and replaces the previous accepted baseline', () => {
    const aggregate: DocumentAggregate = {
      document: buildDocument(),
      versions: [
        buildVersion( {
          id: 'accepted-1',
          versionNumber: 100,
          state: 'Accepted',
        } ),
        buildVersion( {
          id: 'latest-review',
          versionNumber: 101,
          state: 'Reviewed',
        } ),
      ],
    }

    const result = acceptLatestRevision( aggregate, 'latest-review', NOW )

    expect( result.ok ).toBe( true )
    expect( result.error ).toBeNull()
    expect( result.data?.acceptedVersionId ).toBe( 'latest-review' )
    expect( result.data?.replacedVersionId ).toBe( 'accepted-1' )
    expect( result.data?.versions.find( ( version ) => version.id === 'latest-review' ) ).toMatchObject( {
      versionNumber: 200,
      state: 'Accepted',
      updatedAt: NOW,
    } )
    expect( result.data?.versions.find( ( version ) => version.id === 'accepted-1' ) ).toMatchObject( {
      state: 'Replaced',
      updatedAt: NOW,
    } )
  } )

  it( 'rejects attempts to accept a non-latest revision', () => {
    const aggregate: DocumentAggregate = {
      document: buildDocument(),
      versions: [
        buildVersion( { id: 'version-1', versionNumber: 1 } ),
        buildVersion( { id: 'version-2', versionNumber: 2 } ),
      ],
    }

    const result = acceptLatestRevision( aggregate, 'version-1', NOW )

    expect( result ).toEqual( {
      ok: false,
      error: 'Version is not latest',
      data: null,
    } )
  } )

  it( 'rejects the latest revision and marks the previous accepted version as replaced', () => {
    const aggregate: DocumentAggregate = {
      document: buildDocument(),
      versions: [
        buildVersion( {
          id: 'accepted-1',
          versionNumber: 100,
          state: 'Accepted',
        } ),
        buildVersion( {
          id: 'latest-review',
          versionNumber: 101,
          state: 'In Review',
        } ),
      ],
    }

    const result = rejectDocument( aggregate, 'latest-review', NOW )

    expect( result.ok ).toBe( true )
    expect( result.error ).toBeNull()
    expect( result.data?.rejectedVersionId ).toBe( 'latest-review' )
    expect( result.data?.replacedVersionId ).toBe( 'accepted-1' )
    expect( result.data?.versions.find( ( version ) => version.id === 'latest-review' ) ).toMatchObject( {
      state: 'Rejected',
      updatedAt: NOW,
    } )
    expect( result.data?.versions.find( ( version ) => version.id === 'accepted-1' ) ).toMatchObject( {
      state: 'Replaced',
      updatedAt: NOW,
    } )
  } )
} )
