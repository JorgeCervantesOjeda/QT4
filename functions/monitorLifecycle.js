// functions/monitorLifecycle.js
// Identifies harmless Firebase Auth persistence lifecycle rejections.
const isTolerableFirebaseAuthLifecyclePayload = ( payload ) => {
  const action = String( payload?.action ?? '' ).trim()
  const message = String( payload?.messageNormalized ?? payload?.messageRaw ?? '' ).toLowerCase()
  const stack = String( payload?.stack ?? '' )
  const hasFirebaseAuthPersistenceFrame = [
    'setCurrentUser',
    'directlySetCurrentUser',
    'reloadAndSetCurrentUserOrClear',
  ].some( ( frame ) => stack.includes( frame ) )

  return (
    action === 'global.unhandledrejection'
    && message.includes( 'database is closing/hidden' )
    && hasFirebaseAuthPersistenceFrame
  )
}

module.exports = {
  isTolerableFirebaseAuthLifecyclePayload,
}
