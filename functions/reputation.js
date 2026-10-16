// functions/reputation.js: Applies idempotent project-scoped contribution events.

const { FieldValue } = require( "firebase-admin/firestore" )

const POINT_RULES = Object.freeze( {
  threadCreated: { category: "collaboration", points: 1, reason: "Created a discussion thread" },
  commentCreated: { category: "collaboration", points: 1, reason: "Added a comment" },
  goodReactionReceived: { category: "collaboration", points: 2, reason: "Received a good reaction on a comment" },
  reviewCompleted: { category: "review", points: 0, reason: "Completed an active review" },
  reviewAbsence: { category: "review", points: -1, reason: "Did not participate in an assigned review" },
  acceptedVersion: { category: "quality", points: 5, reason: "Created an accepted version" },
  acceptedErrorReport: { category: "quality", points: 2, reason: "Created an accepted error report" },
  acceptedErrorReportPenalty: { category: "quality", points: -2, reason: "An authored version received an accepted error report" },
} )

const BADGE_IDS = Object.freeze( [
  "first-contribution",
  "issue-spotter",
  "helpful-collaborator",
  "reliable-reviewer",
  "quality-builder",
  "consistent-contributor",
] )

const emptySummary = (projectId, userId) => ( {
  projectId,
  userId,
  totalPoints: 0,
  collaborationPoints: 0,
  reviewPoints: 0,
  qualityPoints: 0,
  contributionCount: 0,
  threadCount: 0,
  commentCount: 0,
  goodReactionCount: 0,
  completedReviewCount: 0,
  acceptedVersionCount: 0,
  badgeIds: [],
} )

const readSnapshotData = (snapshot) => {
  if( !snapshot || snapshot.exists === false ) {
    return null
  }
  return {
    id: snapshot.id || "",
    ...( snapshot.data() || {} ),
  }
}

const normalizeRequired = (value) => typeof value === "string" ? value.trim() : ""

const timestampToMillis = (value) => {
  if( value && typeof value.toMillis === "function" ) {
    return value.toMillis()
  }
  if( value instanceof Date ) {
    return value.getTime()
  }
  if( typeof value === "number" && Number.isFinite( value ) ) {
    return value
  }
  if( typeof value === "string" ) {
    const parsed = Date.parse( value )
    return Number.isFinite( parsed ) ? parsed : null
  }
  return null
}

const findPreviousCommentAuthor = async ({ db, comment, commentId }) => {
  const threadId = normalizeRequired( comment.threadId )
  if( !threadId ) {
    return null
  }
  const snapshot = await db.collection( "comments" ).where( "threadId", "==", threadId ).get()
  const currentMillis = timestampToMillis( comment.createdAt )
  const candidates = ( snapshot.docs || [] )
    .filter( (commentSnapshot) => commentSnapshot.id !== commentId )
    .map( (commentSnapshot) => ( {
      id: commentSnapshot.id,
      data: commentSnapshot.data() || {},
    } ) )
    .filter( ({ data }) =>
      data.projectId === comment.projectId &&
      data.versionId === comment.versionId,
    )
    .map( ({ id, data }) => ( {
      id,
      createdBy: normalizeRequired( data.createdBy ),
      createdAtMillis: timestampToMillis( data.createdAt ),
    } ) )
    .filter( ({ createdBy, createdAtMillis, id }) => {
      if( !createdBy ) {
        return false
      }
      if( currentMillis === null || createdAtMillis === null ) {
        return true
      }
      return createdAtMillis < currentMillis ||
        ( createdAtMillis === currentMillis && id < commentId )
    } )
    .sort( (left, right) => {
      if( left.createdAtMillis === null ) return 1
      if( right.createdAtMillis === null ) return -1
      if( right.createdAtMillis !== left.createdAtMillis ) {
        return right.createdAtMillis - left.createdAtMillis
      }
      return right.id.localeCompare( left.id )
    } )
  return candidates[0]?.createdBy || null
}

