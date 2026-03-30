import { auth } from './firebase'

type MonitorSource = 'firestore' | 'storage' | 'auth' | 'ui' | 'network' | 'unknown'
type MonitorSeverity = 'low' | 'medium' | 'high'
type MonitorCategory = 'permission' | 'runtime' | 'network' | 'auth' | 'firebase' | 'unknown'

type MonitorContext = {
  route?: string
  pageUrl?: string
  userId?: string
  userEmail?: string | null
}

type ReportAbnormalErrorInput = {
  error: unknown
  action?: string
  source?: MonitorSource
  projectId?: string
  docId?: string
  versionId?: string
  threadId?: string
  route?: string
  pageUrl?: string
  userId?: string
  userEmail?: string | null
}

type NormalizedError = {
  code: string
  messageRaw: string
  messageNormalized: string
  stack: string
  name: string
}

type ClassifiedError = {
  category: MonitorCategory
  severity: MonitorSeverity
  source: MonitorSource
  code: string
  messageRaw: string
  messageNormalized: string
  stack: string
  name: string
}

const FIREBASE_MONITOR_FUNCTION_URL = (
  import.meta.env.VITE_FIREBASE_MONITOR_FUNCTION_URL ?? ''
).trim()
const APP_BUILD = ( import.meta.env.VITE_APP_BUILD ?? import.meta.env.MODE ).trim()
const LOCAL_DEDUPE_WINDOW_MS = 5000
const MAX_STACK_LENGTH = 4000
const MAX_MESSAGE_LENGTH = 1200
const localDedupeByFingerprint = new Map<string, number>()

let globalHandlersInstalled = false
let warnedMissingMonitorEndpoint = false

const monitorContext: Required<MonitorContext> = {
  route: '',
  pageUrl: '',
  userId: '',
  userEmail: '',
}

const NORMAL_MESSAGE_PATTERNS = [
  /^select\b/i,
  /^please wait\b/i,
  /^you can\b/i,
  /^to [a-z]/i,
  /^no file is linked\b/i,
  /^invalid error report data\b/i,
  /^document not found\.?$/i,
  /^version not found\.?$/i,
  /^version or issue not found\.?$/i,
  /^comment window expired\b/i,
  /^action blocked\b/i,
  /^download blocked by files api authorization\b/i,
  /\bmust be\b/i,
  /\bonly while\b/i,
  /\bbefore\b/i,
  /\bat least\b/i,
  /\bcannot\b/i,
  /\bhas to\b/i,
  /\buser is\b/i,
  /^member lookup failed: user directory entry not found\b/i,
  /^member add failed: user directory entry not found\b/i,
]

const NORMAL_ERROR_CODES = new Set( [
  'auth/email-already-in-use',
  'auth/invalid-credential',
  'auth/invalid-email',
  'auth/missing-password',
  'auth/user-not-found',
  'auth/wrong-password',
  'auth/weak-password',
] )

const WRITE_ACTION_PATTERN = /create|update|save|delete|assign|upload|start|accept|reject|add|toggle|close|reopen|register|signout/i
const READ_ACTION_PATTERN = /load|read|fetch|download|list|refresh|lookup/i

const trimAndCollapseWhitespace = (value: string, maxLength: number): string =>
  value.replace( /\s+/g, ' ' ).trim().slice( 0, maxLength )

const trimMultiline = (value: string, maxLength: number): string =>
  value.replace( /\r\n/g, '\n' ).trim().slice( 0, maxLength )

const normalizeMessageForFingerprint = (value: string): string =>
  trimAndCollapseWhitespace(
    value
      .toLowerCase()
      .replace( /\b[0-9a-f]{16,}\b/g, '<hex>' )
      .replace( /\b\d{2,}\b/g, '<n>' )
      .replace( /https?:\/\/\S+/g, '<url>' ),
    500,
  )

const simpleHash = (value: string): string => {
  let hash = 5381
  for( let index = 0; index < value.length; index += 1 ) {
    hash = ( ( hash << 5 ) + hash ) ^ value.charCodeAt( index )
  }
  return ( hash >>> 0 ).toString( 16 ).padStart( 8, '0' )
}

const getErrorCode = (value: unknown): string => {
  if( !value || typeof value !== 'object' ) {
    return ''
  }
  if( 'code' in value ) {
    return String( ( value as { code?: unknown } ).code ?? '' ).trim()
  }
  return ''
}

const getErrorName = (value: unknown): string => {
  if( value instanceof Error ) {
    return value.name.trim()
  }
  if( value && typeof value === 'object' && 'name' in value ) {
    return String( ( value as { name?: unknown } ).name ?? '' ).trim()
  }
  return ''
}

