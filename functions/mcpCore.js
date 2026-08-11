// functions/mcpCore.js: Provides protocol-level MCP definitions and JSON-RPC dispatch helpers for QT4.
const SERVER_VERSION = "4.4.1"

const RESOURCE_TEXTS = {
  "qt4://guide": [
    "QT4 MCP guide for end-user chatbots.",
    "",
    "Use tools to read the authenticated user's QT4 projects, dashboard tasks, documents, versions, review threads, and comments.",
    "Use create_review_thread and add_review_comment only for review collaboration.",
    "Use prepare_sensitive_action for actions that need confirmation in the QT4 app, such as accepting or rejecting a version, starting a review, assigning people, or replacing files.",
    "Do not ask for or use raw Firestore paths. Do not invent actor IDs. The MCP server derives the user from authentication.",
  ].join( "\n" ),
  "qt4://workflow": [
    "QT4 workflow summary.",
    "",
    "Versions can be In Creation, In Review, Reviewed, Rejected, Replaced, or Accepted.",
    "Review threads and comments belong to a selected version.",
    "Sensitive state transitions must be prepared through prepare_sensitive_action and confirmed in QT4.",
  ].join( "\n" ),
  "qt4://permissions": [
    "QT4 MCP permission summary.",
    "",
    "All tool calls are scoped to the authenticated QT4 user.",
    "Project reads require project membership, authorship, reviewer assignment, or admin status.",
    "Review comments and threads require review contribution access.",
    "The MCP server never accepts actorId from client input.",
  ].join( "\n" ),
}

const RESOURCE_DEFINITIONS = Object.keys( RESOURCE_TEXTS ).map( ( uri ) => ( {
  uri,
  name: uri.replace( "qt4://", "QT4 " ),
  description: "QT4 MCP operating instructions for compatible chatbots.",
  mimeType: "text/plain",
} ) )

const createObjectSchema = (properties = {}, required = []) => ( {
  type: "object",
  properties,
  required,
  additionalProperties: false,
} )

const TOOL_DEFINITIONS = [
  {
    name: "get_my_dashboard",
    description: "Return the authenticated user's dashboard tasks.",
    inputSchema: createObjectSchema(),
  },
  {
    name: "list_my_projects",
    description: "List projects visible to the authenticated user.",
    inputSchema: createObjectSchema(),
  },
  {
    name: "list_project_documents",
    description: "List documents in a project visible to the authenticated user.",
    inputSchema: createObjectSchema( {
      projectId: { type: "string" },
    }, [ "projectId" ] ),
  },
  {
    name: "get_document_context",
    description: "Read a QT4 document with version, thread, and comment context.",
    inputSchema: createObjectSchema( {
      documentId: { type: "string" },
    }, [ "documentId" ] ),
  },
  {
    name: "list_review_threads",
    description: "List review threads for a QT4 version.",
    inputSchema: createObjectSchema( {
      versionId: { type: "string" },
    }, [ "versionId" ] ),
  },
  {
    name: "create_review_thread",
    description: "Create a review thread for a QT4 version.",
    inputSchema: createObjectSchema( {
      versionId: { type: "string" },
      title: { type: "string" },
    }, [ "versionId", "title" ] ),
  },
  {
    name: "add_review_comment",
    description: "Add a comment to an existing QT4 review thread.",
    inputSchema: createObjectSchema( {
      threadId: { type: "string" },
      body: { type: "string" },
    }, [ "threadId", "body" ] ),
  },
  {
    name: "prepare_sensitive_action",
    description: "Prepare a sensitive QT4 action for confirmation inside the QT4 app.",
    inputSchema: createObjectSchema( {
      kind: {
        type: "string",
        enum: [ "accept_version", "reject_version", "start_review", "assign_reviewers", "replace_file" ],
      },
      summary: { type: "string" },
      params: { type: "object" },
    }, [ "kind", "summary" ] ),
  },
  {
    name: "get_pending_confirmations",
    description: "List sensitive actions waiting for the authenticated user in QT4.",
    inputSchema: createObjectSchema(),
  },
]

const createJsonRpcResult = (id, result) => ( {
  jsonrpc: "2.0",
  id: id ?? null,
  result,
} )

const createJsonRpcError = (id, code, message, data) => ( {
  jsonrpc: "2.0",
  id: id ?? null,
  error: {
    code,
    message,
    ...( data ? { data } : {} ),
  },
} )

const createToolTextResult = (value) => ( {
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify( value, null, 2 ),
    },
  ],
} )

const getParamsObject = (message) => {
  if( !message || typeof message.params !== "object" || message.params === null ) {
    return {}
  }
  return message.params
}

const handleMcpMessage = async (message, context) => {
  const id = message && Object.prototype.hasOwnProperty.call( message, "id" ) ? message.id : null
  if( !message || message.jsonrpc !== "2.0" || typeof message.method !== "string" ) {
    return createJsonRpcError( id, -32600, "Invalid JSON-RPC request." )
  }

  if( message.method === "initialize" ) {
    return createJsonRpcResult( id, {
      protocolVersion: getParamsObject( message ).protocolVersion || "2025-06-18",
      capabilities: {
        resources: {},
        tools: {},
      },
      serverInfo: {
        name: "qt4-mcp",
        version: SERVER_VERSION,
      },
    } )
  }

  if( message.method === "resources/list" ) {
    return createJsonRpcResult( id, { resources: RESOURCE_DEFINITIONS } )
  }

  if( message.method === "resources/read" ) {
    const uri = String( getParamsObject( message ).uri || "" )
    const text = RESOURCE_TEXTS[uri]
    if( !text ) {
      return createJsonRpcError( id, -32602, "Unknown QT4 MCP resource." )
    }
    return createJsonRpcResult( id, {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text,
        },
      ],
    } )
  }

  if( message.method === "tools/list" ) {
    return createJsonRpcResult( id, { tools: TOOL_DEFINITIONS } )
  }

  if( message.method === "tools/call" ) {
    if( !context || !context.auth ) {
      return createJsonRpcError( id, -32001, "Authentication required for QT4 MCP tool calls." )
    }
    const params = getParamsObject( message )
    const toolName = String( params.name || "" )
    const handler = context.handlers ? context.handlers[toolName] : null
    if( typeof handler !== "function" ) {
      return createJsonRpcError( id, -32602, "Unknown QT4 MCP tool." )
    }
    try {
      const result = await handler( params.arguments && typeof params.arguments === "object" ? params.arguments : {} )
      return createJsonRpcResult( id, createToolTextResult( result ) )
    } catch( err ) {
      const messageText = err instanceof Error ? err.message : "Unexpected QT4 MCP tool error."
      return createJsonRpcError( id, -32000, messageText )
    }
  }

  if( message.method.startsWith( "notifications/" ) ) {
    return null
  }

  return createJsonRpcError( id, -32601, "Unsupported MCP method." )
}

module.exports = {
  RESOURCE_TEXTS,
  TOOL_DEFINITIONS,
  createJsonRpcError,
  createJsonRpcResult,
  createToolTextResult,
  handleMcpMessage,
}
