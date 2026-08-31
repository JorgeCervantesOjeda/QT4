// functions/slowUiDigest.test.js: Verifies slow UI action digest formatting and delivery orchestration.
const assert = require( "node:assert/strict" )
const test = require( "node:test" )

const {
  buildSlowUiActionDigest,
  createSlowUiActionDigestJob,
} = require( "./slowUiDigest" )

const timestamp = (value) => ( {
  toDate: () => new Date( value ),
} )

const createSnapshot = (id, data) => ( {
  id,
  data: () => data,
  ref: {
    path: `slowUiActions/${id}`,
  },
} )

test( "buildSlowUiActionDigest groups slow actions by page and action", () => {
  const digest = buildSlowUiActionDigest( [
    {
      id: "event-1",
      action: "review.explainIssue",
      page: "Document Versions",
      route: "/projects/p1/documents/d1/versions",
      durationMs: 1220,
      thresholdMs: 1000,
      userId: "user-1",
      projectId: "project-1",
      docId: "doc-1",
      versionId: "version-1",
      threadId: "thread-1",
      startedAt: timestamp( "2026-08-29T12:00:00.000Z" ),
    },
    {
      id: "event-2",
      action: "review.explainIssue",
      page: "Document Versions",
      durationMs: 2100,
      thresholdMs: 1000,
      userId: "user-2",
      startedAtMs: 1000,
    },
  ], new Date( "2026-08-30T14:00:00.000Z" ) )

  assert.equal( digest.subject, "[QT4][UX] 2 slow non-modal actions" )
  assert.match( digest.text, /Document Versions \/ review\.explainIssue/u )
  assert.match( digest.text, /count=2/u )
  assert.match( digest.text, /max=2100ms/u )
  assert.match( digest.text, /user=user-1/u )
  assert.doesNotMatch( digest.text, /example\.com/u )
} )

test( "createSlowUiActionDigestJob emails pending events and marks them reported", async () => {
  const updates = []
  const emails = []
  const docs = [
    createSnapshot( "event-1", {
      action: "review.explainIssue",
      page: "Document Versions",
      durationMs: 1220,
      thresholdMs: 1000,
      userId: "user-1",
    } ),
  ]
  const db = {
    collection(collectionName) {
      assert.equal( collectionName, "slowUiActions" )
      return {
        where(fieldName, op, value) {
          assert.equal( fieldName, "reportedAt" )
          assert.equal( op, "==" )
          assert.equal( value, null )
          return this
        },
        limit(limitValue) {
          assert.equal( limitValue, 200 )
          return this
        },
        get: async () => ( { docs } ),
      }
    },
    batch() {
      return {
        set(ref, data, options) {
          updates.push( { ref, data, options } )
        },
        commit: async () => undefined,
      }
    },
  }
  const admin = {
    firestore: () => db,
  }
  admin.firestore.FieldValue = {
    serverTimestamp: () => "server-timestamp",
  }
  const logger = { info: () => {}, warn: () => {}, error: () => {} }
  const job = createSlowUiActionDigestJob( {
    admin,
    logger,
    now: () => new Date( "2026-08-30T14:00:00.000Z" ),
    getRecipients: () => [ "admin@example.com" ],
    sendTextEmail: async (message) => {
      emails.push( message )
    },
  } )

  await job()

  assert.equal( emails.length, 1 )
  assert.deepEqual( emails[0].to, [ "admin@example.com" ] )
  assert.match( emails[0].text, /event-1/u )
  assert.equal( updates.length, 1 )
  assert.equal( updates[0].data.reportedAt, "server-timestamp" )
  assert.equal( updates[0].data.digestStatus, "sent" )
} )

test( "createSlowUiActionDigestJob does not mark events when recipients are missing", async () => {
  let commitCount = 0
  const warnings = []
  const db = {
    collection() {
      return {
        where() {
          return this
        },
        limit() {
          return this
        },
        get: async () => ( {
          docs: [
            createSnapshot( "event-1", {
              action: "review.explainIssue",
              page: "Document Versions",
              durationMs: 1220,
            } ),
          ],
        } ),
      }
    },
    batch() {
      return {
        set: () => undefined,
        commit: async () => {
          commitCount += 1
        },
      }
    },
  }
  const admin = {
    firestore: () => db,
  }
  admin.firestore.FieldValue = {
    serverTimestamp: () => "server-timestamp",
  }
  const job = createSlowUiActionDigestJob( {
    admin,
    logger: { info: () => {}, warn: (...args) => warnings.push( args ), error: () => {} },
    getRecipients: () => [],
    sendTextEmail: async () => {
      throw new Error( "should not send" )
    },
  } )

  await job()

  assert.equal( commitCount, 0 )
  assert.match( JSON.stringify( warnings ), /recipients_missing/u )
} )
