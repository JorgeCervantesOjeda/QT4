# QT4 Sequenced Reputation Points

## Status

Approved for implementation on 2026-10-16. This document records the approved direction for the next reputation-policy change; it is not yet implemented.

## Evidence and current behavior

- `functions/reputation.js` currently assigns fixed point values through `POINT_RULES`.
- `functions/reputation.js` currently limits review participation to two points per issue and version through `REVIEW_PARTICIPATION_CAP`.
- `src/lib/reputation.ts` exposes the same fixed values to the client contract.
- The current server ledger and summary documents are project-scoped and idempotent by event identity.

## Goal

Replace fixed positive reputation values with one cumulative diminishing sequence per project, user, and positive activity family:

`1, 2, 5, 10, 20, 50, 100, 200, 500, ...`

The sequence values are interval boundaries. The points awarded at a position are one point divided by the number of positions in the interval containing that position.

## Approved policy

### Interval rule

For a one-based activity position `n`, find the next boundary in the sequence and the previous boundary. The interval contains every integer from the previous boundary plus one through the next boundary, except that positions 1 and 2 each form a one-position interval.

| Activity position | Points awarded |
|---|---:|
| 1 | 1 |
| 2 | 1 |
| 3–5 | 1/3 |
| 6–10 | 1/5 |
| 11–20 | 1/10 |
| 21–50 | 1/30 |
| 51–100 | 1/50 |
| 101–200 | 1/100 |
| 201–500 | 1/300 |

The pattern continues by multiplying the boundary templates `1, 2, 5` by successive powers of ten. Every completed interval distributes exactly one point among its positions.

### No reset and no issue cap

- There is no reset of a sequence during the lifetime of a project.
- There is no maximum number of points that one issue can generate.
- Every qualifying participation block advances the review-participation sequence, including additional blocks in the same issue.
- The existing server rule that consecutive comments by the same user form one participation block remains in force. This is grouping duplicate consecutive activity, not a points cap.
- The automatic initial issue comment remains excluded because issue creation already records the first participation block.

### Sequence scope

The same interval rule is used independently for each positive activity family. The counters are cumulative, not reset:

| Sequence family | Events that advance it |
|---|---|
| `reviewParticipation` | Issue creation and later non-consecutive comment blocks |
| `goodReaction` | A good reaction received on the user's comment |
| `acceptedDocument` | A version that changes to `Accepted`, including an accepted error-report version |

Therefore, the first accepted document in a project gives `+1`, the second gives `+1`, and the third through fifth give `+1/3`, regardless of the user's issue activity. This separate counter interpretation is an explicit design assumption derived from the requirement “primer documento aceptado”.

Review completion continues to award zero points and only advances the completed-review counter. Assigned-review absence remains a fixed `-1` event. The accepted-error-report penalty remains a fixed `-2` event. The diminishing sequence applies to positive rewards, not penalties.

## Server data contract

Positive sequenced events add:

- `sequenceKey`: the activity-family identifier;
- `sequenceNumber`: the one-based position used to compute the event value;
- `sequenceIntervalStart` and `sequenceIntervalEnd`: the interval used for auditability;
- `points`: the computed numeric value retained by the existing ledger contract.

The server stores a counter document in `reputationSequenceCounters` for each project, user, and sequence family. The counter increment, event write, and summary update occur in one transaction.

Existing reputation summaries remain valid. On the first sequenced event after this change, a missing counter is initialized from the corresponding existing summary counter so historical activity advances the next position without rewriting historical points. Existing ledger events are not recalculated.

For a retried event, the existing event's `sequenceNumber` and points are reused. If a good reaction is changed away from `good`, its original positive event is reversed; if it becomes `good` again, the original sequence position is reused when available.

## Client contract and presentation

- The TypeScript policy exposes the interval calculation and the event-family mapping without pretending that the client is authoritative for persisted awards.
- Contribution history formats fractional values clearly, including values such as `+0.33`.
- Existing action modals must not claim a fixed `+1` when the final value depends on the server sequence. They show that participation was recorded and direct the user to Contributions for the finalized ledger value.
- Existing badge definitions and thresholds remain unchanged in this change; badge redesign is a separate decision.

## Migration and compatibility

- No historical points are rewritten in this release.
- New positive events use the sequenced policy.
- Existing summaries are used only to seed missing sequence counters.
- `reputationEvents` remains server-only and idempotent.
- Negative events remain visible in the history and do not silently disappear.

## Verification requirements

- Pure policy tests cover interval boundaries 1, 2, 3, 5, 6, 10, 11, 20, 21, 50, 51, 100, 101, 200, 201, and 500.
- Function tests cover cumulative sequences, no issue cap, consecutive-comment grouping, transaction idempotence, reaction reversal, and historical-counter seeding.
- Integration tests cover persisted sequence counters, event metadata, summaries, and server-only reads and writes.
- UI tests cover fractional history display and the absence of fixed `+1` claims in action modals.
- The full unit, rules, integration, lint, and production-build suites remain required before release.

## Explicit non-goals

- Appeals remain out of scope.
- This change does not redesign badge names or thresholds.
- This change does not deploy or release production.
