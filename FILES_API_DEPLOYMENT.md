# Files API Deployment Guide (Local and Production)

This guide standardizes how QT4 connects to `archivos-api` in local and production environments.

## 1. Connection modes

QT4 supports two modes:

- `proxy` mode: browser calls `/files-api`, Vite dev server forwards to local API.
- `direct` mode: browser calls Files API URL directly.

In code, mode is controlled by:

- `VITE_FILES_API_MODE=proxy|direct`

## 2. Local development setup

Use `.env.local` with proxy mode:

```env
VITE_FILES_API_MODE=proxy
VITE_FILES_API_PROXY_PATH=/files-api
QT4_FILES_API_BASE_URL=http://localhost:42873/api/v1
QT4_FILES_API_KEY=<64-hex-key>
```

Run:

```bash
npm run dev
```

Validation:

1. Sign in to QT4.
2. Go to Admin Audit.
3. Click `Check connection`.
4. Expected result: `Connected: ...`.

## 3. Production setup

Use `.env.production` with direct mode:

```env
VITE_FILES_API_MODE=direct
VITE_FILES_API_BASE_URL=https://archivos.dmas.cua.uam.mx/api/v1
VITE_FILES_API_CLIENT_KEY=
```

Important:

- `QT4_FILES_API_BASE_URL` and `QT4_FILES_API_KEY` are not used in production builds.
- Avoid embedding private API keys in `VITE_*` variables, because they are public in frontend bundles.

## 4. Network prerequisites for the Files API server

For external access to production endpoint, the API server host must be configured on Ethernet:

- IP: `148.206.162.65`
- Mask: `255.255.255.0`
- Gateway: `148.206.162.254`
- DNS #1: `148.206.168.1`
- DNS #2: `8.8.8.8`

Public endpoint:

- `https://archivos.dmas.cua.uam.mx`

## 5. Build and deploy checklist

1. Create/update `QT4/.env.production` (based on `.env.production.example`).
2. Build:

```bash
npm run build
```

3. Deploy `QT4/dist` to hosting.
4. Smoke test:
   - Sign in
   - `Check connection` in Admin Audit
   - Upload file in a version in `In Creation`
   - Download file
   - Verify no CORS or auth token errors

## 6. Quick switch reference

- Local API: use `.env.local` with `proxy`.
- Production API: use `.env.production` with `direct`.

If behavior looks incorrect after changing env files, stop and restart Vite or rebuild to refresh injected variables.
