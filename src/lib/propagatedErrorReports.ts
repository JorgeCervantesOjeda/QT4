// src/lib/propagatedErrorReports.ts
// Calls backend operations for accepted error-report propagation retries.
import { auth } from './firebase'

export type PropagatedErrorReportFailure = {
  reason: string
  targetProjectId?: string
  targetDocId?: string
  targetVersionId?: string
  sourceFileRefId?: string
}

export type PropagatedErrorReportsResult = {
  createdCount: number
  skippedCount: number
  failedCount: number
  failures: PropagatedErrorReportFailure[]
}

export type RetryPropagatedErrorReportsRequest = {
  projectId: string
  docId: string
  versionId: string
}

export type RetryPropagatedErrorReportsResponse =
  RetryPropagatedErrorReportsRequest
  & PropagatedErrorReportsResult
  & { ok: true }

type RetryPropagatedErrorReportsOptions = {
  functionUrl?: string
}

const configuredFunctionUrl = (
  import.meta.env.VITE_FIREBASE_RETRY_PROPAGATED_ERROR_REPORTS_FUNCTION_URL ?? ''
).trim()

const normalizeCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite( value ) ? value : 0

const emptyPropagatedErrorReportsResult = (): PropagatedErrorReportsResult => ( {
  createdCount: 0,
  skippedCount: 0,
  failedCount: 0,
  failures: [],
} )

const normalizeFailure = (value: unknown): PropagatedErrorReportFailure | null => {
  if( !value || typeof value !== 'object' ) {
    return null
  }
  const data = value as Partial<Record<keyof PropagatedErrorReportFailure, unknown>>
  const reason = typeof data.reason === 'string' ? data.reason.trim() : ''
  if( !reason ) {
    return null
  }
  return {
    reason,
    targetProjectId: typeof data.targetProjectId === 'string' ? data.targetProjectId : undefined,
    targetDocId: typeof data.targetDocId === 'string' ? data.targetDocId : undefined,
    targetVersionId: typeof data.targetVersionId === 'string' ? data.targetVersionId : undefined,
    sourceFileRefId: typeof data.sourceFileRefId === 'string' ? data.sourceFileRefId : undefined,
  }
}

export const normalizePropagatedErrorReportsResult = (
  value: unknown,
): PropagatedErrorReportsResult => {
  if( !value || typeof value !== 'object' ) {
    return emptyPropagatedErrorReportsResult()
  }
  const data = value as Partial<PropagatedErrorReportsResult>
  return {
    createdCount: normalizeCount( data.createdCount ),
    skippedCount: normalizeCount( data.skippedCount ),
    failedCount: normalizeCount( data.failedCount ),
    failures: Array.isArray( data.failures )
      ? data.failures
          .map( normalizeFailure )
          .filter( (item): item is PropagatedErrorReportFailure => item !== null )
      : [],
  }
}

const readErrorText = async (resp: Response): Promise<string> => {
  try {
    const contentType = resp.headers.get( 'Content-Type' ) ?? ''
    if( contentType.includes( 'application/json' ) ) {
      const data = await resp.json() as { error?: unknown }
      if( typeof data.error === 'string' && data.error.trim() ) {
        return data.error.trim()
      }
    }
    const text = await resp.text()
    return text || resp.statusText
  } catch {
    return resp.statusText
  }
}

const resolveFunctionUrl = (options?: RetryPropagatedErrorReportsOptions): string => {
  const explicitUrl = ( options?.functionUrl ?? configuredFunctionUrl ).trim()
  if( explicitUrl ) {
    return explicitUrl
  }
  if( typeof window !== 'undefined' && window.location.origin ) {
    return `${window.location.origin}/retry-propagated-error-reports`
  }
  throw new Error( 'Propagated error report retry function URL is not configured.' )
}

export const requestRetryPropagatedErrorReports = async (
  request: RetryPropagatedErrorReportsRequest,
  options?: RetryPropagatedErrorReportsOptions,
): Promise<RetryPropagatedErrorReportsResponse> => {
  const user = auth.currentUser
  if( !user ) {
    throw new Error( 'User session is required.' )
  }
  let idToken = ''
  try {
    idToken = await user.getIdToken()
  } catch {
    idToken = await user.getIdToken( true )
  }
  const resp = await fetch( resolveFunctionUrl( options ), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify( request ),
  } )
  if( !resp.ok ) {
    const text = await readErrorText( resp )
    throw new Error( `Propagated error report retry failed (${resp.status}): ${text}` )
  }
  const data = await resp.json() as Partial<RetryPropagatedErrorReportsResponse>
  if( data.ok !== true || data.versionId !== request.versionId ) {
    throw new Error( 'Propagated error report retry returned an invalid response.' )
  }
  return {
    ok: true,
    projectId: data.projectId ?? request.projectId,
    docId: data.docId ?? request.docId,
    versionId: data.versionId,
    ...normalizePropagatedErrorReportsResult( data ),
  }
}
