# QT4 Local Agent Rules

These rules apply to work inside `QT4/` and complement repository-level guidance.

## Encoding and Text Safety (Mandatory)

- Always write text files as UTF-8 without BOM.
- Do not use write methods that may introduce BOM by default.
- Keep encoding consistent when reading and writing the same file.
- Prevent mojibake proactively: preserve valid accents/symbols and avoid mixed encodings.
- If mojibake is introduced in a touched file, fix it before finishing the task.
- Do not commit encoding artifacts (BOM-only diffs or accidental character corruption).
## Patch Application Reliability

- Prefer `apply_patch` for small, focused hunks after reading the exact target block.
- Avoid broad or ambiguous patch context, especially in repeated sections.
- If `apply_patch` fails once due to context mismatch, switch immediately to a controlled direct edit method.
- After any direct edit fallback, verify UTF-8 without BOM and preserve line-ending style.

## Communication Style

- Keep commentary updates to the minimum.
- Do not narrate routine searches, file reads, or obvious intermediate steps.
- Only send commentary when starting implementation, when blocked, or when reporting validation results.
- Before making implementation decisions or editing files, first explain the proposed decisions briefly and wait for the user's explicit `ok`.
- Do not apply code, configuration, or content changes until the user confirms with `ok`.
- Keep final responses brief by default, unless the user asks for more detail.

## Production Release Rule

- Treat a full production deploy as a release, not as a technical deploy.
- For full production releases, always use `npm run release:prod`.
- Do not bump `package.json.version` manually for production releases; the release workflow must compute it from commits since the latest `prod/vX.Y.Z` tag.
- Before a production release, the agent may inspect the planned bump with `npm run release:plan:prod`.
- Partial or technical deploys must not change app version:
  - `npm run deploy:functions:prod`
  - `npm run deploy:prod`
  - test deploys or other non-release deploys
- If the user asks to `deploy` without qualification, interpret it as a full production release and use the release workflow unless the user explicitly requests a partial or technical deploy.
