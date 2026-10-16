# QT4 Review Participation Reputation Addendum

## Status

Approved follow-up to the contribution reputation design on 2026-10-15. It supersedes the initial review and accepted-error-report values where they conflict with this document. Appeals remain out of scope.

## Goal

Reward observable review participation without rewarding reviewer assignment alone, prevent duplicate credit for an issue's automatic initial comment, identify broad review activity, and show earned recognition in existing action modals.

## Policy

- Reviewer assignments are frozen when a version enters `In Review`.
- A reviewer earns one participation point for creating an issue, including its automatic initial comment.
- A reviewer earns one participation point when starting a consecutive block of later comments in an issue, up to two participation points per issue and reviewer for that version.
- Consecutive comments by the same user remain one participation block; a comment by another user starts a new block.
- A reviewer receives no additional participation points after the per-issue cap.
- A reviewer who was assigned when review started and has no participation in the completed review receives `-1` once for that version.
- Participation is attributed to the user who creates the issue or comment, not to every assigned reviewer.
- A reviewer may create an issue recommending acceptance, but cannot accept the version by virtue of being a reviewer.
- The actor who changes a version to `Accepted` receives no decision points.
- A normal accepted version awards `+5` to its author.
- An accepted error report awards `+2` to its author.
- When an error report is accepted, the author of the affected base version receives `-2` once for that accepted report.
- A correction version accepted after an error report earns the normal accepted-version reward for its author.
- Three or more distinct issues participated in during one version review are shown as `Outstanding review activity`; this is a recognition label, not an extra point event.

## Accounting constraints

- The automatic initial comment created with an issue must not produce a second participation event.
- Participation events are idempotent by source comment or issue, consecutive comments are grouped by the server using comment order, and blocks are capped by a server-side per-thread/user counter.
- Negative events remain visible in history and are not silently discarded by clamping the total to zero.
- The server remains the source of truth for points, caps, penalties, and badges.

## UI feedback

- Existing success modals after issue creation and comment creation include the points credited by that action.
- The modal includes deterministic per-issue participation progress, for example `Review participation: 2/2 points for this issue.`
- The modal does not claim a badge unlock from client-side state; it directs the user to Contributions for the server-finalized badge state.
- Recognition text is condition-based and remains visible until the user closes the modal.
- If asynchronous summary data is not available yet, the modal reports the deterministic action credit and directs the user to Contribution history for the finalized server ledger.

## Badge updates

- `first-contribution`: at least one active recognized event.
- `issue-spotter`: create at least three issues in the project.
- `helpful-collaborator`: receive at least three good reactions.
- `reliable-reviewer`: participate in at least three completed reviews; assignment alone does not count.
- `quality-builder`: have at least one accepted version.
- `consistent-contributor`: reach at least ten active recognized events.

## Verification

- Unit tests cover per-issue caps, initial-comment deduplication, distinct-issue recognition, negative events, and badge derivation.
- Function integration tests cover retries, assigned-but-inactive reviewers, active participants, accepted error-report penalties, and accepted-version rewards.
- UI tests cover modal feedback for issue creation and later comments, per-issue cap copy, and the pending-summary fallback.
- Existing rules and system tests remain part of the regression suite.
