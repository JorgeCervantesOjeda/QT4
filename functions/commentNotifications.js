// functions/commentNotifications.js: Sends backend comment notifications and stages hourly digest events.
const { resolveNotificationPreferences } = require( "./notificationPreferences" )

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const trimSingleLine = (value, maxLength = 200) =>
  String( value || "" ).replace( /\s+/g, " " ).trim().slice( 0, maxLength )

const trimMultiline = (value, maxLength = 1600) =>
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

const loadDocument = async (db, collectionName, documentId) => {
  if( !documentId ) {
    return null
  }
  return readSnapshotData( await db.collection( collectionName ).doc( documentId ).get() )
}

const loadThreadComments = async (db, threadId) => {
  if( !threadId ) {
    return []
  }
  const snapshot = await db
    .collection( "comments" )
    .where( "threadId", "==", threadId )
    .get()
  return ( snapshot.docs || [] ).map( readSnapshotData ).filter( Boolean )
}

const addParticipant = (participantIds, userId) => {
  const normalizedUserId = trimSingleLine( userId, 128 )
  if( normalizedUserId ) {
    participantIds.add( normalizedUserId )
  }
}

const buildParticipantIds = ({ comment, comments, documentData, thread, version }) => {
  const participantIds = new Set()
  addParticipant( participantIds, version?.createdBy )
  ;( Array.isArray( version?.reviewerIds ) ? version.reviewerIds : [] )
    .forEach( (reviewerId) => addParticipant( participantIds, reviewerId ) )
  addParticipant( participantIds, thread?.createdBy )
  comments.forEach( (threadComment) => addParticipant( participantIds, threadComment?.createdBy ) )
  addParticipant( participantIds, documentData?.authorId || documentData?.createdBy )
  participantIds.delete( comment.createdBy )
  return [ ...participantIds ]
}

const normalizeProfile = (userId, profile) => {
  const email = trimSingleLine( profile?.email, 200 ).toLowerCase()
  return {
    userId,
    displayName: trimSingleLine( profile?.displayName, 200 ),
    email: EMAIL_PATTERN.test( email ) ? email : "",
    preferences: resolveNotificationPreferences( profile?.notificationPreferences ),
  }
}

const loadRecipientProfiles = async (db, participantIds) => {
  const profiles = await Promise.all(
    participantIds.map( async (participantId) => {
      const profile = await loadDocument( db, "userProfiles", participantId )
      return normalizeProfile( participantId, profile )
    } ),
  )
  return profiles.filter( (profile) => profile.email )
}

const versionNumberToString = (value) => {
  const number = Number( value ?? 0 )
  if( !Number.isFinite( number ) ) {
    return "0.00"
  }
  const integerPart = Math.floor( number / 100 )
  const fraction = number % 100
  return `${integerPart}.${String( fraction ).padStart( 2, "0" )}`
}

const buildCommentDirectUrl = ({ appOrigin, comment, commentId, thread }) => {
  const origin = trimSingleLine( appOrigin, 500 ).replace( /\/+$/, "" )
  const query = new URLSearchParams()
  if( comment.projectId ) {
    query.set( "projectId", comment.projectId )
  }
  query.set( "versionId", comment.versionId )
  query.set( "threadId", comment.threadId )
  query.set( "commentId", commentId )
  query.set( "focus", "comments" )
  const path = `/documents/${encodeURIComponent( comment.docId )}/versions?${query.toString()}`
  return origin ? `${origin}${path}` : path
}

const buildEmailText = ({ actorLabel, comment, directUrl, documentData, thread, version }) => {
  const documentLabel = `${documentData?.shortId ?? "Unassigned"} - ${documentData?.title ?? "Document"}`
  return [
    "A new comment was added.",
    `Document: ${documentLabel}`,
    `Version: ${versionNumberToString( version?.number )}`,
    `Issue: ${thread?.title || "Untitled issue"}`,
    `Comment author: ${actorLabel}`,
    "",
    "Comment:",
    trimMultiline( comment.body, 1600 ),
    "",
    "Open this comment directly:",
    directUrl,
  ].join( "\n" )
}

const buildDigestHourKey = (date) => date.toISOString().slice( 0, 13 )

