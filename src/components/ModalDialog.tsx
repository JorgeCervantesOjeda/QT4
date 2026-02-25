import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

type ModalDialogProps = {
  children: ReactNode
  onClose?: () => void
  cardClassName?: string
  initialFocusRef?: RefObject<HTMLElement | null>
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join( ', ' )

function ModalDialog( { children, onClose, cardClassName, initialFocusRef }: ModalDialogProps ) {
  const containerRef = useRef<HTMLDivElement | null>( null )

  useEffect( () => {
    const previousFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const container = containerRef.current
    if( !container ) {
      return
    }
    const firstFocusable = container.querySelector<HTMLElement>( FOCUSABLE_SELECTOR )
    const target = initialFocusRef?.current ?? firstFocusable ?? container
    target.focus()

    return () => {
      previousFocused?.focus()
    }
  }, [ initialFocusRef ] )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if( event.key === 'Escape' && onClose ) {
      event.preventDefault()
      onClose()
      return
    }
    if( event.key !== 'Tab' ) {
      return
    }
    const container = containerRef.current
    if( !container ) {
      return
    }
    const focusables = Array.from( container.querySelectorAll<HTMLElement>( FOCUSABLE_SELECTOR ) )
    if( focusables.length === 0 ) {
      event.preventDefault()
      container.focus()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if( event.shiftKey ) {
      if( active === first || !container.contains( active ) ) {
        event.preventDefault()
        last.focus()
      }
      return
    }
    if( active === last || !container.contains( active ) ) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onKeyDown={handleKeyDown}>
      <div
        ref={containerRef}
        className={['modal-card', cardClassName].filter( Boolean ).join( ' ' )}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}

export default ModalDialog
