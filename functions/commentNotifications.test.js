// functions/commentNotifications.test.js: Verifies backend comment notification filtering and digest event staging.
const assert = require( "node:assert/strict" )
const test = require( "node:test" )

const {
  createCommentNotificationHandler,
} = require( "./commentNotifications" )

const createSnapshot = (id, data) => ( {
  id,
  exists: Boolean( data ),
  data: () => data,
} )

test( "handler includes the latest version author when a comment targets an older version", async () => {
  const writes = []
  const sentEmails = []
  const store = {
    "threads/thread-1": {
      projectId: "project-1",
      docId: "doc-1",
      versionId: "version-old",
      title: "Missing evidence",
      createdBy: "thread-author",
    },
    "versions/version-old": {
      projectId: "project-1",
      docId: "doc-1",
      number: 1,
      createdBy: "old-author",
      reviewerIds: [],
    },
    "versions/version-latest": {
      projectId: "project-1",
      docId: "doc-1",
      number: 100,
      createdBy: "latest-author",
      reviewerIds: [],
    },
    "documents/doc-1": {
      shortId: 12,
      title: "Evidence matrix",
      latestVersionId: "version-latest",
    },
    "userProfiles/latest-author": {
      email: "latest@example.com",
      notificationPreferences: { commentEmailEnabled: true },
    },
  }
  const db = createFakeDb( store, writes )
  const handler = createCommentNotificationHandler( {
    admin: createAdmin( db ),
    appOrigin: "https://qt4.example.test",
    logger: { error: () => {}, info: () => {}, warn: () => {} },
    sendTextEmail: async (message) => {
      sentEmails.push( message )
    },
  } )

  await handler( createEvent( "comment-1", {
    projectId: "project-1",
    docId: "doc-1",
    versionId: "version-old",
    threadId: "thread-1",
    body: "Please add the missing evidence.",
    createdBy: "comment-author",
  } ) )

  assert.deepEqual( sentEmails[0].to, [ "latest@example.com" ] )
  assert.equal(
    writes.filter( (write) => write.path.startsWith( "notificationEvents/" ) )[0].data.userId,
    "latest-author",
  )
} )

test( "handler stages digest events with project and version context plus absolute links", async () => {
  const writes = []
  const store = {
    "projects/project-1": {
      shortId: 7,
      name: "Project Alpha",
    },
    "threads/thread-1": {
      projectId: "project-1",
      docId: "doc-1",
      versionId: "version-1",
      title: "Missing evidence",
      createdBy: "thread-author",
    },
    "versions/version-1": {
      projectId: "project-1",
      docId: "doc-1",
      number: 100,
      createdBy: "version-author",
      reviewerIds: [],
    },
    "documents/doc-1": {
      shortId: 12,
      title: "Evidence matrix",
    },
    "userProfiles/thread-author": {
      email: "thread@example.com",
      displayName: "Thread User",
      notificationPreferences: {
        commentEmailEnabled: false,
        hourlyActivityDigestEnabled: true,
      },
    },
    "userProfiles/version-author": {
      email: "author@example.com",
      displayName: "Author User",
      notificationPreferences: {
        commentEmailEnabled: false,
        hourlyActivityDigestEnabled: true,
      },
    },
  }
  const db = createFakeDb( store, writes )
  const handler = createCommentNotificationHandler( {
    admin: createAdmin( db ),
    logger: { error: () => {}, info: () => {}, warn: () => {} },
    now: () => new Date( "2026-09-28T18:24:00.000Z" ),
    sendTextEmail: async () => {
      throw new Error( "should not send immediate email" )
    },
  } )

  await handler( createEvent( "comment-1", {
    projectId: "project-1",
    docId: "doc-1",
    versionId: "version-1",
    threadId: "thread-1",
    body: "Please add the missing evidence.",
    createdBy: "actor-user",
  } ) )

  const eventWrite = writes.find( (write) => write.path.startsWith( "notificationEvents/" ) )
  assert.equal( eventWrite.data.projectLabel, "7 - Project Alpha" )
  assert.equal( eventWrite.data.versionLabel, "1.00" )
  assert.match(
    eventWrite.data.directUrl,
    /^https:\/\/qualiteam-plus\.web\.app\/documents\/doc-1\/versions\?/u,
  )
} )

