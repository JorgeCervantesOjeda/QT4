# Derived Variants And Propagated Error Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement derived-document configuration, propagated error reports, short visible references, persistence rules, tests, commit, and production release.

**Architecture:** Extend the existing document-version workflow instead of creating a separate configuration entity. Store derivation/provenance fields on specialized `documents` records and use Firestore transactions or callable/server operations where idempotence and cross-document updates are required.

**Tech Stack:** React 19, TypeScript, Firebase Firestore, Firebase Functions v2, Vitest, Firebase rules tests, Playwright where UI behavior needs coverage.

**Spec:** `docs/superpowers/specs/2026-08-29-derived-variants-and-propagated-error-reports.md`

## Global Constraints

- A configuration is deduced from accepted change requests; no independent configuration entity is persisted.
- Change requests belong to the current project and reference an accepted base version in a different project.
- A derived document keeps origin project/document/version and incorporated accepted change request version IDs.
- Accepting a derived document atomically marks incorporated accepted change request versions as `Replaced`.
- Propagated error reports are idempotent for each variant project, line, and accepted source error-report version.
- Visible provenance references use project short ID, document short ID, and formatted version; long IDs remain internal.
- Production release must use `npm run release:prod`.

---

### Task 1: Add Domain Types And Pure Configuration Helpers

**Files:**
- Modify: `src/pages/versions/types.ts`
- Create: `src/lib/documentDerivation.ts`
- Test: `src/lib/documentDerivation.test.ts`

**Interfaces:**
- Produces: `DerivedDocumentReference`, `PropagatedErrorReportReference`, `ChangeRequestLineKey`, `buildChangeRequestLineKey`, `isAcceptedChangeRequestVersionActive`, `groupActiveChangeRequests`, `formatProvenanceReference`.

- [ ] **Step 1: Write failing tests** for grouping accepted change requests by `{projectId, baseProjectId, baseDocId, baseVersionId}`, excluding `Replaced`, and formatting `Proyecto 3 · Documento 12 · v1.00`.
- [ ] **Step 2: Run** `npm run test -- src/lib/documentDerivation.test.ts` and confirm failure due missing module.
- [ ] **Step 3: Implement** the helpers with no Firestore dependency.
- [ ] **Step 4: Run** `npm run test -- src/lib/documentDerivation.test.ts`.

### Task 2: Create Derived Documents From Active Configuration

**Files:**
- Create: `src/pages/projectDocuments/derivedDocumentData.ts`
- Modify: `src/pages/ProjectDocumentsPage.tsx`
- Test: `src/pages/ProjectDocumentsPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `loadDerivableConfigurations(projectId, userId)`, `createDerivedDocumentFromConfiguration(params)`.

- [ ] **Step 1: Write failing tests** showing accepted change requests appear as a derivable configuration and create a derived document with initial version `0.01` plus provenance fields.
- [ ] **Step 2: Run targeted tests** and confirm expected failure.
- [ ] **Step 3: Implement loader and transaction creator** using `documents`, `versions`, `counters`, and current short-ID patterns.
- [ ] **Step 4: Add UI entry point** with immediate progress text during creation.
- [ ] **Step 5: Run targeted tests.**

### Task 3: Enforce Derived Acceptance And Change Request Boundaries

**Files:**
- Modify: `src/pages/versions/versionDecisionActions.ts`
- Modify: `src/lib/changeRequests.ts`
- Modify: `firestore.rules`
- Test: `src/pages/versions/versionDecisionActions.test.ts` or focused new test
- Test: `src/lib/firestoreChangeRequestRules.test.ts`

**Interfaces:**
- Consumes: provenance fields on `documents`.
- Produces: acceptance path that rejects stale derived documents and atomically replaces incorporated accepted change requests.

- [ ] **Step 1: Write failing tests** for rejecting acceptance when accepted change requests are missing from the derived document.
- [ ] **Step 2: Write failing rules test** that blocks new change-request document creation if a derived document is already accepted for the same line.
- [ ] **Step 3: Implement transaction reads and writes** before accepting a `derivedDocument`.
- [ ] **Step 4: Update Firestore rules** enough to validate derived fields and same-line accepted-derived blocking where rules can enforce it; keep remaining cross-query checks in transaction code.
- [ ] **Step 5: Run targeted tests.**

### Task 4: Propagate Accepted Error Reports

**Files:**
- Create: `functions/propagatedErrorReports.js`
- Modify: `functions/index.js`
- Test: `functions/propagatedErrorReports.test.js`

**Interfaces:**
- Produces: `createPropagatedErrorReportJob({ admin, logger })`.

- [ ] **Step 1: Write failing function tests** for accepting a source report, locating variant projects through accepted change requests and derived documents, creating propagated reports without copying files, and idempotent re-run.
- [ ] **Step 2: Run** `cd functions; npm test -- propagatedErrorReports.test.js` and confirm failure.
- [ ] **Step 3: Implement reusable job** that accepts `{sourceErrorReportDocumentId, sourceErrorReportVersionId}` and writes deterministic propagation result documents plus propagated `documents` and initial `versions`.
- [ ] **Step 4: Wire a Firestore trigger** in `functions/index.js` for accepted error-report versions.
- [ ] **Step 5: Run function tests.**

### Task 5: Surface Propagated Reports And Short References

**Files:**
- Modify: `src/pages/versions/dataLoaders.ts`
- Modify: `src/pages/versions/VersionsHeader.tsx`
- Modify: `src/pages/ProjectDocumentsPage.tsx`
- Test: `src/pages/versions/VersionsHeader.test.tsx`
- Test: `src/pages/ProjectDocumentsPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 `formatProvenanceReference`.
- Produces: visible provenance labels based on short IDs and version number.

- [ ] **Step 1: Write failing tests** for showing project short ID, document short ID, and formatted version in base/provenance labels.
- [ ] **Step 2: Implement loader fields** for base project short ID and base version number.
- [ ] **Step 3: Update UI labels** without using long IDs as primary labels.
- [ ] **Step 4: Run targeted tests.**

### Task 6: Regression Verification, Commit, And Production Release

**Files:**
- Modify only files changed by Tasks 1-5.

- [ ] **Step 1: Run** `npm run test`.
- [ ] **Step 2: Run** `cd functions; npm test`.
- [ ] **Step 3: Run** `npm run build:prod`.
- [ ] **Step 4: Stage only this task's files and commit.**
- [ ] **Step 5: Run** `npm run release:plan:prod`.
- [ ] **Step 6: Run** `npm run release:prod`.
- [ ] **Step 7: Report exact commit, release output, and verification limits.
