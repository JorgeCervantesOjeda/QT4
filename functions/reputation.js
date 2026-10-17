// functions/reputation.js: Applies idempotent project-scoped contribution events.

const { FieldValue } = require( "firebase-admin/firestore" )

const SEQUENCE_BOUNDARY_TEMPLATES = Object.freeze( [ 1, 2, 5 ] )

const POINT_RULES = Object.freeze( {
  threadCreated: { category: "collaboration", points: 1, reason: "Created a discussion thread", sequenceKey: "reviewParticipation" },
  commentCreated: { category: "collaboration", points: 1, reason: "Added a comment", sequenceKey: "reviewParticipation" },
  goodReactionReceived: { category: "collaboration", points: 1, reason: "Received a good reaction on a comment", sequenceKey: "goodReaction" },
  reviewCompleted: { category: "review", points: 0, reason: "Completed an active review" },
  reviewAbsence: { category: "review", points: -1, reason: "Did not participate in an assigned review" },
  acceptedVersion: { category: "quality", points: 1, reason: "Created an accepted version", sequenceKey: "acceptedDocument" },
  acceptedErrorReport: { category: "quality", points: 1, reason: "Created an accepted error report", sequenceKey: "acceptedDocument" },
  acceptedErrorReportPenalty: { category: "quality", points: -2, reason: "An authored version received an accepted error report" },
} )

const getSequenceInterval = (sequenceNumber) => {
  if( !Number.isSafeInteger( sequenceNumber ) || sequenceNumber < 1 ) {
    throw new RangeError( "Sequence number must be a positive safe integer." )
  }
  let previousBoundary = 0
  for( let powerOfTen = 1; ; powerOfTen *= 10 ) {
    for( const boundaryTemplate of SEQUENCE_BOUNDARY_TEMPLATES ) {
      const boundary = boundaryTemplate * powerOfTen
      if( sequenceNumber <= boundary ) {
        return { start: previousBoundary + 1, end: boundary }
      }
      previousBoundary = boundary
    }
    if( powerOfTen > Number.MAX_SAFE_INTEGER / 10 ) {
      throw new RangeError( "Sequence number is too large to calculate safely." )
    }
  }
}

const getSequencePoints = (sequenceNumber) => {
  const interval = getSequenceInterval( sequenceNumber )
  return 1 / ( interval.end - interval.start + 1 )
}

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
    ...( rule.sequenceKey ? { sequenceKey: rule.sequenceKey } : {} ),
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

