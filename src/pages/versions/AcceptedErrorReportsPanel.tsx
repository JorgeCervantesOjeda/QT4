// Shows accepted error reports that unlock the next version after an accepted baseline.
import { versionNumberToString } from '../../domain/types'
import { formatTimeAgoWithTimestamp } from '../../lib/time'
import type { AcceptedErrorReportSummary } from './types'

type AcceptedErrorReportsPanelProps = {
  acceptedErrorReports: AcceptedErrorReportSummary[]
  acceptedErrorReportsStatus: 'idle' | 'loading' | 'ready' | 'error'
  projectId: string
  onOpenReport: (url: string) => void
}

function AcceptedErrorReportsPanel( {
  acceptedErrorReports,
  acceptedErrorReportsStatus,
  projectId,
  onOpenReport,
}: AcceptedErrorReportsPanelProps ) {
  return (
    <section className="panel stack">
      <div className="panel-header">
        <h3>Accepted error reports for selected version</h3>
        <p className="muted">{acceptedErrorReports.length}</p>
      </div>
      {acceptedErrorReportsStatus === 'loading' ? (
        <p className="muted">Loading accepted error reports...</p>
      ) : acceptedErrorReportsStatus === 'error' ? (
        <p className="muted">Accepted error reports could not be loaded right now.</p>
      ) : acceptedErrorReports.length === 0 ? (
        <p className="muted">No accepted error reports are linked to this version.</p>
      ) : (
        <div className="project-grid">
          {acceptedErrorReports.map( ( report ) => {
            const targetUrl = `/documents/${report.docId}/versions?projectId=${projectId}`
            return (
              <article
                key={report.docId}
                className="project-card status-card--accepted"
                onClick={() => onOpenReport( targetUrl )}
                role="button"
                tabIndex={0}
                onKeyDown={( event ) => {
                  if( event.key === 'Enter' || event.key === ' ' ) {
                    event.preventDefault()
                    onOpenReport( targetUrl )
                  }
                }}
              >
                <h4>{`${report.shortId ?? 'Unassigned'} - ${report.title}`}</h4>
                <p className="muted">
                  Latest accepted version: {versionNumberToString( report.latestVersionNumber )}
                </p>
                <p className="muted">
                  Accepted: {formatTimeAgoWithTimestamp( report.acceptedAt )}
                </p>
              </article>
            )
          } )}
        </div>
      )}
    </section>
  )
}

export default AcceptedErrorReportsPanel
