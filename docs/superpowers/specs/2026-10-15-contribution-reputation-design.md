# QT4 Contribution Reputation Design

## Status

Approved design for implementation on 2026-10-15. Appeals are explicitly out of scope until separately authorized.

## Goal

Recognize valuable QT4 collaboration with server-derived contribution points, explainable badges, and project-scoped leaderboards without turning the first release into a global competition or an ELO system.

## Evidence and assumptions

- QT4 already stores projects, project membership, documents, versions, review threads, comments, comment reactions, and version states in Firestore.
- QT4 already has authenticated users, project-scoped permissions, Firestore rules, Cloud Functions, a Dashboard, an Account page, and project/document pages.
- The existing user interface is English. New UI copy will use English for consistency unless a later product decision requests localization.
- The product goal is to reward verified contribution and usefulness, not volume, speed alone, file size, or login frequency.
- Appeals, disputes, penalties, moderation queues, and public negative reputation are excluded from this release.

## Product model

### Reputation dimensions

Each project member can have three visible dimensions:

- `collaborationPoints`: issues, comments, and helpful reactions received.
- `reviewPoints`: completed review assignments.
- `qualityPoints`: accepted versions and accepted error reports.

`totalPoints` is the sum of these dimensions. Points are recognition only; they do not grant permissions, change roles, or replace administrative decisions.

### Initial point rules

The first implementation uses bounded, idempotent events:

| Event | Recipient | Category | Points |
| --- | --- | --- | ---: |
| Thread created | Thread creator | collaboration | 1 |
| Comment created | Comment author | collaboration | 1 |
| `good` reaction received | Comment author | collaboration | 2 |
| Review moves from `In Review` to `Reviewed` or `Accepted` | Each assigned reviewer | review | 4 |
| Non-error-report version becomes `Accepted` | Version creator | quality | 5 |
| Error-report version becomes `Accepted` | Version creator | quality | 6 |

Reaction events are reversible when the same reaction changes from `good` to another value. The stable source event prevents duplicate points when Firestore retries a trigger.

No points are assigned for logins, downloads, raw upload size, project creation, member addition, or arbitrary audit-log entries.

### Badge rules

Badges are project-scoped and derived from counters in the project summary:

- `first-contribution`: at least one recognized event.
- `issue-spotter`: at least three created review threads.
- `helpful-collaborator`: at least three `good` reactions received.
- `reliable-reviewer`: at least three completed review assignments.
- `quality-builder`: at least one accepted version.
- `consistent-contributor`: at least ten recognized contribution events.

Badge criteria and labels are visible in the UI. Badges are not hidden rewards.

## Firestore model

### `reputationEvents/{eventId}`

Server-only immutable event ledger, except for controlled server updates needed to reverse a reaction delta.

Required fields:

- `eventId`
- `projectId`
- `userId`
- `sourceType`
- `sourceId`
- `category`
- `points`
- `reason`
- `createdAt`
- `updatedAt`

Optional context fields include `docId`, `versionId`, `threadId`, `commentId`, and `actorId`.

### `reputationSummaries/{projectId_userId}`

Project-scoped materialized summary used by the UI.

Required fields:

- `projectId`
- `userId`
- `totalPoints`
- `collaborationPoints`
- `reviewPoints`
- `qualityPoints`
- `contributionCount`
- `threadCount`
- `commentCount`
- `goodReactionCount`
- `completedReviewCount`
- `acceptedVersionCount`
- `badgeIds`
- `updatedAt`

The deterministic document ID prevents duplicate summaries for the same project and user.

## Trusted computation

Cloud Functions will derive reputation from domain collections rather than from `auditLogs`. The current audit-log rules allow authenticated users to create records with arbitrary action names, so audit logs are not a trustworthy point source.

Trigger coverage:

- thread creation;
- comment creation;
- comment reaction creation/update;
- version review completion;
- accepted version transitions.

Every trigger must be idempotent and write the event ledger plus summary update in a transaction.

## UI design

### Dashboard

Add a `My contribution` card with total points, current badge, three dimension values, and a link to the personal contribution page. Include loading, empty, error, and processing states.

### Account

Extend `/account` with:

- contribution summary;
- dimension cards;
- earned and in-progress badges;
- project memberships with project points;
- contribution history with source links.

### Project contribution

Add `/projects/:projectId/contribution`.

The page contains:

- project identity and current period;
- top contributors;
- complete member leaderboard;
- points split by dimension;
- badges;
- a visible `How points are calculated` explanation.

The leaderboard is limited to the current project. There is no global leaderboard.

### Contextual feedback

After a recognized action, show a condition-based inline status such as `Contribution recorded`, `Calculating contribution`, or `The action completed, but contribution data is temporarily unavailable`. No status disappears only because a timer elapsed.

## Security and privacy

- Clients can read their own summaries and summaries for projects where they are members.
- Clients cannot create or modify reputation events or summaries.
- Administrators can read the data for diagnostics.
- Reputation does not affect Firestore permissions.
- No appeals UI or appeal data model is included.

## Acceptance criteria

1. A comment or thread creates at most one corresponding contribution event after retries.
2. A `good` reaction awards points to the comment author, not the reactor, and changing the reaction reverses the previous contribution delta.
3. Completing a review awards points once per reviewer and version.
4. Accepted versions award the correct quality category.
5. Summary counters and badges are updated transactionally.
6. Non-members cannot read a project's leaderboard.
7. The personal contribution page renders loading, empty, error, and populated states.
8. The project leaderboard renders only the selected project's members.
9. The UI contains no appeals controls or appeal states.
10. Unit, integration/rules, and system-level tests cover the linked contribution flows.

## Risks and limits

- The point values are a starting policy, not an empirically calibrated measure of user value.
- Existing historical activity will not automatically receive points unless a separate backfill is authorized.
- The first release does not detect collusion beyond basic self-reaction and duplicate-event protections.
- The first release does not include global ranking, ELO, penalties, appeals, or localization.
