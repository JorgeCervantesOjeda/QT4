// functions/aiAssist.js: Handles scoped Gemini-based assistance for QT4 review and dashboard tasks.
const MAX_TEXT_LENGTH = 4000
const MAX_THREAD_COMMENTS = 40
const MAX_DASHBOARD_TASKS = 80

const MODE_SKILLS = {
  explain_comment: [ "qt4-glossary", "explain-comment", "review-context-safety" ],
  explain_thread: [ "qt4-glossary", "explain-thread", "review-context-safety" ],
  improve_text: [ "improve-writing", "preserve-intent", "no-new-claims" ],
  summarize_pending: [ "qt4-glossary", "urgency-ranking", "dashboard-prioritization" ],
}

const MODE_LABELS = {
  explain_comment: "explicar comentario",
  explain_thread: "explicar hilo",
  improve_text: "mejorar redacción",
  summarize_pending: "pendientes y urgencia",
}

class AiAssistError extends Error {
  constructor( code, message, statusCode, logLevel = "warn" ) {
    super( message )
    this.name = "AiAssistError"
    this.code = code
    this.statusCode = statusCode
    this.logLevel = logLevel
  }
}

const createAiAssistError = (code, message, statusCode, logLevel = "warn" ) =>
  new AiAssistError( code, message, statusCode, logLevel )

const truncateLogMessage = (value, maxLength = 600) =>
  String( value || "" ).replace( /\s+/g, " " ).trim().slice( 0, maxLength )

const resolveEntityId = (request = {}) =>
  request.commentId || request.threadId || request.mode || "unknown"

const logAiAssistFailure = (logger, err, request, uid) => {
  const code = err instanceof AiAssistError ? err.code : "unexpected"
  const level = err instanceof AiAssistError ? err.logLevel : "error"
  const message = err instanceof Error ? err.message : "Unexpected AI assist error"
  const payload = {
    code,
    mode: request?.mode || "unknown",
    entityId: resolveEntityId( request ),
    uid: uid || "unknown",
    message: truncateLogMessage( message ),
  }
  if( level === "info" && typeof logger.info === "function" ) {
    logger.info( "aiAssist failed", payload )
    return
  }
  if( level === "warn" && typeof logger.warn === "function" ) {
    logger.warn( "aiAssist failed", payload )
    return
  }
  logger.error( "aiAssist failed", payload )
}

const truncateText = (value, maxLength = MAX_TEXT_LENGTH) => {
  const text = typeof value === "string" ? value.trim() : ""
  if( text.length <= maxLength ) {
    return text
  }
  return `${text.slice( 0, maxLength )}\n[Texto recortado por límite de contexto.]`
}

const normalizeLanguage = (value) => {
  if( value === "en" ) {
    return "en"
  }
  if( value === "auto" ) {
    return "auto"
  }
  return "es"
}

const normalizeRequiredString = (value, fieldName, maxLength = 160) => {
  if( typeof value !== "string" ) {
    throw createAiAssistError( "invalid_request", `${fieldName} is required.`, 400 )
  }
  const normalized = value.trim()
  if( !normalized ) {
    throw createAiAssistError( "invalid_request", `${fieldName} is required.`, 400 )
  }
  if( normalized.length > maxLength ) {
    throw createAiAssistError( "invalid_request", `${fieldName} is too long.`, 400 )
  }
  return normalized
}

const normalizeAiAssistRequest = (body) => {
  const mode = normalizeRequiredString( body?.mode, "mode", 80 )
  if( !Object.prototype.hasOwnProperty.call( MODE_SKILLS, mode ) ) {
    throw createAiAssistError( "invalid_request", "Unsupported AI assist mode.", 400 )
  }
  const request = {
    mode,
    language: normalizeLanguage( body.language ),
  }
  if( mode === "explain_comment" ) {
    request.commentId = normalizeRequiredString( body.commentId, "commentId" )
  }
  if( mode === "explain_thread" ) {
    request.threadId = normalizeRequiredString( body.threadId, "threadId" )
  }
  if( mode === "improve_text" ) {
    request.text = normalizeRequiredString( body.text, "text", MAX_TEXT_LENGTH )
  }
  return request
}

const selectSkillNames = (mode) => [ ...MODE_SKILLS[mode] ]

