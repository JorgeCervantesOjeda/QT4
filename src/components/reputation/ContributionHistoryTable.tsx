// src/components/reputation/ContributionHistoryTable.tsx: Lists the server-generated contribution event ledger.

import { formatReputationPoints, toReputationDate, type ReputationEventRecord } from '../../lib/reputationData'
import './reputation.css'

type ContributionHistoryTableProps = {
  events: ReputationEventRecord[]
}

const formatDate = (value: unknown): string => {
  const date = toReputationDate( value )
  return date ? date.toLocaleString() : 'Date pending'
}

const categoryLabels: Record<ReputationEventRecord['category'], string> = {
  collaboration: 'Collaboration',
  review: 'Review',
  quality: 'Quality',
}

function ContributionHistoryTable({ events }: ContributionHistoryTableProps) {
  if( events.length === 0 ) {
    return <p className="muted">Your contribution history will appear here after your first event.</p>
  }
  return (
    <div className="table-scroll contribution-history">
      <table className="data-table">
        <thead>
          <tr><th scope="col">What happened</th><th scope="col">Area</th><th scope="col">Points</th><th scope="col">When</th></tr>
        </thead>
        <tbody>
          {events.map( (event) => (
            <tr key={event.id}>
              <td>{event.reason}</td>
              <td>{categoryLabels[event.category]}</td>
              <td>{event.points > 0 ? `+${formatReputationPoints( event.points )}` : formatReputationPoints( event.points )}</td>
              <td>{formatDate( event.createdAt )}</td>
            </tr>
          ) )}
        </tbody>
      </table>
    </div>
  )
}

export default ContributionHistoryTable