const buildReputationEvent = ({
  eventId,
  projectId,
  userId,
  sourceType,
  sourceId,
  eventType,
  pointsOverride,
  counterField,
  counterDelta,
  countsAsContribution,
}) => {
  const rule = POINT_RULES[eventType]
  if( !rule ) {
    throw new Error( `Unsupported reputation event type: ${eventType}` )
  }
  return {
    eventId,
    projectId,
    userId,
    sourceType,
    sourceId,
    category: rule.category,
    points: pointsOverride ?? rule.points,
    reason: rule.reason,
    counterField,
    ...( counterDelta !== undefined ? { counterDelta } : {} ),
    ...( countsAsContribution !== undefined ? { countsAsContribution } : {} ),
  }
}

const deriveBadgeIds = (summary) => {
  const badgeIds = []
  if( summary.contributionCount >= 1 ) {
    badgeIds.push( "first-contribution" )
  }
  if( summary.threadCount >= 3 ) {
    badgeIds.push( "issue-spotter" )
  }
  if( summary.goodReactionCount >= 3 ) {
    badgeIds.push( "helpful-collaborator" )
  }
  if( summary.completedReviewCount >= 3 ) {
    badgeIds.push( "reliable-reviewer" )
  }
  if( summary.acceptedVersionCount >= 1 ) {
    badgeIds.push( "quality-builder" )
  }
  if( summary.contributionCount >= 10 ) {
    badgeIds.push( "consistent-contributor" )
  }
  return badgeIds
}

const numericValue = (value, fieldName, logger) => {
  if( value === undefined || value === null ) {
    return 0
  }
  const number = Number( value )
  if( Number.isFinite( number ) ) {
    return number
  }
  logger.warn( "Ignoring malformed reputation counter.", { fieldName, value } )
  return 0
}

const categoryField = {
  collaboration: "collaborationPoints",
  review: "reviewPoints",
  quality: "qualityPoints",
}

const counterFields = new Set( [
  "threadCount",
  "commentCount",
  "goodReactionCount",
  "completedReviewCount",
  "acceptedVersionCount",
] )

const REVIEW_PARTICIPATION_CAP = 2

const buildNextSummary = ({ currentSummary, event, pointDelta, activeDelta, counterDelta, logger }) => {
  const nextSummary = {
    ...currentSummary,
    totalPoints: numericValue( currentSummary.totalPoints, "totalPoints", logger ) + pointDelta,
    collaborationPoints: numericValue( currentSummary.collaborationPoints, "collaborationPoints", logger )
      + ( event.category === "collaboration" ? pointDelta : 0 ),
    reviewPoints: numericValue( currentSummary.reviewPoints, "reviewPoints", logger )
      + ( event.category === "review" ? pointDelta : 0 ),
    qualityPoints: numericValue( currentSummary.qualityPoints, "qualityPoints", logger )
      + ( event.category === "quality" ? pointDelta : 0 ),
    contributionCount: Math.max(
      0,
      numericValue( currentSummary.contributionCount, "contributionCount", logger ) + activeDelta,
    ),
  }
  nextSummary[event.counterField] = Math.max(
    0,
    numericValue( currentSummary[event.counterField], event.counterField, logger ) + counterDelta,
  )
  nextSummary.badgeIds = deriveBadgeIds( nextSummary )
  return nextSummary
}

const getDb = (admin) => {
  if( !admin || typeof admin.firestore !== "function" ) {
    throw new Error( "Firebase Admin Firestore is required for reputation handlers." )
  }
  return admin.firestore()
}

const getServerTimestamp = (admin) => {
  const timestampFactory = admin?.firestore?.FieldValue?.serverTimestamp || FieldValue?.serverTimestamp
  if( typeof timestampFactory !== "function" ) {
    throw new Error( "Firebase Admin server timestamps are required for reputation handlers." )
  }
  return timestampFactory()
}

