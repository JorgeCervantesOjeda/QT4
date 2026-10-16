// src/components/reputation/ContributionStatus.tsx: Renders explicit loading, empty, and error states.

type ContributionStatusProps = {
  status: 'loading' | 'empty' | 'error'
  message?: string
}

function ContributionStatus({ status, message }: ContributionStatusProps) {
  if( status === 'loading' ) {
    return <p className="muted contribution-status" role="status">Loading contribution data...</p>
  }
  if( status === 'error' ) {
    return <p className="error contribution-status" role="alert">{message ?? 'Contribution data could not be loaded.'}</p>
  }
  return <p className="muted contribution-status">{message ?? 'No contributions recorded yet.'}</p>
}

export default ContributionStatus
