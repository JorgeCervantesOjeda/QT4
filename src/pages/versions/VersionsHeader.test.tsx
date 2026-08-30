// src/pages/versions/VersionsHeader.test.tsx
// Verifies document identity labels in the versions page header.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import VersionsHeader from './VersionsHeader'

vi.mock( '../../components/AppBrand', () => ( {
  default: ({ pageTitle }: { pageTitle: string }) => <h1>{pageTitle}</h1>,
} ) )

vi.mock( '../../components/BackStack', () => ( {
  default: () => null,
} ) )

describe( 'versions/VersionsHeader', () => {
  it( 'labels change requests and shows their base document context', () => {
    render(
      <VersionsHeader
        projectId="project-1"
        projectName="Target Project"
        projectShortId={42}
        documentData={{
          id: 'change-request-1',
          projectId: 'project-1',
          title: 'Beta client requirements',
          createdBy: 'user-1',
          type: 'changeRequest',
          shortId: 31,
          baseProjectId: 'project-2',
          baseDocId: 'base-document-1',
          baseVersionId: 'base-version-1',
        }}
        baseDocumentData={{
          id: 'base-document-1',
          projectId: 'project-2',
          projectShortId: 12,
          title: 'Shared Requirements',
          shortId: 9,
          versionId: 'base-version-1',
          versionNumber: 100,
          versionStatus: 'Accepted',
          hasFile: true,
          fileRefId: 'file-1',
        }}
        canEditDocumentTitle={false}
        isBusy={false}
        onEditDocumentTitle={() => undefined}
        onDownloadBaseDocument={() => undefined}
      />,
    )

    expect( screen.getByText( 'Change request' ) ).toBeTruthy()
    expect( screen.getByText( '31 - Beta client requirements' ) ).toBeTruthy()
    expect( screen.getByText( 'This document is a change request for:' ) ).toBeTruthy()
    expect( screen.getByText( 'P12 / D9 / v1.00 - Shared Requirements' ) ).toBeTruthy()
  } )

  it( 'links change requests to the base document page and direct download action', () => {
    const downloadBaseDocument = vi.fn()

    render(
      <VersionsHeader
        projectId="project-1"
        projectName="Target Project"
        projectShortId={42}
        documentData={{
          id: 'change-request-1',
          projectId: 'project-1',
          title: 'Beta client requirements',
          createdBy: 'user-1',
          type: 'changeRequest',
          shortId: 31,
          baseProjectId: 'project-2',
          baseDocId: 'base-document-1',
          baseVersionId: 'base-version-1',
        }}
        baseDocumentData={{
          id: 'base-document-1',
          projectId: 'project-2',
          projectShortId: 12,
          title: 'Shared Requirements',
          shortId: 9,
          versionId: 'base-version-1',
          versionNumber: 100,
          versionStatus: 'Accepted',
          hasFile: true,
          fileRefId: 'file-1',
        }}
        canEditDocumentTitle={false}
        isBusy={false}
        onEditDocumentTitle={() => undefined}
        onDownloadBaseDocument={downloadBaseDocument}
      />,
    )

    expect( screen.getByRole( 'link', { name: 'Open base document' } ).getAttribute( 'href' ) )
      .toBe( '/documents/base-document-1/versions?projectId=project-2&versionId=base-version-1' )

    fireEvent.click( screen.getByRole( 'button', { name: 'Download base document' } ) )

    expect( downloadBaseDocument ).toHaveBeenCalledOnce()
  } )

  it( 'labels derived variants and links to their origin version', () => {
    render(
      <VersionsHeader
        projectId="project-1"
        projectName="Target Project"
        projectShortId={42}
        documentData={{
          id: 'derived-document-1',
          projectId: 'project-1',
          title: 'Beta derived requirements',
          createdBy: 'user-1',
          type: 'derivedDocument',
          shortId: 32,
          originProjectId: 'project-2',
          originDocumentId: 'base-document-1',
          originVersionId: 'base-version-1',
          incorporatedChangeRequestVersionIds: ['change-request-version-1'],
        }}
        baseDocumentData={{
          id: 'base-document-1',
          projectId: 'project-2',
          projectShortId: 12,
          title: 'Shared Requirements',
          shortId: 9,
          versionId: 'base-version-1',
          versionNumber: 100,
          versionStatus: 'Accepted',
          hasFile: true,
          fileRefId: 'file-1',
        }}
        canEditDocumentTitle={false}
        isBusy={false}
        onEditDocumentTitle={() => undefined}
        onDownloadBaseDocument={() => undefined}
      />,
    )

    expect( screen.getByText( 'Derived variant' ) ).toBeTruthy()
    expect( screen.getByText( 'This document is derived from:' ) ).toBeTruthy()
    expect( screen.getByText( 'P12 / D9 / v1.00 - Shared Requirements' ) ).toBeTruthy()
    expect( screen.getByRole( 'link', { name: 'Open base document' } ).getAttribute( 'href' ) )
      .toBe( '/documents/base-document-1/versions?projectId=project-2&versionId=base-version-1' )
  } )
} )
