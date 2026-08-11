// functions/mcpDomain.js: Implements QT4 user-scoped MCP domain tools on top of Firestore.
const SENSITIVE_PARAM_KEYS = new Set( [
  "authorization",
  "idToken",
  "password",
  "refreshToken",
  "secret",
  "token",
] )

const normalizeRequiredString = (value, label, maxLength = 500) => {
  const normalized = String( value || "" ).trim()
  if( !normalized ) {
    throw new Error( `${label} is required.` )
  }
  return normalized.slice( 0, maxLength )
}

const sanitizeParams = (value, depth = 0) => {
  if( depth > 3 ) {
    return "[Max depth reached]"
  }
  if( Array.isArray( value ) ) {
    return value.slice( 0, 20 ).map( ( item ) => sanitizeParams( item, depth + 1 ) )
  }
  if( value && typeof value === "object" ) {
    return Object.fromEntries(
      Object.entries( value )
        .filter( ( [ key ] ) => !SENSITIVE_PARAM_KEYS.has( key ) )
        .map( ( [ key, entryValue ] ) => [ key, sanitizeParams( entryValue, depth + 1 ) ] ),
    )
  }
  if( typeof value === "string" ) {
    return value.slice( 0, 500 )
  }
  if( typeof value === "number" || typeof value === "boolean" || value === null ) {
    return value
  }
  return String( value || "" ).slice( 0, 200 )
}

const buildPendingActionRecord = (auth, args, source) => ( {
  userId: auth.uid,
  actorEmail: auth.email || null,
  kind: normalizeRequiredString( args.kind, "kind", 80 ),
  summary: normalizeRequiredString( args.summary, "summary", 500 ),
  params: sanitizeParams( args.params || {} ),
  status: "pending",
  source,
} )

const toDate = (value) => {
  if( !value ) {
    return null
  }
  if( value instanceof Date ) {
    return value
  }
  if( typeof value.toDate === "function" ) {
    return value.toDate()
  }
  return null
}

const serializeTimestamp = (value) => {
  const date = toDate( value )
  return date ? date.toISOString() : null
}

const readVersionStats = (data) => ( {
  numThreads: Number( data?.stats?.numThreads ?? data?.numThreads ?? 0 ),
  numOpenThreads: Number( data?.stats?.numOpenThreads ?? data?.numOpenThreads ?? 0 ),
  numComments: Number( data?.stats?.numComments ?? data?.numComments ?? 0 ),
  numThreadsWithTwoPlusComments: Number(
    data?.stats?.numThreadsWithTwoPlusComments ?? data?.numThreadsWithTwoPlusComments ?? 0,
  ),
} )

const toProjectSummary = (snapshot, role) => {
  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    shortId: data.shortId ?? null,
    name: data.name || "Untitled project",
    role,
    isActive: data.isActive ?? true,
    createdAt: serializeTimestamp( data.createdAt ),
    updatedAt: serializeTimestamp( data.updatedAt ),
  }
}

const toDocumentSummary = (snapshot) => {
  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    projectId: data.projectId || "",
    shortId: data.shortId ?? null,
    title: data.title || "Untitled document",
    type: data.type || "document",
    createdBy: data.createdBy || "",
    authorId: data.authorId || data.createdBy || "",
    createdAt: serializeTimestamp( data.createdAt ),
    updatedAt: serializeTimestamp( data.updatedAt ),
  }
}

const toVersionSummary = (snapshot) => {
  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    projectId: data.projectId || "",
    docId: data.docId || "",
    number: Number( data.number ?? 0 ),
    status: data.status || "",
    createdBy: data.createdBy || "",
    reviewerIds: Array.isArray( data.reviewerIds ) ? data.reviewerIds : [],
    hasFile: Boolean( data.hasFile ),
    fileRefId: data.fileRefId || null,
    stats: readVersionStats( data ),
    reviewStartAt: serializeTimestamp( data.reviewStartAt ),
    reviewEndAt: serializeTimestamp( data.reviewEndAt ),
    createdAt: serializeTimestamp( data.createdAt ),
    updatedAt: serializeTimestamp( data.updatedAt ),
  }
}

