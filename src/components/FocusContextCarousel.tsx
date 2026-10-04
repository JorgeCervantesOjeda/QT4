// src/components/FocusContextCarousel.tsx
// Presents a linear focus-context list with bounded 3D geometry and direct keyboard and pointer navigation.
// Fractional visual coordinates are computed here because drag state cannot be represented by CSS alone; CSS consumes the resulting variables.
// The viewport bounds are measured only to classify clicks in its empty lateral hit areas, not for responsive layout.
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import './FocusContextCarousel.css'

const ALL_VISIBLE_LIMIT = 30
const CONTEXT_TOTAL_LIMIT = 25
const DRAG_PIXELS_PER_CARD = 120

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
  onSelectedClick?: () => void
  renderItem: ( item: Item, state: FocusContextCarouselRenderState ) => ReactNode
  selectedId: string | null
}

type PointerGestureState = {
  baseCenter: number
  pointerId: number
  startX: number
  startY: number
  didDrag: boolean
}

type VisibleRange = {
  endIndex: number
  startIndex: number
}

type VisualCenterState = {
  selectedIndex: number
  visualCenter: number
}

const clampValue = ( value: number, minimum: number, maximum: number ) =>
  Math.min( maximum, Math.max( minimum, value ) )

const getVisibleRange = ( countOfItems: number, centerIndex: number ): VisibleRange => {
  if( countOfItems <= ALL_VISIBLE_LIMIT ) {
    return { startIndex: 0, endIndex: countOfItems - 1 }
  }

  const countOfVisibleItems = Math.min( CONTEXT_TOTAL_LIMIT, countOfItems )
  const halfWindow = Math.floor( countOfVisibleItems / 2 )
  const pivotIndex = clampValue( Math.round( centerIndex ), 0, countOfItems - 1 )
  let startIndex = pivotIndex - halfWindow
  let endIndex = startIndex + countOfVisibleItems - 1

  if( startIndex < 0 ) {
    endIndex -= startIndex
    startIndex = 0
  }
  if( endIndex > countOfItems - 1 ) {
    startIndex -= endIndex - ( countOfItems - 1 )
    endIndex = countOfItems - 1
  }

  return {
    startIndex: Math.max( 0, startIndex ),
    endIndex: Math.min( countOfItems - 1, endIndex ),
  }
}

const getEdgeHint = ( focusIndex: number, countOfItems: number, countOfVisibleItems: number ) => {
  const interactionHint = 'clic lateral · arrastra · ← →'
  if( focusIndex === 0 ) {
    return `Inicio de la lista · ${interactionHint}`
  }
  if( focusIndex === countOfItems - 1 ) {
    return `Fin de la lista · ${interactionHint}`
  }
  if( countOfItems <= ALL_VISIBLE_LIMIT ) {
    return `Lista completa visible · ${interactionHint}`
  }
  return `${countOfItems - countOfVisibleItems} fuera de contexto · ${interactionHint}`
}

const getCardStyle = (
  distance: number,
  maxDistance: number,
  isSelected: boolean,
): CSSProperties => {
  const normalizedDistance = Math.min( 1, Math.abs( distance ) / maxDistance )
  const alpha = 0.82
  const mappedDistance = Math.log1p( alpha * Math.abs( distance ) ) /
    Math.log1p( alpha * maxDistance )
  const horizontalOffset = Math.sign( distance ) * 505 * mappedDistance
  const verticalOffset = 12 + 78 * Math.pow( normalizedDistance, 1.55 )
  const depthOffset = -270 * Math.pow( normalizedDistance, 1.18 )
  const rotation = Math.abs( distance ) < 0.001
    ? 0
    : -Math.sign( distance ) * ( 8 + 47 * Math.pow( normalizedDistance, 0.9 ) )
  const scale = 1 - 0.66 * Math.pow( normalizedDistance, 0.72 )
  const opacity = 1 - 0.58 * Math.pow( normalizedDistance, 1.15 )
  const blur = normalizedDistance > 0.78 ? 0.7 : 0

  return {
    '--carousel-x': `${horizontalOffset}px`,
    '--carousel-y': `${verticalOffset}px`,
    '--carousel-z': `${depthOffset}px`,
    '--carousel-rotation': `${rotation}deg`,
    '--carousel-scale': String( scale ),
    '--carousel-opacity': String( isSelected ? 1 : opacity ),
    '--carousel-blur': `${blur}px`,
    zIndex: 2000 - Math.round( Math.abs( distance ) * 50 ),
  } as CSSProperties
}

