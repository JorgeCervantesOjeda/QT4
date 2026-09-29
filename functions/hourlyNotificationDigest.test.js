// functions/hourlyNotificationDigest.test.js: Verifies hourly notification digest grouping and idempotency.
const assert = require( "node:assert/strict" )
const test = require( "node:test" )

const {
  buildHourlyNotificationDigest,
  createHourlyNotificationDigestJob,
} = require( "./hourlyNotificationDigest" )

const createSnapshot = (collectionName, id, data) => ( {
  id,
  exists: Boolean( data ),
  data: () => data,
  ref: {
    path: `${collectionName}/${id}`,
  },
} )

const createFakeDb = ({ digestStore = {}, eventDocs = [], profileStore = {}, writes = [] }) => ( {
  batch() {
    return {
      set: (ref, data, options) => {
        writes.push( { type: "batch-set", path: ref.path, data, options } )
      },
      commit: async () => undefined,
    }
  },
  collection(collectionName) {
    if( collectionName === "notificationEvents" ) {
      const filters = []
      return {
        where(fieldName, op, value) {
          filters.push( [ fieldName, op, value ] )
          return this
        },
        orderBy(fieldName, direction = "asc") {
          assert.equal( fieldName, "digestHourKey" )
          assert.equal( direction, "asc" )
          return this
        },
        limit(limitValue) {
          assert.equal( limitValue, 500 )
          return this
        },
        get: async () => {
          assert.deepEqual( filters, [
            [ "digestStatus", "==", "pending" ],
            [ "digestHourKey", "<", "2026-09-28T19" ],
          ] )
          return { docs: eventDocs }
        },
      }
    }
    return {
      doc(documentId) {
        return {
          id: documentId,
          path: `${collectionName}/${documentId}`,
          get: async () => {
            if( collectionName === "userProfiles" ) {
              return createSnapshot( collectionName, documentId, profileStore[documentId] )
            }
            if( collectionName === "notificationDigests" ) {
              return createSnapshot( collectionName, documentId, digestStore[documentId] )
            }
            return createSnapshot( collectionName, documentId, null )
          },
          set: async (data, options) => {
            writes.push( {
              type: "doc-set",
              id: documentId,
              path: `${collectionName}/${documentId}`,
              data,
              options,
            } )
            digestStore[documentId] = {
              ...( digestStore[documentId] || {} ),
              ...data,
            }
          },
        }
      },
    }
  },
} )

const createAdmin = (db) => {
  const admin = {
    firestore: () => db,
  }
  admin.firestore.FieldValue = {
    serverTimestamp: () => "server-timestamp",
  }
  return admin
}

test( "buildHourlyNotificationDigest formats related comments for one user and hour", () => {
  const digest = buildHourlyNotificationDigest( [
    {
      id: "event-1",
      projectLabel: "7 - Project Alpha",
      actorLabel: "Reviewer One",
      documentLabel: "DOC-7 - Quality Plan",
      versionLabel: "1.00",
      issueTitle: "Missing evidence",
      commentExcerpt: "Please add the missing evidence.",
      directUrl: "/documents/doc-1/versions?commentId=comment-1&threadId=thread-1&focus=comments",
      kind: "comment",
    },
    {
      id: "event-2",
      projectLabel: "7 - Project Alpha",
      actorLabel: "Reviewer Two",
      documentLabel: "DOC-7 - Quality Plan",
      versionLabel: "1.00",
      issueTitle: "Missing evidence",
      commentExcerpt: "Second related comment.",
      directUrl: "/documents/doc-1/versions?commentId=comment-2&threadId=thread-1&focus=comments",
      kind: "comment",
    },
  ], "2026-09-28T18" )

  assert.match( digest.subject, /\[QT4\] Hourly activity summary/u )
  assert.match( digest.text, /Project: 7 - Project Alpha/u )
  assert.match( digest.text, /Document: DOC-7 - Quality Plan/u )
  assert.match( digest.text, /Version: 1\.00/u )
  assert.match( digest.text, /Issue: Missing evidence/u )
  assert.match(
    digest.text,
    /Open issue: https:\/\/qualiteam-plus\.web\.app\/documents\/doc-1\/versions\?threadId=thread-1&focus=comments/u,
  )
  assert.match( digest.text, /Comments:\n- Reviewer One: Please add the missing evidence\./u )
  assert.match( digest.text, /- Reviewer Two: Second related comment\./u )
  assert.equal( ( digest.text.match( /Open issue:/gu ) || [] ).length, 1 )
  assert.doesNotMatch( digest.text, /commentId=/u )
} )

