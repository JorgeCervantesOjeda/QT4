# QT4 Migration Plan (Resumable Runbook)

This document defines the execution plan to migrate legacy QualiTeam data into QT4 and recover safely from interruptions (terminal close, network drop, process crash).

## 1. Scope and Goal

Goal:
- Migrate legacy users, projects, members, documents, versions, threads, comments, and files into Firebase-backed QT4.

In scope:
- Data preparation and normalization.
- Firebase Auth user resolution/creation.
- Firestore load of core entities.
- Firebase Storage upload of legacy files.
- Runtime provider switch to final target.

Out of scope:
- Legacy Java/JSF feature changes.
- UI redesign work unrelated to migration.

## 2. Source of Truth and Tools

Primary script:
- `tools/migrate_legacy_qt4.py`

Main commands:
- `python tools/migrate_legacy_qt4.py prepare`
- `python tools/migrate_legacy_qt4.py wipe_core`
- `python tools/migrate_legacy_qt4.py load_core`
- `python tools/migrate_legacy_qt4.py upload_files --max-seconds 900`
- `python tools/migrate_legacy_qt4.py finalize`
- `python tools/migrate_legacy_qt4.py status`

Generated state:
- `migration_work/prepared_data.json`
- `migration_work/upload_state.json`

## 3. Mandatory Safety Gates

Run these checks before any destructive step:

1. Confirm target project and environment:
- Firebase project is `qualiteam-app`.
- Correct `.env.production` is present.

2. Confirm access:
- Firebase CLI authenticated.
- MySQL source reachable.
- SSH/SFTP source files reachable.

3. Confirm approved migration window:
- Team agrees on execution start time and expected downtime/risk.

4. Confirm backup/snapshot exists:
- Export current Firestore/Storage or document rollback baseline before `wipe_core`.

5. Start a migration log file:
- Keep all command outputs in a log file under `migration_work/`.

Example (PowerShell):

```powershell
New-Item -ItemType Directory -Force migration_work | Out-Null
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$log = "migration_work/migration-$ts.log"
"Migration started at $(Get-Date -Format o)" | Tee-Object -FilePath $log
```

## 4. Execution Plan (Step by Step)

### Phase A: Prepare

Run:

```powershell
python tools/migrate_legacy_qt4.py prepare 2>&1 | Tee-Object -FilePath $log -Append
```

Expected result:
- `migration_work/prepared_data.json` exists.
- Output includes `meta.counts`.

Checkpoint A:
- Save `meta.counts` in the log.
- Do not continue if prepare fails.

### Phase B: Core Reset (Destructive)

Run only after approval:

```powershell
python tools/migrate_legacy_qt4.py wipe_core 2>&1 | Tee-Object -FilePath $log -Append
```

Expected result:
- Core collections are deleted and ready for reload.

Checkpoint B:
- Log success marker `[wipe_core] done`.

### Phase C: Core Load

Run:

```powershell
python tools/migrate_legacy_qt4.py load_core 2>&1 | Tee-Object -FilePath $log -Append
```

Expected result:
- Core documents loaded to Firestore.
- Output shows progress lines per collection.

Checkpoint C:
- Log success marker `[load_core] done`.

### Phase D: File Upload (Chunked and Resumable)

Run in repeatable windows (example: 15 minutes per run):

```powershell
python tools/migrate_legacy_qt4.py upload_files --max-seconds 900 2>&1 | Tee-Object -FilePath $log -Append
```

Expected result:
- `migration_work/upload_state.json` updates after each run.
- Script can resume from `nextIndex`.

Checkpoint D:
- Continue running until `nextIndex == totalTasks`.
- Track `uploaded`, `missing`, and `errors` in log.

### Phase E: Finalize Runtime

Run:

```powershell
python tools/migrate_legacy_qt4.py finalize 2>&1 | Tee-Object -FilePath $log -Append
```

Expected result:
- `systemConfig/runtime` updated to final providers.

Checkpoint E:
- Log success marker `[finalize] runtime updated`.

### Phase F: Validation

Run:

```powershell
python tools/migrate_legacy_qt4.py status 2>&1 | Tee-Object -FilePath $log -Append
```

Validate:
- Counts are consistent with preparation output.
- Upload state completed (`nextIndex == totalTasks`).
- QT4 app smoke test passes (login, projects, versions, files, comments, admin audit).

## 5. Recovery Procedure After Interruption

If session is interrupted, restart from latest checkpoint:

1. Check state:

```powershell
python tools/migrate_legacy_qt4.py status
```

2. Recovery rules:
- If `prepared_data.json` is missing: rerun `prepare`.
- If interruption happened during `load_core`: rerun `load_core` (upsert behavior is safe).
- If interruption happened during `upload_files`: rerun `upload_files` until completion.
- Run `finalize` only after core and file migration are complete.

3. Never rerun `wipe_core` unless intentional reset is approved again.

## 6. Evidence Required for Completion

Migration is considered complete only if all items exist:

- `migration_work/migration-<timestamp>.log`
- `migration_work/prepared_data.json`
- `migration_work/upload_state.json` with `nextIndex == totalTasks`
- Final `status` output captured in log
- Short written summary in commit/issue/ops note:
  - Start and end time (ISO-8601)
  - Total migrated records by collection
  - File upload totals (`uploaded`, `missing`, `errors`)
  - Known exceptions and follow-up actions

## 7. Risk Notes

- `wipe_core` is destructive; execute only with explicit approval and verified backup.
- Credentials and tokens must be managed securely; do not commit secrets to repository files.
- `missing` files during upload must be reviewed manually and resolved as a post-migration task.

## 8. Quick Restart Checklist

Use this checklist when a session is lost:

1. Open this file (`PLAN_MIGRACION_QT4.md`).
2. Open latest log in `migration_work/`.
3. Run `python tools/migrate_legacy_qt4.py status`.
4. Resume from the next incomplete phase.
5. Append all outputs to the same log file.

