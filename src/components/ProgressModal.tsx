// src/components/ProgressModal.tsx
// Presents long-running work with the same modal pattern across pages.
import type { ReactNode } from 'react'
import { GiphyInline } from '../giphy/GiphyProvider'
import ModalDialog from './ModalDialog'

type ProgressModalProps = {
  title: string
  message?: string
  children?: ReactNode
}

function ProgressModal({ title, message, children }: ProgressModalProps) {
  return (
    <ModalDialog cardClassName="progress-modal">
      <h3>{title}</h3>
      <GiphyInline reason="loading" mode="inline" showLabel={false} />
      {message ? <p className="muted">{message}</p> : null}
      {children}
    </ModalDialog>
  )
}

export default ProgressModal
