// functions/openConversationDigest.js: Loads complete comments for open digest conversations.
const { resolveNotificationPreferences } = require( "./notificationPreferences" )

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const trimSingleLine = (value, maxLength = 200) =>
  String( value || "" ).replace( /\s+/g, " " ).trim().slice( 0, maxLength )

const normalizeFullCommentText = (value) =>
  String( value || "" ).replace( /\r\n/g, "\n" ).trim()

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

const readSnapshotData = (snapshot) => {
  if( !snapshot || snapshot.exists === false ) {
    return null
  }
  return {
    id: snapshot.id || "",
    ...( snapshot.data() || {} ),
  }
}

const normalizeProfile = (userId, profile) => ( {
  userId,
  displayName: trimSingleLine( profile?.displayName, 200 ),
  email: normalizeEmail( profile?.email ),
  preferences: resolveNotificationPreferences( profile?.notificationPreferences ),
} )

const loadUserProfile = async (db, userId) =>
  normalizeProfile(
    userId,
    readSnapshotData( await db.collection( "userProfiles" ).doc( userId ).get() ),
  )

const loadThreadComments = async (db, threadId) => {
  const snapshot = await db
    .collection( "comments" )
    .where( "threadId", "==", threadId )
    .get()
  return ( snapshot.docs || [] )
    .map( (snapshotItem) => {
      const data = snapshotItem.data() || {}
      return {
        id: trimSingleLine( snapshotItem.id || data.id, 128 ),
        authorId: trimSingleLine( data.createdBy, 128 ),
        body: normalizeFullCommentText( data.body ),
        createdAtMillis: normalizeTimestampMillis( data.createdAt ?? data.updatedAt ),
      }
    } )
    .sort( (left, right) =>
      ( Number.isFinite( left.createdAtMillis ) ? left.createdAtMillis : Number.MAX_SAFE_INTEGER )
      - ( Number.isFinite( right.createdAtMillis ) ? right.createdAtMillis : Number.MAX_SAFE_INTEGER )
      || left.id.localeCompare( right.id ),
    )
}

const isOpenThread = (thread) => thread?.status === "open" || thread?.isOpen === true

const buildConversationDigestEvent = ({ comment, event, hourKey, issueTitle, actorLabel }) => ( {
  ...event,
  id: `${event.id || event.threadId}-${comment.id}`,
  digestHourKey: hourKey,
  eventAtMillis: comment.createdAtMillis,
  issueTitle,
  actorLabel,
  commentText: comment.body,
  commentExcerpt: comment.body,
} )

const loadOpenConversationDigestEvents = async ({ db, events, hourKey, logger }) => {
  const eventsByThreadId = new Map()
  const unthreadedEvents = []
  for( const event of events ) {
    if( !event.threadId ) {
      unthreadedEvents.push( event )
      logger.warn( "hourlyNotificationDigest conversation fallback", {
        reason: "event_without_thread_id",
        eventId: event.id,
        fallback: "event content was included without loading a conversation",
        impact: "The digest may contain only the event content for this item.",
      } )
      continue
    }
    const threadEvents = eventsByThreadId.get( event.threadId ) || []
    threadEvents.push( event )
    eventsByThreadId.set( event.threadId, threadEvents )
  }

  const digestEvents = [ ...unthreadedEvents ]
  const skippedEventGroups = []
  for( const [ threadId, threadEvents ] of eventsByThreadId ) {
    const threadSnapshot = await db.collection( "threads" ).doc( threadId ).get()
    const thread = readSnapshotData( threadSnapshot )
    if( !isOpenThread( thread ) ) {
      const reason = thread ? "thread_closed" : "thread_not_found"
      skippedEventGroups.push( { events: threadEvents, reason } )
      logger.warn( "hourlyNotificationDigest conversation skipped", {
        reason,
        threadId,
        eventCount: threadEvents.length,
        fallback: "pending events were marked skipped",
        impact: "No digest content was generated for this non-open conversation.",
      } )
      continue
    }

    const comments = await loadThreadComments( db, threadId )
    if( comments.length === 0 ) {
      digestEvents.push( ...threadEvents )
      logger.warn( "hourlyNotificationDigest conversation fallback", {
        reason: "open_thread_without_comments",
        threadId,
        eventCount: threadEvents.length,
        fallback: "event content was included because the comments query was empty",
        impact: "The digest may be incomplete for this conversation.",
      } )
      continue
    }

    const eventByCommentId = new Map(
      threadEvents
        .filter( (event) => event.commentId )
        .map( (event) => [ event.commentId, event ] ),
    )
    const authorIds = [ ...new Set( comments.map( (comment) => comment.authorId ).filter( Boolean ) ) ]
    const authorProfiles = new Map(
      await Promise.all( authorIds.map( async (authorId) => [ authorId, await loadUserProfile( db, authorId ) ] ) ),
    )
    const seedEvent = threadEvents[0]
    digestEvents.push( ...comments.map( (comment) => {
      const event = eventByCommentId.get( comment.id ) || seedEvent
      const authorProfile = authorProfiles.get( comment.authorId )
      const actorLabel = eventByCommentId.get( comment.id )?.actorLabel
        || authorProfile?.displayName
        || authorProfile?.email
        || comment.authorId
        || "Unknown user"
      if( !eventByCommentId.has( comment.id ) && !authorProfile?.displayName && !authorProfile?.email ) {
        logger.warn( "hourlyNotificationDigest author fallback", {
          reason: "comment_author_profile_unavailable",
          threadId,
          commentId: comment.id,
          fallback: "comment author id was used as the display label",
          impact: "The digest contains the comment but may show a technical author identifier.",
        } )
      }
      return buildConversationDigestEvent( {
        actorLabel,
        comment,
        event,
        hourKey,
        issueTitle: trimSingleLine( thread.title, 240 ) || seedEvent.issueTitle,
      } )
    } ) )
  }
  return { digestEvents, skippedEventGroups }
}

module.exports = {
  loadOpenConversationDigestEvents,
  loadUserProfile,
}
