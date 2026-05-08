import { createContext } from 'react'

export type GiphyReason =
  | 'good_job'
  | 'teamwork'
  | 'thinking'
  | 'loading'
  | 'dislike_rejected_nope'
  | 'wellcome'

export type GiphyContextValue = {
  preloadGifForReason: (reason: GiphyReason) => Promise<void>
  getCachedGifForReason: (reason: GiphyReason) => string | null
}

export const GiphyContext = createContext<GiphyContextValue | null>( null )