test( "buildHourlyNotificationDigest sorts comments chronologically within an issue", () => {
  const createTimestamp = (iso) => ( {
    toMillis: () => new Date( iso ).getTime(),
  } )
  const digest = buildHourlyNotificationDigest( [
    {
      id: "event-late",
      eventAt: createTimestamp( "2026-09-28T18:45:00.000Z" ),
      projectLabel: "7 - Project Alpha",
      actorLabel: "Third User",
      documentLabel: "DOC-7 - Quality Plan",
      versionLabel: "1.00",
      issueTitle: "Missing evidence",
      commentExcerpt: "Third comment.",
      directUrl: "/documents/doc-1/versions?threadId=thread-1&focus=comments",
    },
    {
      id: "event-early",
      eventAt: createTimestamp( "2026-09-28T18:05:00.000Z" ),
      projectLabel: "7 - Project Alpha",
      actorLabel: "First User",
      documentLabel: "DOC-7 - Quality Plan",
      versionLabel: "1.00",
      issueTitle: "Missing evidence",
      commentExcerpt: "First comment.",
      directUrl: "/documents/doc-1/versions?threadId=thread-1&focus=comments",
    },
    {
      id: "event-middle",
      eventAt: createTimestamp( "2026-09-28T18:20:00.000Z" ),
      projectLabel: "7 - Project Alpha",
      actorLabel: "Second User",
      documentLabel: "DOC-7 - Quality Plan",
      versionLabel: "1.00",
      issueTitle: "Missing evidence",
      commentExcerpt: "Second comment.",
      directUrl: "/documents/doc-1/versions?threadId=thread-1&focus=comments",
    },
  ], "2026-09-28T18" )

  const firstCommentIndex = digest.text.indexOf( "- First User: First comment." )
  const secondCommentIndex = digest.text.indexOf( "- Second User: Second comment." )
  const thirdCommentIndex = digest.text.indexOf( "- Third User: Third comment." )
  assert.ok( firstCommentIndex < secondCommentIndex )
  assert.ok( secondCommentIndex < thirdCommentIndex )
} )

test( "createHourlyNotificationDigestJob preserves comment chronology in the generated email", async () => {
  const emails = []
  const eventTimestamp = (iso) => ( {
    toMillis: () => new Date( iso ).getTime(),
  } )
  const db = createFakeDb( {
    eventDocs: [
      createSnapshot( "notificationEvents", "event-a", {
        userId: "user-1",
        email: "user@example.com",
        kind: "comment",
        digestStatus: "pending",
        digestHourKey: "2026-09-28T18",
        eventAt: eventTimestamp( "2026-09-28T18:30:00.000Z" ),
        projectLabel: "7 - Project Alpha",
        documentLabel: "DOC-7 - Quality Plan",
        versionLabel: "1.00",
        issueTitle: "Missing evidence",
        actorLabel: "Third User",
        commentExcerpt: "Third comment.",
      } ),
      createSnapshot( "notificationEvents", "event-m", {
        userId: "user-1",
        email: "user@example.com",
        kind: "comment",
        digestStatus: "pending",
        digestHourKey: "2026-09-28T18",
        eventAt: eventTimestamp( "2026-09-28T18:05:00.000Z" ),
        projectLabel: "7 - Project Alpha",
        documentLabel: "DOC-7 - Quality Plan",
        versionLabel: "1.00",
        issueTitle: "Missing evidence",
        actorLabel: "First User",
        commentExcerpt: "First comment.",
      } ),
      createSnapshot( "notificationEvents", "event-z", {
        userId: "user-1",
        email: "user@example.com",
        kind: "comment",
        digestStatus: "pending",
        digestHourKey: "2026-09-28T18",
        eventAt: eventTimestamp( "2026-09-28T18:20:00.000Z" ),
        projectLabel: "7 - Project Alpha",
        documentLabel: "DOC-7 - Quality Plan",
        versionLabel: "1.00",
        issueTitle: "Missing evidence",
        actorLabel: "Second User",
        commentExcerpt: "Second comment.",
      } ),
    ],
    profileStore: {
      "user-1": {
        email: "user@example.com",
        notificationPreferences: {
          hourlyActivityDigestEnabled: true,
        },
      },
    },
  } )
  const job = createHourlyNotificationDigestJob( {
    admin: createAdmin( db ),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    now: () => new Date( "2026-09-28T19:05:00.000Z" ),
    sendTextEmail: async (message) => {
      emails.push( message )
    },
  } )

  await job()

  assert.equal( emails.length, 1 )
  const firstCommentIndex = emails[0].text.indexOf( "- First User: First comment." )
  const secondCommentIndex = emails[0].text.indexOf( "- Second User: Second comment." )
  const thirdCommentIndex = emails[0].text.indexOf( "- Third User: Third comment." )
  assert.ok( firstCommentIndex < secondCommentIndex )
  assert.ok( secondCommentIndex < thirdCommentIndex )
} )

