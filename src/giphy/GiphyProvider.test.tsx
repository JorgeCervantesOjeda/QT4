// src/giphy/GiphyProvider.test.tsx
// Verifies fallback rendering for Giphy status media.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GiphyContext, type GiphyContextValue } from './GiphyContext'
import { GiphyInline } from './GiphyProvider'

const renderWithoutCachedGif = (showLabel: boolean) => {
  const value: GiphyContextValue = {
    preloadGifForReason: vi.fn( async () => undefined ),
    getCachedGifForReason: () => null,
  }

  return render(
    <GiphyContext.Provider value={value}>
      <GiphyInline reason="good_job" mode="inline" showLabel={showLabel} />
    </GiphyContext.Provider>,
  )
}

describe( 'GiphyInline', () => {
  it( 'does not show a loading label when inline labels are hidden and the gif is unavailable', () => {
    renderWithoutCachedGif( false )

    expect( screen.queryByText( 'Loading...' ) ).toBeNull()
  } )

  it( 'shows the reason label when inline labels are visible and the gif is unavailable', () => {
    renderWithoutCachedGif( true )

    expect( screen.getByText( 'Done.' ) ).toBeTruthy()
  } )
} )
