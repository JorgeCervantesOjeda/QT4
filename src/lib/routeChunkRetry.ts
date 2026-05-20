// src/lib/routeChunkRetry.ts - Retries route chunk loading once per build and route.
import type { ComponentType } from 'react'

type RouteModule = {
  default: ComponentType
}

type RouteReloadOptions = {
  route?: string
  buildId?: string
  storage?: Storage
  reload?: () => void
}

const CHUNK_RELOAD_STORAGE_PREFIX = 'qt4:chunk-reload'
const CHUNK_LOAD_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module',
  'loading chunk',
  'chunkloaderror',
  'importing a module script failed',
]

const getErrorMessage = (error: unknown): string => {
  if( error instanceof Error ) {
    return error.message
  }
  if( error && typeof error === 'object' && 'message' in error ) {
    return String( ( error as { message?: unknown } ).message ?? '' )
  }
  return String( error ?? '' )
}

const isChunkLoadError = (error: unknown): boolean => {
  const message = getErrorMessage( error ).toLowerCase()
  return CHUNK_LOAD_ERROR_PATTERNS.some( ( pattern ) => message.includes( pattern ) )
}

const getRouteReloadKey = (route: string, buildId: string): string =>
  `${CHUNK_RELOAD_STORAGE_PREFIX}:${buildId}:${route}`

export const loadRouteWithChunkRetry = async <TModule extends RouteModule>(
  loader: () => Promise<TModule>,
  options: RouteReloadOptions = {},
): Promise<TModule> => {
  try {
    return await loader()
  } catch( error ) {
    if( typeof window === 'undefined' || !isChunkLoadError( error ) ) {
      throw error
    }

    const route = options.route ?? `${window.location.pathname}${window.location.search}${window.location.hash}`
    const buildId = options.buildId ?? ( import.meta.env.VITE_APP_BUILD ?? import.meta.env.MODE )
    const storage = options.storage ?? window.sessionStorage
    const reloadKey = getRouteReloadKey( route, buildId )

    if( storage.getItem( reloadKey ) === '1' ) {
      throw error
    }

    storage.setItem( reloadKey, '1' )
    const reload = options.reload ?? window.location.reload.bind( window.location )
    reload()
    return new Promise<TModule>( () => undefined )
  }
}
