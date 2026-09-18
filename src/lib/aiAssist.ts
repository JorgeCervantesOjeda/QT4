// AI assist client for focused Gemini-backed actions in QT4.
import { auth } from './firebase'
import { consumeInjectedTestFault } from './testFaults'

export type AiAssistMode = 'draft_issue_title' | 'explain_comment' | 'explain_thread' | 'improve_text' | 'summarize_pending'

export type AiAssistRequest =
  | { mode: 'draft_issue_title'; text: string; language?: 'auto' | 'es' | 'en' }
  | { mode: 'explain_comment'; commentId: string; language?: 'auto' | 'es' | 'en' }
  | { mode: 'explain_thread'; threadId: string; language?: 'auto' | 'es' | 'en' }
  | { mode: 'improve_text'; text: string; threadId?: string; language?: 'auto' | 'es' | 'en' }
  | { mode: 'summarize_pending'; language?: 'auto' | 'es' | 'en' }

export type AiAssistResponse = {
  ok: true
  mode: AiAssistMode
  result: string
}

type AiAssistOptions = {
  functionUrl?: string
}

const configuredFunctionUrl = (
  import.meta.env.VITE_FIREBASE_AI_ASSIST_FUNCTION_URL ?? ''
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

const resolveFunctionUrl = (options?: AiAssistOptions): string => {
  const explicitUrl = ( options?.functionUrl ?? configuredFunctionUrl ).trim()
  if( explicitUrl ) {
    return explicitUrl
  }
  if( typeof window !== 'undefined' && window.location.origin ) {
    return `${window.location.origin}/ai-assist`
  }
  throw new Error( 'AI assist function URL is not configured.' )
}

export const requestAiAssist = async (
  request: AiAssistRequest,
  options?: AiAssistOptions,
): Promise<AiAssistResponse> => {
  const injectedFault = consumeInjectedTestFault( 'aiAssist.request', request.mode )
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
    throw new Error( `AI assist failed (${resp.status}): ${text}` )
  }
  const data = await resp.json() as Partial<AiAssistResponse>
  if( data.ok !== true || typeof data.result !== 'string' || !data.result.trim() ) {
    throw new Error( 'AI assist returned an empty response.' )
  }
  return {
    ok: true,
    mode: data.mode ?? request.mode,
    result: data.result.trim(),
  }
}
