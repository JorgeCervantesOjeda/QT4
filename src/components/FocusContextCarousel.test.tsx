// src/components/FocusContextCarousel.test.tsx
// Verifies keyboard, boundary, and selection behavior of the focus-context carousel.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FocusContextCarousel from './FocusContextCarousel'

type TestItem = {
  id: string
  label: string
}

const items: TestItem[] = [
  { id: 'version-1', label: 'Version 1' },
  { id: 'version-2', label: 'Version 2' },
  { id: 'version-3', label: 'Version 3' },
]

const renderCarousel = (selectedId = 'version-2') => {
  const onSelect = vi.fn()
  render(
    <FocusContextCarousel
      items={items}
      selectedId={selectedId}
      getItemId={( item ) => item.id}
      getItemLabel={( item ) => item.label}
      ariaLabel="Document versions"
      onSelect={onSelect}
      renderItem={( item ) => <span>{item.label}</span>}
    />,
  )
  return onSelect
}

describe( 'FocusContextCarousel', () => {
  it( 'renders the selected item as the focus card and exposes position', () => {
    renderCarousel()

    expect( screen.getByRole( 'region', { name: 'Document versions' } ) ).toBeTruthy()
    expect( screen.getByRole( 'button', { name: 'Version 2' } ) ).toBeTruthy()
    expect( screen.getByText( 'Item 2 of 3' ) ).toBeTruthy()
  } )

  it( 'selects the next item with keyboard navigation', () => {
    const onSelect = renderCarousel()
    const region = screen.getByRole( 'region', { name: 'Document versions' } )

    fireEvent.keyDown( region, { key: 'ArrowRight' } )

    expect( onSelect ).toHaveBeenCalledWith( 'version-3' )
  } )

  it( 'disables previous and next controls at the list boundaries', () => {
    renderCarousel( 'version-1' )

    expect( screen.getByRole( 'button', { name: 'Previous item' } ) ).toHaveProperty( 'disabled', true )
    expect( screen.getByRole( 'button', { name: 'Next item' } ) ).toHaveProperty( 'disabled', false )
  } )

  it( 'makes an invalid controlled selection visible instead of hiding the fallback', () => {
    renderCarousel( 'missing-version' )

    expect( screen.getByRole( 'status' ).textContent ).toContain(
      'Selected item is unavailable; showing the first item.',
    )
  } )
} )
