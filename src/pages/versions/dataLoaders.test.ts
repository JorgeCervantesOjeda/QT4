// src/pages/versions/dataLoaders.test.ts: Verifies base-document summary resolution for error reports.
import { describe, expect, it } from 'vitest'
import { buildBaseDocumentSummary } from './dataLoaders'

describe( 'versions/dataLoaders', () => {
  it( 'uses the referenced version project when no base project id is stored', () => {
    expect( buildBaseDocumentSummary( {
      baseDocId: 'base-document-1',
      baseDocumentData: {
        id: 'base-document-1',
        projectId: 'project-1',
        title: 'Clase 1',
        shortId: 1,
      },
      baseProjectId: null,
      baseProjectData: { shortId: 372 },
      baseVersionId: 'base-version-1',
      baseVersionData: {
        projectId: 'project-1',
        docId: 'base-document-1',
        number: 100,
        status: 'Accepted',
      },
    } ) ).toMatchObject( {
      projectId: 'project-1',
      projectShortId: 372,
      title: 'Clase 1',
      shortId: 1,
      versionId: 'base-version-1',
      versionNumber: 100,
      versionStatus: 'Accepted',
    } )
  } )
} )
