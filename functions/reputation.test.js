// functions/reputation.test.js: Verifies idempotent server-side contribution events.

const assert = require( "node:assert/strict" )
const test = require( "node:test" )

const {
  POINT_RULES,
  createCommentReputationHandler,
  createThreadReputationHandler,
  createReactionReputationHandler,
  createVersionReputationHandler,
  getSequenceInterval,
  getSequencePoints,
} = require( "./reputation" )

const createSnapshot = (id, data) => ( {
  id,
  exists: data !== undefined,
  data: () => data,
} )

const createFakeDb = (initialStore = {}) => {
  const store = new Map( Object.entries( initialStore ) )

  const getPath = (collectionName, documentId) => `${collectionName}/${documentId}`
  const db = {
    collection(collectionName) {
      return {
        doc(documentId) {
          const path = getPath( collectionName, documentId )
          return {
            path,
            get: async () => createSnapshot( documentId, store.get( path ) ),
          }
        },
        where(fieldName, operator, expectedValue) {
          assert.equal( operator, "==" )
          return {
            get: async () => ( {
              docs: [ ...store.entries() ]
                .filter( ([path, data]) => path.startsWith( `${collectionName}/` ) && data?.[fieldName] === expectedValue )
                .map( ([path, data]) => ( {
                  id: path.split( "/" )[1],
                  data: () => data,
                } ) ),
            } ),
          }
        },
      }
    },
    async runTransaction(callback) {
      const writes = []
      const transaction = {
        get: async (ref) => createSnapshot( ref.path.split( "/" )[1], store.get( ref.path ) ),
        set: (ref, data, options) => writes.push( { ref, data, options } ),
      }
      const result = await callback( transaction )
      writes.forEach( (write) => {
        const previous = store.get( write.ref.path ) || {}
        store.set( write.ref.path, write.options?.merge ? { ...previous, ...write.data } : write.data )
      } )
      return result
    },
    read(path) {
      return store.get( path )
    },
    write(path, data) {
      store.set( path, data )
    },
  }
  return db
}

const createAdmin = (db) => {
  const firestore = () => db
  firestore.FieldValue = {
    serverTimestamp: () => "server-time",
  }
  return { firestore }
}

const logger = { error: () => {}, info: () => {}, warn: () => {} }

test( "sequence intervals distribute one point across each boundary range", () => {
  assert.deepEqual( getSequenceInterval( 1 ), { start: 1, end: 1 } )
  assert.deepEqual( getSequenceInterval( 3 ), { start: 3, end: 5 } )
  assert.deepEqual( getSequenceInterval( 21 ), { start: 21, end: 50 } )
  assert.deepEqual( getSequenceInterval( 501 ), { start: 501, end: 1000 } )
  assert.equal( getSequencePoints( 1 ), 1 )
  assert.equal( getSequencePoints( 3 ), 1 / 3 )
  assert.equal( getSequencePoints( 21 ), 1 / 30 )
  assert.equal( getSequencePoints( 501 ), 1 / 500 )
} )

test( "positive reputation rules use the sequence base while special events keep their values", () => {
  assert.equal( POINT_RULES.threadCreated.points, 1 )
  assert.equal( POINT_RULES.commentCreated.points, 1 )
  assert.equal( POINT_RULES.goodReactionReceived.points, 1 )
  assert.equal( POINT_RULES.acceptedVersion.points, 1 )
  assert.equal( POINT_RULES.acceptedErrorReport.points, 1 )
  assert.equal( POINT_RULES.reviewCompleted.points, 0 )
  assert.equal( POINT_RULES.reviewAbsence.points, -1 )
  assert.equal( POINT_RULES.acceptedErrorReportPenalty.points, -2 )
} )

