// src/components/FocusContextCarousel.tsx
// Presents a bounded linear context around one selected item.
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import './FocusContextCarousel.css'

type FocusContextCarouselRenderState = {
  distance: number
  isSelected: boolean
}

type FocusContextCarouselProps<Item> = {
  ariaLabel: string
  contextRadius?: number
  emptyMessage?: string
  getItemId: ( item: Item ) => string
  getItemLabel: ( item: Item ) => string
  items: readonly Item[]
  onSelect: ( itemId: string ) => void
  renderItem: ( item: Item, state: FocusContextCarouselRenderState ) => ReactNode
  selectedId: string | null
}

function FocusContextCarousel<Item>( {
  ariaLabel,
  contextRadius = 3,
  emptyMessage = 'No items available.',
  getItemId,
  getItemLabel,
  items,
  onSelect,
  renderItem,
  selectedId,
}: FocusContextCarouselProps<Item> ) {
  const matchingSelectedIndex = useMemo( () => {
    return items.findIndex( ( item ) => getItemId( item ) === selectedId )
  }, [ getItemId, items, selectedId ] )
  const selectedIndex = matchingSelectedIndex >= 0 ? matchingSelectedIndex : 0
  const selectedCardRef = useRef<HTMLButtonElement | null>( null )
  const previousSelectedIndexRef = useRef<number | null>( null )
  const selectionNotice = selectedId !== null && matchingSelectedIndex < 0
    ? 'Selected item is unavailable; showing the first item.'
    : null

  useEffect( () => {
    if(
      previousSelectedIndexRef.current !== null &&
      previousSelectedIndexRef.current !== matchingSelectedIndex &&
      selectedCardRef.current &&
      matchingSelectedIndex >= 0
    ) {
      selectedCardRef.current.focus( { preventScroll: true } )
    }
    previousSelectedIndexRef.current = matchingSelectedIndex
  }, [ matchingSelectedIndex ] )
  const normalizedRadius = Math.max( 1, Math.floor( contextRadius ) )
  const visibleItems = items.filter( ( _item, index ) =>
    Math.abs( index - selectedIndex ) <= normalizedRadius,
  )
  const selectAt = ( index: number ) => {
    const item = items[index]
    if( item ) {
      onSelect( getItemId( item ) )
    }
  }
  const handleKeyDown = ( event: KeyboardEvent<HTMLElement> ) => {
    if( event.altKey || event.ctrlKey || event.metaKey ) {
      return
    }
    if( event.key === 'ArrowLeft' || event.key === 'PageUp' ) {
      event.preventDefault()
      selectAt( selectedIndex - 1 )
    } else if( event.key === 'ArrowRight' || event.key === 'PageDown' ) {
      event.preventDefault()
      selectAt( selectedIndex + 1 )
    } else if( event.key === 'Home' ) {
      event.preventDefault()
      selectAt( 0 )
    } else if( event.key === 'End' ) {
      event.preventDefault()
      selectAt( items.length - 1 )
    }
  }

  if( items.length === 0 ) {
    return <p className="muted focus-context-carousel__empty">{emptyMessage}</p>
  }

  return (
    <section
      className="focus-context-carousel"
      role="region"
      aria-label={ariaLabel}
      aria-roledescription="carousel"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="focus-context-carousel__toolbar">
        <button
          type="button"
          aria-label="Previous item"
          onClick={() => selectAt( selectedIndex - 1 )}
          disabled={selectedIndex === 0}
        >
          ←
        </button>
        <p className="focus-context-carousel__position" aria-live="polite">
          Item {selectedIndex + 1} of {items.length}
        </p>
        <button
          type="button"
          aria-label="Next item"
          onClick={() => selectAt( selectedIndex + 1 )}
          disabled={selectedIndex === items.length - 1}
        >
          →
        </button>
      </div>
      {selectionNotice ? (
        <p className="notice-warning focus-context-carousel__selection-notice" role="status">
          {selectionNotice}
        </p>
      ) : null}
      <div className="focus-context-carousel__viewport">
        <div className="focus-context-carousel__track">
          {visibleItems.map( ( item ) => {
            const itemIndex = items.indexOf( item )
            const distance = itemIndex - selectedIndex
            const isSelected = distance === 0
            const style = {
              '--carousel-offset': `${distance * 72}%`,
              '--carousel-opacity': `${Math.max( 0.26, 1 - Math.abs( distance ) * 0.2 )}`,
              '--carousel-scale': `${Math.max( 0.74, 1 - Math.abs( distance ) * 0.08 )}`,
              zIndex: 10 - Math.abs( distance ),
            } as CSSProperties
            return (
              <button
                key={getItemId( item )}
                type="button"
                className="focus-context-carousel__card"
                data-distance={distance}
                data-focus={isSelected ? 'true' : 'false'}
                style={style}
                title={getItemLabel( item )}
                aria-current={isSelected ? 'true' : undefined}
                tabIndex={isSelected ? 0 : -1}
                ref={isSelected ? selectedCardRef : undefined}
                onClick={() => selectAt( itemIndex )}
              >
                {renderItem( item, { distance, isSelected } )}
              </button>
            )
          } )}
        </div>
      </div>
    </section>
  )
}

export type { FocusContextCarouselProps, FocusContextCarouselRenderState }
export default FocusContextCarousel
