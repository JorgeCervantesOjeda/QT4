import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import type { FileStorageProviderKind, NotificationProviderKind } from '../domain/types'
import { db } from './firebase'

export type AppRuntimeConfig = {
  fileStorageProvider: FileStorageProviderKind
  emailProvider: NotificationProviderKind
}

export type AppRuntimeConfigSource = 'firestore' | 'defaults'

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

export const getDefaultAppRuntimeConfig = (): AppRuntimeConfig => ( {
  fileStorageProvider: DEFAULT_FILE_STORAGE_PROVIDER,
  emailProvider: DEFAULT_EMAIL_PROVIDER,
} )

export const loadAppRuntimeConfig = async (): Promise<{
  config: AppRuntimeConfig
  source: AppRuntimeConfigSource
}> => {
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

export const saveAppRuntimeConfig = async (
  config: AppRuntimeConfig,
  updatedBy: string,
): Promise<void> => {
  if( !updatedBy ) {
    throw new Error( 'User session is required.' )
  }
  await setDoc(
    runtimeConfigRef,
    {
      fileStorageProvider: normalizeFileStorageProvider( config.fileStorageProvider ),
      emailProvider: normalizeEmailProvider( config.emailProvider ),
      updatedAt: serverTimestamp(),
      updatedBy,
    },
    { merge: true },
  )
}

export const formatRuntimeConfigSummary = (config: AppRuntimeConfig): string => {
  return `Files: ${config.fileStorageProvider}; Email: ${config.emailProvider}`
}
