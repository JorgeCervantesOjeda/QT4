// functions/slowUiDigest.js: Builds and sends daily digests for slow non-modal UI actions.
const SLOW_UI_ACTION_LIMIT = 200

const trimSingleLine = (value, maxLength = 200) =>
  String( value || "" ).replace( /\s+/g, " " ).trim().slice( 0, maxLength )

const formatTimestamp = (value) => {
  if( value && typeof value.toDate === "function" ) {
    return value.toDate().toISOString()
  }
  if( typeof value === "number" && Number.isFinite( value ) ) {
    return new Date( value ).toISOString()
  }
  return "-"
}

const readEvent = (snapshot) => {
  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    action: trimSingleLine( data.action, 120 ) || "unknown",
    page: trimSingleLine( data.page, 120 ) || "unknown",
    route: trimSingleLine( data.route, 240 ),
    userId: trimSingleLine( data.userId, 128 ) || "unknown",
    projectId: trimSingleLine( data.projectId, 128 ),
    docId: trimSingleLine( data.docId, 128 ),
    versionId: trimSingleLine( data.versionId, 128 ),
    threadId: trimSingleLine( data.threadId, 128 ),
    durationMs: Number.isFinite( Number( data.durationMs ) )
      ? Math.max( 0, Math.round( Number( data.durationMs ) ) )
      : 0,
    thresholdMs: Number.isFinite( Number( data.thresholdMs ) )
      ? Math.max( 0, Math.round( Number( data.thresholdMs ) ) )
      : 1000,
    startedAt: data.startedAt,
    startedAtMs: data.startedAtMs,
  }
}

const groupDigestEvents = (events) => {
  const groupsByKey = new Map()
  for( const event of events ) {
    const key = `${event.page} / ${event.action}`
    const current = groupsByKey.get( key ) || {
      key,
      count: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      routes: new Set(),
    }
    current.count += 1
    current.totalDurationMs += event.durationMs
    current.maxDurationMs = Math.max( current.maxDurationMs, event.durationMs )
    if( event.route ) {
      current.routes.add( event.route )
    }
    groupsByKey.set( key, current )
  }
  return [ ...groupsByKey.values() ]
    .sort( (a, b) => b.maxDurationMs - a.maxDurationMs || b.count - a.count )
}

const buildSlowUiActionDigest = (events, now = new Date()) => {
  const normalizedEvents = events.map( (event) => (
    typeof event.data === "function" ? readEvent( event ) : {
      id: trimSingleLine( event.id, 128 ) || "unknown",
      action: trimSingleLine( event.action, 120 ) || "unknown",
      page: trimSingleLine( event.page, 120 ) || "unknown",
      route: trimSingleLine( event.route, 240 ),
      userId: trimSingleLine( event.userId, 128 ) || "unknown",
      projectId: trimSingleLine( event.projectId, 128 ),
      docId: trimSingleLine( event.docId, 128 ),
      versionId: trimSingleLine( event.versionId, 128 ),
      threadId: trimSingleLine( event.threadId, 128 ),
      durationMs: Math.max( 0, Math.round( Number( event.durationMs ) || 0 ) ),
      thresholdMs: Math.max( 0, Math.round( Number( event.thresholdMs ) || 1000 ) ),
      startedAt: event.startedAt,
      startedAtMs: event.startedAtMs,
    }
  ) )
  const groups = groupDigestEvents( normalizedEvents )
  const subject = `[QT4][UX] ${normalizedEvents.length} slow non-modal action${normalizedEvents.length === 1 ? "" : "s"}`
  const groupLines = groups.slice( 0, 20 ).flatMap( (group) => {
    const averageDurationMs = Math.round( group.totalDurationMs / Math.max( group.count, 1 ) )
    const routeList = [ ...group.routes ].slice( 0, 3 ).join( ", " ) || "-"
    return [
      `${group.key}: count=${group.count}, avg=${averageDurationMs}ms, max=${group.maxDurationMs}ms`,
      `  routes=${routeList}`,
    ]
  } )
  const sampleLines = normalizedEvents
    .sort( (a, b) => b.durationMs - a.durationMs )
    .slice( 0, 50 )
    .map( (event) => [
      `- ${event.durationMs}ms ${event.page}/${event.action}`,
      `event=${event.id}`,
      `user=${event.userId}`,
      event.projectId ? `project=${event.projectId}` : "",
      event.docId ? `doc=${event.docId}` : "",
      event.versionId ? `version=${event.versionId}` : "",
      event.threadId ? `thread=${event.threadId}` : "",
      `started=${formatTimestamp( event.startedAt || event.startedAtMs )}`,
    ].filter( Boolean ).join( ", " ) )
  const text = [
    "QT4 detected UI actions that took more than 1 second without a modal.",
    "",
    `Digest generated at: ${now.toISOString()}`,
    `Pending events included: ${normalizedEvents.length}`,
    "",
    "Groups:",
    ...groupLines,
    "",
    "Slowest samples:",
    ...sampleLines,
  ].join( "\n" )
  return { subject, text }
}

const createSlowUiActionDigestJob = ({
  admin,
  logger,
  now = () => new Date(),
  getRecipients,
  sendTextEmail,
}) => async () => {
  const db = admin.firestore()
  const snapshot = await db
    .collection( "slowUiActions" )
    .where( "reportedAt", "==", null )
    .limit( SLOW_UI_ACTION_LIMIT )
    .get()
  const docs = snapshot.docs || []

  if( docs.length === 0 ) {
    logger.info( "slowUiActionDigest skipped", { reason: "no_events" } )
    return
  }

  const recipients = getRecipients()
  if( recipients.length === 0 ) {
    logger.warn( "slowUiActionDigest skipped", { reason: "recipients_missing", eventCount: docs.length } )
    return
  }

  const digestId = `slow-ui-${now().toISOString().slice( 0, 10 )}`
  const digest = buildSlowUiActionDigest( docs, now() )
  await sendTextEmail( {
    to: recipients,
    subject: digest.subject,
    text: digest.text,
  } )

  const batch = db.batch()
  for( const docSnapshot of docs ) {
    batch.set( docSnapshot.ref, {
      reportedAt: admin.firestore.FieldValue.serverTimestamp(),
      digestId,
      digestStatus: "sent",
    }, { merge: true } )
  }
  await batch.commit()
  logger.info( "slowUiActionDigest sent", { eventCount: docs.length, recipientCount: recipients.length } )
}

module.exports = {
  SLOW_UI_ACTION_LIMIT,
  buildSlowUiActionDigest,
  createSlowUiActionDigestJob,
}