const createEvent = (commentId, data) => ( {
  params: { commentId },
  data: createSnapshot( commentId, data ),
} )

const createFakeDb = (store, writes) => ( {
  collection(collectionName) {
    return {
      doc(documentId) {
        return {
          get: async () => createSnapshot(
            documentId,
            store[`${collectionName}/${documentId}`],
          ),
          set: async (data, options) => {
            writes.push( {
              path: `${collectionName}/${documentId}`,
              data,
              options,
            } )
          },
        }
      },
      where(fieldName, op, value) {
        assert.equal( op, "==" )
        return {
          get: async () => ( {
            docs: Object.entries( store )
              .filter( ([ path, data ]) =>
                path.startsWith( `${collectionName}/` )
                && data[fieldName] === value )
              .map( ([ path, data ]) =>
                createSnapshot( path.split( "/" )[1], data ) ),
          } ),
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

test( "handler sends immediate email only to opted-in related participants", async () => {
  const writes = []
  const sentEmails = []
  const store = {
    "threads/thread-1": {
      projectId: "project-1",
      docId: "doc-1",
      versionId: "version-1",
      title: "Missing evidence",
      createdBy: "thread-author",
    },
    "versions/version-1": {
      projectId: "project-1",
      docId: "doc-1",
      number: 1,
      createdBy: "version-author",
      reviewerIds: [ "enabled-user", "disabled-user", "actor-user" ],
    },
    "documents/doc-1": {
      shortId: 12,
      title: "Evidence matrix",
    },
    "comments/comment-old": {
      threadId: "thread-1",
      createdBy: "enabled-user",
      body: "Earlier comment",
    },
    "userProfiles/enabled-user": {
      email: "enabled@example.com",
      displayName: "Enabled User",
      notificationPreferences: {
        commentEmailEnabled: true,
        hourlyActivityDigestEnabled: true,
      },
    },
    "userProfiles/disabled-user": {
      email: "disabled@example.com",
      displayName: "Disabled User",
      notificationPreferences: {
        commentEmailEnabled: false,
        hourlyActivityDigestEnabled: true,
      },
    },
    "userProfiles/actor-user": {
      email: "actor@example.com",
      displayName: "Actor User",
      notificationPreferences: {
        commentEmailEnabled: true,
        hourlyActivityDigestEnabled: true,
      },
    },
    "userProfiles/version-author": {
      email: "author@example.com",
      displayName: "Author User",
      notificationPreferences: {
        commentEmailEnabled: false,
        hourlyActivityDigestEnabled: true,
      },
    },
    "userProfiles/thread-author": {
      email: "thread@example.com",
      displayName: "Thread User",
      notificationPreferences: {
        commentEmailEnabled: false,
        hourlyActivityDigestEnabled: true,
      },
    },
  }
  const db = createFakeDb( store, writes )
  const handler = createCommentNotificationHandler( {
    admin: createAdmin( db ),
    appOrigin: "https://qt4.example.test",
    logger: { error: () => {}, info: () => {}, warn: () => {} },
    now: () => new Date( "2026-09-28T18:24:00.000Z" ),
    sendTextEmail: async (message) => {
      sentEmails.push( message )
    },
  } )

  await handler( createEvent( "comment-1", {
    projectId: "project-1",
    docId: "doc-1",
    versionId: "version-1",
    threadId: "thread-1",
    body: "Please add the missing evidence.",
    createdBy: "actor-user",
  } ) )

  assert.equal( sentEmails.length, 1 )
  assert.deepEqual( sentEmails[0].to, [ "enabled@example.com" ] )
  assert.doesNotMatch( sentEmails[0].text, /disabled@example\.com/u )
  assert.doesNotMatch( sentEmails[0].text, /actor@example\.com/u )
  assert.match( sentEmails[0].text, /Please add the missing evidence/u )
  assert.match( sentEmails[0].text, /https:\/\/qt4\.example\.test\/documents\/doc-1\/versions/u )

  const eventWrites = writes.filter( (write) => write.path.startsWith( "notificationEvents/" ) )
  assert.deepEqual(
    eventWrites.map( (write) => write.data.userId ).sort(),
    [
      "disabled-user",
      "enabled-user",
      "thread-author",
      "version-author",
    ],
  )
  assert.equal( eventWrites[0].data.digestHourKey, "2026-09-28T18" )
} )