const applyReputationEvent = async ({ admin, event, logger }) => {
  const projectId = normalizeRequired( event.projectId )
  const userId = normalizeRequired( event.userId )
  const eventId = normalizeRequired( event.eventId )
  if( !projectId || !userId || !eventId ) {
    logger.warn( "Skipping reputation event with missing identity.", { event } )
    return false
  }
  if( !counterFields.has( event.counterField ) ) {
    logger.warn( "Skipping reputation event with unsupported counter field.", { event } )
    return false
  }

  const db = getDb( admin )
  const eventRef = db.collection( "reputationEvents" ).doc( eventId )
  const summaryRef = db.collection( "reputationSummaries" ).doc( `${projectId}_${userId}` )
  return db.runTransaction( async (transaction) => {
    const eventSnapshot = await transaction.get( eventRef )
    const summarySnapshot = await transaction.get( summaryRef )
    const previousEvent = readSnapshotData( eventSnapshot )
    const previousPoints = numericValue( previousEvent?.points, "points", logger )
    const nextPoints = numericValue( event.points, "points", logger )
    if( previousEvent && previousPoints === nextPoints ) {
      return false
    }
    const previousActive = previousEvent?.active === true || previousPoints > 0
    const nextActive = event.countsAsContribution !== false && nextPoints > 0
    const activeDelta = ( nextActive ? 1 : 0 ) - ( previousActive ? 1 : 0 )
    const counterDelta = Number.isFinite( Number( event.counterDelta ) )
      ? Number( event.counterDelta )
      : activeDelta
    if( !previousEvent && nextPoints === 0 && counterDelta === 0 ) {
      return false
    }

    const currentSummary = {
      ...emptySummary( projectId, userId ),
      ...( readSnapshotData( summarySnapshot ) || {} ),
    }
    const pointDelta = nextPoints - previousPoints
    const nextSummary = buildNextSummary( {
      currentSummary,
      event,
      pointDelta,
      activeDelta,
      counterDelta,
      logger,
    } )

    const timestamp = getServerTimestamp( admin )
    transaction.set( eventRef, {
      ...event,
      active: nextPoints !== 0,
      createdAt: previousEvent?.createdAt || timestamp,
      updatedAt: timestamp,
    }, { merge: true } )
    transaction.set( summaryRef, {
      ...nextSummary,
      updatedAt: timestamp,
    }, { merge: true } )
    return true
  } )
}

const applyCappedReviewParticipationEvent = async ({ admin, event, logger, threadId, versionId }) => {
  const projectId = normalizeRequired( event.projectId )
  const userId = normalizeRequired( event.userId )
  const eventId = normalizeRequired( event.eventId )
  const normalizedThreadId = normalizeRequired( threadId )
  const normalizedVersionId = normalizeRequired( versionId )
  if( !projectId || !userId || !eventId || !normalizedThreadId || !normalizedVersionId ) {
    logger.warn( "Skipping capped review participation with incomplete identity.", {
      event,
      threadId,
      versionId,
    } )
    return false
  }
  const db = getDb( admin )
  const eventRef = db.collection( "reputationEvents" ).doc( eventId )
  const summaryRef = db.collection( "reputationSummaries" ).doc( `${projectId}_${userId}` )
  const participationRef = db.collection( "reputationParticipation" ).doc(
    `${projectId}_${normalizedVersionId}_${normalizedThreadId}_${userId}`,
  )
  const reviewSummaryRef = db.collection( "reviewParticipationSummaries" ).doc(
    `${projectId}_${normalizedVersionId}_${userId}`,
  )
  return db.runTransaction( async (transaction) => {
    const [eventSnapshot, summarySnapshot, participationSnapshot, reviewSummarySnapshot] = await Promise.all([
      transaction.get( eventRef ),
      transaction.get( summaryRef ),
      transaction.get( participationRef ),
      transaction.get( reviewSummaryRef ),
    ])
    const previousEvent = readSnapshotData( eventSnapshot )
    if( previousEvent ) {
      return false
    }
    const previousParticipation = readSnapshotData( participationSnapshot )
    const participationCount = numericValue(
      previousParticipation?.participationCount,
      "participationCount",
      logger,
    )
    if( participationCount >= REVIEW_PARTICIPATION_CAP ) {
      logger.info( "Skipping review participation because the issue cap is reached.", {
        projectId,
        userId,
        threadId: normalizedThreadId,
        versionId: normalizedVersionId,
      } )
      return false
    }
    const currentSummary = {
      ...emptySummary( projectId, userId ),
      ...( readSnapshotData( summarySnapshot ) || {} ),
    }
    const nextSummary = buildNextSummary( {
      currentSummary,
      event,
      pointDelta: Number( event.points ),
      activeDelta: 1,
      counterDelta: 1,
      logger,
    } )
    const previousReviewSummary = readSnapshotData( reviewSummarySnapshot )
    const timestamp = getServerTimestamp( admin )
    transaction.set( eventRef, {
      ...event,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    }, { merge: true } )
    transaction.set( summaryRef, {
      ...nextSummary,
      updatedAt: timestamp,
    }, { merge: true } )
    transaction.set( participationRef, {
      projectId,
      versionId: normalizedVersionId,
      threadId: normalizedThreadId,
      userId,
      participationCount: participationCount + 1,
      updatedAt: timestamp,
    }, { merge: true } )
    transaction.set( reviewSummaryRef, {
      projectId,
      versionId: normalizedVersionId,
      userId,
      participationCount: numericValue(
        previousReviewSummary?.participationCount,
        "reviewParticipationCount",
        logger,
      ) + 1,
      distinctThreadCount: numericValue(
        previousReviewSummary?.distinctThreadCount,
        "distinctThreadCount",
        logger,
      ) + ( previousParticipation ? 0 : 1 ),
      updatedAt: timestamp,
    }, { merge: true } )
    return true
  } )
}

