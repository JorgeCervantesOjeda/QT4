# QT4 Contribution Reputation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trusted project-scoped contribution points, explainable badges, contribution history, and project leaderboards to QT4 without implementing appeals.

**Architecture:** Firestore domain events are converted by idempotent Cloud Functions into a server-only reputation event ledger and project-scoped summary documents. React pages read those summaries through shared presentation components for Dashboard, Account, and project contribution views.

**Tech Stack:** React 19, TypeScript, Vite, Firebase Firestore, Firebase Functions v2, Vitest, Testing Library, Playwright, Firebase rules emulator.

**Spec:** `docs/superpowers/specs/2026-10-15-contribution-reputation-design.md`

## Global Constraints

- Appeals are excluded: do not create appeal routes, controls, collections, statuses, or UI copy.
- New text files are UTF-8 without BOM.
- New files start with a path-and-purpose comment when they are source files.
- No client write may create or modify reputation events or summaries.
- All reputation trigger handlers must be idempotent.
- UI uses the existing English product copy for consistency.
- Use CSS-first presentation and visible loading/error/empty/processing states.
- Every changed behavior receives unit, integration/rules, and system-level evidence where applicable.

## Review Focus

- Firestore retry duplicates a trigger: test stable event IDs and unchanged summaries.
- A user changes a reaction from `good` to `regular` or `bad`: test delta reversal.
- A reaction is applied to another user's comment: test recipient attribution.
- A non-member queries a project leaderboard: test rules denial.
- Summary or leaderboard loading fails or has no data: test visible UI states and explicit recovery.

### Task 1: Define reputation policy and pure scoring logic

**Files:**
- Create: `src/lib/reputation.ts`
- Test: `src/lib/reputation.test.ts`

**Interfaces:**
- Produces `ReputationCategory`, `ReputationBadgeId`, `ReputationSummary`, `ReputationEvent`, `BADGE_DEFINITIONS`, `getContributionPoints`, `deriveBadgeIds`.

- [ ] **Step 1: Write failing unit tests** for point lookup, badge thresholds, category totals, and reaction deltas.
- [ ] **Step 2: Run `npx vitest run src/lib/reputation.test.ts` and confirm the expected missing-module failure.**
- [ ] **Step 3: Implement the minimum typed policy and pure functions.**
- [ ] **Step 4: Run the focused test and confirm all policy tests pass.**
- [ ] **Step 5: Run the related existing unit tests for domain and audit code.**

### Task 2: Add trusted server reputation processing

**Files:**
- Create: `functions/reputation.js`
- Test: `functions/reputation.test.js`
- Modify: `functions/index.js`

**Interfaces:**
- Consumes Firestore document snapshots for threads, comments, comment reactions, and versions.
- Produces `createReputationHandlers`, `applyReputationEvent`, and deterministic event/summary updates.

- [ ] **Step 1: Write failing function tests** for stable event IDs, event deltas, recipient selection, and badge counter updates.
- [ ] **Step 2: Run `node --test functions/reputation.test.js` and confirm the expected failure.**
- [ ] **Step 3: Implement transaction helpers that update `reputationEvents` and `reputationSummaries` atomically.**
- [ ] **Step 4: Implement trigger factories for thread creation, comment creation, reaction writes, and version updates.**
- [ ] **Step 5: Export the handlers from `functions/index.js`.**
- [ ] **Step 6: Run the focused function tests and the existing Functions test suite.**

