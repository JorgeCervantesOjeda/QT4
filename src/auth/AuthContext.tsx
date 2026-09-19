// src/auth/AuthContext.tsx
// Provides the authenticated user and session lifecycle behavior to the app.
import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { AuthContext } from './AuthContextStore'

type AuthProviderProps = {
  children: React.ReactNode
}

const DEFAULT_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000
const INACTIVITY_TIMEOUT_MS = (() => {
  const raw = Number( import.meta.env.VITE_INACTIVITY_TIMEOUT_MS ?? DEFAULT_INACTIVITY_TIMEOUT_MS )
  return Number.isFinite( raw ) && raw > 0 ? raw : DEFAULT_INACTIVITY_TIMEOUT_MS
})()
const GIPHY_CACHE_KEY_PREFIX = 'qt4_giphy_last_'
const GIPHY_CACHE_CLEAR_EVENT = 'qt4:giphy-cache-clear'

const clearGiphyCache = () => {
  try {
    Object.keys( window.localStorage )
      .filter( ( key ) => key.startsWith( GIPHY_CACHE_KEY_PREFIX ) )
      .forEach( ( key ) => {
        window.localStorage.removeItem( key )
      } )
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent( new Event( GIPHY_CACHE_CLEAR_EVENT ) )
}

function AuthProvider( { children }: AuthProviderProps ) {
  const [user, setUser] = useState<User | null>( null )
  const [loading, setLoading] = useState( true )

  useEffect( () => {
    const unsubscribe = onAuthStateChanged( auth, ( nextUser ) => {
      setUser( nextUser )
      setLoading( false )
    } )
    return () => unsubscribe()
  }, [] )

  const signOutUser = async () => {
    clearGiphyCache()
    await signOut( auth )
  }

  useEffect( () => {
    if( !user ) {
      return
    }
    let timerId: number | null = null
    const resetTimer = () => {
      if( timerId ) {
        window.clearTimeout( timerId )
      }
      timerId = window.setTimeout( () => {
        clearGiphyCache()
        void signOut( auth ).finally( () => {
          window.location.assign( '/login?reason=inactive' )
        } )
      }, INACTIVITY_TIMEOUT_MS )
    }
    const events: Array<keyof WindowEventMap> = [ 'pointerdown', 'keydown', 'scroll', 'touchstart' ]
    events.forEach( ( eventName ) => {
      window.addEventListener( eventName, resetTimer, { passive: true } )
    } )
    resetTimer()
    return () => {
      events.forEach( ( eventName ) => {
        window.removeEventListener( eventName, resetTimer )
      } )
      if( timerId ) {
        window.clearTimeout( timerId )
      }
    }
  }, [ user ] )

  const value = useMemo(
    () => ( {
      user,
      loading,
      signOutUser,
    } ),
    [ user, loading ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthProvider }
