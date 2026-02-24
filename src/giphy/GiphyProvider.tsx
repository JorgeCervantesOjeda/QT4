import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GiphyContext, type GiphyReason } from './GiphyContext'
import { useGiphy } from './useGiphy'

type GiphyConfig = {
  endpoint: 'gifs' | 'stickers'
  tag: string
  label: string
}

const API_KEY = import.meta.env.VITE_GIPHY_API_KEY || 'DoErQC3vkB72XrWUuLeCBhglIm4L5ubJ'

const CONFIG_BY_REASON: Record<GiphyReason, GiphyConfig> = {
  good_job: {
    endpoint: 'gifs',
    tag: 'good job yes yeah',
    label: 'Working on it...',
  },
  teamwork: {
    endpoint: 'gifs',
    tag: 'team work',
    label: 'Working on it...',
  },
  thinking: {
    endpoint: 'gifs',
    tag: 'thinking+decision',
    label: 'Waiting for your confirmation...',
  },
  loading: {
    endpoint: 'gifs',
    tag: 'bored waiting',
    label: 'Loading...',
  },
  dislike_rejected_nope: {
    endpoint: 'gifs',
    tag: 'dislike rejected nope',
    label: 'Working on it...',
  },
  wellcome: {
    endpoint: 'gifs',
    tag: 'wellcome',
    label: 'Working on it...',
  },
}

const FETCH_COOLDOWN_MS = 2 * 60 * 1000
const GIPHY_CACHE_CLEAR_EVENT = 'qt4:giphy-cache-clear'

const buildGiphyRandomUrl = (reason: GiphyReason) => {
  const config = CONFIG_BY_REASON[reason]
  const tag = encodeURIComponent( config.tag )
  return `https://api.giphy.com/v1/${config.endpoint}/random?api_key=${API_KEY}&tag=${tag}&rating=g`
}

const extractGiphyMediaUrl = (payload: unknown): string | null => {
  if( !payload || typeof payload !== 'object' ) {
    return null
  }
  const data = ( payload as { data?: unknown } ).data
  const record = Array.isArray( data ) ? data[0] : data
  if( !record || typeof record !== 'object' ) {
    return null
  }
  const images = ( record as { images?: Record<string, unknown> } ).images
  if( !images ) {
    return null
  }
  const downsized = images.downsized_small as { mp4?: string } | undefined
  if( downsized?.mp4 ) {
    return downsized.mp4
  }
  const original = images.original as { mp4?: string; url?: string } | undefined
  if( original?.mp4 ) {
    return original.mp4
  }
  if( original?.url ) {
    return original.url
  }
  return null
}