const toThreadSummary = (snapshot) => {
  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    projectId: data.projectId || "",
    docId: data.docId || "",
    versionId: data.versionId || "",
    title: data.title || "Untitled issue",
    status: data.status || "open",
    commentCount: Number( data.commentCount ?? 0 ),
    createdBy: data.createdBy || "",
    lastCommentBy: data.lastCommentBy || null,
    lastCommentAt: serializeTimestamp( data.lastCommentAt ),
    createdAt: serializeTimestamp( data.createdAt ),
    updatedAt: serializeTimestamp( data.updatedAt ),
  }
}

const toCommentSummary = (snapshot) => {
  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    projectId: data.projectId || "",
    docId: data.docId || "",
    versionId: data.versionId || "",
    threadId: data.threadId || "",
    body: data.body || "",
    createdBy: data.createdBy || "",
    createdAt: serializeTimestamp( data.createdAt ),
    updatedAt: serializeTimestamp( data.updatedAt ),
  }
}

const createMcpToolHandlers = ({ admin, logger }) => {
  const firestore = admin.firestore()
  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp
  const increment = admin.firestore.FieldValue.increment

  const logAudit = async (auth, entry) => {
    try {
      await firestore.collection( "auditLogs" ).add( {
        actorId: auth.uid,
        actorEmail: auth.email || null,
        ...entry,
        createdAt: serverTimestamp(),
      } )
    } catch( err ) {
      logger.warn( "MCP audit log failed", {
        action: entry.action,
        actorId: auth.uid,
        reason: err instanceof Error ? err.message : String( err ),
      } )
    }
  }

  const loadAccessContext = async (auth) => {
    const [ profileSnapshot, membershipSnapshot ] = await Promise.all( [
      firestore.collection( "userProfiles" ).doc( auth.uid ).get(),
      firestore.collection( "projectMembers" ).where( "userId", "==", auth.uid ).get(),
    ] )
    const roleByProjectId = {}
    membershipSnapshot.docs.forEach( ( snapshot ) => {
      const data = snapshot.data() || {}
      if( data.projectId ) {
        roleByProjectId[data.projectId] = data.role || "member"
      }
    } )
    return {
      isAdmin: Boolean( profileSnapshot.data()?.isAdmin ),
      roleByProjectId,
    }
  }

  const hasProjectAccess = (access, projectId) =>
    Boolean( access.isAdmin || access.roleByProjectId[projectId] )

  const loadVersionForContribution = async (auth, versionId) => {
    const versionSnapshot = await firestore.collection( "versions" ).doc( versionId ).get()
    if( !versionSnapshot.exists ) {
      throw new Error( "Version not found." )
    }
    const version = toVersionSummary( versionSnapshot )
    const access = await loadAccessContext( auth )
    const canContribute = access.isAdmin
      || access.roleByProjectId[version.projectId] === "leader"
      || version.createdBy === auth.uid
      || version.reviewerIds.includes( auth.uid )
    if( !canContribute ) {
      throw new Error( "User cannot contribute to this review." )
    }
    return { access, version, versionSnapshot }
  }

  const listThreadsWithComments = async (versionId) => {
    const [ threadSnapshot, commentSnapshot ] = await Promise.all( [
      firestore.collection( "threads" ).where( "versionId", "==", versionId ).get(),
      firestore.collection( "comments" ).where( "versionId", "==", versionId ).get(),
    ] )
    return {
      threads: threadSnapshot.docs.map( toThreadSummary ),
      comments: commentSnapshot.docs.map( toCommentSummary ),
    }
  }

  return {
    get_my_dashboard: async (args, auth) => {
      const dashboardSnapshot = await firestore.collection( "dashboard" ).doc( auth.uid ).get()
      const taskSnapshot = await firestore.collection( "dashboard" ).doc( auth.uid ).collection( "tasks" ).get()
      await logAudit( auth, { action: "mcp.get_my_dashboard", entityType: "dashboard", entityId: auth.uid } )
      return {
        dashboard: dashboardSnapshot.exists ? dashboardSnapshot.data() : null,
        tasks: taskSnapshot.docs.map( ( snapshot ) => ( { id: snapshot.id, ...snapshot.data() } ) ),
      }
    },

    list_my_projects: async (args, auth) => {
      const access = await loadAccessContext( auth )
      const projectIds = Object.keys( access.roleByProjectId )
      const projectSnapshots = await Promise.all(
        projectIds.map( ( projectId ) => firestore.collection( "projects" ).doc( projectId ).get() ),
      )
      await logAudit( auth, { action: "mcp.list_my_projects", entityType: "project", entityId: "mine" } )
      return {
        projects: projectSnapshots
          .filter( ( snapshot ) => snapshot.exists )
          .map( ( snapshot ) => toProjectSummary( snapshot, access.roleByProjectId[snapshot.id] ) ),
      }
    },

    list_project_documents: async (args, auth) => {
      const projectId = normalizeRequiredString( args.projectId, "projectId", 160 )
      const access = await loadAccessContext( auth )
      if( !hasProjectAccess( access, projectId ) ) {
        throw new Error( "User cannot read this project." )
      }
      const snapshot = await firestore.collection( "documents" ).where( "projectId", "==", projectId ).get()
      await logAudit( auth, { action: "mcp.list_project_documents", entityType: "project", entityId: projectId, projectId } )
      return { documents: snapshot.docs.map( toDocumentSummary ) }
    },

    get_document_context: async (args, auth) => {
      const documentId = normalizeRequiredString( args.documentId, "documentId", 160 )
      const documentSnapshot = await firestore.collection( "documents" ).doc( documentId ).get()
      if( !documentSnapshot.exists ) {
        throw new Error( "Document not found." )
      }
      const documentData = toDocumentSummary( documentSnapshot )
      const access = await loadAccessContext( auth )
      if( !hasProjectAccess( access, documentData.projectId ) && documentData.createdBy !== auth.uid ) {
        throw new Error( "User cannot read this document." )
      }
      const versionSnapshot = await firestore.collection( "versions" ).where( "docId", "==", documentId ).get()
      const versions = versionSnapshot.docs.map( toVersionSummary ).sort( ( left, right ) => right.number - left.number )
      const versionContexts = await Promise.all(
        versions.map( async ( version ) => ( {
          version,
          ...( await listThreadsWithComments( version.id ) ),
        } ) ),
      )
      await logAudit( auth, { action: "mcp.get_document_context", entityType: "document", entityId: documentId, projectId: documentData.projectId, docId: documentId } )
      return { document: documentData, versions: versionContexts }
    },

    list_review_threads: async (args, auth) => {
      const versionId = normalizeRequiredString( args.versionId, "versionId", 160 )
      const { version } = await loadVersionForContribution( auth, versionId )
      await logAudit( auth, { action: "mcp.list_review_threads", entityType: "version", entityId: versionId, projectId: version.projectId, docId: version.docId, versionId } )
      return await listThreadsWithComments( versionId )
    },

    create_review_thread: async (args, auth) => {
      const versionId = normalizeRequiredString( args.versionId, "versionId", 160 )
      const title = normalizeRequiredString( args.title, "title", 200 )
      const { version, versionSnapshot } = await loadVersionForContribution( auth, versionId )
      const threadRef = firestore.collection( "threads" ).doc()
      await firestore.runTransaction( async (transaction) => {
        const freshVersion = await transaction.get( versionSnapshot.ref )
        const stats = readVersionStats( freshVersion.data() || {} )
        transaction.set( threadRef, {
          projectId: version.projectId,
          docId: version.docId,
          versionId,
          status: "open",
          title,
          createdBy: auth.uid,
          commentCount: 0,
          lastCommentAt: null,
          lastCommentBy: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: auth.uid,
        } )
        transaction.update( versionSnapshot.ref, {
          stats: {
            ...stats,
            numThreads: stats.numThreads + 1,
            numOpenThreads: stats.numOpenThreads + 1,
          },
          numThreads: stats.numThreads + 1,
          numOpenThreads: stats.numOpenThreads + 1,
          numComments: stats.numComments,
          numThreadsWithTwoPlusComments: stats.numThreadsWithTwoPlusComments,
          activityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: auth.uid,
        } )
      } )
      await logAudit( auth, { action: "mcp.create_review_thread", entityType: "thread", entityId: threadRef.id, projectId: version.projectId, docId: version.docId, versionId, threadId: threadRef.id } )
      return { threadId: threadRef.id, status: "open" }
    },

    add_review_comment: async (args, auth) => {
      const threadId = normalizeRequiredString( args.threadId, "threadId", 160 )
      const body = normalizeRequiredString( args.body, "body", 4000 )
      const threadSnapshot = await firestore.collection( "threads" ).doc( threadId ).get()
      if( !threadSnapshot.exists ) {
        throw new Error( "Thread not found." )
      }
      const thread = toThreadSummary( threadSnapshot )
      if( thread.status !== "open" ) {
        throw new Error( "Thread is closed." )
      }
      const { version, versionSnapshot } = await loadVersionForContribution( auth, thread.versionId )
      const commentRef = firestore.collection( "comments" ).doc()
      await firestore.runTransaction( async (transaction) => {
        const [ freshVersion, freshThread ] = await Promise.all( [
          transaction.get( versionSnapshot.ref ),
          transaction.get( threadSnapshot.ref ),
        ] )
        const stats = readVersionStats( freshVersion.data() || {} )
        const currentCommentCount = Number( freshThread.data()?.commentCount ?? 0 )
        const nextCommentCount = currentCommentCount + 1
        const incrementTwoPlus = currentCommentCount < 2 && nextCommentCount >= 2 ? 1 : 0
        transaction.set( commentRef, {
          projectId: version.projectId,
          docId: version.docId,
          versionId: version.id,
          threadId,
          body,
          createdBy: auth.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } )
        transaction.update( threadSnapshot.ref, {
          commentCount: nextCommentCount,
          lastCommentAt: serverTimestamp(),
          lastCommentBy: auth.uid,
          updatedAt: serverTimestamp(),
          updatedBy: auth.uid,
        } )
        transaction.update( versionSnapshot.ref, {
          stats: {
            ...stats,
            numComments: stats.numComments + 1,
            numThreadsWithTwoPlusComments: stats.numThreadsWithTwoPlusComments + incrementTwoPlus,
          },
          numThreads: stats.numThreads,
          numOpenThreads: stats.numOpenThreads,
          numComments: stats.numComments + 1,
          numThreadsWithTwoPlusComments: stats.numThreadsWithTwoPlusComments + incrementTwoPlus,
          activityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: auth.uid,
        } )
      } )
      await logAudit( auth, { action: "mcp.add_review_comment", entityType: "comment", entityId: commentRef.id, projectId: version.projectId, docId: version.docId, versionId: version.id, threadId, commentId: commentRef.id } )
      return { commentId: commentRef.id, threadId }
    },

    prepare_sensitive_action: async (args, auth) => {
      const record = buildPendingActionRecord( auth, args, "mcp" )
      const ref = await firestore.collection( "mcpPendingActions" ).add( {
        ...record,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } )
      await logAudit( auth, { action: "mcp.prepare_sensitive_action", entityType: "mcpPendingAction", entityId: ref.id, metadata: { kind: record.kind } } )
      return { actionId: ref.id, status: "pending", summary: record.summary }
    },

    get_pending_confirmations: async (args, auth) => {
      const snapshot = await firestore
        .collection( "mcpPendingActions" )
        .where( "userId", "==", auth.uid )
        .where( "status", "==", "pending" )
        .get()
      await logAudit( auth, { action: "mcp.get_pending_confirmations", entityType: "mcpPendingAction", entityId: "mine" } )
      return {
        pendingActions: snapshot.docs.map( ( doc ) => ( {
          id: doc.id,
          ...doc.data(),
          createdAt: serializeTimestamp( doc.data().createdAt ),
          updatedAt: serializeTimestamp( doc.data().updatedAt ),
        } ) ),
      }
    },
  }
}

module.exports = {
  buildPendingActionRecord,
  createMcpToolHandlers,
  normalizeRequiredString,
  sanitizeParams,
}
