// src/components/FocusContextCarousel.test.tsx
// Verifies keyboard, boundary, and selection behavior of the focus-context carousel.
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
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

const createItems = (countOfItems: number) => Array.from( { length: countOfItems }, ( _item, index ) => ( {
  id: `version-${index + 1}`,
  label: `Version ${index + 1}`,
} ) )

const renderCarousel = (
  selectedId = 'version-2',
  carouselItems: readonly TestItem[] = items,
  onSelectedClick = vi.fn(),
) => {
  const onSelect = vi.fn()
  render(
    <FocusContextCarousel
      items={carouselItems}
      selectedId={selectedId}
      getItemId={( item ) => item.id}
      getItemLabel={( item ) => item.label}
      ariaLabel="Document versions"
      onSelect={onSelect}
      onSelectedClick={onSelectedClick}
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

  it( 'moves five items with PageDown like the reference carousel', () => {
    const onSelect = renderCarousel( 'version-2', createItems( 8 ) )
    const region = screen.getByRole( 'region', { name: 'Document versions' } )

    fireEvent.keyDown( region, { key: 'PageDown' } )

    expect( onSelect ).toHaveBeenCalledWith( 'version-7' )
  } )

  it( 'leaves wheel scrolling to the page instead of changing the selected item', () => {
    const onSelect = renderCarousel()
    const region = screen.getByRole( 'region', { name: 'Document versions' } )
    const wheelEvent = createEvent.wheel( region, { deltaY: 60, deltaX: 0 } )

    fireEvent( region, wheelEvent )

    expect( onSelect ).not.toHaveBeenCalled()
    expect( wheelEvent.defaultPrevented ).toBe( false )
  } )

  it( 'snaps a horizontal drag to the nearest item without wrapping', () => {
    const onSelect = renderCarousel()
    const region = screen.getByRole( 'region', { name: 'Document versions' } )

    fireEvent.pointerDown( region, { clientX: 320, clientY: 200, pointerId: 1 } )
    fireEvent.pointerMove( region, { clientX: 200, clientY: 202, pointerId: 1 } )
    fireEvent.pointerUp( region, { clientX: 200, clientY: 202, pointerId: 1 } )

    expect( onSelect ).toHaveBeenCalledWith( 'version-3' )
  } )

  it( 'moves only one adjacent item when a distant card is clicked', () => {
    const onSelect = renderCarousel( 'version-3', createItems( 5 ) )

    fireEvent.click( screen.getByRole( 'button', { name: 'Version 5' } ) )
    fireEvent.click( screen.getByRole( 'button', { name: 'Version 1' } ) )

    expect( onSelect ).toHaveBeenNthCalledWith( 1, 'version-4' )
    expect( onSelect ).toHaveBeenNthCalledWith( 2, 'version-3' )
  } )

  it( 'delegates a click on the current card without changing selection', () => {
    const onSelectedClick = vi.fn()
    const onSelect = renderCarousel( 'version-2', items, onSelectedClick )

    fireEvent.click( screen.getByRole( 'button', { name: 'Version 2' } ) )

    expect( onSelectedClick ).toHaveBeenCalledOnce()
    expect( onSelect ).not.toHaveBeenCalled()
  } )

  it( 'keeps a context window of at most twenty-five cards for long lists', () => {
    const longItems = createItems( 40 )
    renderCarousel( 'version-20', longItems )
    const region = screen.getByRole( 'region', { name: 'Document versions' } )

    expect( region.querySelectorAll( '.focus-context-carousel__card' ) ).toHaveLength( 25 )
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
