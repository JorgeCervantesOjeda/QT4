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
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={reviewDurationDays}
          onChange={( event ) => {
            const rawReviewDurationDays = event.target.value.trim()
            onReviewDurationDaysChange(
              rawReviewDurationDays ? Number( rawReviewDurationDays ) : 1,
            )
          }}
          disabled={isBusy || !canConfigureReviewDuration}
        />
      </label>
      <p className="muted">Allowed range: 1 to 30 days.</p>
    </section>
  )
}

export default ReviewDurationPanel
