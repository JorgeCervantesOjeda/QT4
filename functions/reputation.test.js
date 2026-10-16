// functions/reputation.test.js: Verifies idempotent server-side contribution events.

const assert = require( "node:assert/strict" )
const test = require( "node:test" )

const {
  createThreadReputationHandler,
  createReactionReputationHandler,
  createVersionReputationHandler,
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

test( "thread contribution is written once when the trigger is retried", async () => {
  const db = createFakeDb()
  const handler = createThreadReputationHandler( { admin: createAdmin( db ), logger } )
  const event = {
    params: { threadId: "thread-1" },
    data: createSnapshot( "thread-1", {
      projectId: "project-1",
      createdBy: "user-1",
    } ),
  }

  await handler( event )
  await handler( event )

  assert.equal( db.read( "reputationEvents/threadCreated:thread-1" ).points, 1 )
  assert.equal( db.read( "reputationSummaries/project-1_user-1" ).totalPoints, 1 )
  assert.equal( db.read( "reputationSummaries/project-1_user-1" ).contributionCount, 1 )
} )

test( "review completion credits every assigned reviewer and acceptance credits the author", async () => {
  const db = createFakeDb( {
    "documents/document-1": { type: "document" },
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

  assert.equal( db.read( "reputationSummaries/project-1_reviewer-1" ).totalPoints, 4 )
  assert.equal( db.read( "reputationSummaries/project-1_reviewer-2" ).totalPoints, 4 )
  assert.equal( db.read( "reputationSummaries/project-1_author-1" ).totalPoints, 5 )
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

test( "accepting an error report credits the author with the quality bonus", async () => {
  const db = createFakeDb( {
    "documents/error-report-1": { type: "errorReport" },
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

  assert.equal( db.read( "reputationSummaries/project-1_author-1" ).qualityPoints, 6 )
  assert.equal( db.read( "reputationSummaries/project-1_author-1" ).totalPoints, 6 )
} )
