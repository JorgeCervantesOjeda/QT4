// Version list/table presenter with download and selection controls.
import type { ColumnDef, OnChangeFn, SortingState } from '@tanstack/react-table'
import DataTable from '../../components/DataTable'
import FocusContextCarousel from '../../components/FocusContextCarousel'
import {
  versionNumberToString,
  type FileStorageProviderKind,
} from '../../domain/types'
import { formatTimeAgoWithTimestamp } from '../../lib/time'
import type { FileRefSummary, VersionSummary } from './types'
import {
  formatFileExtensionLabel,
  formatReviewPeriodLabel,
  formatStorageProviderLabel,
  hasLinkedFileMetadata,
} from './utils'
import type { ListViewMode } from './viewModes'

type VersionListPanelProps = {
  docId: string | undefined
  versions: VersionSummary[]
  selectedVersion: VersionSummary | null
  versionColumns: ColumnDef<VersionSummary, unknown>[]
  versionSorting: SortingState
  viewMode: ListViewMode
  isBusy: boolean
  isLoadingVersions: boolean
  downloadStatus: 'idle' | 'downloading' | 'success' | 'error'
  clockNowMs: number
  formatUserLabel: (userId: string) => string
  getVersionDownloadProvider: (version: VersionSummary) => FileStorageProviderKind | null
  versionFileRefsById: Record<string, FileRefSummary>
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
  versionFileRefsById,
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

  if( viewMode === 'focus' ) {
    const focusVersion = selectedVersion ?? versions[0] ?? null
    const focusFileExtensionLabel = focusVersion
      ? formatFileExtensionLabel(
        focusVersion.fileRefId ? versionFileRefsById[focusVersion.fileRefId] : null,
      )
      : null
    return (
      <div className="stack">
        <FocusContextCarousel
          items={versions}
          selectedId={focusVersion?.id ?? null}
          getItemId={( version ) => version.id}
          getItemLabel={( version ) => `Version ${versionNumberToString( version.number )}`}
          ariaLabel="Document versions in focus view"
          onSelect={openReviewIssuesForVersion}
          renderItem={( version ) => (
            <div className="focus-context-carousel__content">
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
              <p className="muted">Review period: {formatReviewPeriodLabel( version, clockNowMs )}</p>
            </div>
          )}
        />
        {focusVersion && hasLinkedFileMetadata( focusVersion ) ? (
          <div className="actions focus-context-carousel__selected-actions">
            <button
              type="button"
              onClick={() => requestDownloadVersionFile( focusVersion )}
              disabled={isBusy || downloadStatus === 'downloading'}
            >
              Download selected version file
            </button>
            {focusFileExtensionLabel ? (
              <span className="download-file-extension">{focusFileExtensionLabel}</span>
            ) : null}
            <span className="download-provider-hint">
              {`From: ${formatStorageProviderLabel( getVersionDownloadProvider( focusVersion ) )}`}
            </span>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="project-grid">
      {versions.map( ( version ) => {
        const isSelected = selectedVersion?.id === version.id
        const fileExtensionLabel = formatFileExtensionLabel(
          version.fileRefId ? versionFileRefsById[version.fileRefId] : null,
        )
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
              Review period: {formatReviewPeriodLabel( version, clockNowMs )}
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
                {fileExtensionLabel ? (
                  <span className="download-file-extension">{fileExtensionLabel}</span>
                ) : null}
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
