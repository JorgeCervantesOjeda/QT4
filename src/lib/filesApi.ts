import { versionNumberToString } from '../domain/types'
import { auth } from './firebase'

type FilesApiMode = 'proxy' | 'direct'

const normalizeMode = (value: string | undefined): FilesApiMode => {
  return value === 'direct' ? 'direct' : 'proxy'
}

const FILES_API_MODE: FilesApiMode = normalizeMode( import.meta.env.VITE_FILES_API_MODE )
const rawProxyPath = ( import.meta.env.VITE_FILES_API_PROXY_PATH ?? '/files-api' ).trim()
const normalizedProxyPath = rawProxyPath.startsWith( '/' ) ? rawProxyPath : `/${rawProxyPath}`
const FILES_API_PROXY_PATH = normalizedProxyPath.replace( /\/+$/, '' )
const FILES_API_BASE_URL = ( import.meta.env.VITE_FILES_API_BASE_URL ?? '' ).replace( /\/+$/, '' )

const resolveFilesApiBasePath = (): string => {
  if( FILES_API_MODE === 'direct' ) {
    if( !FILES_API_BASE_URL ) {
      throw new Error(
        'Files API is in direct mode but VITE_FILES_API_BASE_URL is missing.',
      )
    }
    return FILES_API_BASE_URL
  }
  return FILES_API_PROXY_PATH || '/files-api'
}

const FILES_API_BASE_PATH = resolveFilesApiBasePath()
const MAX_FILE_BYTES = 20 * 1024 * 1024

export type UploadFileResponse = {
  id?: number
  fileKey: string
  sizeBytes?: number
  isPermanent?: boolean
  expireAfterDays?: number
  overwritten?: boolean
}

type UploadOptions = {
  overwrite?: boolean
  isPermanent?: boolean
  expireAfterDays?: number | null
}

export const getFilesApiConfigSummary = (): string => {
  return FILES_API_MODE === 'direct'
    ? `direct (${FILES_API_BASE_PATH})`
    : `proxy (${FILES_API_BASE_PATH})`
}

export const buildFilesApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith( '/' ) ? path : `/${path}`
  return `${FILES_API_BASE_PATH}${normalizedPath}`
}

const sanitizeSegment = (value: string): string => {
  const normalized = value
    .normalize( 'NFKD' )
    .replace( /[\u0300-\u036f]/g, '' )
    .replace( /[^A-Za-z0-9._-]/g, '_' )
  const trimmed = normalized.replace( /_+/g, '_' ).replace( /^_+|_+$/g, '' )
  return trimmed || 'unknown'
}

const sanitizeFileName = (fileName: string): string => {
  const normalized = fileName
    .normalize( 'NFKD' )
    .replace( /[\u0300-\u036f]/g, '' )
    .replace( /[^A-Za-z0-9._-]/g, '_' )
  const trimmed = normalized.replace( /_+/g, '_' ).replace( /^_+|_+$/g, '' )
  return trimmed || 'file.bin'
}

const truncateFileName = (fileName: string, maxLength: number): string => {
  if( fileName.length <= maxLength ) {
    return fileName
  }
  const dotIndex = fileName.lastIndexOf( '.' )
  if( dotIndex > 0 && dotIndex < fileName.length - 1 ) {
    const ext = fileName.slice( dotIndex )
    const base = fileName.slice( 0, dotIndex )
    const allowedBase = Math.max( 1, maxLength - ext.length )
    return `${base.slice( 0, allowedBase )}${ext}`
  }
  return fileName.slice( 0, maxLength )
}

const withSessionHeaders = async (headersInit?: HeadersInit): Promise<Headers> => {
  const user = auth.currentUser
  if( !user ) {
    throw new Error( 'User session is required.' )
  }

  const idToken = await user.getIdToken( true )
  const headers = new Headers( headersInit )
  headers.set( 'Authorization', `Bearer ${idToken}` )
  return headers
}

