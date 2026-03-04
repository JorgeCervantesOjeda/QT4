# QT4 (React + Vite + Firebase)

QT4 is the migration project for QualiTeam built with React, TypeScript, Vite, Firebase Auth, and Firestore.

## Local development

Run all commands from `QT4/`.

1. Install dependencies.

```bash
npm install
```

2. Create `QT4/.env.local` with Firebase and Files API values.
3. Start the dev server.

```bash
npm run dev
```

For local Files API development, use proxy mode in `.env.local`:

```env
VITE_FILES_API_MODE=proxy
VITE_FILES_API_PROXY_PATH=/files-api
QT4_FILES_API_BASE_URL=http://localhost:42873/api/v1
```

## Build

```bash
npm run build
```

## Environment variables

### Firebase (Vite env)

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
```

### Files API

```env
# Frontend mode: proxy (recommended for local dev) or direct
VITE_FILES_API_MODE=proxy

# Used by frontend only when mode=direct
VITE_FILES_API_BASE_URL=

# Optional proxy mount path for frontend when mode=proxy
VITE_FILES_API_PROXY_PATH=/files-api

# Used by Vite dev server proxy target
QT4_FILES_API_BASE_URL=http://localhost:42873/api/v1
```

Modes:

- `proxy`: frontend calls `/files-api`, and Vite forwards to `QT4_FILES_API_BASE_URL`.
- `direct`: frontend calls `VITE_FILES_API_BASE_URL` directly.
- Files API authentication is Bearer-only (`Authorization: Bearer <Firebase ID token>`), and backend project context is derived from token `aud`.

Production recommendation:

- Use `direct` mode and set `VITE_FILES_API_BASE_URL=https://archivos.dmas.cua.uam.mx/api/v1`.
- Do not rely on `QT4_FILES_API_*` in production builds; those are for Vite dev proxy only.

### Runtime provider defaults

```env
# Used when Firestore config document systemConfig/runtime does not exist
VITE_DEFAULT_FILE_STORAGE_PROVIDER=files-api
VITE_DEFAULT_EMAIL_PROVIDER=files-api

# Used only when email provider is firebase-functions
VITE_FIREBASE_NOTIFY_FUNCTION_URL=
```

Runtime resolution order:

- First, `systemConfig/runtime` in Firestore (`fileStorageProvider`, `emailProvider`).
- If missing/unreadable, fallback to env defaults above.

When `emailProvider=firebase-functions`, the endpoint defined by
`VITE_FIREBASE_NOTIFY_FUNCTION_URL` must accept:

- `Authorization: Bearer <Firebase ID token>`
- JSON body: `{ "to": string[], "cc": string[], "subject": string, "text": string }`

### Firebase Functions email endpoint

The repository includes `functions/notifyEmail` (HTTP function) for SMTP delivery using OAuth2 only.

Setup:

1. Install function dependencies:

```bash
npm --prefix functions install
```

2. Create `functions/.env.qualiteam-app` from `functions/.env.example` and set:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_FROM`
- `SMTP_OAUTH_CLIENT_ID`
- `SMTP_OAUTH_CLIENT_SECRET`
- `SMTP_OAUTH_REFRESH_TOKEN`
- `NOTIFY_ALLOWED_ORIGINS` (optional)

For local emulator usage, you can also copy the same values to `functions/.env.local`.
Local dev origins (`http://localhost:5173`, `http://127.0.0.1:5173`) are allowed by default for CORS.

Compatibility note:

- The function also accepts the variable names already used in `archivos-api` (`MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_SMTP_USER`, `MAIL_FROM_ADDRESS`, `MAIL_OAUTH_CLIENT_ID`, `MAIL_OAUTH_CLIENT_SECRET`, `MAIL_OAUTH_REFRESH_TOKEN`).
- The function also accepts legacy MailerAgent aliases from QualiTeam_NB8 (`QUALITEAM_GMAIL_USER`, `QUALITEAM_GMAIL_CLIENT_ID`, `QUALITEAM_GMAIL_CLIENT_SECRET`, `QUALITEAM_GMAIL_REFRESH_TOKEN`).
- Password-based SMTP (`SMTP_PASS` / `MAIL_SMTP_PASS`) is not supported.

3. Deploy the function:

```bash
npm run deploy:functions:prod
```

4. Copy the deployed function URL and set it as:

```env
VITE_FIREBASE_NOTIFY_FUNCTION_URL=https://.../notifyEmail
```

5. Rebuild/redeploy frontend and set `emailProvider=firebase-functions` in Admin Audit.

### Giphy (optional)

```env
VITE_GIPHY_API_KEY=
```

If omitted, the app uses built-in fallback behavior.

## Current routes

- `/login`
- `/register`
- `/app` (dashboard)
- `/projects`
- `/projects/:projectId/documents`
- `/documents/:docId/versions`
- `/admin/audit`

## Current implemented modules

- Authentication with Firebase Auth (login, register, reset password).
- Project management (create, list, add members by email from `userDirectory`).
- Project documents (create, filter all/mine, short IDs, latest status summary).
- Versions and review workflow:
  - create initial/next version
  - assign author and reviewers (In Creation)
  - upload/replace/download file
  - start review (stores `reviewStartAt` and `reviewEndAt`)
  - create issues (threads), add comments, close/reopen issues
  - after review expiration, comments remain allowed only while the selected thread latest comment is under 1 hour old
  - versions in `In Review` move automatically to `Reviewed` when expiration is reached and there are no comments, or after 1 hour from the latest version comment
  - comments area shows an approximate countdown of remaining comment window time
  - accept/reject latest version with rule-based checks
  - create error report documents from accepted versions
- Dashboard with user tasks (`dashboard/{userId}`), per-section refresh, card/table views.
- Admin audit page:
  - activity report with table/calendar views
  - Files API connectivity check (`/files-api/me`)
  - runtime provider selector (`files-api` or `firebase-storage`, and `files-api` or `firebase-functions`)
  - data model backfill/update action

## Data model maintenance

The Admin Audit page includes a "Data model update" action that backfills and normalizes existing data:

- Missing project short IDs
- Missing document short IDs
- Thread counters and last-comment metadata
- Version counters (`numThreads`, `numOpenThreads`, `numComments`, `numThreadsWithTwoPlusComments`)

This action requires admin access and relies on `QT4/firestore.rules`.

## Notes

- File uploads are limited to 20 MB and are allowed only when the selected version is in `In Creation`.
- File download/delete uses the stored file metadata provider (`files.storageProvider`) so old files remain accessible after provider switches.
- Session persistence uses browser session scope (logout or browser close ends the session).
- Firestore rules and indexes are versioned in `QT4/firestore.rules` and `QT4/firestore.indexes.json`.
- Firebase Storage rules are versioned in `QT4/storage.rules`.
- Full deployment and switch guide: `QT4/FILES_API_DEPLOYMENT.md`.
