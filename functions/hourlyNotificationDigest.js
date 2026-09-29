// functions/hourlyNotificationDigest.js: Sends per-user hourly digests for related notification events.
const { resolveNotificationPreferences } = require( "./notificationPreferences" )

const HOURLY_NOTIFICATION_DIGEST_LIMIT = 500
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const trimSingleLine = (value, maxLength = 200) =>
  String( value || "" ).replace( /\s+/g, " " ).trim().slice( 0, maxLength )

const trimMultiline = (value, maxLength = 1000) =>
  String( value || "" ).replace( /\r\n/g, "\n" ).trim().slice( 0, maxLength )

const readSnapshotData = (snapshot) => {
  if( !snapshot || snapshot.exists === false ) {
    return null
  }
  return {
    id: snapshot.id || "",
    ...( snapshot.data() || {} ),
  }
}

const normalizeEmail = (value) => {
  const email = trimSingleLine( value, 200 ).toLowerCase()
  return EMAIL_PATTERN.test( email ) ? email : ""
}

const normalizeEvent = (snapshot) => {
  const data = typeof snapshot.data === "function" ? snapshot.data() || {} : snapshot
  return {
    id: trimSingleLine( snapshot.id || data.id, 128 ),
    ref: snapshot.ref,
    userId: trimSingleLine( data.userId, 128 ),
    email: normalizeEmail( data.email ),
    kind: trimSingleLine( data.kind, 32 ) || "comment",
    digestHourKey: trimSingleLine( data.digestHourKey, 32 ),
    actorLabel: trimSingleLine( data.actorLabel, 200 ) || "Unknown user",
    documentLabel: trimSingleLine( data.documentLabel, 240 ) || "Document",
    issueTitle: trimSingleLine( data.issueTitle, 240 ) || "Untitled issue",
    commentExcerpt: trimMultiline( data.commentExcerpt, 500 ),
    directUrl: trimSingleLine( data.directUrl, 1000 ),
  }
}

const normalizeProfile = (userId, profile) => ( {
  userId,
  email: normalizeEmail( profile?.email ),
  preferences: resolveNotificationPreferences( profile?.notificationPreferences ),
} )

const buildClosedHourCutoffKey = (date) => date.toISOString().slice( 0, 13 )

const isClosedHourEvent = (event, cutoffHourKey) =>
  Boolean( event.userId && event.digestHourKey && event.ref && event.digestHourKey < cutoffHourKey )

const groupEventsByUserHour = (events) => {
  const groupsByKey = new Map()
  for( const event of events ) {
    const key = `${event.userId}_${event.digestHourKey}`
    const group = groupsByKey.get( key ) || {
      digestId: key,
      hourKey: event.digestHourKey,
      userId: event.userId,
      events: [],
    }
    group.events.push( event )
    groupsByKey.set( key, group )
  }
  return [ ...groupsByKey.values() ]
    .sort( (a, b) => a.digestId.localeCompare( b.digestId ) )
}

const buildHourlyNotificationDigest = (events, hourKey) => {
  const normalizedEvents = events.map( normalizeEvent )
  const subject = `[QT4] Hourly activity summary (${normalizedEvents.length})`
  const eventLines = normalizedEvents.flatMap( (event, index) => [
    `${index + 1}. ${event.kind === "issue" ? "Issue activity" : "Comment activity"}`,
    `Document: ${event.documentLabel}`,
    `Issue: ${event.issueTitle}`,
    `Actor: ${event.actorLabel}`,
    event.commentExcerpt ? `Comment: ${event.commentExcerpt}` : "",
    event.directUrl ? `Open: ${event.directUrl}` : "",
    "",
  ].filter( (line) => line !== "" ) )
  const text = [
    "QT4 hourly activity summary.",
    "",
    `Hour: ${hourKey}`,
    `Related items: ${normalizedEvents.length}`,
    "",
    ...eventLines,
  ].join( "\n" ).trim()
  return { subject, text }
}

const writeEventStatuses = async ({ admin, db, digestId, events, status, extra = {} }) => {
  const batch = db.batch()
  for( const event of events ) {
    batch.set( event.ref, {
      digestId,
      digestStatus: status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...extra,
    }, { merge: true } )
  }
  await batch.commit()
}

const loadUserProfile = async (db, userId) =>
  normalizeProfile(
    userId,
    readSnapshotData( await db.collection( "userProfiles" ).doc( userId ).get() ),
  )