const createThreadReputationHandler = ({ admin, logger }) => async (event) => {
  const threadId = normalizeRequired( event?.params?.threadId )
  const thread = readSnapshotData( event?.data )
  if( !threadId || !thread?.projectId || !thread?.createdBy ) {
    logger.warn( "Skipping thread reputation event with incomplete data.", { threadId, thread } )
    return
  }
  await applyCappedReviewParticipationEvent( {
    admin,
    logger,
    event: buildReputationEvent( {
      eventId: `threadCreated:${threadId}`,
      projectId: thread.projectId,
      userId: thread.createdBy,
      sourceType: "thread",
      sourceId: threadId,
      eventType: "threadCreated",
      counterField: "threadCount",
    } ),
    threadId,
    versionId: thread.versionId,
  } )
}

const createCommentReputationHandler = ({ admin, logger }) => async (event) => {
  const commentId = normalizeRequired( event?.params?.commentId )
  const comment = readSnapshotData( event?.data )
  if( !commentId || !comment?.projectId || !comment?.createdBy ) {
    logger.warn( "Skipping comment reputation event with incomplete data.", { commentId, comment } )
    return
  }
  if( comment.isInitialIssueComment === true ) {
    logger.info( "Skipping initial issue comment reputation because the issue already awards participation.", {
      commentId,
      threadId: comment.threadId,
    } )
    return
  }
  const previousCommentAuthor = await findPreviousCommentAuthor( {
    db: getDb( admin ),
    comment,
    commentId,
  } )
  if( previousCommentAuthor === comment.createdBy ) {
    logger.info( "Skipping consecutive review comment participation because the block is already credited.", {
      commentId,
      createdBy: comment.createdBy,
      threadId: comment.threadId,
    } )
    return
  }
  await applyCappedReviewParticipationEvent( {
    admin,
    logger,
    event: buildReputationEvent( {
      eventId: `commentCreated:${commentId}`,
      projectId: comment.projectId,
      userId: comment.createdBy,
      sourceType: "comment",
      sourceId: commentId,
      eventType: "commentCreated",
      counterField: "commentCount",
    } ),
    threadId: comment.threadId,
    versionId: comment.versionId,
  } )
}

const createReactionReputationHandler = ({ admin, logger }) => async (event) => {
  const reactionId = normalizeRequired( event?.params?.reactionId )
  const after = readSnapshotData( event?.data?.after )
  const before = readSnapshotData( event?.data?.before )
  const reaction = after || before
  if( !reactionId || !reaction?.commentId ) {
    logger.warn( "Skipping reaction reputation event with incomplete data.", { reactionId, reaction } )
    return
  }
  const db = getDb( admin )
  const commentSnapshot = await db.collection( "comments" ).doc( reaction.commentId ).get()
  const comment = readSnapshotData( commentSnapshot )
  if( !comment?.projectId || !comment?.createdBy ) {
    logger.warn( "Skipping reaction reputation event because the comment is unavailable.", { reactionId, commentId: reaction.commentId } )
    return
  }
  const points = after?.reaction === "good" ? POINT_RULES.goodReactionReceived.points : 0
  await applyReputationEvent( {
    admin,
    logger,
    event: buildReputationEvent( {
      eventId: `reactionGood:${reactionId}`,
      projectId: comment.projectId,
      userId: comment.createdBy,
      sourceType: "commentReaction",
      sourceId: reactionId,
      eventType: "goodReactionReceived",
      pointsOverride: points,
      counterField: "goodReactionCount",
    } ),
  } )
}

