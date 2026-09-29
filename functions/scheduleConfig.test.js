// functions/scheduleConfig.test.js: Verifies scheduled notification jobs use stable clock boundaries.
const assert = require( "node:assert/strict" )
const { readFileSync } = require( "node:fs" )
const test = require( "node:test" )

test( "hourly notification digest runs at the top of each hour", () => {
  const indexText = readFileSync( "index.js", "utf8" )
  const envExampleText = readFileSync( ".env.example", "utf8" )

  assert.match(
    indexText,
    /NOTIFICATION_DIGEST_SCHEDULE", "0 \* \* \* \*"/u,
  )
  assert.match( envExampleText, /^NOTIFICATION_DIGEST_SCHEDULE=0 \* \* \* \*$/mu )
} )