const getErrorMessage = (value: unknown): string => {
  if( typeof value === 'string' ) {
    return value
  }
  if( value instanceof Error ) {
    return value.message
  }
  if( value && typeof value === 'object' && 'message' in value ) {
    return String( ( value as { message?: unknown } ).message ?? '' )
  }
  return ''
}

const getErrorStack = (value: unknown): string => {
  if( value instanceof Error && value.stack ) {
    return trimMultiline( value.stack, MAX_STACK_LENGTH )
  }
  if( value && typeof value === 'object' && 'stack' in value ) {
    return trimMultiline( String( ( value as { stack?: unknown } ).stack ?? '' ), MAX_STACK_LENGTH )
  }
  return ''
}

const normalizeError = (value: unknown): NormalizedError => {
  const code = getErrorCode( value )
  const messageRaw = trimMultiline( getErrorMessage( value ) || 'Unexpected error', MAX_MESSAGE_LENGTH )
  return {
    code,
    messageRaw,
    messageNormalized: normalizeMessageForFingerprint( messageRaw ),
    stack: getErrorStack( value ),
    name: getErrorName( value ),
  }
}

const isNormalBusinessMessage = (normalizedMessage: string): boolean =>
  NORMAL_MESSAGE_PATTERNS.some( ( pattern ) => pattern.test( normalizedMessage ) )

const resolveSource = (code: string, explicitSource?: MonitorSource): MonitorSource => {
  if( explicitSource ) {
    return explicitSource
  }
  const loweredCode = code.toLowerCase()
  if( loweredCode.startsWith( 'auth/' ) ) {
    return 'auth'
  }
  if( loweredCode.startsWith( 'storage/' ) ) {
    return 'storage'
  }
  if( loweredCode.includes( 'permission-denied' ) || loweredCode.includes( 'firestore/' ) ) {
    return 'firestore'
  }
  return 'unknown'
}

const classifyError = (
  normalized: NormalizedError,
  action: string,
  explicitSource?: MonitorSource,
): ClassifiedError | null => {
  const loweredCode = normalized.code.toLowerCase()
  const source = resolveSource( loweredCode, explicitSource )
  const isWriteAction = WRITE_ACTION_PATTERN.test( action )
  const isReadAction = READ_ACTION_PATTERN.test( action )

  if( loweredCode && NORMAL_ERROR_CODES.has( loweredCode ) ) {
    return null
  }
  if( isNormalBusinessMessage( normalized.messageRaw ) || isNormalBusinessMessage( normalized.messageNormalized ) ) {
    return null
  }
  if( normalized.name === 'AbortError' ) {
    return null
  }

  if(
    loweredCode.includes( 'permission-denied' )
    || normalized.messageNormalized.includes( 'missing or insufficient permissions' )
    || normalized.messageNormalized.includes( 'permission-denied' )
  ) {
    return {
      category: 'permission',
      severity: 'high',
      source,
      ...normalized,
    }
  }

  if(
    loweredCode.includes( 'unauthenticated' )
    || loweredCode.includes( 'auth/network-request-failed' )
    || loweredCode.includes( 'auth/internal-error' )
    || loweredCode.includes( 'auth/user-token-expired' )
  ) {
    return {
      category: 'auth',
      severity: 'high',
      source: source === 'unknown' ? 'auth' : source,
      ...normalized,
    }
  }

  if(
    loweredCode.includes( 'unavailable' )
    || loweredCode.includes( 'deadline-exceeded' )
    || loweredCode.includes( 'resource-exhausted' )
    || normalized.messageNormalized.includes( 'network error' )
    || normalized.messageNormalized.includes( 'failed to fetch' )
  ) {
    return {
      category: 'network',
      severity: isWriteAction ? 'high' : 'medium',
      source: source === 'unknown' ? 'network' : source,
      ...normalized,
    }
  }

  if(
    loweredCode.includes( 'internal' )
    || loweredCode.includes( 'unknown' )
    || loweredCode.includes( 'data-loss' )
    || loweredCode.includes( 'aborted' )
  ) {
    return {
      category: 'runtime',
      severity: isWriteAction ? 'high' : 'medium',
      source,
      ...normalized,
    }
  }

  if(
    normalized.messageNormalized.includes( 'failed' )
    || normalized.messageNormalized.includes( 'exception' )
    || normalized.messageNormalized.includes( 'unexpected error' )
    || normalized.messageNormalized.includes( 'internal server error' )
  ) {
    return {
      category: source === 'auth' ? 'auth' : source === 'network' ? 'network' : 'firebase',
      severity: isWriteAction ? 'high' : isReadAction ? 'medium' : 'low',
      source,
      ...normalized,
    }
  }

  if( normalized.stack ) {
    return {
      category: 'runtime',
      severity: 'high',
      source: source === 'unknown' ? 'ui' : source,
      ...normalized,
    }
  }

  return null
}

