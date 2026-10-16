// functions/commentNotifications.js: Sends backend comment notifications and stages hourly digest events.
const { FieldValue } = require( "firebase-admin/firestore" )

const { resolveNotificationPreferences } = require( "./notificationPreferences" )
const {
  buildEmailDocument,
  buildEmailLink,
  escapeHtml,
  renderHtmlText,
} = require( "./emailFormatting" )

const DEFAULT_APP_ORIGIN = "https://qualiteam-plus.web.app"
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

const buildParticipantIds = ({ comment, comments, latestVersion, thread, version }) => {
  const participantIds = new Set()
  addParticipant( participantIds, comment.createdBy )
  addParticipant( participantIds, version?.createdBy )
  addParticipant( participantIds, latestVersion?.createdBy )
  ;( Array.isArray( version?.reviewerIds ) ? version.reviewerIds : [] )
    .forEach( (reviewerId) => addParticipant( participantIds, reviewerId ) )
  addParticipant( participantIds, thread?.createdBy )
  comments.forEach( (threadComment) => addParticipant( participantIds, threadComment?.createdBy ) )
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

const buildProjectLabel = (projectData) =>
  `${projectData?.shortId ?? "Unassigned"} - ${projectData?.name ?? "Project"}`

const buildDocumentLabel = (documentData) =>
  `${documentData?.shortId ?? "Unassigned"} - ${documentData?.title ?? "Document"}`

const buildCommentDirectUrl = ({ appOrigin, comment, commentId, thread }) => {
  const origin = ( trimSingleLine( appOrigin, 500 ) || DEFAULT_APP_ORIGIN ).replace( /\/+$/, "" )
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
  const documentLabel = buildDocumentLabel( documentData )
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

const buildEmailHtml = ({ actorLabel, comment, directUrl, documentData, thread, version }) => {
  const documentLabel = buildDocumentLabel( documentData )
  const issueTitle = thread?.title || "Untitled issue"
  return buildEmailDocument( {
    body: [
      '<h1 style="margin:0 0 20px;color:#172033;font-size:26px;">A new comment was added.</h1>',
      `<p style="margin:0 0 6px;"><strong>Document:</strong> ${escapeHtml( documentLabel )}</p>`,
      `<p style="margin:0 0 6px;"><strong>Version:</strong> ${escapeHtml( versionNumberToString( version?.number ) )}</p>`,
      `<p style="margin:0 0 6px;"><strong>Issue:</strong> ${escapeHtml( issueTitle )}</p>`,
      `<p style="margin:0 0 20px;"><strong>Comment author:</strong> ${escapeHtml( actorLabel )}</p>`,
      '<h2 style="margin:0 0 8px;font-size:18px;">Comment</h2>',
      `<div style="margin:0 0 24px;padding:16px;background:#f4f7fb;border-left:4px solid #0b57d0;border-radius:4px;">${renderHtmlText( comment.body )}</div>`,
      buildEmailLink( directUrl, "Open this comment directly" ),
    ].join( "" ),
    preheader: `${actorLabel} added a comment to ${issueTitle}.`,
    title: "QT4 — New comment",
  } )
}

const buildDigestHourKey = (date) => date.toISOString().slice( 0, 13 )

const getServerTimestamp = (admin) => {
  const timestampFactory = admin?.firestore?.FieldValue?.serverTimestamp || FieldValue?.serverTimestamp
  if( typeof timestampFactory !== "function" ) {
    throw new Error( "Firebase Admin server timestamps are required for comment notifications." )
  }
  return timestampFactory
}

const stageNotificationEvents = async ({
  admin,
  actorLabel,
  comment,
  commentId,
  db,
  directUrl,
  documentData,
  now,
  projectData,
  recipients,
  thread,
  version,
}) => {
  const documentLabel = buildDocumentLabel( documentData )
  const serverTimestamp = getServerTimestamp( admin )
  await Promise.all(
    recipients.map( (recipient) => db
      .collection( "notificationEvents" )
      .doc( `comment-${commentId}-${recipient.userId}` )
      .set( {
        userId: recipient.userId,
        email: recipient.email,
        kind: "comment",
        projectId: comment.projectId,
        projectLabel: buildProjectLabel( projectData ),
        docId: comment.docId,
        versionId: comment.versionId,
        versionLabel: versionNumberToString( version?.number ),
        threadId: comment.threadId,
        commentId,
        actorId: comment.createdBy,
        actorLabel,
        documentLabel,
        issueTitle: thread?.title || "Untitled issue",
        commentExcerpt: trimMultiline( comment.body, 500 ),
        directUrl,
        eventAt: serverTimestamp(),
        digestStatus: "pending",
        digestHourKey: buildDigestHourKey( now ),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
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
    const [ thread, version, documentData, projectData, comments ] = await Promise.all( [
      loadDocument( db, "threads", comment.threadId ),
      loadDocument( db, "versions", comment.versionId ),
      loadDocument( db, "documents", comment.docId ),
      loadDocument( db, "projects", comment.projectId ),
      loadThreadComments( db, comment.threadId ),
    ] )
    const latestVersion = documentData?.latestVersionId
      ? await loadDocument( db, "versions", documentData.latestVersionId )
      : version
    const participantIds = buildParticipantIds( {
      comment,
      comments,
      latestVersion,
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
      projectData,
      recipients,
      thread,
      version,
    } )

    const immediateRecipients = recipients
      .filter( (recipient) =>
        recipient.userId !== comment.createdBy
        && recipient.preferences.commentEmailEnabled )
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
        html: buildEmailHtml( {
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
  DEFAULT_APP_ORIGIN,
  buildDigestHourKey,
  buildEmailHtml,
  createCommentNotificationHandler,
  stageNotificationEvents,
}

