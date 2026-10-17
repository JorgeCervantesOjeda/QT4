// src/components/reputation/ProjectLeaderboard.tsx: Renders a project-only contribution ranking.

import type { ReputationSummary } from '../../lib/reputation'
import { formatReputationPoints } from '../../lib/reputationData'
import './reputation.css'

type ProjectLeaderboardProps = {
  summaries: ReputationSummary[]
  currentUserId: string
  resolveUserLabel?: (userId: string) => string
}

function ProjectLeaderboard({ summaries, currentUserId, resolveUserLabel = (userId) => userId }: ProjectLeaderboardProps) {
  if( summaries.length === 0 ) {
    return <p className="muted">No contribution summaries are available for this project yet.</p>
  }
  return (
    <ol className="project-leaderboard" aria-label="Project contribution leaderboard">
      {summaries.map( (summary, index) => (
        <li
          key={`${summary.projectId}-${summary.userId}`}
          className={summary.userId === currentUserId ? 'project-leaderboard__row project-leaderboard__row--current' : 'project-leaderboard__row'}
        >
          <span className="project-leaderboard__rank">{index + 1}</span>
          <span className="project-leaderboard__user">{resolveUserLabel( summary.userId )}</span>
          <strong>{formatReputationPoints( summary.totalPoints )} pts</strong>
          <span className="muted">{summary.badgeIds.length} badges</span>
        </li>
      ) )}
    </ol>
  )
}

export default ProjectLeaderboard
