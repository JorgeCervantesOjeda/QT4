# QT4 Sequenced Reputation Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed positive reputation awards with cumulative project-scoped activity sequences whose intervals distribute one point among their positions, without a per-issue cap or sequence reset.

**Architecture:** The client and Functions layers will share the same interval contract through equivalent pure helpers and boundary tests. Functions will assign each positive event a sequence family and position inside a transaction that updates a server-only sequence counter, the immutable event ledger, and the project/user summary. Existing historical totals will seed missing counters without rewriting old events.

**Tech Stack:** React 19, TypeScript, Firebase Firestore, Firebase Functions v2, Vitest, Node test runner, Playwright, Firebase rules emulator.

**Spec:** `docs/superpowers/specs/2026-10-16-sequenced-reputation-points-design.md`

## Global Constraints

- Positive sequence boundaries are `1, 2, 5, 10, 20, 50, 100, 200, 500, ...`.
- Each completed interval distributes exactly one point among its positions.
- There is no sequence reset during a project's lifetime and no maximum number of points per issue.
- Consecutive comments by the same user remain one participation block; the automatic initial issue comment remains deduplicated.
- Sequence families are independent for `reviewParticipation`, `goodReaction`, and `acceptedDocument`.
- Review completion remains zero points; review absence remains `-1`; accepted-error-report penalties remain `-2`.
- Existing historical ledger points are not recalculated; missing sequence counters are seeded from existing summary counters.
- Reputation events, summaries, and sequence counters remain server-only writes.
- New and modified text files must be UTF-8 without BOM.
- No production deploy or release is part of this plan.

## Review Focus

- An event at every interval boundary must receive the correct fraction, including positions 2, 5, 10, 20, 50, and 51; covered in Tasks 1 and 2.
- Two qualifying participation blocks in the same issue must both be credited, and a third must continue the cumulative sequence; covered in Task 2.
- A retry must reuse the original sequence position and points rather than advancing the counter; covered in Task 2.
- A historical summary must seed a missing counter without rewriting old events; covered in Task 2.
- A good reaction reversal must remove the original award and reuse its sequence position if the reaction becomes good again; covered in Task 2.
- A modal must not claim `+1` when the final server award depends on the sequence; covered in Task 3.
- Fractional history values must be understandable and stable for zero, positive, and negative points; covered in Task 3.

---

### Task 1: Define and test the sequenced point policy

**Files:**
- Modify: `src/lib/reputation.ts`
- Test: `src/lib/reputation.test.ts`
- Modify: `functions/reputation.js`
- Test: `functions/reputation.test.js`

**Interfaces:**
- `getSequenceInterval(sequenceNumber: number): { start: number; end: number }` returns the inclusive interval for a one-based position.
- `getSequencePoints(sequenceNumber: number): number` returns `1 / (end - start + 1)` for the interval.
- The server mirror exposes the same boundary behavior for Function handlers.
- Positive event rules carry `sequenceKey` values `reviewParticipation`, `goodReaction`, or `acceptedDocument`; non-sequenced events carry no sequence key.

- [x] Write failing TypeScript tests for positions `1, 2, 3, 5, 6, 10, 11, 20, 21, 50, 51, 100, 101, 200, 201, and 500`, including the continuation beyond 500.
- [x] Write failing Node tests for the server helper and the updated base policy values: positive sequenced rules use base-one interval points, while review completion and penalties retain their existing special values.
- [x] Run the focused Vitest and Node files and confirm failures are caused by the missing sequence contract.
- [x] Implement the smallest pure helpers and event-family mapping that satisfy the tests.
- [x] Run both focused test files and confirm they pass.

### Task 2: Apply sequence counters transactionally in Functions

**Files:**
- Modify: `functions/reputation.js`
- Test: `functions/reputation.test.js`
- Modify: `functions/reputation.test.js` test fixtures only as needed for the new persisted fields.

