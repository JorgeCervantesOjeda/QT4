// src/components/reputation/ContributionHistoryTable.tsx: Lists the server-generated contribution event ledger.

import { toReputationDate, type ReputationEventRecord } from '../../lib/reputationData'
import './reputation.css'

type ContributionHistoryTableProps = {
  events: ReputationEventRecord[]
}

const formatDate = (value: unknown): string => {
  const date = toReputationDate( value )
  return date ? date.toLocaleString() : 'Date pending'
}

function ContributionHistoryTable({ events }: ContributionHistoryTableProps) {
  if( events.length === 0 ) {
    return <p className="muted">Your contribution history will appear here after your first event.</p>
  }
  return (
    <div className="table-scroll contribution-history">
      <table className="data-table">
        <thead>
          <tr><th scope="col">Contribution</th><th scope="col">Category</th><th scope="col">Points</th><th scope="col">Date</th></tr>
        </thead>
        <tbody>
          {events.map( (event) => (
            <tr key={event.id}>
              <td>{event.reason}</td>
              <td>{event.category}</td>
              <td>{event.points > 0 ? `+${event.points}` : event.points}</td>
              <td>{formatDate( event.createdAt )}</td>
            </tr>
          ) )}
        </tbody>
      </table>
    </div>
  )
}

export default ContributionHistoryTable
