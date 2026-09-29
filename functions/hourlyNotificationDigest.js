// functions/hourlyNotificationDigest.js: Sends per-user hourly digests for related notification events.
const { resolveNotificationPreferences } = require( "./notificationPreferences" )

const DEFAULT_APP_ORIGIN = "https://qualiteam-plus.web.app"
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

const normalizeTimestampMillis = (value) => {
  if( value && typeof value.toMillis === "function" ) {
    const millis = value.toMillis()
    return Number.isFinite( millis ) ? millis : Number.POSITIVE_INFINITY
  }
  if( value && typeof value.toDate === "function" ) {
    const date = value.toDate()
    const millis = date instanceof Date ? date.getTime() : Date.parse( date )
    return Number.isFinite( millis ) ? millis : Number.POSITIVE_INFINITY
  }
  if( value instanceof Date ) {
    const millis = value.getTime()
    return Number.isFinite( millis ) ? millis : Number.POSITIVE_INFINITY
  }
  if( typeof value === "number" && Number.isFinite( value ) ) {
    return value
  }
  if( typeof value === "string" ) {
    const millis = Date.parse( value )
    if( Number.isFinite( millis ) ) {
      return millis
    }
  }
  return Number.POSITIVE_INFINITY
}

const normalizeEvent = (snapshot) => {
  const data = typeof snapshot.data === "function" ? snapshot.data() || {} : snapshot
  const eventTimestamp = data.eventAt ?? data.createdAt ?? data.eventAtMillis
  return {
    id: trimSingleLine( snapshot.id || data.id, 128 ),
    ref: snapshot.ref,
    userId: trimSingleLine( data.userId, 128 ),
    email: normalizeEmail( data.email ),
    kind: trimSingleLine( data.kind, 32 ) || "comment",
    digestHourKey: trimSingleLine( data.digestHourKey, 32 ),
    projectId: trimSingleLine( data.projectId, 128 ),
    projectLabel: trimSingleLine( data.projectLabel, 240 ) || "Project",
    docId: trimSingleLine( data.docId, 128 ),
    versionId: trimSingleLine( data.versionId, 128 ),
    threadId: trimSingleLine( data.threadId, 128 ),
    commentId: trimSingleLine( data.commentId, 128 ),
    actorLabel: trimSingleLine( data.actorLabel, 200 ) || "Unknown user",
    documentLabel: trimSingleLine( data.documentLabel, 240 ) || "Document",
    versionLabel: trimSingleLine( data.versionLabel, 80 ) || "Version",
    issueTitle: trimSingleLine( data.issueTitle, 240 ) || "Untitled issue",
    commentExcerpt: trimMultiline( data.commentExcerpt, 500 ),
    directUrl: trimSingleLine( data.directUrl, 1000 ),
    eventAtMillis: normalizeTimestampMillis( eventTimestamp ),
  }
}

const compareDigestEvents = (left, right) => {
  const leftTime = Number.isFinite( left.eventAtMillis )
    ? left.eventAtMillis
    : Number.MAX_SAFE_INTEGER
  const rightTime = Number.isFinite( right.eventAtMillis )
    ? right.eventAtMillis
    : Number.MAX_SAFE_INTEGER
  return left.digestHourKey.localeCompare( right.digestHourKey )
    || leftTime - rightTime
    || left.id.localeCompare( right.id )
}

const sortDigestEvents = (events) => [ ...events ].sort( compareDigestEvents )

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

const normalizeAppOrigin = (appOrigin) =>
  ( trimSingleLine( appOrigin, 500 ) || DEFAULT_APP_ORIGIN ).replace( /\/+$/, "" )

const buildAbsoluteAppUrl = (urlValue, appOrigin) => {
  const normalizedUrlValue = trimSingleLine( urlValue, 1000 )
  if( !normalizedUrlValue ) {
    return ""
  }
  try {
    const url = new URL( normalizedUrlValue, normalizeAppOrigin( appOrigin ) )
    if( url.protocol !== "http:" && url.protocol !== "https:" ) {
      return ""
    }
    return url.toString()
  } catch {
    return ""
  }
}