export const buildFileKey = (params: {
  projectId: string
  documentId: string
  versionNumber: number
  fileName: string
}): string => {
  const projectSegment = sanitizeSegment( params.projectId )
  const docSegment = sanitizeSegment( params.documentId )
  const versionSegment = `v${versionNumberToString( params.versionNumber )}`
  const safeFileName = sanitizeFileName( params.fileName )
  const prefix = `qt4/${projectSegment}/${docSegment}/${versionSegment}/`
  let fileKey = `${prefix}${safeFileName}`
  if( fileKey.length > 255 ) {
    const maxFileNameLength = Math.max( 1, 255 - prefix.length )
    fileKey = `${prefix}${truncateFileName( safeFileName, maxFileNameLength )}`
  }
  return fileKey
}

const readErrorText = async (resp: Response): Promise<string> => {
  try {
    const text = await resp.text()
    return text || resp.statusText
  } catch {
    return resp.statusText
  }
}

export const uploadFile = async (
  fileKey: string,
  file: File,
  options: UploadOptions = {},
): Promise<UploadFileResponse> => {
  if( file.size > MAX_FILE_BYTES ) {
    throw new Error( 'File exceeds 20 MB limit.' )
  }
  if( file.size === 0 ) {
    throw new Error( 'File is empty.' )
  }
  const headers = await withSessionHeaders()
  headers.set( 'Content-Type', 'application/octet-stream' )
  if( options.overwrite ) {
    headers.set( 'X-Overwrite', 'yes' )
  }
  if( typeof options.isPermanent === 'boolean' ) {
    headers.set( 'X-File-Permanent', options.isPermanent ? 'true' : 'false' )
  }
  if( typeof options.expireAfterDays === 'number' ) {
    headers.set( 'X-Expire-After-Days', `${options.expireAfterDays}` )
  }
  const resp = await fetch(
    buildFilesApiUrl( `/files/${encodeURIComponent( fileKey )}` ),
    {
      method: 'PUT',
      headers,
      body: file,
    },
  )
  if( !resp.ok ) {
    const text = await readErrorText( resp )
    throw new Error( `Upload failed (${resp.status}): ${text}` )
  }
  return resp.json() as Promise<UploadFileResponse>
}

export const downloadFile = async (fileKey: string, suggestedName?: string): Promise<void> => {
  const headers = await withSessionHeaders()
  const resp = await fetch(
    buildFilesApiUrl( `/files/${encodeURIComponent( fileKey )}?download=1` ),
    { method: 'GET', headers },
  )
  if( resp.status === 404 ) {
    throw new Error( 'File not found.' )
  }
  if( !resp.ok ) {
    const text = await readErrorText( resp )
    throw new Error( `Download failed (${resp.status}): ${text}` )
  }
  const blob = await resp.blob()
  const link = document.createElement( 'a' )
  link.href = URL.createObjectURL( blob )
  link.download = suggestedName || fileKey.split( '/' ).pop() || 'file.bin'
  document.body.appendChild( link )
  link.click()
  link.remove()
  URL.revokeObjectURL( link.href )
}

export const deleteFile = async (fileKey: string): Promise<void> => {
  const headers = await withSessionHeaders()
  const resp = await fetch(
    buildFilesApiUrl( `/files/${encodeURIComponent( fileKey )}` ),
    { method: 'DELETE', headers },
  )
  if( resp.status === 404 ) {
    return
  }
  if( !resp.ok ) {
    const text = await readErrorText( resp )
    throw new Error( `Delete failed (${resp.status}): ${text}` )
  }
}

export const notifyEmail = async (params: {
  to: string[]
  cc?: string[]
  subject: string
  text: string
}): Promise<void> => {
  const headers = await withSessionHeaders( { 'Content-Type': 'application/json' } )
  const resp = await fetch( buildFilesApiUrl( '/notify' ), {
    method: 'POST',
    headers,
    body: JSON.stringify( {
      to: params.to,
      cc: params.cc ?? [],
      subject: params.subject,
      text: params.text,
    } ),
  } )
  if( !resp.ok ) {
    const text = await readErrorText( resp )
    throw new Error( `Notify failed (${resp.status}): ${text}` )
  }
}