const createHourlyNotificationDigestJob = ({
  admin,
  logger,
  now = () => new Date(),
  getTimeZone = () => "America/Mexico_City",
  sendTextEmail,
}) => async () => {
  const db = admin.firestore()
  const cutoffHourKey = buildClosedHourCutoffKey( now() )
  const snapshot = await db
    .collection( "notificationEvents" )
    .where( "digestStatus", "==", "pending" )
    .where( "digestHourKey", "<", cutoffHourKey )
    .orderBy( "digestHourKey", "asc" )
    .limit( HOURLY_NOTIFICATION_DIGEST_LIMIT )
    .get()
  const events = ( snapshot.docs || [] )
    .map( normalizeEvent )
    .filter( (event) => isClosedHourEvent( event, cutoffHourKey ) )

  if( events.length === 0 ) {
    logger.info( "hourlyNotificationDigest skipped", {
      reason: "no_closed_pending_events",
      cutoffHourKey,
      timeZone: getTimeZone(),
    } )
    return
  }

  for( const group of groupEventsByUserHour( events ) ) {
    const digestRef = db.collection( "notificationDigests" ).doc( group.digestId )
    const existingDigest = readSnapshotData( await digestRef.get() )
    if( [ "sent", "skipped" ].includes( existingDigest?.digestStatus ) ) {
      await writeEventStatuses( {
        admin,
        db,
        digestId: group.digestId,
        events: group.events,
        status: existingDigest.digestStatus,
      } )
      logger.info( "hourlyNotificationDigest skipped", {
        reason: "terminal_digest_exists",
        digestId: group.digestId,
        digestStatus: existingDigest.digestStatus,
      } )
      continue
    }
    if( existingDigest?.digestStatus === "processing" ) {
      logger.warn( "hourlyNotificationDigest skipped", {
        reason: "digest_already_processing",
        digestId: group.digestId,
        eventCount: group.events.length,
      } )
      continue
    }

    await digestRef.set( {
      userId: group.userId,
      digestHourKey: group.hourKey,
      digestStatus: "processing",
      eventCount: group.events.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true } )

    const profile = await loadUserProfile( db, group.userId )
    if( !profile.preferences.hourlyActivityDigestEnabled ) {
      await digestRef.set( {
        digestStatus: "skipped",
        digestSkipReason: "preference_disabled",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true } )
      await writeEventStatuses( {
        admin,
        db,
        digestId: group.digestId,
        events: group.events,
        status: "skipped",
        extra: { digestSkipReason: "preference_disabled" },
      } )
      logger.info( "hourlyNotificationDigest skipped", {
        reason: "preference_disabled",
        digestId: group.digestId,
      } )
      continue
    }
    if( !profile.email ) {
      await digestRef.set( {
        digestStatus: "skipped",
        digestSkipReason: "missing_email",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true } )
      await writeEventStatuses( {
        admin,
        db,
        digestId: group.digestId,
        events: group.events,
        status: "skipped",
        extra: { digestSkipReason: "missing_email" },
      } )
      logger.warn( "hourlyNotificationDigest skipped", {
        reason: "missing_email",
        digestId: group.digestId,
        userId: group.userId,
      } )
      continue
    }

    const digest = buildHourlyNotificationDigest( group.events, group.hourKey )
    try {
      await sendTextEmail( {
        to: [ profile.email ],
        subject: digest.subject,
        text: digest.text,
      } )
      await digestRef.set( {
        digestStatus: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true } )
      await writeEventStatuses( {
        admin,
        db,
        digestId: group.digestId,
        events: group.events,
        status: "sent",
      } )
      logger.info( "hourlyNotificationDigest sent", {
        digestId: group.digestId,
        eventCount: group.events.length,
      } )
    } catch( err ) {
      const cause = trimSingleLine( err instanceof Error ? err.message : "Unexpected email error", 500 )
      await digestRef.set( {
        digestStatus: "failed",
        lastDigestError: cause,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true } )
      await writeEventStatuses( {
        admin,
        db,
        digestId: group.digestId,
        events: group.events,
        status: "failed",
        extra: { lastDigestError: cause },
      } )
      logger.error( "hourlyNotificationDigest failed", {
        digestId: group.digestId,
        cause,
        fallback: "events were marked failed for operator inspection",
        impact: "Hourly activity digest email was not delivered.",
      } )
    }
  }
}

module.exports = {
  HOURLY_NOTIFICATION_DIGEST_LIMIT,
  buildHourlyNotificationDigest,
  buildClosedHourCutoffKey,
  createHourlyNotificationDigestJob,
}
