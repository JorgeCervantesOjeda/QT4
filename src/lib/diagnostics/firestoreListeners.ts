import { logClientDiagnostic } from './clientDiagnostics'
import { getRouteDiagnosticContext } from './routeContext'

export type FirestoreListenerContext = {
  label: string
  projectId?: string
  documentId?: string
  versionId?: string
  threadId?: string
  focus?: string
  queryDescription?: string
}

export type ActiveFirestoreListener = FirestoreListenerContext & {
  id: string
  createdAt: string
  route: string
  pageUrl: string
}

const activeFirestoreListeners = new Map<string, ActiveFirestoreListener>()

export function trackFirestoreListener(context: FirestoreListenerContext) {
  const id = crypto.randomUUID()
  const routeContext = getRouteDiagnosticContext()

  const listener: ActiveFirestoreListener = {
    id,
    createdAt: new Date().toISOString(),

    label: context.label,
    projectId: context.projectId || routeContext.urlProjectId,
    documentId: context.documentId || routeContext.urlDocumentId,
    versionId: context.versionId || routeContext.urlVersionId,
    threadId: context.threadId || routeContext.urlThreadId,
    focus: context.focus || routeContext.urlFocus,
    queryDescription: context.queryDescription,

    route: routeContext.route,
    pageUrl: routeContext.pageUrl,
  }

  activeFirestoreListeners.set( id, listener )

  logClientDiagnostic( 'firestore.listener.created', {
    ...listener,
    activeListenerCount: activeFirestoreListeners.size,
    online: routeContext.online,
    visibilityState: routeContext.visibilityState,
  } )

  return {
    id,

    recordSnapshot(data: Record<string, unknown> = {}) {
      logClientDiagnostic( 'firestore.listener.snapshot', {
        id,
        label: listener.label,
        activeListenerCount: activeFirestoreListeners.size,
        ...data,
      } )
    },

    recordError(error: unknown) {
      logClientDiagnostic( 'firestore.listener.error', {
        id,
        label: listener.label,
        activeListenerCount: activeFirestoreListeners.size,
        errorName: error instanceof Error ? error.name : '',
        errorMessage: error instanceof Error ? error.message : String( error ),
        errorStack: error instanceof Error ? error.stack : '',
      } )
    },

    dispose() {
      activeFirestoreListeners.delete( id )

      logClientDiagnostic( 'firestore.listener.disposed', {
        id,
        label: listener.label,
        activeListenerCount: activeFirestoreListeners.size,
      } )
    },
  }
}

export function getActiveFirestoreListeners(): ActiveFirestoreListener[] {
  return Array.from( activeFirestoreListeners.values() )
}