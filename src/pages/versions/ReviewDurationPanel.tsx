// src/pages/versions/ReviewDurationPanel.tsx
// Renders review duration configuration for versions that are still in creation.

type ReviewDurationPanelProps = {
  isBusy: boolean
  canConfigureReviewDuration: boolean
  reviewDurationDays: number
  onReviewDurationDaysChange: (reviewDurationDays: number) => void
}

function ReviewDurationPanel( {
  isBusy,
  canConfigureReviewDuration,
  reviewDurationDays,
  onReviewDurationDaysChange,
}: ReviewDurationPanelProps ) {
  return (
    <section className="panel">
      <h3>Review Duration</h3>
      <label className="field">
        <span>Review duration days</span>
        <input
          type="number"
          min={1}
          max={30}
          step={1}
          value={reviewDurationDays}
          onChange={( event ) => onReviewDurationDaysChange( event.target.valueAsNumber )}
          disabled={isBusy || !canConfigureReviewDuration}
        />
      </label>
      <p className="muted">Allowed range: 1 to 30 days.</p>
    </section>
  )
}

export default ReviewDurationPanel
