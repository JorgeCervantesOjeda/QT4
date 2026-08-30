// src/lib/documentDerivation.test.ts
// Verifies derived-document domain rules that must stay consistent across UI and Firestore calls.
import { describe, expect, it } from 'vitest'
import {
  buildActiveConfiguration,
  canAcceptChangeRequestForLine,
  formatShortDocumentReference,
  isAcceptedDerivedDocumentForLine,
} from './documentDerivation'

describe( 'lib/documentDerivation', () => {
  it( 'builds one active configuration line from accepted change requests over the same external base', () => {
    const result = buildActiveConfiguration( [
      {
        documentId: 'change-request-a',
        versionId: 'version-a',
        projectId: 'target-project',
        documentType: 'changeRequest',
        baseProjectId: 'base-project',
        baseDocId: 'base-document',
        baseVersionId: 'base-version',
        status: 'Accepted',
      },
      {
        documentId: 'change-request-b',
        versionId: 'version-b',
        projectId: 'target-project',
        documentType: 'changeRequest',
        baseProjectId: 'base-project',
        baseDocId: 'base-document',
        baseVersionId: 'base-version',
        status: 'Accepted',
      },
      {
        documentId: 'change-request-c',
        versionId: 'version-c',
        projectId: 'target-project',
        documentType: 'changeRequest',
        baseProjectId: 'base-project',
        baseDocId: 'base-document',
        baseVersionId: 'base-version',
        status: 'Replaced',
      },
    ] )

    expect( result ).toEqual( [
      {
        key: 'target-project|base-project|base-document|base-version',
        variantProjectId: 'target-project',
        originProjectId: 'base-project',
        originDocumentId: 'base-document',
        originVersionId: 'base-version',
        changeRequestVersionIds: ['version-a', 'version-b'],
      },
    ] )
  } )

  it( 'rejects accepting another change request after the derived document was accepted for that line', () => {
    const decision = canAcceptChangeRequestForLine( {
      variantProjectId: 'target-project',
      originProjectId: 'base-project',
      originDocumentId: 'base-document',
      originVersionId: 'base-version',
      pendingDerivedGenerationCount: 0,
      derivedDocuments: [
        {
          type: 'derivedDocument',
          projectId: 'target-project',
          status: 'Accepted',
          originProjectId: 'base-project',
          originDocumentId: 'base-document',
          originVersionId: 'base-version',
        },
      ],
    } )

    expect( decision ).toEqual( {
      ok: false,
      reason: 'acceptedDerivedDocumentExists',
      message: 'This base already has an accepted derived document in the current project. Create an error report for the derived document instead.',
    } )
  } )

  it( 'allows accepting another change request while the derived variant is still in progress', () => {
    const decision = canAcceptChangeRequestForLine( {
      variantProjectId: 'target-project',
      originProjectId: 'base-project',
      originDocumentId: 'base-document',
      originVersionId: 'base-version',
      pendingDerivedGenerationCount: 0,
      derivedDocuments: [
        {
          type: 'derivedDocument',
          projectId: 'target-project',
          status: 'In Review',
          originProjectId: 'base-project',
          originDocumentId: 'base-document',
          originVersionId: 'base-version',
        },
      ],
    } )

    expect( decision ).toEqual( { ok: true } )
  } )

  it( 'rejects accepting a change request while a derived variant is being generated', () => {
    const decision = canAcceptChangeRequestForLine( {
      variantProjectId: 'target-project',
      originProjectId: 'base-project',
      originDocumentId: 'base-document',
      originVersionId: 'base-version',
      pendingDerivedGenerationCount: 1,
      derivedDocuments: [],
    } )

    expect( decision ).toEqual( {
      ok: false,
      reason: 'derivedGenerationInProgress',
      message: 'A derived variant is already being generated for this base. Wait until it finishes before accepting another change request.',
    } )
  } )

  it( 'formats project, document, and version with short visible identifiers', () => {
    expect( formatShortDocumentReference( {
      projectShortId: 12,
      documentShortId: 7,
      versionNumber: 300,
      title: 'Shared Requirements',
    } ) ).toBe( 'P12 / D7 / v3.00 - Shared Requirements' )
  } )

  it( 'matches accepted derived documents by origin line', () => {
    expect( isAcceptedDerivedDocumentForLine( {
      type: 'derivedDocument',
      projectId: 'target-project',
      status: 'Accepted',
      originProjectId: 'base-project',
      originDocumentId: 'base-document',
      originVersionId: 'base-version',
    }, {
      variantProjectId: 'target-project',
      originProjectId: 'base-project',
      originDocumentId: 'base-document',
      originVersionId: 'base-version',
    } ) ).toBe( true )
  } )
} )