const buildFingerprint = (
  classified: ClassifiedError,
  route: string,
  action: string,
): string => simpleHash( [
  classified.source,
  classified.category,
  classified.code,
  classified.messageNormalized,
  route,
  action,
].join( '|' ) )

const shouldSkipLocalDuplicate = (fingerprint: string): boolean => {
  const now = Date.now()
  const previous = localDedupeByFingerprint.get( fingerprint ) ?? 0
  localDedupeByFingerprint.set( fingerprint, now )

  for( const [ key, timestamp ] of localDedupeByFingerprint.entries() ) {
    if( now - timestamp > LOCAL_DEDUPE_WINDOW_MS ) {
      localDedupeByFingerprint.delete( key )
    }
  }

  return now - previous < LOCAL_DEDUPE_WINDOW_MS
}

const buildRoute = (route?: string): string => {
  if( route && route.trim() ) {
    return route.trim()
  }
  if( typeof window === 'undefined' ) {
    return monitorContext.route
  }
  const { pathname, search, hash } = window.location
  return `${pathname}${search}${hash}`
}

const buildPageUrl = (pageUrl?: string): string => {
  if( pageUrl && pageUrl.trim() ) {
    return pageUrl.trim()
  }
  if( typeof window === 'undefined' ) {
    return monitorContext.pageUrl
  }
  return window.location.href
}

const warnMissingEndpoint = () => {
  if( warnedMissingMonitorEndpoint ) {
    return
  }
  warnedMissingMonitorEndpoint = true
  console.warn( 'VITE_FIREBASE_MONITOR_FUNCTION_URL is missing. Abnormal error monitoring is disabled.' )
}

export const setErrorMonitorContext = (nextContext: MonitorContext): void => {
  monitorContext.route = nextContext.route ?? monitorContext.route
  monitorContext.pageUrl = nextContext.pageUrl ?? monitorContext.pageUrl
  monitorContext.userId = nextContext.userId ?? monitorContext.userId
  monitorContext.userEmail = nextContext.userEmail ?? monitorContext.userEmail
}

export const reportAbnormalError = async (input: ReportAbnormalErrorInput): Promise<boolean> => {
  if( typeof window === 'undefined' ) {
    return false
  }
  if( !FIREBASE_MONITOR_FUNCTION_URL ) {
    warnMissingEndpoint()
    return false
  }

  const normalized = normalizeError( input.error )
  const action = trimAndCollapseWhitespace( input.action ?? 'unknown', 120 )
  const classified = classifyError( normalized, action, input.source )
  if( !classified ) {
    return false
  }

  const route = buildRoute( input.route || monitorContext.route )
  const fingerprint = buildFingerprint( classified, route, action )
  if( shouldSkipLocalDuplicate( fingerprint ) ) {
    return false
  }

  const user = auth.currentUser
  if( !user ) {
    return false
  }

  try {
    const idToken = await user.getIdToken()
    const payload = {
      fingerprint,
      category: classified.category,
      severity: classified.severity,
      source: classified.source,
      code: classified.code,
      name: classified.name,
      messageRaw: classified.messageRaw,
      messageNormalized: classified.messageNormalized,
      stack: classified.stack,
      route,
      pageUrl: buildPageUrl( input.pageUrl || monitorContext.pageUrl ),
      action,
      actorId: input.userId ?? monitorContext.userId ?? user.uid,
      actorEmail: input.userEmail ?? monitorContext.userEmail ?? user.email ?? '',
      projectId: input.projectId ?? '',
      docId: input.docId ?? '',
      versionId: input.versionId ?? '',
      threadId: input.threadId ?? '',
      userAgent: trimAndCollapseWhitespace( window.navigator.userAgent ?? '', 400 ),
      appBuild: APP_BUILD,
      clientTimestamp: new Date().toISOString(),
    }
    const response = await fetch( FIREBASE_MONITOR_FUNCTION_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify( payload ),
    } )
    if( !response.ok ) {
      const responseText = await response.text().catch( () => response.statusText )
      console.warn( 'Abnormal error monitor failed:', response.status, responseText )
      return false
    }
    return true
  } catch( err ) {
    console.warn( 'Abnormal error monitor request failed:', err )
    return false
  }
}

export const installGlobalErrorMonitoring = (): void => {
  if( typeof window === 'undefined' || globalHandlersInstalled ) {
    return
  }
  globalHandlersInstalled = true

  window.addEventListener( 'error', ( event ) => {
    void reportAbnormalError( {
      error: event.error ?? event.message,
      source: 'ui',
      action: 'global.error',
    } )
  } )

  window.addEventListener( 'unhandledrejection', ( event ) => {
    void reportAbnormalError( {
      error: event.reason ?? 'Unhandled promise rejection',
      source: 'ui',
      action: 'global.unhandledrejection',
    } )
  } )
}

