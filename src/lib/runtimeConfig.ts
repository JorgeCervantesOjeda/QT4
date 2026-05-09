import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import type { FileStorageProviderKind, NotificationProviderKind } from '../domain/types'
import { db } from './firebase'

export type AppRuntimeConfig = {
  fileStorageProvider: FileStorageProviderKind
  emailProvider: NotificationProviderKind
}

export type AppRuntimeConfigSource = 'firestore' | 'defaults'

type LoadAppRuntimeConfigResult = {
  config: AppRuntimeConfig
  source: AppRuntimeConfigSource
}

export const normalizeFileStorageProvider = (value: unknown): FileStorageProviderKind => {
  return value === 'firebase-storage' ? 'firebase-storage' : 'files-api'
}

export const normalizeEmailProvider = (value: unknown): NotificationProviderKind => {
  return value === 'firebase-functions' ? 'firebase-functions' : 'files-api'
}

const DEFAULT_FILE_STORAGE_PROVIDER = normalizeFileStorageProvider(
  import.meta.env.VITE_DEFAULT_FILE_STORAGE_PROVIDER,
)
const DEFAULT_EMAIL_PROVIDER = normalizeEmailProvider(
  import.meta.env.VITE_DEFAULT_EMAIL_PROVIDER,
)

const runtimeConfigRef = doc( db, 'systemConfig', 'runtime' )
let runtimeConfigCache: LoadAppRuntimeConfigResult | null = null
let runtimeConfigPromise: Promise<LoadAppRuntimeConfigResult> | null = null

export const getDefaultAppRuntimeConfig = (): AppRuntimeConfig => ( {
  fileStorageProvider: DEFAULT_FILE_STORAGE_PROVIDER,
  emailProvider: DEFAULT_EMAIL_PROVIDER,
} )

const cloneLoadResult = (value: LoadAppRuntimeConfigResult): LoadAppRuntimeConfigResult => ( {
  config: { ...value.config },
  source: value.source,
} )

const cacheLoadResult = (value: LoadAppRuntimeConfigResult): LoadAppRuntimeConfigResult => {
  runtimeConfigCache = cloneLoadResult( value )
  return cloneLoadResult( value )
}

export const clearAppRuntimeConfigCache = (): void => {
  runtimeConfigCache = null
  runtimeConfigPromise = null
}

const loadRuntimeConfigFromFirestore = async (): Promise<LoadAppRuntimeConfigResult> => {
  const defaults = getDefaultAppRuntimeConfig()
  try {
    const snapshot = await getDoc( runtimeConfigRef )
    if( !snapshot.exists() ) {
      return {
        config: defaults,
        source: 'defaults',
      }
    }
    const data = snapshot.data()
    return {
      config: {
        fileStorageProvider: normalizeFileStorageProvider( data.fileStorageProvider ),
        emailProvider: normalizeEmailProvider( data.emailProvider ),
      },
      source: 'firestore',
    }
  } catch {
    return {
      config: defaults,
      source: 'defaults',
    }
  }
}

export const loadAppRuntimeConfig = async (
  options: { forceRefresh?: boolean } = {},
): Promise<LoadAppRuntimeConfigResult> => {
  if( options.forceRefresh ) {
    clearAppRuntimeConfigCache()
  }
  if( runtimeConfigCache ) {
    return cloneLoadResult( runtimeConfigCache )
  }
  if( !runtimeConfigPromise ) {
    runtimeConfigPromise = loadRuntimeConfigFromFirestore().then( (result) => {
      runtimeConfigPromise = null
      return cacheLoadResult( result )
    } )
  }
  return cloneLoadResult( await runtimeConfigPromise )
}

export const saveAppRuntimeConfig = async (
  config: AppRuntimeConfig,
  updatedBy: string,
): Promise<void> => {
  if( !updatedBy ) {
    throw new Error( 'User session is required.' )
  }
  const normalizedConfig: AppRuntimeConfig = {
    fileStorageProvider: normalizeFileStorageProvider( config.fileStorageProvider ),
    emailProvider: normalizeEmailProvider( config.emailProvider ),
  }
  await setDoc(
    runtimeConfigRef,
    {
      fileStorageProvider: normalizedConfig.fileStorageProvider,
      emailProvider: normalizedConfig.emailProvider,
      updatedAt: serverTimestamp(),
      updatedBy,
    },
    { merge: true },
  )
  cacheLoadResult( {
    config: normalizedConfig,
    source: 'firestore',
  } )
  runtimeConfigPromise = null
}

export const formatRuntimeConfigSummary = (config: AppRuntimeConfig): string => {
  return `Files: ${config.fileStorageProvider}; Email: ${config.emailProvider}`
}
