import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import type { FileStorageProviderKind } from '../domain/types'
import {
  buildFileKey,
  deleteFile as deleteFileWithFilesApi,
  downloadFile as downloadFileWithFilesApi,
  uploadFile as uploadFileWithFilesApi,
} from './filesApi'
import { storage } from './firebase'
import { loadAppRuntimeConfig, normalizeFileStorageProvider } from './runtimeConfig'
import { consumeInjectedTestFault } from './testFaults'

type UploadOptions = {
  overwrite?: boolean
  isPermanent?: boolean
  expireAfterDays?: number | null
}

export type UploadFileResult = {
  sizeBytes: number
  isPermanent: boolean
  expireAfterDays: number | null
  storageProvider: FileStorageProviderKind
}

const MAX_FILE_BYTES = 20 * 1024 * 1024
const DOWNLOAD_LOG_PREFIX = '[file-storage][download]'
const rawForcedProvider = ( import.meta.env.VITE_FORCE_FILE_STORAGE_PROVIDER ?? '' ).trim()
const FORCED_FILE_STORAGE_PROVIDER: FileStorageProviderKind | null = rawForcedProvider
  ? normalizeFileStorageProvider( rawForcedProvider )
  : null

const ensureValidFile = (file: File) => {
  if( file.size > MAX_FILE_BYTES ) {
    throw new Error( 'File exceeds 20 MB limit.' )
  }
  if( file.size === 0 ) {
    throw new Error( 'File is empty.' )
  }
}

const triggerUrlDownload = (downloadUrl: string, suggestedName?: string, fileKey?: string) => {
  const link = document.createElement( 'a' )
  link.href = downloadUrl
  link.rel = 'noopener'
  if( suggestedName || fileKey ) {
    link.download = suggestedName || fileKey?.split( '/' ).pop() || 'file.bin'
  }
  document.body.appendChild( link )
  link.click()
  link.remove()
}

const openUrlInNewTab = (downloadUrl: string, suggestedName?: string, fileKey?: string) => {
  const openedWindow = window.open( downloadUrl, '_blank', 'noopener,noreferrer' )
  if( openedWindow ) {
    return
  }
  triggerUrlDownload( downloadUrl, suggestedName, fileKey )
}

const describeError = (err: unknown): string => {
  if( err instanceof Error ) {
    return err.message
  }
  return String( err )
}

const resolveProvider = async (preferred?: FileStorageProviderKind): Promise<FileStorageProviderKind> => {
  if( FORCED_FILE_STORAGE_PROVIDER ) {
    return FORCED_FILE_STORAGE_PROVIDER
  }
  if( preferred ) {
    return preferred
  }
  const { config } = await loadAppRuntimeConfig()
  return config.fileStorageProvider
}

export const getEffectiveFileStorageProviderHint = (
  preferred?: FileStorageProviderKind | null,
): FileStorageProviderKind | null => {
  if( FORCED_FILE_STORAGE_PROVIDER ) {
    return FORCED_FILE_STORAGE_PROVIDER
  }
  return preferred ?? null
}

const uploadFileWithFirebaseStorage = async (
  fileKey: string,
  file: File,
): Promise<UploadFileResult> => {
  ensureValidFile( file )
  const injectedFault = consumeInjectedTestFault( 'storage.uploadBytes', fileKey )
  if( injectedFault ) {
    throw injectedFault
  }
  const storageRef = ref( storage, fileKey )
  await uploadBytes( storageRef, file, {
    contentType: file.type || 'application/octet-stream',
  } )
  return {
    sizeBytes: file.size,
    isPermanent: true,
    expireAfterDays: null,
    storageProvider: 'firebase-storage',
  }
}

