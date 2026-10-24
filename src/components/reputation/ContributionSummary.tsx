// src/components/reputation/ContributionSummary.tsx: Shows the point dimensions for one project.

import type { ReputationSummary } from '../../lib/reputation'
import { formatReputationPoints } from '../../lib/reputationData'
import './reputation.css'

type ContributionSummaryProps = {
  summary: ReputationSummary
  title?: string
  totalLabel?: string
}

function ContributionSummary({ summary, title = 'Contribution summary', totalLabel = 'Total points' }: ContributionSummaryProps) {
  return (
    <section className="contribution-summary" aria-label={title}>
      <div className="contribution-summary__total">
        <span className="contribution-summary__value">{formatReputationPoints( summary.totalPoints )}</span>
        <span className="contribution-summary__label">{totalLabel}</span>
        <span className="muted">Only this project is included.</span>
      </div>
      <div className="contribution-summary__dimensions">
        <div>
          <span>Collaboration</span>
          <strong>{formatReputationPoints( summary.collaborationPoints )}</strong>
          <small>Issues and helpful comments</small>
        </div>
        <div>
          <span>Review work</span>
          <strong>{formatReputationPoints( summary.reviewPoints )}</strong>
          <small>Review participation</small>
        </div>
        <div>
          <span>Quality</span>
          <strong>{formatReputationPoints( summary.qualityPoints )}</strong>
          <small>Accepted versions and reports</small>
        </div>
      </div>
    </section>
  )
}

export default ContributionSummary
