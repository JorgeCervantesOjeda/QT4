// src/pages/versions/VersionsHeader.test.tsx
// Verifies document identity labels in the versions page header.
import { render, screen } from '@testing-library/react'
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
          title: 'Shared Requirements',
          shortId: 9,
        }}
        canEditDocumentTitle={false}
        isBusy={false}
        onEditDocumentTitle={() => undefined}
      />,
    )

    expect( screen.getByText( 'Change request' ) ).toBeTruthy()
    expect( screen.getByText( '31 - Beta client requirements' ) ).toBeTruthy()
    expect( screen.getByText( 'This document is a change request for:' ) ).toBeTruthy()
    expect( screen.getByText( '9 - Shared Requirements' ) ).toBeTruthy()
  } )
} )
