import type { NotificationProviderKind } from '../domain/types'
import { notifyEmail as notifyEmailWithFilesApi } from './filesApi'
import { auth } from './firebase'
import { loadAppRuntimeConfig } from './runtimeConfig'
import { consumeInjectedTestFault } from './testFaults'

type NotifyEmailParams = {
  to: string[]
  cc?: string[]
  subject: string
  text: string
}

const FIREBASE_NOTIFY_FUNCTION_URL = (
  import.meta.env.VITE_FIREBASE_NOTIFY_FUNCTION_URL ?? ''
).trim()

const readErrorText = async (resp: Response): Promise<string> => {
  try {
    const text = await resp.text()
    return text || resp.statusText
  } catch {
    return resp.statusText
  }
}

const resolveProvider = async (
  preferred?: NotificationProviderKind,
): Promise<NotificationProviderKind> => {
  if( preferred ) {
    return preferred
  }
  const { config } = await loadAppRuntimeConfig()
  return config.emailProvider
}

const notifyEmailWithFirebaseFunctions = async (params: NotifyEmailParams): Promise<void> => {
  if( !FIREBASE_NOTIFY_FUNCTION_URL ) {
    throw new Error(
      'Email provider firebase-functions is enabled but VITE_FIREBASE_NOTIFY_FUNCTION_URL is missing.',
    )
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
  const resp = await fetch( FIREBASE_NOTIFY_FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
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

export const notifyEmailUsingActiveProvider = async (
  params: NotifyEmailParams,
  provider?: NotificationProviderKind,
): Promise<void> => {
  const injectedFault = consumeInjectedTestFault( 'notifications.notifyEmail', params.subject )
  if( injectedFault ) {
    throw injectedFault
  }
  const resolvedProvider = await resolveProvider( provider )
  if( resolvedProvider === 'firebase-functions' ) {
    await notifyEmailWithFirebaseFunctions( params )
    return
  }
  await notifyEmailWithFilesApi( params )
}
