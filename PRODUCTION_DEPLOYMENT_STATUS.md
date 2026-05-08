# Production Deployment Status (QT4 + Files API)

Last updated: 2026-02-27
Owner: Jorge Cervantes

## Current status

- Overall state: In progress
- QT4 frontend: Ready to test against production API endpoint
- Files API service (`archivos-api`): Running and restarted with updated mail settings
- Mail notifications: SMTP/OAuth authentication verified from backend runtime
- HTTPS on `archivos.dmas.cua.uam.mx`: Blocked by external DNS timeout during Let's Encrypt validation

## Completed items

1. QT4 configured for production direct mode (`VITE_FILES_API_BASE_URL=https://archivos.dmas.cua.uam.mx/api/v1`).
2. Files API notify schema compatibility fixed in database:
   - `mail_notify_logs.project_id` present and indexed.
   - `project_mail_policies` present and bootstrapped.
3. Files API mail configuration updated and validated in runtime checks.
4. Files API process restarted and confirmed listening on port `42873`.
5. QT4 upload UX improved with modal loading popup using existing loading Giphy.

## Open blockers

1. Public DNS reliability for `archivos.dmas.cua.uam.mx`:
   - External validators report timeout for A/AAAA lookups intermittently.
2. Let's Encrypt certificate issuance:
   - Pending DNS stabilization before successful issuance and IIS binding.

## Next actions

1. Infra/DNS team confirms authoritative DNS reachability from Internet (UDP/TCP 53).
2. Re-run Let's Encrypt issuance after DNS is stable.
3. Install and bind certificate in IIS (`443` + redirect `80 -> 443`).
4. Run production smoke test:
   - Admin Audit `Check connection`
   - Version file upload/download
   - Start review and verify notification delivery

## Go-live criteria

- DNS resolution stable from external networks.
- Valid TLS certificate installed for `archivos.dmas.cua.uam.mx`.
- QT4 smoke test passes without 401/403/500/network errors.
- Mail notification flow confirmed from "Start review".
