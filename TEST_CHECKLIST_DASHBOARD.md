# Dashboard Subscription Checklist

Date: 2026-02-07

Scope: Dashboard uses `dashboard/{userId}` collection with client-written tasks and live subscription.

## Prerequisites
- Firestore rules deployed (dashboard read/write allowed only for `request.auth.uid`).

## Tests
1. Initial load writes dashboard doc
   1. Sign in and open `/app`.
   2. Confirm tasks render or the empty state appears.
   3. In Firestore Console, verify `dashboard/{userId}` exists with:
      - `userId`
      - `tasks` array
      - `updatedAt`
      - `updatedBy`

2. Dashboard updates from local recompute
   1. Perform an action that changes tasks (for example, create an In Creation version or add a review comment).
   2. Return to `/app` and confirm the tasks reflect the change.
   3. Verify `dashboard/{userId}` updated (`updatedAt` changed).

3. Dashboard live updates via subscription
   1. Open `/app` in two tabs.
   2. In tab A, trigger a task change.
   3. Verify tab B updates without reload.

4. Permissions
   1. Attempt to read another user's `dashboard/{userId}` -> should fail.
   2. Confirm the current user can read/write only their own dashboard doc.

5. Empty state
   1. Use a user with no pending tasks.
   2. Confirm "No pending tasks right now." appears (and no errors).

## Additional checks (2026-02-18)
1. Giphy behavior after logout
   1. Trigger logout.
   2. Sign in again.
   3. Force a failed login or blocked action modal.
   4. Confirm failure modal shows `dislike_rejected_nope` without stale gif reuse from previous session.

2. Loading reason behavior
   1. Navigate to Projects, Documents, and Versions pages.
   2. Confirm loading states use `loading` reason.
   3. Confirm success dialogs use `good_job` reason.

3. Selected card visibility
   1. Select a version card and an issue card.
   2. Hover the selected card.
   3. Confirm selected green aura remains visible while hover styling is also visible.