### Task 3: Secure and query reputation data

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json` if the tested queries require indexes.
- Create: `src/lib/firestoreReputationRules.test.ts`

**Interfaces:**
- Allows signed-in users to read their own summaries.
- Allows project members and administrators to read summaries for accessible projects.
- Denies client create/update/delete for reputation events and summaries.

- [ ] **Step 1: Write failing rules tests** for self reads, project-member reads, non-member denial, and client-write denial.
- [ ] **Step 2: Run `npm run test:rules -- --runInBand` or the focused emulator command and confirm the expected denial/permission failures.**
- [ ] **Step 3: Add the minimum rules and indexes required by the spec.**
- [ ] **Step 4: Run the focused rules tests and confirm the expected access matrix.**
- [ ] **Step 5: Run the existing Firestore rules tests for regression.**

### Task 4: Build shared contribution UI components

**Files:**
- Create: `src/components/ContributionSummary.tsx`
- Create: `src/components/BadgeGrid.tsx`
- Create: `src/components/ContributionHistoryTable.tsx`
- Create: `src/components/ContributionStatus.tsx`
- Create: `src/components/ProjectLeaderboard.tsx`
- Create: `src/components/ContributionUi.css`
- Test: matching component tests under `src/components/`

**Interfaces:**
- Components consume typed summaries/events and callbacks for navigation/retry.
- Components render loading, empty, populated, processing, and error states without timers.

- [ ] **Step 1: Write failing component tests** for populated summaries, badge criteria, empty states, loading states, and project-scoped rows.
- [ ] **Step 2: Run focused component tests and confirm the expected failures.**
- [ ] **Step 3: Implement the smallest CSS-first components using existing panel, card, table, status, and action patterns.**
- [ ] **Step 4: Add responsive CSS and accessible labels/status regions.**
- [ ] **Step 5: Run focused component tests and verify all states.**

### Task 5: Add personal contribution data and routes

**Files:**
- Create: `src/pages/ContributionPage.tsx`
- Create: `src/pages/ContributionPage.test.tsx`
- Modify: `src/pages/AccountSettingsPage.tsx`
- Modify: `src/pages/DashboardPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- `/contribution` renders the signed-in user's project summaries and history.
- `/account` links to the contribution view without removing notification preferences.
- `/app` contains the compact `My contribution` panel.

- [ ] **Step 1: Write failing page tests** for route rendering, Firestore loading, empty/error feedback, and navigation from Account/Dashboard.
- [ ] **Step 2: Run focused page tests and confirm expected failures.**
- [ ] **Step 3: Implement the contribution query and page composition.**
- [ ] **Step 4: Add the Account and Dashboard entry points with visible pending/error states.**
- [ ] **Step 5: Run focused page tests and existing Account/Dashboard tests.**

### Task 6: Add project-scoped leaderboard

**Files:**
- Create: `src/pages/ProjectContributionPage.tsx`
- Create: `src/pages/ProjectContributionPage.test.tsx`
- Modify: `src/pages/ProjectDocumentsPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- `/projects/:projectId/contribution` reads only the selected project's summaries and renders the project leaderboard.
- Existing project/document navigation remains unchanged.

- [ ] **Step 1: Write failing page and navigation tests** for project identity, sorted rows, empty state, non-member error state, and link visibility.
- [ ] **Step 2: Run focused tests and confirm expected failures.**
- [ ] **Step 3: Implement the project query, sorting, explanation panel, and responsive composition.**
- [ ] **Step 4: Add the project-page entry point.**
- [ ] **Step 5: Run focused page tests and existing ProjectDocuments tests.**

### Task 7: Link unit, integration, and system evidence

**Files:**
- Create or modify: `src/test/e2e/reputation.spec.ts`
- Modify: `src/test/e2e/fakes/state.ts` only if the fake system needs deterministic reputation fixtures.
- Modify: `src/test/e2e/fakes/app.ts` only if the route requires a new fixture action.

**Interfaces:**
- The system test proves that a signed-in user can navigate from Dashboard to personal contribution and from a project document page to the project leaderboard.

- [ ] **Step 1: Write the failing system test for the approved navigation and visible populated state.**
- [ ] **Step 2: Run the focused Playwright configuration and confirm the expected failure.**
- [ ] **Step 3: Add only the fixture data and route wiring required by the system test.**
- [ ] **Step 4: Run the focused system test and confirm it passes.**
- [ ] **Step 5: Run the full unit, rules, Functions, system, lint, and production build checks.**

## Final verification

- `npm test`
- `npm run test:rules`
- `npm run test:e2e:fake`
- `npm run lint`
- `npm run build`

The final report must distinguish passed checks from unverified live-production behavior. No production deployment is part of this plan.
