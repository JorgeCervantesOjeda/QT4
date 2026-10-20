// functions/commentNotifications.test.js: Verifies backend comment notification filtering and digest event staging.
const assert = require( "node:assert/strict" )
const test = require( "node:test" )

const {
  buildEmailHtml,
  createCommentNotificationHandler,
} = require( "./commentNotifications" )
const { buildHourlyNotificationDigest } = require( "./hourlyNotificationDigest" )

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

test( "error-report identity survives notification handling and hourly digest rendering", async () => {
  const writes = []
  const sentEmails = []
  const store = {
    "documents/report-1": {
      type: "errorReport", shortId: 13, title: "Missing evidence",
      baseDocId: "base-1",
    },
    "documents/base-1": { shortId: 12, title: "Evidence matrix" },
    "versions/report-version": { number: 100, createdBy: "reviewer" },
    "threads/thread-1": { title: "Check evidence" },
    "userProfiles/reviewer": {
      email: "reviewer@example.com",
      notificationPreferences: { commentEmailEnabled: true },
    },
  }
  const handler = createCommentNotificationHandler( {
    admin: createAdmin( createFakeDb( store, writes ) ),
    logger: { error: assert.fail, info: () => {}, warn: assert.fail },
    sendTextEmail: async (message) => { sentEmails.push( message ) },
  } )
  await handler( createEvent( "comment-1", {
    projectId: "project-1", docId: "report-1", versionId: "report-version",
    threadId: "thread-1", createdBy: "actor", body: "First line\r\n\r\nSecond paragraph",
  } ) )

  assert.equal( sentEmails.length, 1 )
  assert.match( sentEmails[0].subject, /Error report: 13/u )
  for( const content of [ sentEmails[0].text, sentEmails[0].html ] ) {
    assert.match( content, /Error report: 13 - Missing evidence/u )
    assert.match( content, /for document: 12 - Evidence matrix/u )
    assert.match( content, /documents\/report-1\/versions/u )
  }
  assert.match( sentEmails[0].html, /First line<br><br>Second paragraph/u )
  const events = writes.map( (write) => ( { id: write.path, ...write.data } ) )
  const digest = buildHourlyNotificationDigest( events, "2026-10-20T15" )
  assert.match( digest.text, /Error report: 13 - Missing evidence/u )
  assert.match( digest.html, /for document: 12 - Evidence matrix/u )
} )

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
  assert.match( sentEmails[0].html, /<h1[^>]*>A new comment was added\.<\/h1>/u )
  assert.match( sentEmails[0].html, /Please add the missing evidence/u )

  const eventWrites = writes.filter( (write) => write.path.startsWith( "notificationEvents/" ) )
  assert.deepEqual(
    eventWrites.map( (write) => write.data.userId ).sort(),
    [
      "actor-user",
      "disabled-user",
      "enabled-user",
      "thread-author",
      "version-author",
    ],
  )
  assert.equal( eventWrites[0].data.digestHourKey, "2026-09-28T18" )
} )

test( "buildEmailHtml escapes comment content and renders a direct link", () => {
  const html = buildEmailHtml( {
    actorLabel: "Reviewer <One>",
    comment: { body: "Please use <strong>evidence</strong>." },
    directUrl: "https://qt4.example.test/documents/doc-1/versions?threadId=thread-1",
    documentData: { shortId: 12, title: "Evidence matrix" },
    thread: { title: "Missing evidence" },
    version: { number: 100 },
  } )

  assert.match( html, /Reviewer &lt;One&gt;/u )
  assert.match( html, /Please use &lt;strong&gt;evidence&lt;\/strong&gt;\./u )
  assert.match( html, /<a href="https:\/\/qt4\.example\.test\/documents\/doc-1\/versions\?threadId=thread-1"/u )
  assert.match( html, /<strong>Document:<\/strong> 12 - Evidence matrix/u )
  assert.doesNotMatch( html, /Error report:/u )
} )

// Linked integration coverage: error-report identity survives notification handling and hourly digest rendering.
test( "buildEmailHtml escapes report and base titles while retaining the report identity", () => {
  const html = buildEmailHtml( {
    actorLabel: "Reviewer",
    comment: { body: "First\r\n\r\nSecond" },
    directUrl: "https://qt4.example.test/documents/report-1/versions",
    documentData: { type: "errorReport", shortId: 13, title: "Report <one>", baseDocId: "base-1" },
    baseDocumentData: { shortId: 12, title: "Base & evidence" },
    thread: { title: "Issue" }, version: { number: 100 },
  } )
  assert.match( html, /Error report: 13 - Report &lt;one&gt; \(for document: 12 - Base &amp; evidence\)/u )
  assert.match( html, /First<br><br>Second/u )
} )

