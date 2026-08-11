// functions/mcpCore.test.js: Verifies QT4 MCP protocol helpers and public agent resources.
const test = require( "node:test" )
const assert = require( "node:assert/strict" )

const {
  handleMcpMessage,
} = require( "./mcpCore" )

test( "lists QT4 MCP resources for agent instructions", async () => {
  const response = await handleMcpMessage( {
    jsonrpc: "2.0",
    id: 1,
    method: "resources/list",
  }, { auth: null, handlers: {} } )

  const uris = response.result.resources.map( ( resource ) => resource.uri )
  assert.deepEqual( uris, [
    "qt4://guide",
    "qt4://workflow",
    "qt4://permissions",
  ] )
} )

test( "reads the guide resource with sensitive action instructions", async () => {
  const response = await handleMcpMessage( {
    jsonrpc: "2.0",
    id: 2,
    method: "resources/read",
    params: { uri: "qt4://guide" },
  }, { auth: null, handlers: {} } )

  assert.equal( response.result.contents[0].uri, "qt4://guide" )
  assert.match( response.result.contents[0].text, /prepare_sensitive_action/ )
} )

test( "lists the initial QT4 user tools", async () => {
  const response = await handleMcpMessage( {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/list",
  }, { auth: null, handlers: {} } )

  const toolNames = response.result.tools.map( ( tool ) => tool.name )
  assert.deepEqual( toolNames, [
    "get_my_dashboard",
    "list_my_projects",
    "list_project_documents",
    "get_document_context",
    "list_review_threads",
    "create_review_thread",
    "add_review_comment",
    "prepare_sensitive_action",
    "get_pending_confirmations",
  ] )
} )

test( "rejects tool calls without authenticated user context", async () => {
  const response = await handleMcpMessage( {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "get_my_dashboard",
      arguments: {},
    },
  }, { auth: null, handlers: {} } )

  assert.equal( response.error.code, -32001 )
  assert.match( response.error.message, /Authentication required/ )
} )
