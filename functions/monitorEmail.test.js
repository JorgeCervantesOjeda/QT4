// functions/monitorEmail.test.js
// Verifies that monitor emails include safe, actionable diagnostic details.
const assert = require( "node:assert/strict" )
const test = require( "node:test" )

const { buildMonitorEmailText } = require( "./monitorEmail" )
const { normalizeMonitorDetails } = require( "./monitorDetails" )

test( "buildMonitorEmailText includes structured diagnostic details", () => {
  const text = buildMonitorEmailText( {
    consoleUrl: "https://console.firebase.google.com/event/1",
    payload: {
      action: "versions.createThread",
      actorEmail: "user@example.com",
      actorId: "user-1",
      activeFirestoreListeners: [],
      appBuild: "4.12.0",
      appVersion: "4.12.0",
      category: "permission",
      clientTimestamp: "2026-10-05T18:44:02.592Z",
      code: "permission-denied",
      docId: "document-1",
      docLabel: "Document 1",
      fingerprint: "99072bb5",
      messageRaw: "Missing or insufficient permissions.",
      online: true,
      pageLabel: "Document Versions",
      pageUrl: "https://example.com/documents/document-1/versions",
      projectId: "project-1",
      projectLabel: "Project 1",
      recentDiagnostics: [],
      route: "/documents/document-1/versions",
      severity: "high",
      source: "firestore",
      threadId: "thread-1",
      versionId: "version-1",
      diagnosticDetails: {
        authorization: { canContribute: false, isVersionReviewer: false },
        likelyCauses: ["actor_not_authorized"],
      },
      visibilityState: "visible",
    },
  } )

  assert.match( text, /Diagnostic details \(client-side; not authoritative\):/u )
  assert.match( text, /actor_not_authorized/u )
  assert.match( text, /Firestore event:/u )
} )

test( "normalizeMonitorDetails bounds diagnostic payloads", () => {
  const normalized = normalizeMonitorDetails( {
    nested: { value: "kept" },
    password: "must not be treated as a special field",
    values: Array.from( { length: 30 }, ( _, index ) => index ),
  } )

  assert.equal( normalized.nested.value, "kept" )
  assert.equal( normalized.values.length, 20 )
  assert.equal( normalized.password, "must not be treated as a special field" )
} )
