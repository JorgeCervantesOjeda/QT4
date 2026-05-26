// Version list/table presenter with download and selection controls.
import type { ColumnDef, OnChangeFn, SortingState } from '@tanstack/react-table'
import DataTable from '../../components/DataTable'
import {
  versionNumberToString,
  type FileStorageProviderKind,
} from '../../domain/types'
import { formatApproxCountdown } from '../../lib/reviewWindow'
import { formatTimeAgoWithTimestamp, formatTimestamp } from '../../lib/time'
import type { VersionSummary } from './types'
import {
  formatStorageProviderLabel,
  hasLinkedFileMetadata,
} from './utils'

type VersionListPanelProps = {
  docId: string | undefined
  versions: VersionSummary[]
  selectedVersion: VersionSummary | null
  versionColumns: ColumnDef<VersionSummary, unknown>[]
  versionSorting: SortingState
  viewMode: 'card' | 'table'
  isBusy: boolean
  isLoadingVersions: boolean
  downloadStatus: 'idle' | 'downloading' | 'success' | 'error'
  clockNowMs: number
  formatUserLabel: (userId: string) => string
  getVersionDownloadProvider: (version: VersionSummary) => FileStorageProviderKind | null
  versionStatusClassName: (version: VersionSummary) => string
  setVersionSorting: OnChangeFn<SortingState>
  openReviewIssuesForVersion: (versionId: string) => void
  requestDownloadVersionFile: (version: VersionSummary) => void
}

function VersionListPanel( {
  docId,
  versions,
  selectedVersion,
  versionColumns,
  versionSorting,
  viewMode,
  isBusy,
  isLoadingVersions,
  downloadStatus,
  clockNowMs,
  formatUserLabel,
  getVersionDownloadProvider,
  versionStatusClassName,
  setVersionSorting,
  openReviewIssuesForVersion,
  requestDownloadVersionFile,
}: VersionListPanelProps ) {
  if( !isBusy && !isLoadingVersions && versions.length === 0 ) {
    return <p className="muted">No versions yet.</p>
  }

  if( viewMode === 'table' ) {
    return (
      <DataTable
        key={`qt4_table_versions_${docId ?? 'unknown'}`}
        columns={versionColumns}
        data={versions}
        sorting={versionSorting}
        onSortingChange={setVersionSorting}
        tableClassName="data-table--versions"
        storageKey={`qt4_table_versions_${docId ?? 'unknown'}`}
        getRowClassName={( row ) => `${versionStatusClassName( row )} ${
          selectedVersion?.id === row.id ? 'data-table-row--selected' : ''
        }`.trim()}
        onRowClick={( row ) => openReviewIssuesForVersion( row.id )}
      />
    )
  }

  return (
    <div className="project-grid">
      {versions.map( ( version ) => {
        const isSelected = selectedVersion?.id === version.id
        return (
          <article
            key={version.id}
            className={`project-card version-card ${versionStatusClassName( version )} ${
              isSelected ? 'project-card--selected' : ''
            }`}
            onClick={() => openReviewIssuesForVersion( version.id )}
            role="button"
            tabIndex={0}
            onKeyDown={( event ) => {
              if( event.key === 'Enter' || event.key === ' ' ) {
                event.preventDefault()
                openReviewIssuesForVersion( version.id )
              }
            }}
          >
            <h3>Version {versionNumberToString( version.number )}</h3>
            <p className="muted">{version.status}</p>
            <p className="muted">Author: {formatUserLabel( version.createdBy )}</p>
            <p className="muted">Created: {formatTimeAgoWithTimestamp( version.createdAt )}</p>
            <p className="muted">Last activity: {formatTimeAgoWithTimestamp( version.activityAt ?? version.createdAt )}</p>
            <p className="muted">Reviewers: {version.reviewerIds.length}</p>
            <p className="muted">
              Issues: {version.numThreads} - Open: {version.numOpenThreads} - Comments: {version.numComments}
            </p>
            <p className="muted">
              Uploaded: {!version.hasFile ? 'No' : version.fileRefId ? 'Yes' : 'Missing metadata'}
            </p>
            <p className="muted">
              Review period:{' '}
              {version.status !== 'In Review'
                ? '-'
                : !version.reviewEndAt
                  ? 'No expiration'
                  : version.reviewEndAt.getTime() <= clockNowMs
                    ? `Main window ended (${formatTimestamp( version.reviewEndAt )})`
                    : `${formatApproxCountdown( version.reviewEndAt.getTime() - clockNowMs )} (${formatTimestamp( version.reviewEndAt )})`}
            </p>
            {hasLinkedFileMetadata( version ) ? (
              <div className="actions">
                <button
                  type="button"
                  onClick={( event ) => {
                    event.stopPropagation()
                    requestDownloadVersionFile( version )
                  }}
                  onKeyDown={( event ) => event.stopPropagation()}
                  disabled={isBusy || downloadStatus === 'downloading'}
                >
                  Download file
                </button>
                <span className="download-provider-hint">
                  {`From: ${formatStorageProviderLabel( getVersionDownloadProvider( version ) )}`}
                </span>
              </div>
            ) : null}
          </article>
        )
      } )}
    </div>
  )
}

export default VersionListPanel