export const GiphyInline = ({
  reason,
  mode = 'overlay',
  showLabel = true,
}: {
  reason: GiphyReason
  mode?: 'overlay' | 'inline'
  showLabel?: boolean
}) => {
  const { getCachedGifForReason, preloadGifForReason } = useGiphy()
  const [srcByReason, setSrcByReason] = useState<Partial<Record<GiphyReason, string>>>( {} )
  const src = srcByReason[reason] ?? getCachedGifForReason( reason )
  const label = CONFIG_BY_REASON[reason]?.label ?? 'Loading...'

  useEffect( () => {
    let isActive = true
    void preloadGifForReason( reason ).then( () => {
      if( !isActive ) {
        return
      }
      const after = getCachedGifForReason( reason )
      if( after ) {
        setSrcByReason( ( current ) => {
          if( current[reason] === after ) {
            return current
          }
          return { ...current, [reason]: after }
        } )
      } else {
        console.warn( `Giphy not available for reason: ${reason}. Showing loading state.` )
      }
    } )
    return () => {
      isActive = false
    }
  }, [ reason, preloadGifForReason, getCachedGifForReason ] )

  if( mode === 'inline' ) {
    if( !src ) {
      return <p className="muted">Loading...</p>
    }
    return (
      <div className="giphy-inline">
        <video src={src} autoPlay loop muted playsInline />
        {showLabel ? <p className="muted">{label}</p> : null}
      </div>
    )
  }

  if( !src ) {
    return (
      <div className="giphy-overlay" role="dialog" aria-modal="true">
        <div className="giphy-card">
          <div className="giphy-placeholder">Loading...</div>
          <p className="muted">{label}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="giphy-overlay" role="dialog" aria-modal="true">
      <div className="giphy-card giphy-inline">
        <video src={src} autoPlay loop muted playsInline />
        {showLabel ? <p className="muted">{label}</p> : null}
      </div>
    </div>
  )
}

export const GiphyProvider = ({ children }: { children: React.ReactNode }) => {
  const lastSrcRef = useRef<Record<GiphyReason, string | null>>( {
    good_job: null,
    teamwork: null,
    thinking: null,
    loading: null,
    dislike_rejected_nope: null,
    wellcome: null,
  } )
  const inFlightRef = useRef<Record<GiphyReason, boolean>>( {
    good_job: false,
    teamwork: false,
    thinking: false,
    loading: false,
    dislike_rejected_nope: false,
    wellcome: false,
  } )
  const lastFetchRef = useRef<Record<GiphyReason, number>>( {
    good_job: 0,
    teamwork: 0,
    thinking: 0,
    loading: 0,
    dislike_rejected_nope: 0,
    wellcome: 0,
  } )
  const inFlightPromiseRef = useRef<Record<GiphyReason, Promise<string | null> | null>>( {
    good_job: null,
    teamwork: null,
    thinking: null,
    loading: null,
    dislike_rejected_nope: null,
    wellcome: null,
  } )
  const fetchGifForReason = useCallback( async (reason: GiphyReason) => {
    if( inFlightPromiseRef.current[reason] ) {
      return inFlightPromiseRef.current[reason]
    }

    const requestPromise = ( async () => {
      const now = Date.now()
      if( now - lastFetchRef.current[reason] < FETCH_COOLDOWN_MS ) {
        return null
      }
      inFlightRef.current[reason] = true
      lastFetchRef.current[reason] = now
      const response = await fetch( buildGiphyRandomUrl( reason ) )
      if( !response.ok ) {
        if( response.status === 429 ) {
          console.warn( `Giphy rate limit hit for reason: ${reason}. Status: ${response.status}` )
        } else {
          console.warn( `Giphy fetch failed for reason: ${reason}. Status: ${response.status}` )
        }
        throw new Error( `Giphy error ${response.status}` )
      }
      console.warn( `Giphy fetch ok for reason: ${reason}. Status: ${response.status}` )
      const payload = await response.json()
      const src = extractGiphyMediaUrl( payload )
      if( !src ) {
        console.warn( `Giphy payload missing media for reason: ${reason}` )
        throw new Error( 'No usable media from Giphy' )
      }
      return src
    } )().finally( () => {
      inFlightRef.current[reason] = false
      inFlightPromiseRef.current[reason] = null
    } )

    inFlightPromiseRef.current[reason] = requestPromise
    return requestPromise
  }, [] )

  const storeLastGifSrcForReason = useCallback( (reason: GiphyReason, src: string) => {
    lastSrcRef.current[reason] = src
    try {
      window.localStorage.setItem( `qt4_giphy_last_${reason}`, src )
    } catch {
      // ignore storage errors
    }
  }, [] )

  const ensureGifLoadedForReason = useCallback(
    async (reason: GiphyReason) => {
      if( lastSrcRef.current[reason] ) {
        return
      }
      try {
        const result = await fetchGifForReason( reason )
        if( result ) {
          storeLastGifSrcForReason( reason, result )
        } else {
          console.warn( `Giphy missing for reason: ${reason}. Possible rate limit or cooldown.` )
        }
      } catch {
        if( !lastSrcRef.current[reason] ) {
          console.warn( `Giphy missing for reason: ${reason}. Fetch failed.` )
        }
      }
    },
    [ fetchGifForReason, storeLastGifSrcForReason ],
  )

  const preloadGifForReason = useCallback(
    async (reason: GiphyReason) => {
      await ensureGifLoadedForReason( reason )
    },
    [ ensureGifLoadedForReason ],
  )

  const getCachedGifForReason = useCallback( (reason: GiphyReason) => {
    return lastSrcRef.current[reason] ?? null
  }, [] )

  const value = useMemo(
    () => ( {
      preloadGifForReason,
      getCachedGifForReason,
    } ),
    [ preloadGifForReason, getCachedGifForReason ],
  )

  useEffect( () => {
    let isActive = true
    const seedReasons = async () => {
      const reasons = Object.keys( lastSrcRef.current ) as GiphyReason[]
      await Promise.allSettled(
        reasons.map( async ( reason ) => {
          if( !isActive ) {
            return
          }
          await ensureGifLoadedForReason( reason )
        } ),
      )
    }
    void seedReasons()
    return () => {
      isActive = false
    }
  }, [ ensureGifLoadedForReason ] )

  useEffect( () => {
    const reasons = Object.keys( lastSrcRef.current ) as GiphyReason[]
    reasons.forEach( ( reason ) => {
      try {
        const stored = window.localStorage.getItem( `qt4_giphy_last_${reason}` )
        if( stored ) {
          lastSrcRef.current[reason] = stored
        }
      } catch {
        // ignore storage errors
      }
    } )
  }, [] )

  useEffect( () => {
    const handleCacheClear = () => {
      const reasons = Object.keys( lastSrcRef.current ) as GiphyReason[]
      reasons.forEach( ( reason ) => {
        lastSrcRef.current[reason] = null
        inFlightRef.current[reason] = false
        lastFetchRef.current[reason] = 0
        inFlightPromiseRef.current[reason] = null
      } )
      // Ensure login failures have a GIF ready immediately after logout cache reset.
      void ensureGifLoadedForReason( 'dislike_rejected_nope' )
    }
    window.addEventListener( GIPHY_CACHE_CLEAR_EVENT, handleCacheClear )
    return () => {
      window.removeEventListener( GIPHY_CACHE_CLEAR_EVENT, handleCacheClear )
    }
  }, [ ensureGifLoadedForReason ] )

  return (
    <GiphyContext.Provider value={value}>
      {children}
    </GiphyContext.Provider>
  )
}
