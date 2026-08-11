// functions/mcpDomain.test.js: Verifies QT4 MCP domain input normalization helpers.
const test = require( "node:test" )
const assert = require( "node:assert/strict" )

const {
  buildPendingActionRecord,
  normalizeRequiredString,
  sanitizeParams,
} = require( "./mcpDomain" )

test( "normalizeRequiredString trims required input", () => {
  assert.equal( normalizeRequiredString( "  abc  ", "sample" ), "abc" )
} )

test( "normalizeRequiredString rejects empty input", () => {
  assert.throws(
    () => normalizeRequiredString( "   ", "sample" ),
    /sample is required/,
  )
} )

test( "sanitizeParams removes large or unsafe values", () => {
  const sanitized = sanitizeParams( {
    ok: "value",
    empty: "",
    nested: { keep: true },
    array: [ "a", "b" ],
    token: "secret",
    veryLong: "x".repeat( 600 ),
  } )

  assert.deepEqual( sanitized, {
    ok: "value",
    empty: "",
    nested: { keep: true },
    array: [ "a", "b" ],
    veryLong: "x".repeat( 500 ),
  } )
} )

test( "buildPendingActionRecord derives user and pending status", () => {
  const record = buildPendingActionRecord(
    {
      uid: "user-1",
      email: "user@example.com",
    },
    {
      kind: "accept_version",
      summary: "Accept version 1.00",
      params: { versionId: "version-1" },
    },
    "mcp",
  )

  assert.equal( record.userId, "user-1" )
  assert.equal( record.actorEmail, "user@example.com" )
  assert.equal( record.status, "pending" )
  assert.equal( record.kind, "accept_version" )
  assert.deepEqual( record.params, { versionId: "version-1" } )
} )