test( "sequenced review participation uses the cumulative 1, 1, 1/3 schedule", async () => {
  const db = createFakeDb()
  const handler = createThreadReputationHandler( { admin: createAdmin( db ), logger } )

  for( let index = 1; index <= 5; index += 1 ) {
    await handler( {
      params: { threadId: `thread-${index}` },
      data: createSnapshot( `thread-${index}`, {
        projectId: "project-1",
        versionId: `version-${index}`,
        createdBy: "user-1",
      } ),
    } )
  }

  const points = [ 1, 1, 1 / 3, 1 / 3, 1 / 3 ]
  points.forEach( (expectedPoints, index) => {
    const event = db.read( `reputationEvents/threadCreated:thread-${index + 1}` )
    assert.equal( event.points, expectedPoints )
    assert.equal( event.sequenceKey, "reviewParticipation" )
    assert.equal( event.sequenceNumber, index + 1 )
  } )
  assert.equal(
    db.read( "reputationSequenceCounters/project-1_user-1_reviewParticipation" ).sequenceNumber,
    5,
  )
} )

test( "sequenced reactions and accepted documents use independent cumulative schedules", async () => {
  const db = createFakeDb( {
    "documents/document-1": { type: "document" },
    "documents/document-2": { type: "document" },
    "documents/document-3": { type: "document" },
    "comments/comment-1": { projectId: "project-1", createdBy: "comment-author" },
    "comments/comment-2": { projectId: "project-1", createdBy: "comment-author" },
    "comments/comment-3": { projectId: "project-1", createdBy: "comment-author" },
  } )
  const reactionHandler = createReactionReputationHandler( { admin: createAdmin( db ), logger } )
  const versionHandler = createVersionReputationHandler( { admin: createAdmin( db ), logger } )

  for( let index = 1; index <= 3; index += 1 ) {
    await reactionHandler( {
      params: { reactionId: `reaction-${index}` },
      data: {
        before: createSnapshot( `reaction-${index}`, undefined ),
        after: createSnapshot( `reaction-${index}`, { commentId: `comment-${index}`, reaction: "good" } ),
      },
    } )
    await versionHandler( {
      params: { versionId: `version-${index}` },
      data: {
        before: createSnapshot( `version-${index}`, {
          projectId: "project-1",
          docId: `document-${index}`,
          createdBy: "document-author",
          status: "Reviewed",
        } ),
        after: createSnapshot( `version-${index}`, {
          projectId: "project-1",
          docId: `document-${index}`,
          createdBy: "document-author",
          status: "Accepted",
        } ),
      },
    } )
  }

  assert.equal( db.read( "reputationEvents/reactionGood:reaction-1" ).points, 1 )
  assert.equal( db.read( "reputationEvents/reactionGood:reaction-2" ).points, 1 )
  assert.equal( db.read( "reputationEvents/reactionGood:reaction-3" ).points, 1 / 3 )
  assert.equal( db.read( "reputationEvents/reactionGood:reaction-3" ).sequenceKey, "goodReaction" )
  assert.equal( db.read( "reputationEvents/acceptedVersion:version-1" ).points, 1 )
  assert.equal( db.read( "reputationEvents/acceptedVersion:version-2" ).points, 1 )
  assert.equal( db.read( "reputationEvents/acceptedVersion:version-3" ).points, 1 / 3 )
  assert.equal( db.read( "reputationEvents/acceptedVersion:version-3" ).sequenceKey, "acceptedDocument" )
} )

test( "thread contribution is written once when the trigger is retried", async () => {
  const db = createFakeDb()
  const handler = createThreadReputationHandler( { admin: createAdmin( db ), logger } )
  const event = {
    params: { threadId: "thread-1" },
    data: createSnapshot( "thread-1", {
      projectId: "project-1",
      versionId: "version-1",
      createdBy: "user-1",
    } ),
  }

  await handler( event )
  await handler( event )

  assert.equal( db.read( "reputationEvents/threadCreated:thread-1" ).points, 1 )
  assert.equal( db.read( "reputationSummaries/project-1_user-1" ).totalPoints, 1 )
  assert.equal( db.read( "reputationSummaries/project-1_user-1" ).contributionCount, 1 )
  assert.deepEqual(
    db.read( "reputationEvents/threadCreated:thread-1" ).earnedBadgeIds,
    [ "first-contribution" ],
  )
} )