const toDateIso = (value) => {
  if( !value ) {
    return null
  }
  if( value instanceof Date ) {
    return value.toISOString()
  }
  if( value && typeof value.toDate === "function" ) {
    return value.toDate().toISOString()
  }
  return null
}

const readDocData = (snapshot) => {
  if( !snapshot || !snapshot.exists ) {
    return null
  }
  return { id: snapshot.id, ...snapshot.data() }
}

const hasProjectAccess = async (firestore, uid, projectId) => {
  if( !projectId ) {
    return false
  }
  const snapshot = await firestore.collection( "projectMembers" ).doc( `${projectId}_${uid}` ).get()
  if( !snapshot.exists ) {
    return false
  }
  const role = snapshot.data().role
  return role === "leader" || role === "member"
}

const summarizeComment = (comment) => ( {
  id: comment.id,
  body: truncateText( comment.body, 1800 ),
  createdBy: comment.createdBy || "",
  createdAt: toDateIso( comment.createdAt ),
} )

const summarizeThread = (thread) => ( {
  id: thread.id,
  title: thread.title || "",
  status: thread.status || "",
  createdBy: thread.createdBy || "",
  commentCount: Number( thread.commentCount ?? 0 ),
  lastCommentAt: toDateIso( thread.lastCommentAt ),
} )

const summarizeDocument = (document) => ( {
  id: document.id,
  title: document.title || "",
  shortId: document.shortId ?? null,
  type: document.type || "",
  projectId: document.projectId || "",
} )

const summarizeVersion = (version) => ( {
  id: version.id,
  number: Number( version.number ?? 0 ),
  status: version.status || "",
  reviewStartAt: toDateIso( version.reviewStartAt ),
  reviewEndAt: toDateIso( version.reviewEndAt ),
} )

const loadProjectBundle = async (firestore, uid, projectId, refs) => {
  if( !( await hasProjectAccess( firestore, uid, projectId ) ) ) {
    throw createAiAssistError( "permission_denied", "User cannot read this project context.", 403 )
  }
  const [ projectSnapshot, documentSnapshot, versionSnapshot ] = await Promise.all( [
    firestore.collection( "projects" ).doc( projectId ).get(),
    refs.docId ? firestore.collection( "documents" ).doc( refs.docId ).get() : Promise.resolve( null ),
    refs.versionId ? firestore.collection( "versions" ).doc( refs.versionId ).get() : Promise.resolve( null ),
  ] )
  const document = readDocData( documentSnapshot )
  const version = readDocData( versionSnapshot )
  if( document && document.projectId !== projectId ) {
    throw createAiAssistError( "context_mismatch", "Document does not belong to this project context.", 400 )
  }
  if( version && version.projectId !== projectId ) {
    throw createAiAssistError( "context_mismatch", "Version does not belong to this project context.", 400 )
  }
  return {
    project: readDocData( projectSnapshot ),
    document,
    version,
  }
}

const loadCommentContext = async (firestore, auth, commentId) => {
  const comment = readDocData( await firestore.collection( "comments" ).doc( commentId ).get() )
  if( !comment ) {
    throw createAiAssistError( "context_not_found", "Comment not found.", 404 )
  }
  const thread = readDocData( await firestore.collection( "threads" ).doc( comment.threadId || "" ).get() )
  if( !thread ) {
    throw createAiAssistError( "context_not_found", "Thread not found.", 404 )
  }
  const bundle = await loadProjectBundle( firestore, auth.uid, comment.projectId, {
    docId: comment.docId,
    versionId: comment.versionId,
  } )
  return {
    comment: summarizeComment( comment ),
    thread: summarizeThread( thread ),
    document: bundle.document ? summarizeDocument( bundle.document ) : null,
    version: bundle.version ? summarizeVersion( bundle.version ) : null,
    project: bundle.project ? { id: bundle.project.id, name: bundle.project.name || "" } : null,
  }
}

