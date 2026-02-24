# Codex Runbook: QT4 + Files API Production Setup

This runbook is for a future Codex session to configure and validate QT4 against the real production `archivos-api`.

## Scope

- Configure network prerequisites on the production Files API host.
- Ensure `archivos-api` is reachable at:
  - `https://archivos.dmas.cua.uam.mx/api/v1`
- Build QT4 in production mode with direct Files API access.
- Validate end-to-end upload/download from QT4.

## Preconditions

- Access to production PC that hosts `archivos-api`.
- Access to QT4 repository.
- Firebase project credentials already configured for production.
- TLS endpoint and DNS already delegated for `archivos.dmas.cua.uam.mx`.

## 1. Production network configuration (Files API host)

On Windows Ethernet adapter, set:

- IP: `148.206.162.65`
- Mask: `255.255.255.0`
- Gateway: `148.206.162.254`
- DNS #1: `148.206.168.1`
- DNS #2: `8.8.8.8`

Quick checks:

```powershell
ipconfig /all
ping archivos.dmas.cua.uam.mx
```

Expected:

- Ethernet has the static IP above.
- DNS resolves and ping reaches target network.

## 2. Start and verify `archivos-api`

On production host:

1. Start `archivos-api` with production config.
2. Ensure it binds to external interface (not localhost-only).
3. Confirm TLS endpoint is available.

Checks:

```powershell
curl https://archivos.dmas.cua.uam.mx/api/v1/health
```

If `/health` is unavailable in your API, test any public lightweight endpoint used by your deployment.

### CORS requirement for Firebase Hosting clients

`archivos-api` must allow the QT4 production origin(s), for example:

- `https://<firebase-project-id>.web.app`
- `https://<firebase-project-id>.firebaseapp.com`
- your custom domain (if used)

At minimum, allow:

- methods used by QT4 (`GET`, `PUT`, `DELETE`, `POST`, `OPTIONS`)
- headers used by QT4 (`Authorization`, `Content-Type`, `X-API-Key`, `X-Overwrite`, `X-File-Permanent`, `X-Expire-After-Days`)

Without this, Firebase Hosting clients will fail with browser `NetworkError`/CORS blocks even if the API works from server-side tools.

## 3. Configure QT4 production environment

In `QT4/.env.production`, ensure:

```env
VITE_FILES_API_MODE=direct
VITE_FILES_API_BASE_URL=https://archivos.dmas.cua.uam.mx/api/v1
VITE_FILES_API_CLIENT_KEY=
```

Notes:

- In production frontend, do not depend on `QT4_FILES_API_*` variables.
- `QT4_FILES_API_*` is only for local Vite proxy mode (`npm run dev`).

## 4. Build QT4 for production

From `QT4/`:

```powershell
npm run build
```

Expected:

- Successful `tsc -b && vite build`.
- Deployable assets generated under `QT4/dist`.

## 5. Deploy and smoke test

After deploying `QT4/dist`:

1. Sign in with a valid user in QT4.
2. Go to Admin Audit and click `Check connection`.
3. Open a document version in `In Creation`.
4. Upload a file.
5. Download the same file.
6. Open browser DevTools Network tab and confirm Files API calls are not blocked by CORS.

Expected:

- Check connection: `Connected: ...`
- Upload succeeds without network/auth modal errors.
- Download succeeds.
- Preflight and API requests return valid CORS response headers for the hosting origin.

## 6. Common failures and fixes

### Error: `Files API error (401): Invalid or expired Firebase session token`

Cause:

- Files API cannot validate Firebase ID tokens (bad/missing Firebase Admin setup).

Fix:

- Verify service account / admin credentials on `archivos-api`.
- Verify backend points to correct Firebase project.
- Restart `archivos-api` after credential changes.

### Error: `Files API error (500): Internal auth error`

Cause:

- Backend auth middleware crashed or misconfigured.

Fix:

- Inspect `archivos-api` logs.
- Validate Firebase Admin initialization path and credentials.
- Restart API and retest.

### Error: `NetworkError when attempting to fetch resource`

Cause:

- DNS, TLS, firewall, reverse proxy, service binding, or CORS policy issue.

Fix:

- Verify DNS resolution from client and server.
- Verify HTTPS cert chain and endpoint reachability.
- Verify service is listening on expected interface/port.
- Verify CORS allowlist includes the Firebase Hosting origin.

### Error: `Upload failed (400): Body must be binary`

Cause:

- Request body sent with wrong content type/encoding on backend path.

Fix:

- Ensure upload endpoint accepts raw binary (`application/octet-stream`).
- Confirm no middleware is forcing JSON body parsing for upload route.

## 7. Local fallback mode (for developer machine)

Use `QT4/.env.local`:

```env
VITE_FILES_API_MODE=proxy
VITE_FILES_API_PROXY_PATH=/files-api
QT4_FILES_API_BASE_URL=http://localhost:42873/api/v1
QT4_FILES_API_KEY=<64-hex-key>
```

Then run:

```powershell
npm run dev
```

## 8. Completion criteria

Task is complete only if all are true:

1. `Check connection` reports connected.
2. Upload works in a version in `In Creation`.
3. Download works for uploaded file.
4. No 401/500/network errors remain in QT4 for Files API operations.