const buildIssueUrl = (event, appOrigin) => {
  const issueUrl = buildAbsoluteAppUrl( event.directUrl, appOrigin )
  if( !issueUrl ) {
    return ""
  }
  const url = new URL( issueUrl )
  url.searchParams.delete( "commentId" )
  return url.toString()
}

const buildGroupKey = (values) => values
  .map( (value) => trimSingleLine( value, 240 ) )
  .join( "\u001f" )

const getOrCreateDigestGroup = (map, key, createGroup) => {
  const existingGroup = map.get( key )
  if( existingGroup ) {
    return existingGroup
  }
  const group = createGroup()
  map.set( key, group )
  return group
}

const groupEventsForDigestText = (events, appOrigin) => {
  const projects = []
  const projectsByKey = new Map()
  for( const event of events ) {
    const projectKey = buildGroupKey( [ event.projectId, event.projectLabel ] )
    const projectGroup = getOrCreateDigestGroup( projectsByKey, projectKey, () => {
      const group = { label: event.projectLabel, documents: [], documentsByKey: new Map() }
      projects.push( group )
      return group
    } )
    const documentKey = buildGroupKey( [ event.docId, event.documentLabel ] )
    const documentGroup = getOrCreateDigestGroup( projectGroup.documentsByKey, documentKey, () => {
      const group = { label: event.documentLabel, versions: [], versionsByKey: new Map() }
      projectGroup.documents.push( group )
      return group
    } )
    const versionKey = buildGroupKey( [ event.versionId, event.versionLabel ] )
    const versionGroup = getOrCreateDigestGroup( documentGroup.versionsByKey, versionKey, () => {
      const group = { label: event.versionLabel, issues: [], issuesByKey: new Map() }
      documentGroup.versions.push( group )
      return group
    } )
    const issueKey = buildGroupKey( [ event.threadId, event.issueTitle ] )
    const issueGroup = getOrCreateDigestGroup( versionGroup.issuesByKey, issueKey, () => {
      const group = {
        title: event.issueTitle,
        issueUrl: buildIssueUrl( event, appOrigin ),
        comments: [],
      }
      versionGroup.issues.push( group )
      return group
    } )
    if( !issueGroup.issueUrl ) {
      issueGroup.issueUrl = buildIssueUrl( event, appOrigin )
    }
    issueGroup.comments.push( {
      actorLabel: event.actorLabel,
      commentExcerpt: event.commentExcerpt,
    } )
  }
  return projects
}

const buildHourlyNotificationDigest = (events, hourKey, options = {}) => {
  const normalizedEvents = sortDigestEvents( events.map( normalizeEvent ) )
  const subject = `[QT4] Hourly activity summary (${normalizedEvents.length})`
  const projects = groupEventsForDigestText( normalizedEvents, options.appOrigin )
  const eventLines = projects.flatMap( (project) => [
    `Project: ${project.label}`,
    "",
    ...project.documents.flatMap( (document) => [
      `Document: ${document.label}`,
      "",
      ...document.versions.flatMap( (version) => [
        `Version: ${version.label}`,
        "",
        ...version.issues.flatMap( (issue) => [
          `Issue: ${issue.title}`,
          issue.issueUrl ? `Open issue: ${issue.issueUrl}` : "",
          "Comments:",
          ...issue.comments.map( (comment) =>
            `- ${comment.actorLabel}: ${comment.commentExcerpt || "(no comment text)"}`,
          ),
          "",
        ].filter( (line) => line !== "" ) ),
      ] ),
    ] ),
  ] )
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
  appOrigin = DEFAULT_APP_ORIGIN,
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
  const sortedEvents = sortDigestEvents( events )

  if( sortedEvents.length === 0 ) {
    logger.info( "hourlyNotificationDigest skipped", {
      reason: "no_closed_pending_events",
      cutoffHourKey,
      timeZone: getTimeZone(),
    } )
    return
  }

  for( const group of groupEventsByUserHour( sortedEvents ) ) {
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

    const digest = buildHourlyNotificationDigest( group.events, group.hourKey, { appOrigin } )
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
  DEFAULT_APP_ORIGIN,
  HOURLY_NOTIFICATION_DIGEST_LIMIT,
  buildAbsoluteAppUrl,
  buildHourlyNotificationDigest,
  buildClosedHourCutoffKey,
  createHourlyNotificationDigestJob,
}