const getEarnedBadgeIds = (currentSummary, nextSummary) => {
  const previousBadgeIds = new Set(
    Array.isArray( currentSummary.badgeIds ) ? currentSummary.badgeIds : [],
  )
  return nextSummary.badgeIds.filter( (badgeId) => !previousBadgeIds.has( badgeId ) )
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

const sequenceSeedFields = Object.freeze( {
  reviewParticipation: [ "threadCount", "commentCount" ],
  goodReaction: [ "goodReactionCount" ],
  acceptedDocument: [ "acceptedVersionCount" ],
} )

const getSequenceCounterRef = (db, event) => db
  .collection( "reputationSequenceCounters" )
  .doc( `${event.projectId}_${event.userId}_${event.sequenceKey}` )

const getSequenceSeed = ({ currentSummary, sequenceKey, logger }) => {
  const fields = sequenceSeedFields[sequenceKey] || []
  return fields.reduce(
    (total, fieldName) => total + Math.max( 0, Math.floor( numericValue( currentSummary[fieldName], fieldName, logger ) ) ),
    0,
  )
}

const resolveSequencedEvent = ({ currentSummary, event, previousEvent, previousCounter, logger }) => {
  const requestedPoints = numericValue( event.points, "points", logger )
  if( !event.sequenceKey ) {
    return {
      event: { ...event, points: requestedPoints },
      points: requestedPoints,
      sequenceNumber: null,
      shouldWriteCounter: false,
    }
  }

  const storedSequenceNumber = Number( previousEvent?.sequenceNumber )
  const previousSequenceNumber = Number.isSafeInteger( storedSequenceNumber ) && storedSequenceNumber > 0
    ? storedSequenceNumber
    : null
  const storedCounterNumber = Number( previousCounter?.sequenceNumber )
  const hasStoredCounter = Number.isSafeInteger( storedCounterNumber ) && storedCounterNumber >= 0
  const seed = hasStoredCounter
    ? storedCounterNumber
    : getSequenceSeed( { currentSummary, sequenceKey: event.sequenceKey, logger } )
  const sequenceNumber = previousSequenceNumber || ( requestedPoints > 0 ? seed + 1 : null )
  const points = requestedPoints > 0 && sequenceNumber
    ? getSequencePoints( sequenceNumber )
    : requestedPoints
  const sequenceInterval = sequenceNumber ? getSequenceInterval( sequenceNumber ) : null
  const counterNumber = sequenceNumber ? Math.max( seed, sequenceNumber ) : seed
  const shouldWriteCounter = Boolean(
    sequenceNumber && requestedPoints > 0 && ( !hasStoredCounter || storedCounterNumber < counterNumber ),
  )
  return {
    event: {
      ...event,
      points,
      ...( sequenceNumber ? {
        sequenceNumber,
        sequenceIntervalStart: sequenceInterval.start,
        sequenceIntervalEnd: sequenceInterval.end,
      } : {} ),
    },
    points,
    sequenceNumber,
    counterNumber,
    shouldWriteCounter,
  }
}

const applySequencedReputationEvent = async ({ admin, event, logger }) => {
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
  const sequenceCounterRef = event.sequenceKey
    ? getSequenceCounterRef( db, { projectId, userId, sequenceKey: event.sequenceKey } )
    : null
  return db.runTransaction( async (transaction) => {
    const eventSnapshot = await transaction.get( eventRef )
    const summarySnapshot = await transaction.get( summaryRef )
    const sequenceCounterSnapshot = sequenceCounterRef
      ? await transaction.get( sequenceCounterRef )
      : null
    const previousEvent = readSnapshotData( eventSnapshot )
    const previousPoints = numericValue( previousEvent?.points, "points", logger )
    const requestedPoints = numericValue( event.points, "points", logger )
    if( previousEvent && previousPoints > 0 && requestedPoints > 0 && !previousEvent.sequenceNumber ) {
      return false
    }
    const currentSummary = {
      ...emptySummary( projectId, userId ),
      ...( readSnapshotData( summarySnapshot ) || {} ),
    }
    const sequenceResult = resolveSequencedEvent( {
      currentSummary,
      event,
      previousEvent,
      previousCounter: readSnapshotData( sequenceCounterSnapshot ),
      logger,
    } )
    const nextEvent = sequenceResult.event
    const nextPoints = sequenceResult.points
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
    const pointDelta = nextPoints - previousPoints
    const nextSummary = buildNextSummary( {
      currentSummary,
      event,
      pointDelta,
      activeDelta,
      counterDelta,
      logger,
    } )
    const earnedBadgeIds = getEarnedBadgeIds( currentSummary, nextSummary )
    const eventWithBadgeAwards = earnedBadgeIds.length
      ? { ...nextEvent, earnedBadgeIds }
      : nextEvent

    const timestamp = getServerTimestamp( admin )
    transaction.set( eventRef, {
      ...eventWithBadgeAwards,
      active: nextPoints !== 0,
      createdAt: previousEvent?.createdAt || timestamp,
      updatedAt: timestamp,
    }, { merge: true } )
    transaction.set( summaryRef, {
      ...nextSummary,
      updatedAt: timestamp,
    }, { merge: true } )
    if( sequenceResult.shouldWriteCounter ) {
      transaction.set( sequenceCounterRef, {
        projectId,
        userId,
        sequenceKey: event.sequenceKey,
        sequenceNumber: sequenceResult.counterNumber,
        updatedAt: timestamp,
      }, { merge: true } )
    }
    return true
  } )
}

const applyReputationEvent = applySequencedReputationEvent

const applyReviewParticipationEvent = async ({ admin, event, logger, threadId, versionId }) => {
  const projectId = normalizeRequired( event.projectId )
  const userId = normalizeRequired( event.userId )
  const eventId = normalizeRequired( event.eventId )
  const normalizedThreadId = normalizeRequired( threadId )
  const normalizedVersionId = normalizeRequired( versionId )
  if( !projectId || !userId || !eventId || !normalizedThreadId || !normalizedVersionId ) {
    logger.warn( "Skipping review participation with incomplete identity.", {
      event,
      threadId,
      versionId,
    } )
    return false
  }
  const db = getDb( admin )
  const eventRef = db.collection( "reputationEvents" ).doc( eventId )
  const summaryRef = db.collection( "reputationSummaries" ).doc( `${projectId}_${userId}` )
  const sequenceCounterRef = getSequenceCounterRef( db, event )
  const participationRef = db.collection( "reputationParticipation" ).doc(
    `${projectId}_${normalizedVersionId}_${normalizedThreadId}_${userId}`,
  )
  const reviewSummaryRef = db.collection( "reviewParticipationSummaries" ).doc(
    `${projectId}_${normalizedVersionId}_${userId}`,
  )
  return db.runTransaction( async (transaction) => {
    const [eventSnapshot, summarySnapshot, participationSnapshot, reviewSummarySnapshot, sequenceCounterSnapshot] = await Promise.all([
      transaction.get( eventRef ),
      transaction.get( summaryRef ),
      transaction.get( participationRef ),
      transaction.get( reviewSummaryRef ),
      transaction.get( sequenceCounterRef ),
    ])
    const previousEvent = readSnapshotData( eventSnapshot )
    if( previousEvent ) {
      return false
    }
    const currentSummary = {
      ...emptySummary( projectId, userId ),
      ...( readSnapshotData( summarySnapshot ) || {} ),
    }
    const previousParticipation = readSnapshotData( participationSnapshot )
    const participationCount = numericValue(
      previousParticipation?.participationCount,
      "participationCount",
      logger,
    )
    const sequenceResult = resolveSequencedEvent( {
      currentSummary,
      event,
      previousEvent,
      previousCounter: readSnapshotData( sequenceCounterSnapshot ),
      logger,
    } )
    const nextSummary = buildNextSummary( {
      currentSummary,
      event: sequenceResult.event,
      pointDelta: sequenceResult.points,
      activeDelta: 1,
      counterDelta: 1,
      logger,
    } )
    const earnedBadgeIds = getEarnedBadgeIds( currentSummary, nextSummary )
    const eventWithBadgeAwards = earnedBadgeIds.length
      ? { ...sequenceResult.event, earnedBadgeIds }
      : sequenceResult.event
    const previousReviewSummary = readSnapshotData( reviewSummarySnapshot )
    const timestamp = getServerTimestamp( admin )
    transaction.set( eventRef, {
      ...eventWithBadgeAwards,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    }, { merge: true } )
    transaction.set( summaryRef, {
      ...nextSummary,
      updatedAt: timestamp,
    }, { merge: true } )
    if( sequenceResult.shouldWriteCounter ) {
      transaction.set( sequenceCounterRef, {
        projectId,
        userId,
        sequenceKey: event.sequenceKey,
        sequenceNumber: sequenceResult.counterNumber,
        updatedAt: timestamp,
      }, { merge: true } )
    }
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
  await applyReviewParticipationEvent( {
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
  await applyReviewParticipationEvent( {
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
  applyReviewParticipationEvent,
  applySequencedReputationEvent,
  buildReputationEvent,
  createCommentReputationHandler,
  createReactionReputationHandler,
  createThreadReputationHandler,
  createVersionReputationHandler,
  deriveBadgeIds,
  getSequenceInterval,
  getSequencePoints,
}