const downloadFileWithFirebaseStorage = async (
  fileKey: string,
  suggestedName?: string,
): Promise<void> => {
  const startedAt = Date.now()
  console.info( `${DOWNLOAD_LOG_PREFIX}[firebase][start]`, {
    fileKey,
    suggestedName: suggestedName ?? null,
  } )
  const injectedFault = consumeInjectedTestFault( 'storage.getDownloadURL', fileKey )
  if( injectedFault ) {
    throw injectedFault
  }
  const storageRef = ref( storage, fileKey )
  try {
    const downloadUrl = await getDownloadURL( storageRef )
    console.info( `${DOWNLOAD_LOG_PREFIX}[firebase][url_ready]`, {
      fileKey,
      elapsedMs: Date.now() - startedAt,
      urlHost: new URL( downloadUrl ).host,
    } )
    openUrlInNewTab( downloadUrl, suggestedName, fileKey )
    console.info( `${DOWNLOAD_LOG_PREFIX}[firebase][triggered]`, {
      fileKey,
      totalElapsedMs: Date.now() - startedAt,
    } )
  } catch( err ) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String( ( err as { code: unknown } ).code )
        : 'unknown'
    console.warn( `${DOWNLOAD_LOG_PREFIX}[firebase][error]`, {
      fileKey,
      elapsedMs: Date.now() - startedAt,
      code,
      message: describeError( err ),
    } )
    throw err
  }
}

const isStorageObjectNotFound = (err: unknown): boolean => {
  if( !err || typeof err !== 'object' || !( 'code' in err ) ) {
    return false
  }
  const code = String( ( err as { code: unknown } ).code )
  return code === 'storage/object-not-found'
}

const deleteFileWithFirebaseStorage = async (fileKey: string): Promise<void> => {
  try {
    await deleteObject( ref( storage, fileKey ) )
  } catch( err ) {
    if( isStorageObjectNotFound( err ) ) {
      return
    }
    throw err
  }
}

export const uploadFileUsingActiveProvider = async (
  fileKey: string,
  file: File,
  options: UploadOptions = {},
): Promise<UploadFileResult> => {
  const provider = await resolveProvider()
  if( provider === 'firebase-storage' ) {
    return uploadFileWithFirebaseStorage( fileKey, file )
  }
  const response = await uploadFileWithFilesApi( fileKey, file, options )
  return {
    sizeBytes: Number( response.sizeBytes ?? file.size ),
    isPermanent: Boolean( response.isPermanent ),
    expireAfterDays:
      typeof response.expireAfterDays === 'number' ? Number( response.expireAfterDays ) : null,
    storageProvider: 'files-api',
  }
}

export const downloadFileByProvider = async (
  fileKey: string,
  suggestedName?: string,
  provider?: FileStorageProviderKind,
): Promise<void> => {
  const startedAt = Date.now()
  const resolvedProvider = await resolveProvider( provider )
  console.info( `${DOWNLOAD_LOG_PREFIX}[route]`, {
    fileKey,
    requestedProvider: provider ?? null,
    resolvedProvider,
    forcedProvider: FORCED_FILE_STORAGE_PROVIDER,
  } )
  if( resolvedProvider === 'firebase-storage' ) {
    await downloadFileWithFirebaseStorage( fileKey, suggestedName )
    console.info( `${DOWNLOAD_LOG_PREFIX}[done]`, {
      fileKey,
      provider: resolvedProvider,
      totalElapsedMs: Date.now() - startedAt,
    } )
    return
  }
  await downloadFileWithFilesApi( fileKey, suggestedName )
  console.info( `${DOWNLOAD_LOG_PREFIX}[done]`, {
    fileKey,
    provider: resolvedProvider,
    totalElapsedMs: Date.now() - startedAt,
  } )
}

export const deleteFileByProvider = async (
  fileKey: string,
  provider?: FileStorageProviderKind,
): Promise<void> => {
  const resolvedProvider = await resolveProvider( provider )
  if( resolvedProvider === 'firebase-storage' ) {
    await deleteFileWithFirebaseStorage( fileKey )
    return
  }
  await deleteFileWithFilesApi( fileKey )
}

export { buildFileKey }