const createVersionReputationHandler = ({ admin, logger }) => async (event) => {
  const versionId = normalizeRequired( event?.params?.versionId )
  const before = readSnapshotData( event?.data?.before )
  const after = readSnapshotData( event?.data?.after )
  if( !versionId || !before || !after?.projectId ) {
    logger.warn( "Skipping version reputation event with incomplete data.", { versionId, before, after } )
    return
  }

  const reviewCompleted = before.status === "In Review"
    && ( after.status === "Reviewed" || after.status === "Accepted" )
  if( reviewCompleted ) {
    const reviewerIds = Array.isArray( after.reviewerIds ) ? after.reviewerIds : []
    const db = getDb( admin )
    await Promise.all( reviewerIds.map( async (reviewerId) => {
      const participationSnapshot = await db
        .collection( "reviewParticipationSummaries" )
        .doc( `${after.projectId}_${versionId}_${reviewerId}` )
        .get()
      const participation = readSnapshotData( participationSnapshot )
      const participated = numericValue( participation?.participationCount, "reviewParticipationCount", logger ) > 0
      await applyReputationEvent( {
        admin,
        logger,
        event: buildReputationEvent( {
          eventId: `${participated ? "reviewCompleted" : "reviewAbsence"}:${versionId}:${reviewerId}`,
          projectId: after.projectId,
          userId: reviewerId,
          sourceType: "versionReview",
          sourceId: versionId,
          eventType: participated ? "reviewCompleted" : "reviewAbsence",
          counterField: "completedReviewCount",
          counterDelta: participated ? 1 : 0,
          countsAsContribution: false,
        } ),
      } )
    } ) )
  }

  if( before.status !== "Accepted" && after.status === "Accepted" && after.createdBy && after.docId ) {
    const db = getDb( admin )
    const document = readSnapshotData( await db.collection( "documents" ).doc( after.docId ).get() )
    if( !document ) {
      logger.warn( "Skipping accepted-version reputation event because the document is unavailable.", { versionId, docId: after.docId } )
      return
    }
    const eventType = document.type === "errorReport" ? "acceptedErrorReport" : "acceptedVersion"
    await applyReputationEvent( {
      admin,
      logger,
      event: buildReputationEvent( {
        eventId: `acceptedVersion:${versionId}`,
        projectId: after.projectId,
        userId: after.createdBy,
        sourceType: "version",
        sourceId: versionId,
        eventType,
        counterField: "acceptedVersionCount",
      } ),
    } )
    if( document.type === "errorReport" && document.baseVersionId ) {
      const baseVersionSnapshot = await db.collection( "versions" ).doc( document.baseVersionId ).get()
      const baseVersion = readSnapshotData( baseVersionSnapshot )
      if( baseVersion?.createdBy ) {
        await applyReputationEvent( {
          admin,
          logger,
          event: buildReputationEvent( {
            eventId: `acceptedErrorReportPenalty:${versionId}:${document.baseVersionId}`,
            projectId: after.projectId,
            userId: baseVersion.createdBy,
            sourceType: "acceptedErrorReport",
            sourceId: versionId,
            eventType: "acceptedErrorReportPenalty",
            counterField: "acceptedVersionCount",
            countsAsContribution: false,
          } ),
        } )
      } else {
        logger.warn( "Skipping accepted error-report penalty because the base version author is unavailable.", {
          baseVersionId: document.baseVersionId,
          versionId,
        } )
      }
    }
  }
}

module.exports = {
  BADGE_IDS,
  POINT_RULES,
  applyReputationEvent,
  buildReputationEvent,
  createCommentReputationHandler,
  createReactionReputationHandler,
  createThreadReputationHandler,
  createVersionReputationHandler,
  deriveBadgeIds,
}
