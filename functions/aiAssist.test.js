// functions/aiAssist.test.js: Verifies QT4 AI assist mode routing and prompt safety helpers.
const assert = require( "node:assert/strict" )
const test = require( "node:test" )

const {
  buildAiPrompt,
  createAiAssistHandler,
  normalizeAiAssistRequest,
  selectSkillNames,
} = require( "./aiAssist" )

const createResponse = () => {
  const response = {
    headers: {},
    statusCode: 200,
    body: null,
    set( name, value ) {
      this.headers[name] = value
      return this
    },
    status( statusCode ) {
      this.statusCode = statusCode
      return this
    },
    json( body ) {
      this.body = body
      return this
    },
    send( body ) {
      this.body = body
      return this
    },
  }
  return response
}

const createFirestore = () => ( {
  collection() {
    return {
      doc() {
        return {
          get: async () => ( { exists: true, data: () => ( { taskCount: 0, expiredTaskCount: 0 } ) } ),
          collection() {
            return {
              get: async () => ( { docs: [] } ),
            }
          },
        }
      },
    }
  },
} )

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

test( "handler returns 401 when the user session is missing", async () => {
  const loggerCalls = []
  const handler = createAiAssistHandler( {
    admin: { firestore: createFirestore },
    logger: { info: (...args) => loggerCalls.push( args ), warn: (...args) => loggerCalls.push( args ), error: (...args) => loggerCalls.push( args ) },
    verifyBearerToken: async () => null,
    setCorsHeaders: () => {},
  } )
  const response = createResponse()

  await handler( { method: "POST", body: { mode: "summarize_pending" }, headers: {} }, response )

  assert.equal( response.statusCode, 401 )
  assert.equal( response.body.error, "User session is required." )
  assert.match( JSON.stringify( loggerCalls ), /auth_missing/u )
} )

test( "handler returns a provider error when Gemini fails", async () => {
  const previousApiKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = "test-key"
  const loggerCalls = []
  const handler = createAiAssistHandler( {
    admin: {
      firestore: createFirestore,
    },
    logger: { info: (...args) => loggerCalls.push( args ), warn: (...args) => loggerCalls.push( args ), error: (...args) => loggerCalls.push( args ) },
    verifyBearerToken: async () => ( { uid: "user-1" } ),
    setCorsHeaders: () => {},
    fetchImpl: async () => ( {
      ok: false,
      status: 403,
      text: async () => "API key not valid.",
    } ),
  } )
  const response = createResponse()

  await handler( { method: "POST", body: { mode: "summarize_pending" }, headers: {} }, response )

  if( previousApiKey === undefined ) {
    delete process.env.GEMINI_API_KEY
  } else {
    process.env.GEMINI_API_KEY = previousApiKey
  }
  assert.equal( response.statusCode, 502 )
  assert.equal( response.body.error, "AI provider request failed." )
  assert.match( JSON.stringify( loggerCalls ), /provider_error/u )
  assert.doesNotMatch( JSON.stringify( loggerCalls ), /test-key/u )
} )
