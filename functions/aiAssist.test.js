// functions/aiAssist.test.js: Verifies QT4 AI assist mode routing and prompt safety helpers.
const assert = require( "node:assert/strict" )
const test = require( "node:test" )

const {
  buildAiPrompt,
  callGemini,
  createAiAssistHandler,
  normalizeAiAssistRequest,
  selectSkillNames,
} = require( "./aiAssist" )
const { groupPendingTasksForAi } = require( "./pendingTaskGrouping" )

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

const createMappedFirestore = (docsByPath) => ( {
  collection(collectionName) {
    const collectionPath = collectionName
    return createCollectionRef( docsByPath, collectionPath )
  },
} )

const createIndexFailingCommentsFirestore = (docsByPath) => ( {
  collection(collectionName) {
    if( collectionName !== "comments" ) {
      return createCollectionRef( docsByPath, collectionName )
    }
    return {
      where(fieldName, operator, value) {
        return {
          orderBy() {
            throw new Error( "9 FAILED_PRECONDITION: The query requires an index." )
          },
          limit() {
            return this
          },
          get: async () => createQueryRef( docsByPath, collectionName, [ { fieldName, operator, value } ] ).get(),
        }
      },
    }
  },
} )

const createCollectionRef = (docsByPath, collectionPath) => ( {
  doc(docId) {
    return {
      get: async () => createDocSnapshot( docId, docsByPath[`${collectionPath}/${docId}`] ),
    }
  },
  where(fieldName, operator, value) {
    return createQueryRef( docsByPath, collectionPath, [ { fieldName, operator, value } ] )
  },
} )

const createQueryRef = (docsByPath, collectionPath, filters) => ( {
  where(fieldName, operator, value) {
    return createQueryRef( docsByPath, collectionPath, [ ...filters, { fieldName, operator, value } ] )
  },
  orderBy() {
    return this
  },
  limit() {
    return this
  },
  get: async () => ( {
    docs: Object.entries( docsByPath )
      .filter( ([ path ]) => path.startsWith( `${collectionPath}/` ) )
      .filter( ([ path ]) => path.slice( collectionPath.length + 1 ).indexOf( "/" ) === -1 )
      .map( ([ path, data ] ) => createDocSnapshot( path.slice( collectionPath.length + 1 ), data ) )
      .filter( (snapshot) => snapshot.exists )
      .filter( (snapshot) => filters.every( (filter) => (
        filter.operator === "==" && snapshot.data()[filter.fieldName] === filter.value
      ) ) ),
  } ),
} )

const createDocSnapshot = (id, data) => ( {
  id,
  exists: Boolean( data ),
  data: () => data,
} )

