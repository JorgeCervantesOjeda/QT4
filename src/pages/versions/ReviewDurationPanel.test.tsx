// src/pages/versions/ReviewDurationPanel.test.tsx
// Verifies the standalone review duration configuration panel.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ReviewDurationPanel from './ReviewDurationPanel'

describe( 'ReviewDurationPanel', () => {
  it( 'renders review duration separately from author and reviewer assignment', () => {
    const handleChange = vi.fn()

    render(
      <ReviewDurationPanel
        isBusy={false}
        canConfigureReviewDuration={true}
        reviewDurationDays={3}
        onReviewDurationDaysChange={handleChange}
      />,
    )

    const input = screen.getByLabelText( 'Review duration days' ) as HTMLInputElement

    expect( screen.getByRole( 'heading', { name: 'Review Duration' } ) ).toBeTruthy()
    expect( input.valueAsNumber ).toBe( 3 )

    fireEvent.change( input, {
      target: { value: '5' },
    } )

    expect( handleChange ).toHaveBeenCalledWith( 5 )
  } )

  it( 'disables duration changes when the version cannot be configured', () => {
    render(
      <ReviewDurationPanel
        isBusy={false}
        canConfigureReviewDuration={false}
        reviewDurationDays={1}
        onReviewDurationDaysChange={() => undefined}
      />,
    )

    expect( ( screen.getByLabelText( 'Review duration days' ) as HTMLInputElement ).disabled ).toBe( true )
  } )
} )