**Interfaces:**
- `applySequencedReputationEvent({ admin, event, logger })` reads and writes `reputationSequenceCounters/{projectId}_{userId}_{sequenceKey}` together with the event and summary.
- Sequenced event records contain `sequenceKey`, `sequenceNumber`, `sequenceIntervalStart`, and `sequenceIntervalEnd`.
- `applyReviewParticipationEvent` records every qualifying participation block without `REVIEW_PARTICIPATION_CAP`.

- [x] Write failing tests proving the first two events in each family receive `1`, the third through fifth receive `1/3`, and the next boundaries receive the specified fractions.
- [x] Write a failing test proving three qualifying participation blocks in one issue are all credited and advance the cumulative review-participation counter.
- [x] Write a failing retry test proving the same event does not consume a second sequence position.
- [x] Write a failing historical-seed test proving an existing `threadCount`, `commentCount`, `goodReactionCount`, or `acceptedVersionCount` initializes the corresponding sequence counter.
- [x] Write a failing reaction-transition test proving good → regular reverses the original points and regular → good reuses the existing sequence position when present.
- [x] Implement transactional sequence-counter reads, seed logic, event metadata, and summary updates.
- [x] Remove the per-issue cap while preserving initial-comment deduplication and consecutive-comment grouping.
- [x] Run `node --test functions/reputation.test.js` and confirm all Function tests pass.

### Task 3: Make the client history and action feedback truthful

**Files:**
- Modify: `src/lib/reputationData.ts`
- Test: `src/lib/reputationData.test.ts`
- Modify: `src/pages/versions/reviewIssueActions.ts`
- Test: `src/pages/versions/reviewIssueActions.test.ts`
- Modify: `src/components/reputation/ContributionHistoryTable.tsx`
- Test: `src/pages/ContributionPage.test.tsx`

**Interfaces:**
- `formatReputationPoints(points: number): string` returns a stable user-facing representation such as `1`, `0.33`, or `-2`.
- Action modals report that participation was recorded and point finalization is available in Contributions; they do not claim a fixed `+1`.

- [x] Write failing tests for formatting whole, fractional, zero, and negative point values.
- [x] Write failing action tests for issue creation and comment creation that reject the old fixed-`+1` copy and require a server-finalization message.
- [x] Implement the formatter and replace fixed award language in existing success modals without timer-based dismissal.
- [x] Render formatted fractional values in contribution history while preserving visible negative events.
- [x] Run the focused client tests and confirm they pass.

### Task 4: Verify persistence, rules, UI flows, and regression behavior

**Files:**
- Modify or create: relevant tests under `src/lib/`, `functions/`, and `src/test/e2e/`.
- Modify: `src/pages/ContributionPage.test.tsx` or reputation fixtures only when assertions need the new fractional display.

**Interfaces:**
- Unit policy tests, Function transaction tests, Firestore rules tests, and end-to-end UI tests remain linked to the same user activity flow.

- [x] Add or update an emulator integration assertion for sequence counter documents, event metadata, summary totals, and server-only access.
- [x] Run the rules suite and confirm clients cannot write sequence counters, events, or summaries.
- [x] Run the focused fake end-to-end reputation route tests and verify the empty state and project route remain usable.
- [x] Run `npm test`, `npm run test:rules`, `npm run lint`, and `npm run build`.
- [x] Run `git diff --check`, inspect the final diff, and record any residual behavior that was not verified.

## Expected verification commands

- `npx vitest run src/lib/reputation.test.ts src/lib/reputationData.test.ts src/pages/ContributionPage.test.tsx src/pages/versions/reviewIssueActions.test.ts --no-file-parallelism --maxWorkers=1`
- `node --test functions/reputation.test.js`
- `npm run test:reputation:emulator`
- `npm run test:rules`
- `npm run test:e2e:fake -- src/test/e2e/reputation.spec.ts`
- `npm test`
- `npm run lint`
- `npm run build`
