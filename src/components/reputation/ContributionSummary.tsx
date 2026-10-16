// src/components/reputation/ContributionSummary.tsx: Shows the point dimensions for one project.

import type { ReputationSummary } from '../../lib/reputation'
import './reputation.css'

type ContributionSummaryProps = {
  summary: ReputationSummary
  title?: string
}

function ContributionSummary({ summary, title = 'Contribution summary' }: ContributionSummaryProps) {
  return (
    <section className="contribution-summary" aria-label={title}>
      <div className="contribution-summary__total">
        <span className="contribution-summary__value">{summary.totalPoints}</span>
        <span className="muted">points</span>
      </div>
      <div className="contribution-summary__dimensions">
        <div><span>Collaboration</span><strong>{summary.collaborationPoints}</strong></div>
        <div><span>Review</span><strong>{summary.reviewPoints}</strong></div>
        <div><span>Quality</span><strong>{summary.qualityPoints}</strong></div>
      </div>
    </section>
  )
}

export default ContributionSummary