const stageNotificationEvents = async ({
  admin,
  actorLabel,
  comment,
  commentId,
  db,
  directUrl,
  documentData,
  now,
  recipients,
  thread,
}) => {
  await Promise.all(
    recipients.map( (recipient) => db
      .collection( "notificationEvents" )
      .doc( `comment-${commentId}-${recipient.userId}` )
      .set( {
        userId: recipient.userId,
        email: recipient.email,
        kind: "comment",
        projectId: comment.projectId,
        docId: comment.docId,
        versionId: comment.versionId,
        threadId: comment.threadId,
        commentId,
        actorId: comment.createdBy,
        actorLabel,
        documentLabel: `${documentData?.shortId ?? "Unassigned"} - ${documentData?.title ?? "Document"}`,
        issueTitle: thread?.title || "Untitled issue",
        commentExcerpt: trimMultiline( comment.body, 500 ),
        directUrl,
        eventAt: admin.firestore.FieldValue.serverTimestamp(),
        digestStatus: "pending",
        digestHourKey: buildDigestHourKey( now ),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true } ) ),
  )
}

const createCommentNotificationHandler = ({
  admin,
  appOrigin = "",
  logger,
  now = () => new Date(),
  sendTextEmail,
}) => async (event) => {
  const db = admin.firestore()
  const commentId = event.params?.commentId || event.data?.id || ""
  const comment = readSnapshotData( event.data )
  if( !comment ) {
    logger.warn( "commentNotification skipped", {
      reason: "missing_comment",
      commentId,
    } )
    return
  }

  try {
    const [ thread, version, documentData, comments ] = await Promise.all( [
      loadDocument( db, "threads", comment.threadId ),
      loadDocument( db, "versions", comment.versionId ),
      loadDocument( db, "documents", comment.docId ),
      loadThreadComments( db, comment.threadId ),
    ] )
    const participantIds = buildParticipantIds( {
      comment,
      comments,
      documentData,
      thread,
      version,
    } )
    const recipients = await loadRecipientProfiles( db, participantIds )
    const actorProfile = normalizeProfile(
      comment.createdBy,
      await loadDocument( db, "userProfiles", comment.createdBy ),
    )
    const actorLabel = actorProfile.displayName || actorProfile.email || comment.createdBy || "Unknown user"
    const directUrl = buildCommentDirectUrl( { appOrigin, comment, commentId, thread } )

    await stageNotificationEvents( {
      admin,
      actorLabel,
      comment,
      commentId,
      db,
      directUrl,
      documentData,
      now: now(),
      recipients,
      thread,
    } )

    const immediateRecipients = recipients
      .filter( (recipient) => recipient.preferences.commentEmailEnabled )
      .map( (recipient) => recipient.email )
    if( immediateRecipients.length === 0 ) {
      logger.info( "commentNotification immediate email skipped", {
        reason: "no_opted_in_recipients",
        commentId,
      } )
      return
    }

    try {
      await sendTextEmail( {
        to: immediateRecipients.slice( 0, 1 ),
        cc: immediateRecipients.slice( 1 ),
        subject: `New Comment: ${documentData?.shortId ?? "Unassigned"} - ${thread?.title || "Untitled issue"}`,
        text: buildEmailText( {
          actorLabel,
          comment,
          directUrl,
          documentData,
          thread,
          version,
        } ),
      } )
      logger.info( "commentNotification immediate email sent", {
        commentId,
        recipientCount: immediateRecipients.length,
      } )
    } catch( err ) {
      logger.error( "commentNotification immediate email failed", {
        commentId,
        cause: err instanceof Error ? err.message : "Unexpected email error",
        fallback: "comment remains created and digest events stay pending",
        impact: "Immediate comment email was not delivered.",
      } )
    }
  } catch( err ) {
    logger.error( "commentNotification failed", {
      commentId,
      cause: err instanceof Error ? err.message : "Unexpected comment notification error",
      fallback: "comment remains created",
      impact: "Immediate and digest notification handling did not complete.",
    } )
  }
}

module.exports = {
  buildDigestHourKey,
  createCommentNotificationHandler,
  stageNotificationEvents,
}