const loadThreadContext = async (firestore, auth, threadId) => {
  const thread = readDocData( await firestore.collection( "threads" ).doc( threadId ).get() )
  if( !thread ) {
    throw createAiAssistError( "context_not_found", "Thread not found.", 404 )
  }
  const bundle = await loadProjectBundle( firestore, auth.uid, thread.projectId, {
    docId: thread.docId,
    versionId: thread.versionId,
  } )
  const commentsSnapshot = await firestore
    .collection( "comments" )
    .where( "threadId", "==", threadId )
    .orderBy( "createdAt", "asc" )
    .limit( MAX_THREAD_COMMENTS )
    .get()
  return {
    thread: summarizeThread( thread ),
    comments: commentsSnapshot.docs.map( (snapshot) => summarizeComment( { id: snapshot.id, ...snapshot.data() } ) ),
    document: bundle.document ? summarizeDocument( bundle.document ) : null,
    version: bundle.version ? summarizeVersion( bundle.version ) : null,
    project: bundle.project ? { id: bundle.project.id, name: bundle.project.name || "" } : null,
  }
}

const summarizeTask = (task) => ( {
  id: task.id,
  type: task.type || "",
  title: task.title || "",
  detail: task.detail || "",
  lifecycleState: task.lifecycleState || "active",
  visualState: task.visualState || "",
  projectId: task.projectId || "",
  reviewEndAt: toDateIso( task.reviewEndAt ),
  reviewPeriodState: task.reviewPeriodState || "",
  createdAt: toDateIso( task.createdAt ),
} )

const loadPendingContext = async (firestore, auth) => {
  const [ dashboardSnapshot, tasksSnapshot ] = await Promise.all( [
    firestore.collection( "dashboard" ).doc( auth.uid ).get(),
    firestore.collection( "dashboard" ).doc( auth.uid ).collection( "tasks" ).get(),
  ] )
  const tasks = tasksSnapshot.docs.map( (snapshot) => summarizeTask( { id: snapshot.id, ...snapshot.data() } ) )
  const activeTasks = tasks.filter( (task) => task.lifecycleState !== "expired" )
  const expiredTasks = tasks.filter( (task) => task.lifecycleState === "expired" )
  const countsByType = tasks.reduce( (counts, task) => {
    counts[task.type] = ( counts[task.type] || 0 ) + 1
    return counts
  }, {} )
  return {
    dashboard: dashboardSnapshot.exists ? {
      taskCount: Number( dashboardSnapshot.data().taskCount ?? tasks.length ),
      expiredTaskCount: Number( dashboardSnapshot.data().expiredTaskCount ?? expiredTasks.length ),
      updatedAt: toDateIso( dashboardSnapshot.data().updatedAt ),
    } : null,
    countsByType,
    activeTasks: activeTasks.slice( 0, MAX_DASHBOARD_TASKS ),
    expiredTaskCount: expiredTasks.length,
    truncated: activeTasks.length > MAX_DASHBOARD_TASKS,
  }
}

const loadContext = async (firestore, auth, request) => {
  if( request.mode === "explain_comment" ) {
    return await loadCommentContext( firestore, auth, request.commentId )
  }
  if( request.mode === "explain_thread" ) {
    return await loadThreadContext( firestore, auth, request.threadId )
  }
  if( request.mode === "improve_text" ) {
    return { userText: truncateText( request.text ) }
  }
  return await loadPendingContext( firestore, auth )
}

const skillText = (mode) => {
  if( mode === "explain_comment" ) {
    return "Explica qué dice el comentario, qué pide, si requiere acción y qué ambigüedades hay. No propongas una respuesta."
  }
  if( mode === "explain_thread" ) {
    return "Resume el hilo, enumera asuntos pendientes y explica quién parece esperar qué. No propongas respuestas nuevas."
  }
  if( mode === "improve_text" ) {
    return "Mejora claridad, precisión y tono del texto del usuario. Conserva la intención. No agregues argumentos nuevos."
  }
  return "Clasifica pendientes por urgencia usando fechas, estado, vencimiento y tipo. Explica la razón de cada prioridad."
}

