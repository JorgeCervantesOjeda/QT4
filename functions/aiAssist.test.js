// functions/aiAssist.test.js: Verifies QT4 AI assist mode routing and prompt safety helpers.
const assert = require( "node:assert/strict" )
const test = require( "node:test" )

const {
  buildAiPrompt,
  normalizeAiAssistRequest,
  selectSkillNames,
} = require( "./aiAssist" )

test( "normalizes only supported AI assist modes", () => {
  assert.equal(
    normalizeAiAssistRequest( { mode: "explain_comment", commentId: " comment-1 " } ).commentId,
    "comment-1",
  )
  assert.throws(
    () => normalizeAiAssistRequest( { mode: "write_reply", text: "Please answer for me." } ),
    /Unsupported AI assist mode/u,
  )
} )

test( "selects deterministic skills for each mode", () => {
  assert.deepEqual(
    selectSkillNames( "explain_thread" ),
    [ "qt4-glossary", "explain-thread", "review-context-safety" ],
  )
  assert.deepEqual(
    selectSkillNames( "improve_text" ),
    [ "improve-writing", "preserve-intent", "no-new-claims" ],
  )
} )

test( "prompt forbids writing replies from scratch", () => {
  const prompt = buildAiPrompt( {
    mode: "improve_text",
    language: "es",
    context: {
      userText: "Creo que este comentario necesita más evidencia.",
    },
  } )
  assert.match( prompt, /No redactes una respuesta nueva desde cero/u )
  assert.match( prompt, /No agregues argumentos nuevos/u )
  assert.match( prompt, /Conserva la intención/u )
} )