test( "createHourlyNotificationDigestJob sends one email per user and closed hour", async () => {
  const emails = []
  const writes = []
  const eventDocs = [
    createSnapshot( "notificationEvents", "event-1", {
      userId: "user-1",
      email: "old@example.com",
      kind: "comment",
      digestStatus: "pending",
      digestHourKey: "2026-09-28T18",
      actorLabel: "Reviewer One",
      documentLabel: "DOC-7 - Quality Plan",
      issueTitle: "Missing evidence",
      commentExcerpt: "Please add the missing evidence.",
      directUrl: "https://qt4.example.test/documents/doc-1/versions?commentId=comment-1",
    } ),
    createSnapshot( "notificationEvents", "event-current", {
      userId: "user-1",
      email: "current@example.com",
      kind: "comment",
      digestStatus: "pending",
      digestHourKey: "2026-09-28T19",
      issueTitle: "Current hour event",
    } ),
  ]
  const db = createFakeDb( {
    eventDocs,
    profileStore: {
      "user-1": {
        email: "user@example.com",
        notificationPreferences: {
          commentEmailEnabled: true,
          hourlyActivityDigestEnabled: true,
        },
      },
    },
    writes,
  } )
  const job = createHourlyNotificationDigestJob( {
    admin: createAdmin( db ),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    now: () => new Date( "2026-09-28T19:05:00.000Z" ),
    sendTextEmail: async (message) => {
      emails.push( message )
    },
  } )

  await job()

  assert.equal( emails.length, 1 )
  assert.deepEqual( emails[0].to, [ "user@example.com" ] )
  assert.match( emails[0].subject, /\[QT4\] Hourly activity summary/u )
  assert.match( emails[0].text, /Issue:/u )
  assert.match( emails[0].text, /Comments:/u )
  const digestWrites = writes.filter( (write) => write.path.startsWith( "notificationDigests/" ) )
  assert.equal( digestWrites[0].id, "user-1_2026-09-28T18" )
  const eventUpdates = writes.filter( (write) => write.path === "notificationEvents/event-1" )
  assert.equal( eventUpdates.at( -1 ).data.digestStatus, "sent" )
  assert.equal( writes.some( (write) => write.path === "notificationEvents/event-current" ), false )
} )

test( "createHourlyNotificationDigestJob skips already sent user-hour digests", async () => {
  const emails = []
  const writes = []
  const db = createFakeDb( {
    digestStore: {
      "user-1_2026-09-28T18": {
        digestStatus: "sent",
      },
    },
    eventDocs: [
      createSnapshot( "notificationEvents", "event-1", {
        userId: "user-1",
        email: "user@example.com",
        digestStatus: "pending",
        digestHourKey: "2026-09-28T18",
        issueTitle: "Already sent",
      } ),
    ],
    profileStore: {
      "user-1": {
        email: "user@example.com",
        notificationPreferences: {
          hourlyActivityDigestEnabled: true,
        },
      },
    },
    writes,
  } )
  const job = createHourlyNotificationDigestJob( {
    admin: createAdmin( db ),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    now: () => new Date( "2026-09-28T19:05:00.000Z" ),
    sendTextEmail: async (message) => {
      emails.push( message )
    },
  } )

  await job()

  assert.equal( emails.length, 0 )
  assert.equal(
    writes.some( (write) =>
      write.path === "notificationDigests/user-1_2026-09-28T18"
      && write.data.digestStatus !== "sent" ),
    false,
  )
} )

test( "createHourlyNotificationDigestJob marks events skipped when digest preference is off", async () => {
  const writes = []
  const db = createFakeDb( {
    eventDocs: [
      createSnapshot( "notificationEvents", "event-1", {
        userId: "user-1",
        email: "user@example.com",
        digestStatus: "pending",
        digestHourKey: "2026-09-28T18",
        issueTitle: "Preference off",
      } ),
    ],
    profileStore: {
      "user-1": {
        email: "user@example.com",
        notificationPreferences: {
          hourlyActivityDigestEnabled: false,
        },
      },
    },
    writes,
  } )
  const job = createHourlyNotificationDigestJob( {
    admin: createAdmin( db ),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    now: () => new Date( "2026-09-28T19:05:00.000Z" ),
    sendTextEmail: async () => {
      throw new Error( "should not send" )
    },
  } )

  await job()

  const eventUpdates = writes.filter( (write) => write.path === "notificationEvents/event-1" )
  assert.equal( eventUpdates.at( -1 ).data.digestStatus, "skipped" )
  assert.equal( eventUpdates.at( -1 ).data.digestSkipReason, "preference_disabled" )
} )
