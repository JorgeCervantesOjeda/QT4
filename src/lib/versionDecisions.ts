// src/lib/versionDecisions.ts
// Calls the backend authority for transactional version accept/reject decisions.
import { auth } from './firebase'
import { consumeInjectedTestFault } from './testFaults'

export type VersionDecision = 'accept' | 'reject'

export type VersionDecisionRequest = {
  decision: VersionDecision
  projectId: string
  docId: string
  versionId: string
}

export type VersionDecisionResponse = {
  ok: true
  decision: VersionDecision
  projectId: string
  docId: string
  versionId: string
  promotedNumber: number | null
  replacedVersionIds: string[]
}

type VersionDecisionOptions = {
  functionUrl?: string
}

const configuredFunctionUrl = (
  import.meta.env.VITE_FIREBASE_VERSION_DECISION_FUNCTION_URL ?? ''
).trim()

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

const resolveFunctionUrl = (options?: VersionDecisionOptions): string => {
  const explicitUrl = ( options?.functionUrl ?? configuredFunctionUrl ).trim()
  if( explicitUrl ) {
    return explicitUrl
  }
  if( typeof window !== 'undefined' && window.location.origin ) {
    return `${window.location.origin}/version-decision`
  }
  throw new Error( 'Version decision function URL is not configured.' )
}

export const requestVersionDecision = async (
  request: VersionDecisionRequest,
  options?: VersionDecisionOptions,
): Promise<VersionDecisionResponse> => {
  const injectedFault = consumeInjectedTestFault( 'versionDecisions.request', request.decision )
  if( injectedFault ) {
    throw injectedFault
  }
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
    throw new Error( `Version decision failed (${resp.status}): ${text}` )
  }
  const data = await resp.json() as Partial<VersionDecisionResponse>
  if( data.ok !== true || data.decision !== request.decision || data.versionId !== request.versionId ) {
    throw new Error( 'Version decision returned an invalid response.' )
  }
  return {
    ok: true,
    decision: data.decision,
    projectId: data.projectId ?? request.projectId,
    docId: data.docId ?? request.docId,
    versionId: data.versionId,
    promotedNumber: typeof data.promotedNumber === 'number' ? data.promotedNumber : null,
    replacedVersionIds: Array.isArray( data.replacedVersionIds ) ? data.replacedVersionIds : [],
  }
}
