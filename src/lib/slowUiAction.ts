// src/lib/slowUiAction.ts: Measures non-modal UI actions and records slow cases for a daily admin digest.
type SlowUiActionContext = {
  action: string
  page: string
  hasModal?: boolean
  userId?: string | null
  projectId?: string | null
  docId?: string | null
  versionId?: string | null
  threadId?: string | null
  route?: string | null
}

type SlowUiActionEvent = Required<Pick<
  SlowUiActionContext,
  'action' | 'page' | 'hasModal'
>> & {
  route: string
  userId: string
  projectId: string
  docId: string
  versionId: string
  threadId: string
  durationMs: number
  thresholdMs: number
  startedAtMs: number
  endedAtMs: number
}

type MeasureSlowUiActionDeps = {
  nowMs?: () => number
  reportSlowUiAction?: (event: SlowUiActionEvent) => Promise<void> | void
}

const SLOW_UI_ACTION_THRESHOLD_MS = 1000

const trimSingleLine = (value: unknown, maxLength: number): string =>
  String( value ?? '' ).replace( /\s+/g, ' ' ).trim().slice( 0, maxLength )

const buildSlowUiActionEvent = (
  context: SlowUiActionContext,
  startedAtMs: number,
  endedAtMs: number,
): SlowUiActionEvent => ( {
  action: trimSingleLine( context.action, 120 ) || 'unknown',
  page: trimSingleLine( context.page, 120 ) || 'unknown',
  hasModal: context.hasModal === true,
  route: trimSingleLine( context.route, 240 ),
  userId: trimSingleLine( context.userId, 128 ),
  projectId: trimSingleLine( context.projectId, 128 ),
  docId: trimSingleLine( context.docId, 128 ),
  versionId: trimSingleLine( context.versionId, 128 ),
  threadId: trimSingleLine( context.threadId, 128 ),
  durationMs: Math.max( 0, Math.round( endedAtMs - startedAtMs ) ),
  thresholdMs: SLOW_UI_ACTION_THRESHOLD_MS,
  startedAtMs,
  endedAtMs,
} )

const reportSlowUiActionToFirestore = async (event: SlowUiActionEvent): Promise<void> => {
  const [
    { addDoc, collection, serverTimestamp, Timestamp },
    { auth, db },
  ] = await Promise.all( [
    import( 'firebase/firestore' ),
    import( './firebase' ),
  ] )
  const currentUserId = auth.currentUser?.uid ?? ''
  const userId = event.userId || currentUserId
  if( !userId ) {
    console.warn( 'Slow UI action reporting skipped: user session is missing.' )
    return
  }

  await addDoc( collection( db, 'slowUiActions' ), {
    action: event.action,
    page: event.page,
    route: event.route,
    hasModal: event.hasModal,
    userId,
    projectId: event.projectId,
    docId: event.docId,
    versionId: event.versionId,
    threadId: event.threadId,
    durationMs: event.durationMs,
    thresholdMs: event.thresholdMs,
    startedAt: Timestamp.fromMillis( event.startedAtMs ),
    endedAt: Timestamp.fromMillis( event.endedAtMs ),
    createdAt: serverTimestamp(),
    reportedAt: null,
  } )
}

const measureSlowUiAction = async <T>(
  context: SlowUiActionContext,
  operation: () => Promise<T> | T,
  deps: MeasureSlowUiActionDeps = {},
): Promise<T> => {
  const nowMs = deps.nowMs ?? Date.now
  const reportSlowUiAction = deps.reportSlowUiAction ?? reportSlowUiActionToFirestore
  const startedAtMs = nowMs()
  try {
    return await operation()
  } finally {
    const endedAtMs = nowMs()
    const event = buildSlowUiActionEvent( context, startedAtMs, endedAtMs )
    if( !event.hasModal && event.durationMs > SLOW_UI_ACTION_THRESHOLD_MS ) {
      try {
        void Promise.resolve( reportSlowUiAction( event ) ).catch( (err) => {
          console.warn( 'Slow UI action reporting failed:', err )
        } )
      } catch( err ) {
        console.warn( 'Slow UI action reporting failed:', err )
      }
    }
  }
}

export {
  SLOW_UI_ACTION_THRESHOLD_MS,
  measureSlowUiAction,
  reportSlowUiActionToFirestore,
}
export type {
  MeasureSlowUiActionDeps,
  SlowUiActionContext,
  SlowUiActionEvent,
}
