// src/components/reputation/BadgeGrid.tsx: Displays project-scoped earned and locked contribution badges.

import { BADGE_DEFINITIONS, type ReputationBadgeId } from '../../lib/reputation'
import './reputation.css'

type BadgeGridProps = {
  unlockedBadgeIds: ReputationBadgeId[]
}

function BadgeGrid({ unlockedBadgeIds }: BadgeGridProps) {
  const unlocked = new Set( unlockedBadgeIds )
  return (
    <div className="badge-grid" aria-label="Contribution badges">
      {BADGE_DEFINITIONS.map( (badge) => {
        const isUnlocked = unlocked.has( badge.id )
        return (
          <article
            key={badge.id}
            className={`badge-card${isUnlocked ? ' badge-card--unlocked' : ' badge-card--locked'}`}
            data-badge-id={badge.id}
          >
            <span className="badge-card__icon" aria-hidden="true">{isUnlocked ? '✦' : '○'}</span>
            <div>
              <h3>{badge.label}</h3>
              <p className="muted">{badge.description}</p>
            </div>
          </article>
        )
      } )}
    </div>
  )
}

export default BadgeGrid
