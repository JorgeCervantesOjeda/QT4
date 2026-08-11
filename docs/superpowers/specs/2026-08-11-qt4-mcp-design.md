# QT4 Remote MCP MVP Design

## Goal

Build a remote MCP entry point for end users so compatible chatbots can read QT4 context and perform low-risk review collaboration actions through QT4 permissions.

## Scope

The MVP exposes user-scoped tools only:

- read dashboard tasks;
- list projects visible to the authenticated user;
- list documents in a visible project;
- read a document context with versions, threads, and comments;
- create review threads;
- add review comments;
- prepare a sensitive action for confirmation in QT4.

Sensitive actions are not executed by the MCP server in this MVP. They are stored as pending confirmations for the signed-in user to review inside QT4.

## Architecture

The MCP endpoint is implemented in Firebase Functions to fit the current backend. It uses Firebase Admin SDK to verify Firebase ID tokens, then calls QT4 domain-oriented helpers rather than exposing arbitrary Firestore operations.

```text
MCP-compatible chatbot
  -> Firebase Function /mcp
  -> QT4 MCP domain helpers
  -> Firebase Auth, Firestore, audit logs
  -> QT4 frontend pending confirmation panel
```

## Authentication

The MVP accepts `Authorization: Bearer <Firebase ID token>`. This is enough to test with QT4 users and local clients. OAuth discovery metadata can be added later for broad hosted-client compatibility.

Unauthenticated requests return `401` and do not leak project data.

## MCP Surface

Resources:

- `qt4://guide`;
- `qt4://workflow`;
- `qt4://permissions`.

Tools:

- `get_my_dashboard`;
- `list_my_projects`;
- `list_project_documents`;
- `get_document_context`;
- `list_review_threads`;
- `create_review_thread`;
- `add_review_comment`;
- `prepare_sensitive_action`;
- `get_pending_confirmations`.

## Permission Model

Every tool derives the actor from the verified token. Reads are filtered by `projectMembers`, authorship, reviewer assignment, or admin status where the existing rules imply access. Writes require project/review contribution access.

The MCP server never accepts `actorId` as a trusted input.

## Pending Confirmations

Prepared sensitive actions are stored in `mcpPendingActions/{actionId}` with:

- `userId`;
- `kind`;
- `status`;
- `summary`;
- sanitized `params`;
- `createdAt`;
- `updatedAt`;
- `source`.

QT4 shows pending actions for the current user. The MVP supports acknowledging or dismissing them in the UI; execution is reserved for a later iteration.

## Observability

Every MCP tool call writes an `auditLogs` entry with:

- actor;
- action name;
- entity type and id when available;
- result status;
- non-secret summary.

Fallbacks and unexpected errors are logged with Firebase Functions logger. No fallback is silent.

## Testing

Verification for this MVP:

- backend unit-style smoke calls against the local function handler where practical;
- TypeScript build for frontend changes;
- full app build;
- focused tests for pending confirmation UI helpers if added.

## Limits

This MVP does not implement full OAuth 2.1 dynamic client registration. It uses Firebase ID tokens as the initial user authentication mechanism. That limits compatibility with some hosted chatbots until OAuth discovery and authorization endpoints are added.
