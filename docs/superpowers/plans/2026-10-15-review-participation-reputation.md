# QT4 Review Participation Reputation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace assignment-based review credit with capped server-derived issue participation, penalties and badge updates, and show deterministic contribution feedback in existing success modals.

**Architecture:** Domain triggers will emit idempotent reputation events. A server-side participation counter will cap each user's credit at two points per issue, while version completion will derive active participants and non-participating assigned reviewers. Existing success-modal state will carry a small structured contribution notice so the UI can show action credit without waiting on a background trigger.

**Tech Stack:** React 19, TypeScript, Firebase Firestore, Firebase Functions v2, Vitest, Node test runner, Firebase rules emulator.

**Spec:** `docs/superpowers/specs/2026-10-15-review-participation-reputation-design.md`

## Global Constraints

- Appeals remain excluded.
- New text files are UTF-8 without BOM.
- No client write may create or modify reputation events, summaries, or participation counters.
- The issue's automatic initial comment is one participation, not two events.
- Consecutive comments by the same user in one issue form one participation block; a later comment after another user's comment may start a new block.
- A user receives at most two participation points per issue per version review.
- Negative reputation events remain visible in the server ledger.
- UI feedback is visible before long-running work and does not disappear by timer.
- No production deploy is part of this plan.

## Review Focus

- A retried initial issue-comment trigger must not award a duplicate point.
- Consecutive comments by the same user in one issue must not create additional participation events.
- A comment after another user's comment may start a new participation block, still subject to the two-point cap.
- Two users commenting in the same issue must each receive their own capped credit.
- An assigned reviewer with no participation must receive exactly one `-1` event when review completes.
- An accepted error report must award `+2` to its author and `-2` to the affected base-version author.

### Task 1: Update the pure reputation policy and badge contracts

**Files:**
- Modify: `src/lib/reputation.ts`
- Test: `src/lib/reputation.test.ts`
- Modify: `docs/superpowers/specs/2026-10-15-review-participation-reputation-design.md`

**Interfaces:**
- Produces policy constants and badge definitions for participation, penalties, and reliable review.

- [ ] Write failing tests for the new event values, badge thresholds, and recognition label.
- [ ] Run the focused Vitest file and observe failures caused by the old policy.
- [ ] Implement the minimum typed policy and pure badge helpers.
- [ ] Run the focused Vitest file and the existing reputation component tests.

### Task 2: Implement server-side capped participation and penalties

**Files:**
- Modify: `functions/reputation.js`
- Test: `functions/reputation.test.js`
- Modify: `functions/index.js` only if trigger inputs require it.

**Interfaces:**
- Consumes issue, comment, reaction, and version snapshots.
- Produces idempotent active and negative reputation events, per-thread/user cap state, and updated summaries.

- [ ] Write failing function tests for initial-comment deduplication, two-point caps, distinct active participants, inactive-reviewer penalties, and accepted-error-report penalties.
- [ ] Run the focused Node test file and observe expected failures.
- [ ] Implement server-only cap bookkeeping and event attribution.
- [ ] Implement version-completion credit only for active participants and one absence penalty per assigned reviewer.
- [ ] Lower accepted error-report credit to `+2` and add the affected-version `-2` event.
- [ ] Run the focused Function tests and the complete Functions test set.

### Task 3: Add deterministic feedback to existing success modals

**Files:**
- Modify: `src/pages/versions/versionsPageState.ts`
- Modify: `src/pages/versions/reviewIssueActions.ts`
- Modify: `src/pages/versions/VersionsModals.tsx`
- Modify: `src/pages/versions/VersionsPageView.tsx` if prop plumbing requires it.
- Test: `src/pages/versions/VersionsModals.test.tsx` and `src/pages/versions/reviewIssueActions.test.ts`

**Interfaces:**
- Existing action handlers provide an optional contribution notice.
- `VersionsModals` renders the notice inside the existing success modal and keeps explicit dismissal behavior.

- [ ] Write failing UI tests for issue creation, capped comment feedback, and badge/unavailable-summary copy.
- [ ] Run the focused UI tests and observe expected failures.
- [ ] Implement structured notice state and action-specific deterministic point messages.
- [ ] Render the notice accessibly without timer-based dismissal.
- [ ] Run focused UI tests and the complete versions-page unit tests.

### Task 4: Link system-level evidence and regression verification

**Files:**
- Modify or create: relevant reputation integration tests under `src/lib/` and `functions/`.
- Modify: existing system fixtures only if required.

**Interfaces:**
- Unit policy, Function integration, rules access, and user-facing modal behavior remain linked to the same contribution flow.

- [ ] Add or update integration coverage for persisted capped events and summaries.
- [ ] Add a system-level assertion for visible contribution feedback after issue/comment activity if the existing fake app supports the flow.
- [ ] Run the full unit, rules, integration, lint, and production-build checks.
- [ ] Perform a final self-review of the diff against the addendum and record any residual unverified behavior.

## Expected verification commands

- `npx vitest run src/lib/reputation.test.ts src/components/reputation/reputation.test.tsx src/pages/versions/VersionsModals.test.tsx src/pages/versions/reviewIssueActions.test.ts`
- `node --test functions/reputation.test.js`
- `npm test`
- `npm run test:rules`
- `npm run lint`
- `npm run build`

No production deployment is included.