test( "the initial issue comment does not create a second contribution", async () => {
  const db = createFakeDb()
  const handler = createCommentReputationHandler( { admin: createAdmin( db ), logger } )

  await handler( {
    params: { commentId: "comment-initial" },
    data: createSnapshot( "comment-initial", {
      projectId: "project-1",
      versionId: "version-1",
      threadId: "thread-1",
      createdBy: "user-1",
      isInitialIssueComment: true,
    } ),
  } )

  assert.equal( db.read( "reputationSummaries/project-1_user-1" ), undefined )
} )

test( "consecutive comments by one user count as one participation block", async () => {
  const db = createFakeDb()
  const threadHandler = createThreadReputationHandler( { admin: createAdmin( db ), logger } )
  const commentHandler = createCommentReputationHandler( { admin: createAdmin( db ), logger } )

  await threadHandler( {
    params: { threadId: "thread-1" },
    data: createSnapshot( "thread-1", {
      projectId: "project-1",
      versionId: "version-1",
      createdBy: "user-1",
    } ),
  } )
  db.write( "comments/initial-comment", {
    projectId: "project-1",
    versionId: "version-1",
    threadId: "thread-1",
    createdBy: "user-1",
    createdAt: "2026-10-15T10:00:00.000Z",
    isInitialIssueComment: true,
  } )
  const comments = [
    [ "comment-1", "user-1", "2026-10-15T10:01:00.000Z" ],
    [ "comment-2", "user-1", "2026-10-15T10:02:00.000Z" ],
    [ "comment-3", "user-2", "2026-10-15T10:03:00.000Z" ],
    [ "comment-4", "user-1", "2026-10-15T10:04:00.000Z" ],
    [ "comment-5", "user-1", "2026-10-15T10:05:00.000Z" ],
    [ "comment-6", "user-2", "2026-10-15T10:06:00.000Z" ],
    [ "comment-7", "user-1", "2026-10-15T10:07:00.000Z" ],
  ]
  for( const [commentId, userId, createdAt] of comments ) {
    db.write( `comments/${commentId}`, {
      projectId: "project-1",
      versionId: "version-1",
      threadId: "thread-1",
      createdBy: userId,
      createdAt,
    } )
    await commentHandler( {
      params: { commentId },
      data: createSnapshot( commentId, {
        projectId: "project-1",
        versionId: "version-1",
        threadId: "thread-1",
        createdBy: userId,
        createdAt,
      } ),
    } )
  }

  assert.equal( db.read( "reputationSummaries/project-1_user-1" ).totalPoints, 2 + 1 / 3 )
  assert.equal( db.read( "reputationSummaries/project-1_user-1" ).commentCount, 2 )
  assert.equal( db.read( "reputationSummaries/project-1_user-2" ).totalPoints, 2 )
  assert.equal( db.read( "reputationEvents/commentCreated:comment-1" ), undefined )
  assert.equal( db.read( "reputationEvents/commentCreated:comment-2" ), undefined )
  assert.equal( db.read( "reputationEvents/commentCreated:comment-4" ).points, 1 )
  assert.equal( db.read( "reputationEvents/commentCreated:comment-5" ), undefined )
  assert.equal( db.read( "reputationEvents/commentCreated:comment-7" ).points, 1 / 3 )
} )

test( "review completion rewards active assigned reviewers and penalizes inactive ones", async () => {
  const db = createFakeDb( {
    "documents/document-1": { type: "document" },
    "reviewParticipationSummaries/project-1_version-1_reviewer-1": {
      participationCount: 1,
      distinctThreadCount: 1,
    },
  } )
  const handler = createVersionReputationHandler( { admin: createAdmin( db ), logger } )

  await handler( {
    params: { versionId: "version-1" },
    data: {
      before: createSnapshot( "version-1", {
        projectId: "project-1",
        docId: "document-1",
        createdBy: "author-1",
        reviewerIds: [ "reviewer-1", "reviewer-2" ],
        status: "In Review",
      } ),
      after: createSnapshot( "version-1", {
        projectId: "project-1",
        docId: "document-1",
        createdBy: "author-1",
        reviewerIds: [ "reviewer-1", "reviewer-2" ],
        status: "Accepted",
      } ),
    },
  } )

  assert.equal( db.read( "reputationSummaries/project-1_reviewer-1" ).totalPoints, 0 )
  assert.equal( db.read( "reputationSummaries/project-1_reviewer-1" ).completedReviewCount, 1 )
  assert.equal( db.read( "reputationSummaries/project-1_reviewer-2" ).totalPoints, -1 )
  assert.equal( db.read( "reputationSummaries/project-1_author-1" ).totalPoints, 1 )
} )

