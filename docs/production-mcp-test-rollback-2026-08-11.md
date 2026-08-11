# QT4 MCP Production Test Rollback Notes

## Production Test Deploy

Date: 2026-08-11

Project: `qualiteam-app`

Site: `qualiteam-plus`

Deployed command:

```powershell
npx firebase-tools deploy --only functions,hosting:prod,firestore:rules --project qualiteam-app
```

Deployed endpoints:

- Hosting app: `https://qualiteam-plus.web.app`
- MCP endpoint through Hosting: `https://qualiteam-plus.web.app/mcp`
- Direct MCP Function: `https://us-central1-qualiteam-app.cloudfunctions.net/mcp`

## Verified After Deploy

- `GET https://qualiteam-plus.web.app/mcp` returned `200`.
- `POST https://qualiteam-plus.web.app/mcp` with `tools/list` returned `200`.
- `POST https://us-central1-qualiteam-app.cloudfunctions.net/mcp` with `resources/read` for `qt4://guide` returned `200`.
- `POST https://qualiteam-plus.web.app/mcp` with `tools/call` and no token returned `401`.
- `npx firebase-tools functions:list --project qualiteam-app` lists `mcp`, `notifyEmail`, and `reportClientMonitorEvent`.

## Rollback Point

Rollback source path:

```txt
C:\Users\usuario\ownCloud2\QT4_rollback_prod_v4_4_1
```

Rollback commit:

```txt
89d0ed8bc1a4e03afc92aefb9bad2289b200059b
```

Rollback tag:

```txt
prod/v4.4.1
```

The rollback worktree is clean and has a successful `npm run build:prod` output.

## Rollback Commands

From the rollback worktree:

```powershell
cd C:\Users\usuario\ownCloud2\QT4_rollback_prod_v4_4_1
npm run build:prod
npx firebase-tools deploy --only functions,hosting:prod,firestore:rules --project qualiteam-app
```

After rollback, remove the new MCP function if it remains deployed:

```powershell
npx firebase-tools functions:delete mcp --region us-central1 --project qualiteam-app
```

Then verify:

```powershell
npx firebase-tools functions:list --project qualiteam-app
```

Expected after rollback:

- `notifyEmail`
- `reportClientMonitorEvent`
- no `mcp`

## Data Left By Tests

Code rollback does not automatically remove Firestore documents created during testing. Review or remove test-only documents from:

- `auditLogs`
- `mcpPendingActions`
- `threads`, only if `create_review_thread` was tested;
- `comments`, only if `add_review_comment` was tested.

For safest testing, use only:

- `resources/list`;
- `resources/read`;
- `tools/list`;
- read tools;
- `prepare_sensitive_action`.
