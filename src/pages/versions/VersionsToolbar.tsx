// Main version workflow toolbar: selection, create, review, decision, and error-report actions.
import type { RefObject } from 'react'
import { versionNumberToString } from '../../domain/types'
import type { VersionSummary } from './types'

type VersionsToolbarProps = {
  versionsActionsRef: RefObject<HTMLDivElement | null>
  versions: VersionSummary[]
  selectedVersion: VersionSummary | null
  isBusy: boolean
  createButtonLabel: string
  viewMode: 'card' | 'table'
  versionSelectStatusClassName: (version?: Pick<VersionSummary, 'status' | 'reviewEndAt'> | null) => string
  versionStatusColor: (version?: Pick<VersionSummary, 'status' | 'reviewEndAt'> | null) => string
  selectVersionAndClearThreadQuery: (versionId: string | null) => void
  moveSelectedVersion: (direction: 1 | -1) => void
  requestCreateVersionConfirmation: () => void
  requestStartReviewConfirmation: () => void
  requestVersionDecisionConfirmation: (decision: 'accept' | 'reject') => void
  requestErrorReportCreation: () => void
  setViewMode: (viewMode: 'card' | 'table') => void
}

function VersionsToolbar( {
  versionsActionsRef,
  versions,
  selectedVersion,
  isBusy,
  createButtonLabel,
  viewMode,
  versionSelectStatusClassName,
  versionStatusColor,
  selectVersionAndClearThreadQuery,
  moveSelectedVersion,
  requestCreateVersionConfirmation,
  requestStartReviewConfirmation,
  requestVersionDecisionConfirmation,
  requestErrorReportCreation,
  setViewMode,
}: VersionsToolbarProps ) {
  return (
    <>
      <div className="panel-header panel-header--versions">
        {!isBusy ? <h2>Versions</h2> : null}
        <div ref={versionsActionsRef} className="actions actions--versions-toolbar">
          <label className="field">
            <span>Selected version</span>
            <select
              className={`version-select ${versionSelectStatusClassName( selectedVersion )}`.trim()}
              value={selectedVersion?.id ?? ''}
              onChange={( event ) => selectVersionAndClearThreadQuery( event.target.value || null )}
              onKeyDown={( event ) => {
                if( versions.length === 0 ) {
                  return
                }
                if( event.key === 'ArrowLeft' ) {
                  event.preventDefault()
                  moveSelectedVersion( -1 )
                } else if( event.key === 'ArrowRight' ) {
                  event.preventDefault()
                  moveSelectedVersion( 1 )
                } else if( event.key === 'Home' ) {
                  event.preventDefault()
                  selectVersionAndClearThreadQuery( versions[0].id )
                } else if( event.key === 'End' ) {
                  event.preventDefault()
                  selectVersionAndClearThreadQuery( versions[versions.length - 1].id )
                }
              }}
              disabled={isBusy}
            >
              {versions.map( ( version ) => (
                <option
                  key={version.id}
                  value={version.id}
                  style={{ backgroundColor: versionStatusColor( version ), color: '#24130f' }}
                >
                  {versionNumberToString( version.number )} - {version.status}
                </option>
              ) )}
            </select>
          </label>
          <button type="button" onClick={requestCreateVersionConfirmation} disabled={isBusy}>
            {createButtonLabel}
          </button>
          <button type="button" onClick={requestStartReviewConfirmation} disabled={isBusy}>
            Start review
          </button>
          <button type="button" onClick={() => requestVersionDecisionConfirmation( 'accept' )} disabled={isBusy}>
            Accept latest
          </button>
          <button type="button" onClick={() => requestVersionDecisionConfirmation( 'reject' )} disabled={isBusy}>
            Reject latest
          </button>
          <button type="button" onClick={requestErrorReportCreation} disabled={isBusy}>
            Create error report
          </button>
        </div>
      </div>
      <div className="actions">
        <label className="field">
          <span>View</span>
          <div className="view-toggle">
            <button
              type="button"
              aria-pressed={viewMode === 'card'}
              onClick={() => setViewMode( 'card' )}
            >
              Cards
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'table'}
              onClick={() => setViewMode( 'table' )}
            >
              Table
            </button>
          </div>
        </label>
      </div>
    </>
  )
}

export default VersionsToolbar