const timestamp = (value) => ( {
  toDate: () => new Date( value ),
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

test( "comment explanation prompt asks for a human answer", () => {
  const prompt = buildAiPrompt( {
    mode: "explain_comment",
    language: "es",
    context: {
      comment: { body: "Could you clarify this value?", createdBy: "reviewer-1" },
      thread: { title: "Missing value" },
    },
  } )

  assert.match( prompt, /respuesta humana/u )
  assert.match( prompt, /No uses formato de auditoría/u )
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

test( "handler sends document references to Gemini without internal task ids", async () => {
  const previousApiKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = "test-key"
  let providerPrompt = ""
  const firestore = () => ( {
    collection(collectionName) {
      assert.equal( collectionName, "dashboard" )
      return {
        doc(uid) {
          assert.equal( uid, "user-1" )
          return {
            get: async () => ( {
              exists: true,
              data: () => ( {
                taskCount: 1,
                expiredTaskCount: 0,
              } ),
            } ),
            collection(childCollectionName) {
              assert.equal( childCollectionName, "tasks" )
              return {
                get: async () => ( {
                  docs: [
                    {
                      id: "authoring-internal-task-id",
                      data: () => ( {
                        type: "authoring",
                        title: "801 - Readable Draft",
                        documentShortId: 801,
                        documentTitle: "Readable Draft",
                        lifecycleState: "active",
                      } ),
                    },
                  ],
                } ),
              }
            },
          }
        },
      }
    },
  } )
  const handler = createAiAssistHandler( {
    admin: { firestore },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    verifyBearerToken: async () => ( { uid: "user-1" } ),
    setCorsHeaders: () => {},
    fetchImpl: async (_url, request) => {
      const body = JSON.parse( request.body )
      providerPrompt = body.contents[0].parts[0].text
      return {
        ok: true,
        json: async () => ( {
          candidates: [
            { content: { parts: [ { text: "Yo empezaría por 801 - Readable Draft." } ] } },
          ],
        } ),
      }
    },
  } )
  const response = createResponse()

  await handler( { method: "POST", body: { mode: "summarize_pending" }, headers: {} }, response )

  if( previousApiKey === undefined ) {
    delete process.env.GEMINI_API_KEY
  } else {
    process.env.GEMINI_API_KEY = previousApiKey
  }
  assert.equal( response.statusCode, 200 )
  assert.match( providerPrompt, /"documentShortId": 801/u )
  assert.match( providerPrompt, /"documentTitle": "Readable Draft"/u )
  assert.doesNotMatch( providerPrompt, /authoring-internal-task-id/u )
} )

test( "handler explains a thread whose project id is only on the version", async () => {
  const previousApiKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = "test-key"
  const firestore = () => createMappedFirestore( {
    "threads/thread-without-project": {
      title: "Missing value",
      status: "open",
      docId: "doc-1",
      versionId: "version-1",
      commentCount: 1,
    },
    "comments/comment-1": {
      threadId: "thread-without-project",
      body: "Could you clarify this value?",
      createdBy: "reviewer-1",
    },
    "versions/version-1": {
      projectId: "project-1",
      docId: "doc-1",
      number: 1,
      status: "In Review",
    },
    "documents/doc-1": {
      projectId: "project-1",
      title: "Readable Draft",
      shortId: 801,
    },
    "projects/project-1": {
      name: "Readable Project",
    },
    "projectMembers/project-1_user-1": {
      role: "member",
    },
  } )
  const handler = createAiAssistHandler( {
    admin: { firestore },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    verifyBearerToken: async () => ( { uid: "user-1" } ),
    setCorsHeaders: () => {},
    fetchImpl: async () => ( {
      ok: true,
      json: async () => ( {
        candidates: [
          { content: { parts: [ { text: "La persona revisora pide aclarar un valor." } ] } },
        ],
      } ),
    } ),
  } )
  const response = createResponse()

  await handler( { method: "POST", body: { mode: "explain_thread", threadId: "thread-without-project" }, headers: {} }, response )

  if( previousApiKey === undefined ) {
    delete process.env.GEMINI_API_KEY
  } else {
    process.env.GEMINI_API_KEY = previousApiKey
  }
  assert.equal( response.statusCode, 200 )
  assert.equal( response.body.result, "La persona revisora pide aclarar un valor." )
} )

test( "handler explains a thread without requiring a comments order index", async () => {
  const previousApiKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = "test-key"
  const firestore = () => createIndexFailingCommentsFirestore( {
    "threads/thread-1": {
      title: "Missing value",
      status: "open",
      projectId: "project-1",
      docId: "doc-1",
      versionId: "version-1",
      commentCount: 2,
    },
    "comments/newer-comment": {
      threadId: "thread-1",
      body: "Second comment.",
      createdAt: timestamp( "2026-08-12T10:00:00.000Z" ),
    },
    "comments/older-comment": {
      threadId: "thread-1",
      body: "First comment.",
      createdAt: timestamp( "2026-08-12T09:00:00.000Z" ),
    },
    "versions/version-1": {
      projectId: "project-1",
      docId: "doc-1",
      number: 1,
      status: "In Review",
    },
    "documents/doc-1": {
      projectId: "project-1",
      title: "Readable Draft",
      shortId: 801,
    },
    "projects/project-1": {
      name: "Readable Project",
    },
    "projectMembers/project-1_user-1": {
      role: "member",
    },
  } )
  let providerPrompt = ""
  const handler = createAiAssistHandler( {
    admin: { firestore },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    verifyBearerToken: async () => ( { uid: "user-1" } ),
    setCorsHeaders: () => {},
    fetchImpl: async (_url, request) => {
      const body = JSON.parse( request.body )
      providerPrompt = body.contents[0].parts[0].text
      return {
        ok: true,
        json: async () => ( {
          candidates: [
            { content: { parts: [ { text: "El issue pide aclarar un valor." } ] } },
          ],
        } ),
      }
    },
  } )
  const response = createResponse()

  await handler( { method: "POST", body: { mode: "explain_thread", threadId: "thread-1" }, headers: {} }, response )

  if( previousApiKey === undefined ) {
    delete process.env.GEMINI_API_KEY
  } else {
    process.env.GEMINI_API_KEY = previousApiKey
  }
  assert.equal( response.statusCode, 200 )
  assert.match( providerPrompt, /First comment.[\s\S]*Second comment/u )
} )

test( "callGemini uses the supported lite model contract", async () => {
  let requestedUrl = ""
  await assert.rejects(
    callGemini( {
      apiKey: "test-key",
      model: "gemini-flash-lite-latest",
      prompt: "Hello",
      fetchImpl: async (url) => {
        requestedUrl = url
        return {
          ok: false,
          status: 418,
          text: async () => "test provider failure",
        }
      },
    } ),
    /Gemini request failed/u,
  )
  assert.match( requestedUrl, /models\/gemini-flash-lite-latest:generateContent/u )
  assert.doesNotMatch( requestedUrl, /gemini-2\.5-flash-lite/u )
} )

test( "callGemini ignores provider thought parts", async () => {
  const text = await callGemini( {
    apiKey: "test-key",
    model: "gemma-4-26b-a4b-it",
    prompt: "Hello",
    fetchImpl: async () => ( {
      ok: true,
      json: async () => ( {
        candidates: [
          {
            content: {
              parts: [
                { text: "internal reasoning", thought: true },
                { text: "Visible answer." },
              ],
            },
          },
        ],
      } ),
    } ),
  } )

  assert.equal( text, "Visible answer." )
} )

test( "groups pending tasks without letting historical expired tasks dominate", () => {
  const now = new Date( "2026-08-12T00:00:00.000Z" )
  const activeTask = {
    id: "active-1",
    type: "authoring",
    lifecycleState: "active",
    createdAt: "2026-08-11T00:00:00.000Z",
  }
  const recentExpiredTask = {
    id: "expired-recent",
    type: "reply",
    lifecycleState: "expired",
    reviewEndAt: "2026-08-10T00:00:00.000Z",
  }
  const oldExpiredTasks = Array.from( { length: 20 }, (_, index) => ( {
    id: `expired-old-${index}`,
    type: index % 2 === 0 ? "reviewer" : "reply",
    lifecycleState: "expired",
    reviewEndAt: "2026-06-01T00:00:00.000Z",
  } ) )

  const grouped = groupPendingTasksForAi( [ activeTask, recentExpiredTask, ...oldExpiredTasks ], now )

  assert.equal( grouped.counts.total, 22 )
  assert.equal( grouped.counts.active, 1 )
  assert.equal( grouped.counts.recentExpired, 1 )
  assert.equal( grouped.counts.historicalExpired, 20 )
  assert.deepEqual( grouped.activeTasks.map( (task) => task.type ), [ "authoring" ] )
  assert.deepEqual( grouped.recentExpiredTasks.map( (task) => task.type ), [ "reply" ] )
  assert.equal( grouped.historicalExpiredSummary.countsByType.reviewer, 10 )
  assert.equal( grouped.historicalExpiredSummary.countsByType.reply, 10 )
} )