const buildAiPrompt = ({ mode, language, context }) => {
  const responseLanguage = language === "en" ? "English" : "español"
  return [
    "Eres una función de apoyo de QT4, no un asistente autónomo.",
    `Modo: ${MODE_LABELS[mode]}.`,
    `Skills activos: ${selectSkillNames( mode ).join( ", " )}.`,
    `Responde en ${responseLanguage}.`,
    skillText( mode ),
    "No redactes una respuesta nueva desde cero.",
    "No inventes datos, permisos, fechas ni conclusiones.",
    "No pidas ni propongas consultas arbitrarias a Firestore.",
    "Separa hechos observables de inferencias cuando aplique.",
    "No agregues argumentos nuevos al texto del usuario.",
    "Conserva la intención del usuario.",
    "Devuelve una respuesta breve y accionable.",
    "",
    "Contexto permitido:",
    JSON.stringify( context, null, 2 ),
  ].join( "\n" )
}

const callGemini = async ({ apiKey, model, prompt, fetchImpl = fetch }) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent( model )}:generateContent?key=${encodeURIComponent( apiKey )}`
  const response = await fetchImpl( url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify( {
      contents: [
        {
          role: "user",
          parts: [ { text: prompt } ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 700,
      },
    } ),
  } )
  if( !response.ok ) {
    const text = await response.text().catch( () => response.statusText )
    throw createAiAssistError(
      "provider_error",
      `Gemini request failed (${response.status}): ${truncateLogMessage( text )}`,
      502,
      "error",
    )
  }
  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts
    ?.map( (part) => part.text || "" )
    ?.join( "" )
    ?.trim()
  if( !text ) {
    throw createAiAssistError( "provider_empty_response", "Gemini returned an empty response.", 502, "error" )
  }
  return text
}

const createAiAssistHandler = ({ admin, logger, verifyBearerToken, setCorsHeaders, fetchImpl }) => async (req, res) => {
  setCorsHeaders( req, res, [ "AI_ASSIST_ALLOWED_ORIGINS", "NOTIFY_ALLOWED_ORIGINS" ] )
  if( req.method === "OPTIONS" ) {
    res.status( 204 ).send( "" )
    return
  }
  if( req.method !== "POST" ) {
    res.status( 405 ).json( { error: "Method not allowed" } )
    return
  }
  let request = null
  let uid = ""
  try {
    request = normalizeAiAssistRequest( req.body && typeof req.body === "object" ? req.body : {} )
    const decoded = await verifyBearerToken( req )
    if( !decoded?.uid ) {
      throw createAiAssistError( "auth_missing", "User session is required.", 401 )
    }
    uid = decoded.uid
    const context = await loadContext( admin.firestore(), { uid: decoded.uid }, request )
    const apiKey = ( process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "" ).trim()
    if( !apiKey ) {
      throw createAiAssistError( "provider_not_configured", "AI provider is not configured.", 503, "error" )
    }
    const model = ( process.env.GEMINI_MODEL || "gemini-2.5-flash-lite" ).trim()
    const prompt = buildAiPrompt( { mode: request.mode, language: request.language, context } )
    const result = await callGemini( { apiKey, model, prompt, fetchImpl } )
    try {
      await admin.firestore().collection( "auditLogs" ).add( {
        actorId: decoded.uid,
        action: `aiAssist.${request.mode}`,
        entityType: "aiAssist",
        entityId: request.commentId || request.threadId || decoded.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      } )
    } catch( auditErr ) {
      logger.warn( "aiAssist audit log failed", {
        code: "audit_log_failed",
        mode: request.mode,
        entityId: resolveEntityId( request ),
        uid: decoded.uid,
        message: truncateLogMessage( auditErr instanceof Error ? auditErr.message : "Unexpected audit log error" ),
      } )
    }
    logger.info( "aiAssist completed", {
      mode: request.mode,
      entityId: resolveEntityId( request ),
      uid: decoded.uid,
    } )
    res.status( 200 ).json( { ok: true, mode: request.mode, result } )
  } catch( err ) {
    logAiAssistFailure( logger, err, request, uid )
    if( err instanceof AiAssistError ) {
      const providerError = err.code === "provider_error" || err.code === "provider_empty_response"
      res.status( err.statusCode ).json( {
        error: providerError ? "AI provider request failed." : err.message,
        code: err.code,
      } )
      return
    }
    res.status( 500 ).json( {
      error: "Internal AI assist error.",
      code: "unexpected",
    } )
  }
}

module.exports = {
  buildAiPrompt,
  callGemini,
  createAiAssistHandler,
  createAiAssistError,
  normalizeAiAssistRequest,
  selectSkillNames,
}