function FocusContextCarousel<Item>( {
  ariaLabel,
  contextRadius = 3,
  emptyMessage = 'No items available.',
  getItemId,
  getItemLabel,
  items,
  onSelect,
  onSelectedClick,
  renderItem,
  selectedId,
}: FocusContextCarouselProps<Item> ) {
  const matchingSelectedIndex = useMemo( () => {
    return items.findIndex( ( item ) => getItemId( item ) === selectedId )
  }, [ getItemId, items, selectedId ] )
  const selectedIndex = matchingSelectedIndex >= 0 ? matchingSelectedIndex : 0
  const [ visualCenterState, setVisualCenterState ] = useState<VisualCenterState>( {
    selectedIndex,
    visualCenter: selectedIndex,
  } )
  const [ isDragging, setIsDragging ] = useState( false )
  const selectedCardRef = useRef<HTMLButtonElement | null>( null )
  const previousSelectedIndexRef = useRef<number | null>( null )
  const focusAfterMoveRef = useRef( false )
  const pointerGestureRef = useRef<PointerGestureState | null>( null )
  const suppressClickRef = useRef( false )
  const visualCenter = visualCenterState.selectedIndex === selectedIndex
    ? visualCenterState.visualCenter
    : selectedIndex
  const focusIndex = clampValue( Math.round( visualCenter ), 0, Math.max( 0, items.length - 1 ) )
  const selectionNotice = selectedId !== null && matchingSelectedIndex < 0
    ? 'Selected item is unavailable; showing the first item.'
    : null

  useEffect( () => {
    if(
      previousSelectedIndexRef.current !== null &&
      previousSelectedIndexRef.current !== focusIndex &&
      !isDragging &&
      focusAfterMoveRef.current &&
      selectedCardRef.current
    ) {
      selectedCardRef.current.focus( { preventScroll: true } )
      focusAfterMoveRef.current = false
    }
    previousSelectedIndexRef.current = focusIndex
  }, [ focusIndex, isDragging ] )

  const normalizedRadius = Math.max( 1, Math.floor( contextRadius ) )
  const visibleRange = getVisibleRange( items.length, focusIndex )
  const visibleItems = items.slice( visibleRange.startIndex, visibleRange.endIndex + 1 )
  const maxDistance = Math.max(
    1,
    Math.abs( visibleRange.startIndex - visualCenter ),
    Math.abs( visibleRange.endIndex - visualCenter ),
  )
  const updateVisualCenter = ( nextCenter: number ) => {
    setVisualCenterState( { selectedIndex, visualCenter: nextCenter } )
  }
  const selectAt = ( index: number, shouldFocus = false ) => {
    if( index < 0 || index >= items.length ) {
      return
    }
    const item = items[index]
    if( !item ) {
      return
    }
    focusAfterMoveRef.current = shouldFocus
    updateVisualCenter( index )
    onSelect( getItemId( item ) )
  }
  const stepBy = ( delta: number, shouldFocus = false ) => {
    const nextIndex = clampValue( focusIndex + delta, 0, items.length - 1 )
    if( nextIndex !== focusIndex ) {
      selectAt( nextIndex, shouldFocus )
    }
  }
  const handleKeyDown = ( event: KeyboardEvent<HTMLElement> ) => {
    if( event.altKey || event.ctrlKey || event.metaKey ) {
      return
    }
    if( event.key === 'ArrowLeft' ) {
      event.preventDefault()
      stepBy( -1, true )
    } else if( event.key === 'ArrowRight' ) {
      event.preventDefault()
      stepBy( 1, true )
    } else if( event.key === 'PageUp' ) {
      event.preventDefault()
      stepBy( -5, true )
    } else if( event.key === 'PageDown' ) {
      event.preventDefault()
      stepBy( 5, true )
    } else if( event.key === 'Home' ) {
      event.preventDefault()
      selectAt( 0, true )
    } else if( event.key === 'End' ) {
      event.preventDefault()
      selectAt( items.length - 1, true )
    }
  }
  const handleViewportClick = ( event: MouseEvent<HTMLDivElement> ) => {
    const target = event.target
    if(
      target instanceof Element &&
      target.closest( '.focus-context-carousel__card, .focus-context-carousel__nav, .focus-context-carousel__edge-hint' )
    ) {
      return
    }
    const viewportRect = event.currentTarget.getBoundingClientRect()
    if( viewportRect.width <= 0 ) {
      return
    }
    const midpoint = viewportRect.left + viewportRect.width / 2
    stepBy( event.clientX < midpoint ? -1 : 1, true )
  }
  const handlePointerDown = ( event: PointerEvent<HTMLElement> ) => {
    const target = event.target
    if( target instanceof Element && target.closest( '.focus-context-carousel__toolbar' ) ) {
      return
    }
    pointerGestureRef.current = {
      baseCenter: visualCenter,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      didDrag: false,
    }
  }
  const handlePointerMove = ( event: PointerEvent<HTMLElement> ) => {
    const gesture = pointerGestureRef.current
    if( !gesture || gesture.pointerId !== event.pointerId ) {
      return
    }
    const deltaX = event.clientX - gesture.startX
    const deltaY = event.clientY - gesture.startY
    if( !gesture.didDrag && Math.hypot( deltaX, deltaY ) > 8 ) {
      gesture.didDrag = true
      setIsDragging( true )
      event.currentTarget.setPointerCapture?.( event.pointerId )
    }
    if( !gesture.didDrag ) {
      return
    }
    event.preventDefault()
    updateVisualCenter( clampValue( gesture.baseCenter - deltaX / DRAG_PIXELS_PER_CARD, 0, items.length - 1 ) )
  }
  const finishPointerGesture = ( event: PointerEvent<HTMLElement> ) => {
    const gesture = pointerGestureRef.current
    if( !gesture || gesture.pointerId !== event.pointerId ) {
      return
    }
    pointerGestureRef.current = null
    if( !gesture.didDrag ) {
      return
    }
    const snapIndex = clampValue( Math.round( visualCenter ), 0, items.length - 1 )
    setIsDragging( false )
    suppressClickRef.current = true
    updateVisualCenter( snapIndex )
    selectAt( snapIndex )
  }
  const handlePointerCancel = () => {
    const gesture = pointerGestureRef.current
    if( !gesture ) {
      return
    }
    pointerGestureRef.current = null
    if( gesture.didDrag ) {
      const snapIndex = clampValue( Math.round( visualCenter ), 0, items.length - 1 )
      setIsDragging( false )
      updateVisualCenter( snapIndex )
      selectAt( snapIndex )
    }
  }
  const handleCardClick = ( itemIndex: number ) => {
    if( suppressClickRef.current ) {
      suppressClickRef.current = false
      return
    }
    if( itemIndex === focusIndex ) {
      onSelectedClick?.()
      return
    }
    const adjacentIndex = itemIndex > focusIndex ? focusIndex + 1 : focusIndex - 1
    selectAt( adjacentIndex, true )
  }

  if( items.length === 0 ) {
    return <p className="muted focus-context-carousel__empty">{emptyMessage}</p>
  }

  return (
    <section
      className={`focus-context-carousel ${isDragging ? 'focus-context-carousel--dragging' : ''}`.trim()}
      role="region"
      aria-label={ariaLabel}
      aria-roledescription="linear focus list"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerGesture}
      onPointerCancel={handlePointerCancel}
    >
      <div className="focus-context-carousel__toolbar">
        <p className="focus-context-carousel__position" aria-live="polite">
          Item {focusIndex + 1} of {items.length}
        </p>
      </div>
      {selectionNotice ? (
        <p className="notice-warning focus-context-carousel__selection-notice" role="status">
          {selectionNotice}
        </p>
      ) : null}
      <div className="focus-context-carousel__viewport" onClick={handleViewportClick}>
        <div className="focus-context-carousel__stage">
          {visibleItems.map( ( item, visibleOffset ) => {
            const itemIndex = visibleRange.startIndex + visibleOffset
            const distance = itemIndex - visualCenter
            const isSelected = itemIndex === focusIndex
            const style = getCardStyle( distance, maxDistance, isSelected )
            return (
              <button
                key={getItemId( item )}
                type="button"
                className="focus-context-carousel__card"
                data-distance={distance}
                data-focus={isSelected ? 'true' : 'false'}
                data-lod={Math.abs( distance ) <= normalizedRadius ? 'detail' : 'context'}
                style={style}
                title={getItemLabel( item )}
                aria-current={isSelected ? 'true' : undefined}
                tabIndex={isSelected ? 0 : -1}
                ref={isSelected ? selectedCardRef : undefined}
                onClick={() => handleCardClick( itemIndex )}
              >
                {renderItem( item, { distance, isSelected } )}
              </button>
            )
          } )}
        </div>
        <button
          type="button"
          className="focus-context-carousel__nav focus-context-carousel__nav--previous"
          aria-label="Previous item"
          onClick={() => selectAt( focusIndex - 1, true )}
          disabled={focusIndex === 0}
        >
          ←
        </button>
        <button
          type="button"
          className="focus-context-carousel__nav focus-context-carousel__nav--next"
          aria-label="Next item"
          onClick={() => selectAt( focusIndex + 1, true )}
          disabled={focusIndex === items.length - 1}
        >
          →
        </button>
        <p className="focus-context-carousel__edge-hint" aria-live="polite">
          {getEdgeHint( focusIndex, items.length, visibleItems.length )}
        </p>
      </div>
    </section>
  )
}

export type { FocusContextCarouselProps, FocusContextCarouselRenderState }
export default FocusContextCarousel