test( "changing a good reaction to a regular reaction reverses the prior contribution", async () => {
  const db = createFakeDb( {
    "comments/comment-1": {
      projectId: "project-1",
      createdBy: "comment-author",
    },
    "reputationEvents/reactionGood:reaction-1": {
      projectId: "project-1",
      userId: "comment-author",
      points: 2,
      category: "collaboration",
      counterField: "goodReactionCount",
      createdAt: "original-time",
    },
    "reputationSummaries/project-1_comment-author": {
      projectId: "project-1",
      userId: "comment-author",
      totalPoints: 2,
      collaborationPoints: 2,
      reviewPoints: 0,
      qualityPoints: 0,
      contributionCount: 1,
      threadCount: 0,
      commentCount: 0,
      goodReactionCount: 1,
      completedReviewCount: 0,
      acceptedVersionCount: 0,
      badgeIds: [ "first-contribution" ],
    },
  } )
  const handler = createReactionReputationHandler( { admin: createAdmin( db ), logger } )

  await handler( {
    params: { reactionId: "reaction-1" },
    data: {
      before: createSnapshot( "reaction-1", { commentId: "comment-1", reaction: "good" } ),
      after: createSnapshot( "reaction-1", { commentId: "comment-1", reaction: "regular" } ),
    },
  } )

  assert.equal( db.read( "reputationSummaries/project-1_comment-author" ).totalPoints, 0 )
  assert.equal( db.read( "reputationSummaries/project-1_comment-author" ).goodReactionCount, 0 )
  assert.deepEqual( db.read( "reputationSummaries/project-1_comment-author" ).badgeIds, [] )
} )

test( "returning a reaction to good reuses its existing sequence position", async () => {
  const db = createFakeDb( {
    "comments/comment-1": {
      projectId: "project-1",
      createdBy: "comment-author",
    },
    "reputationEvents/reactionGood:reaction-1": {
      projectId: "project-1",
      userId: "comment-author",
      points: 1 / 3,
      category: "collaboration",
      sequenceKey: "goodReaction",
      sequenceNumber: 3,
      sequenceIntervalStart: 3,
      sequenceIntervalEnd: 5,
      counterField: "goodReactionCount",
      createdAt: "original-time",
    },
    "reputationSummaries/project-1_comment-author": {
      projectId: "project-1",
      userId: "comment-author",
      totalPoints: 1 / 3,
      collaborationPoints: 1 / 3,
      reviewPoints: 0,
      qualityPoints: 0,
      contributionCount: 1,
      threadCount: 0,
      commentCount: 0,
      goodReactionCount: 1,
      completedReviewCount: 0,
      acceptedVersionCount: 0,
      badgeIds: [ "first-contribution" ],
    },
    "reputationSequenceCounters/project-1_comment-author_goodReaction": {
      projectId: "project-1",
      userId: "comment-author",
      sequenceKey: "goodReaction",
      sequenceNumber: 3,
    },
  } )
  const handler = createReactionReputationHandler( { admin: createAdmin( db ), logger } )

  await handler( {
    params: { reactionId: "reaction-1" },
    data: {
      before: createSnapshot( "reaction-1", { commentId: "comment-1", reaction: "regular" } ),
      after: createSnapshot( "reaction-1", { commentId: "comment-1", reaction: "good" } ),
    },
  } )

  const event = db.read( "reputationEvents/reactionGood:reaction-1" )
  assert.equal( event.points, 1 / 3 )
  assert.equal( event.sequenceNumber, 3 )
  assert.equal( db.read( "reputationSequenceCounters/project-1_comment-author_goodReaction" ).sequenceNumber, 3 )
  assert.equal( db.read( "reputationSummaries/project-1_comment-author" ).totalPoints, 1 / 3 )
} )

