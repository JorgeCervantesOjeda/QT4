// functions/monitorLifecycle.test.js
// Verifies suppression criteria for harmless Firebase Auth lifecycle rejections.
const test = require( "node:test" )
const assert = require( "node:assert/strict" )

const { isTolerableFirebaseAuthLifecyclePayload } = require( "./monitorLifecycle" )

test( "recognizes Firebase Auth IndexedDB lifecycle rejections", () => {
  const isTolerable = isTolerableFirebaseAuthLifecyclePayload( {
    action: "global.unhandledrejection",
    messageRaw: "Database is closing/hidden",
    messageNormalized: "database is closing/hidden",
    stack: [
      "_openDb@https://qualiteam-plus.web.app/assets/vendor-firebase.js:1:86252",
      "setCurrentUser@https://qualiteam-plus.web.app/assets/vendor-firebase.js:1:45853",
      "reloadAndSetCurrentUserOrClear@https://qualiteam-plus.web.app/assets/vendor-firebase.js:1:55487",
    ].join( "\n" ),
  } )

  assert.equal( isTolerable, true )
} )

test( "does not suppress unrelated unhandled rejections", () => {
  const isTolerable = isTolerableFirebaseAuthLifecyclePayload( {
    action: "global.unhandledrejection",
    messageRaw: "Unexpected runtime failure",
    messageNormalized: "unexpected runtime failure",
    stack: "at renderSomething (https://example.com/app.js:1:1)",
  } )

  assert.equal( isTolerable, false )
} )
