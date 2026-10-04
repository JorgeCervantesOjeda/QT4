// src/pages/versions/VersionListPanel.test.tsx
// Verifies the versions list integration with the focus-context carousel.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import VersionListPanel from './VersionListPanel'
import type { VersionSummary } from './types'

const versions: VersionSummary[] = [
  {
    id: 'version-1',
    number: 1,
    status: 'Accepted',
    createdBy: 'author-1',
    reviewerIds: [],
    reviewDurationDays: 2,
    hasFile: true,
    fileRefId: null,
    numThreads: 1,
    numOpenThreads: 0,
    numComments: 2,
    numThreadsWithTwoPlusComments: 0,
    acceptedErrorReportId: null,
  },
  {
    id: 'version-2',
    number: 2,
    status: 'In Review',
    createdBy: 'author-2',
    reviewerIds: [ 'reviewer-1' ],
    reviewDurationDays: 3,
    hasFile: false,
    fileRefId: null,
    numThreads: 0,
    numOpenThreads: 0,
    numComments: 0,
    numThreadsWithTwoPlusComments: 0,
    acceptedErrorReportId: null,
  },
]

describe( 'VersionListPanel', () => {
  it( 'selects versions from focus navigation', () => {
    const openReviewIssuesForVersion = vi.fn()
    render(
      <VersionListPanel
        docId="doc-1"
        versions={versions}
        selectedVersion={versions[0]}
        versionColumns={[]}
        versionSorting={[]}
        viewMode="focus"
        isBusy={false}
        isLoadingVersions={false}
        downloadStatus="idle"
        clockNowMs={Date.now()}
        formatUserLabel={( userId ) => userId}
        getVersionDownloadProvider={() => null}
        versionFileRefsById={{}}
        versionStatusClassName={() => ''}
        setVersionSorting={vi.fn()}
        openReviewIssuesForVersion={openReviewIssuesForVersion}
        requestDownloadVersionFile={vi.fn()}
      />,
    )

    expect( screen.getByRole( 'region', { name: 'Document versions in focus view' } ) ).toBeTruthy()
    expect( screen.getByRole( 'button', { name: /Version 0\.01/u } ) ).toBeTruthy()

    fireEvent.click( screen.getByRole( 'button', { name: 'Next item' } ) )

    expect( openReviewIssuesForVersion ).toHaveBeenCalledWith( 'version-2' )
  } )
} )