test( "missing sequence counters are seeded from existing summary counters", async () => {
  const db = createFakeDb( {
    "comments/comment-1": { projectId: "project-1", createdBy: "comment-author" },
    "reputationSummaries/project-1_comment-author": {
      projectId: "project-1",
      userId: "comment-author",
      totalPoints: 2,
      collaborationPoints: 2,
      reviewPoints: 0,
      qualityPoints: 0,
      contributionCount: 2,
      threadCount: 0,
      commentCount: 0,
      goodReactionCount: 2,
      completedReviewCount: 0,
      acceptedVersionCount: 0,
      badgeIds: [ "first-contribution" ],
    },
  } )
  const handler = createReactionReputationHandler( { admin: createAdmin( db ), logger } )

  await handler( {
    params: { reactionId: "reaction-1" },
    data: {
      before: createSnapshot( "reaction-1", undefined ),
      after: createSnapshot( "reaction-1", { commentId: "comment-1", reaction: "good" } ),
    },
  } )

  const event = db.read( "reputationEvents/reactionGood:reaction-1" )
  assert.equal( event.sequenceNumber, 3 )
  assert.equal( event.points, 1 / 3 )
  assert.equal( db.read( "reputationSequenceCounters/project-1_comment-author_goodReaction" ).sequenceNumber, 3 )
} )

test( "retrying a historical positive event does not recalculate its points", async () => {
  const db = createFakeDb( {
    "comments/comment-1": { projectId: "project-1", createdBy: "comment-author" },
    "reputationEvents/reactionGood:reaction-1": {
      projectId: "project-1",
      userId: "comment-author",
      points: 1,
      category: "collaboration",
      counterField: "goodReactionCount",
      createdAt: "original-time",
    },
    "reputationSummaries/project-1_comment-author": {
      projectId: "project-1",
      userId: "comment-author",
      totalPoints: 2,
      collaborationPoints: 2,
      reviewPoints: 0,
      qualityPoints: 0,
      contributionCount: 2,
      threadCount: 0,
      commentCount: 0,
      goodReactionCount: 2,
      completedReviewCount: 0,
      acceptedVersionCount: 0,
      badgeIds: [ "first-contribution" ],
    },
  } )
  const handler = createReactionReputationHandler( { admin: createAdmin( db ), logger } )

  await handler( {
    params: { reactionId: "reaction-1" },
    data: {
      before: createSnapshot( "reaction-1", { commentId: "comment-1", reaction: "regular" } ),
      after: createSnapshot( "reaction-1", { commentId: "comment-1", reaction: "good" } ),
    },
  } )

  assert.equal( db.read( "reputationEvents/reactionGood:reaction-1" ).points, 1 )
  assert.equal( db.read( "reputationSummaries/project-1_comment-author" ).totalPoints, 2 )
  assert.equal( db.read( "reputationSequenceCounters/project-1_comment-author_goodReaction" ), undefined )
} )

test( "accepting an error report credits the author with the quality bonus", async () => {
  const db = createFakeDb( {
    "documents/error-report-1": { type: "errorReport", baseVersionId: "base-version-1" },
    "versions/base-version-1": { createdBy: "base-author-1" },
  } )
  const handler = createVersionReputationHandler( { admin: createAdmin( db ), logger } )

  await handler( {
    params: { versionId: "error-version-1" },
    data: {
      before: createSnapshot( "error-version-1", {
        projectId: "project-1",
        docId: "error-report-1",
        createdBy: "author-1",
        reviewerIds: [],
        status: "Reviewed",
      } ),
      after: createSnapshot( "error-version-1", {
        projectId: "project-1",
        docId: "error-report-1",
        createdBy: "author-1",
        reviewerIds: [],
        status: "Accepted",
      } ),
    },
  } )

  assert.equal( db.read( "reputationSummaries/project-1_author-1" ).qualityPoints, 1 )
  assert.equal( db.read( "reputationSummaries/project-1_author-1" ).totalPoints, 1 )
  assert.equal( db.read( "reputationSummaries/project-1_base-author-1" ).qualityPoints, -2 )
  assert.equal( db.read( "reputationSummaries/project-1_base-author-1" ).totalPoints, -2 )
} )
