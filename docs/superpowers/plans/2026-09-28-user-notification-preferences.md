<!-- docs/superpowers/plans/2026-09-28-user-notification-preferences.md: Plan de implementación para preferencias de notificación de cuenta y resumen horario. -->
# User Notification Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add account-level notification preferences for immediate comment emails and hourly issue/comment digest emails.

**Architecture:** Store preferences in `userProfiles/{uid}` and centralize default resolution in shared frontend and backend helpers. Move comment recipient filtering into Cloud Functions, record per-user notification events, and send hourly digest emails from a scheduled backend job. Add an authenticated account settings page with immediate visible save feedback.

**Tech Stack:** React 19, Vite, TypeScript, Firebase Auth, Firestore, Firestore rules, Cloud Functions v2, Node.js test runner, Vitest, Firebase rules unit tests.

**Spec:** `docs/superpowers/specs/2026-09-28-user-notification-preferences-design.md`

## Global Constraints

- Default `commentEmailEnabled` is `true` for profiles without `notificationPreferences`.
- Default `hourlyActivityDigestEnabled` is `false` for profiles without `notificationPreferences`.
- Client code must not decide whether another user receives a notification email.
- Immediate comment notification recipient filtering must run in backend.
- Hourly digest must group by `userId` and closed `digestHourKey`.
- Hourly digest default time zone is `America/Mexico_City`.
- The actor that creates a comment or issue event must not receive notification for that same event.
- UI save feedback must be visible and must not disappear by timer.
- Do not change providers, create project-level preferences, or change review permissions.
- Text files must stay UTF-8 without BOM.

## Review Focus

- Missing legacy preference object: helper returns immediate email on, digest off; covered in Task 1 tests.
- Failed preference save: checkbox state returns to persisted value and an error remains visible; covered in Task 2 tests.
- Recipient opt-out: backend sends immediate comment email only to opted-in participants; covered in Task 4 tests.
- Digest idempotency: same user/hour cannot be emailed twice after retry; covered in Task 5 tests.
- Comment creation regression: adding a comment still succeeds when email backend fails; covered in Task 6 tests.

---

## File Structure

- `src/lib/notificationPreferences.ts`: frontend preference type, defaults, normalization, and Firestore update payload helpers.
- `src/lib/notificationPreferences.test.ts`: frontend helper tests.
- `src/pages/AccountSettingsPage.tsx`: authenticated account settings UI.
- `src/pages/AccountSettingsPage.test.tsx`: UI behavior tests for load, save, and failure feedback.
- `src/App.tsx`: route registration for `/account`.
- `src/components/AppBrand.tsx`: account settings entry point near the signed-in session label.
- `src/pages/RegisterPage.tsx`: initializes default preferences at account creation.
- `src/domain/types.ts`: adds `NotificationPreferences` to `UserProfile`.
- `firestore.rules`: validates safe user profile preference updates and protects backend notification event collections.
- `src/lib/firestoreNotificationPreferenceRules.test.ts`: Firestore rules tests for preferences.
- `functions/notificationPreferences.js`: backend preference defaults and normalizer.
- `functions/commentNotifications.js`: comment-created notification orchestration and event staging.
- `functions/hourlyNotificationDigest.js`: hourly digest grouping, formatting, sending, and idempotency.
- `functions/index.js`: exports `onDocumentCreated` trigger and scheduler wiring.
- `functions/commentNotifications.test.js`: backend comment notification tests.
- `functions/hourlyNotificationDigest.test.js`: backend digest tests.
- `src/pages/versions/commentNotification.ts`: remove direct participant email send or narrow it to client status only after backend migration.
- `src/pages/versions/reviewIssueActions.ts`: keep comment creation flow successful independent of backend notification delivery.
- Existing related tests: update where direct notification mocks currently assume client-side sending.

### Task 1: Preference Model and Defaults

**Files:**
- Create: `src/lib/notificationPreferences.ts`
- Create: `src/lib/notificationPreferences.test.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/pages/RegisterPage.tsx`

**Interfaces:**
- Produces: `type NotificationPreferences = { commentEmailEnabled: boolean; hourlyActivityDigestEnabled: boolean }`
- Produces: `const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences`
- Produces: `resolveNotificationPreferences(value: unknown) => NotificationPreferences`
- Produces: `buildNotificationPreferencesUpdate(preferences: NotificationPreferences) => { notificationPreferences: NotificationPreferences; updatedAt: FieldValue }`
- Consumes: Firestore `serverTimestamp` for update payloads.

- [ ] **Step 1: Write frontend preference helper tests**

Add tests in `src/lib/notificationPreferences.test.ts`:

```ts
expect(resolveNotificationPreferences(undefined)).toEqual({
  commentEmailEnabled: true,
  hourlyActivityDigestEnabled: false,
})
expect(resolveNotificationPreferences({
  commentEmailEnabled: false,
  hourlyActivityDigestEnabled: true,
})).toEqual({
  commentEmailEnabled: false,
  hourlyActivityDigestEnabled: true,
})
expect(resolveNotificationPreferences({
  commentEmailEnabled: 'no',
  hourlyActivityDigestEnabled: 'yes',
})).toEqual({
  commentEmailEnabled: true,
  hourlyActivityDigestEnabled: false,
})
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run: `npx vitest run src/lib/notificationPreferences.test.ts`

Expected: FAIL because `src/lib/notificationPreferences.ts` does not exist.

- [ ] **Step 3: Implement `src/lib/notificationPreferences.ts`**

Create the type, defaults, `resolveNotificationPreferences(value: unknown): NotificationPreferences`, and `buildNotificationPreferencesUpdate(preferences: NotificationPreferences)`.

- [ ] **Step 4: Update domain and registration defaults**

Add `notificationPreferences: NotificationPreferences` to `UserProfile` in `src/domain/types.ts`. In `src/pages/RegisterPage.tsx`, include default preferences in the `userProfiles/{uid}` `setDoc` call.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/lib/notificationPreferences.test.ts src/pages/RegisterPage.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notificationPreferences.ts src/lib/notificationPreferences.test.ts src/domain/types.ts src/pages/RegisterPage.tsx src/pages/RegisterPage.test.tsx
git commit -m "feat: add notification preference defaults"
```

### Task 2: Account Settings UI

**Files:**
- Create: `src/pages/AccountSettingsPage.tsx`
- Create: `src/pages/AccountSettingsPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/AppBrand.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `resolveNotificationPreferences(value: unknown) => NotificationPreferences`
- Consumes: `buildNotificationPreferencesUpdate(preferences: NotificationPreferences)`
- Produces: route `/account` guarded by `RequireAuth`

- [ ] **Step 1: Write UI tests**

In `src/pages/AccountSettingsPage.test.tsx`, test:

```ts
expect(await screen.findByRole('checkbox', { name: /Email me for each related comment/i })).toBeChecked()
expect(screen.getByRole('checkbox', { name: /Email me an hourly activity summary/i })).not.toBeChecked()
```

Also test that toggling a checkbox shows visible `Saving notification preferences...`, persists to `userProfiles/{uid}`, then shows `Notification preferences saved.`. Add a failure test where `updateDoc` rejects and the page shows `Notification preferences could not be saved:` without a timer.

- [ ] **Step 2: Run UI tests to verify they fail**

Run: `npx vitest run src/pages/AccountSettingsPage.test.tsx`

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Implement `AccountSettingsPage`**

Create a page that loads `userProfiles/{uid}`, resolves defaults, renders the two checkbox controls, and saves each change with visible `idle | loading | saving | saved | error` state. On save failure, restore the persisted values and keep the error visible until the next successful save or explicit user change.

- [ ] **Step 4: Wire route and navigation**

Add `/account` to `src/App.tsx` inside `RequireAuth`. Add an `Account` link or button in `AppBrand` near the session label.

- [ ] **Step 5: Add minimal CSS**

In `src/App.css`, add focused styles for the account preferences section using existing `.panel`, `.field`, `.actions`, `.muted`, and `.error` patterns.

- [ ] **Step 6: Run UI tests**

Run: `npx vitest run src/pages/AccountSettingsPage.test.tsx src/App.test.tsx src/components/AppBrand.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/AccountSettingsPage.tsx src/pages/AccountSettingsPage.test.tsx src/App.tsx src/components/AppBrand.tsx src/App.css src/App.test.tsx src/components/AppBrand.test.tsx
git commit -m "feat: add account notification settings"
```

### Task 3: Firestore Rules for Preferences and Internal Events

**Files:**
- Modify: `firestore.rules`
- Create: `src/lib/firestoreNotificationPreferenceRules.test.ts`
- Modify: `package.json` if needed to include the new rules test in `test:rules`

**Interfaces:**
- Consumes: `notificationPreferences.commentEmailEnabled` and `notificationPreferences.hourlyActivityDigestEnabled` boolean fields.
- Produces: rule coverage for `userProfiles`, `notificationEvents`, and `notificationDigests`.

- [ ] **Step 1: Write rules tests**

Add tests that:

```ts
await assertSucceeds(updateDoc(doc(selfDb, 'userProfiles', userId), {
  notificationPreferences: {
    commentEmailEnabled: false,
    hourlyActivityDigestEnabled: true,
  },
}))
await assertFails(updateDoc(doc(selfDb, 'userProfiles', userId), { isAdmin: true }))
await assertFails(setDoc(doc(selfDb, 'notificationEvents', 'event-1'), { userId }))
await assertFails(setDoc(doc(selfDb, 'notificationDigests', 'digest-1'), { userId }))
```

- [ ] **Step 2: Run rules tests to verify failure where rules are missing**

Run: `npx firebase-tools emulators:exec --only firestore "npx vitest run src/lib/firestoreNotificationPreferenceRules.test.ts"`

Expected: FAIL until rules and script selection are aligned.

- [ ] **Step 3: Update Firestore rules**

Constrain `userProfiles/{userId}` self-updates so `isAdmin` is preserved and `notificationPreferences`, when present, contains only booleans for `commentEmailEnabled` and `hourlyActivityDigestEnabled`. Add `notificationEvents/{eventId}` and `notificationDigests/{digestId}` matches with no client write access.

- [ ] **Step 4: Run rules tests**

Run: `npm run test:rules`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules src/lib/firestoreNotificationPreferenceRules.test.ts package.json
git commit -m "feat: secure notification preference rules"
```

### Task 4: Backend Immediate Comment Notifications

**Files:**
- Create: `functions/notificationPreferences.js`
- Create: `functions/commentNotifications.js`
- Create: `functions/commentNotifications.test.js`
- Modify: `functions/index.js`
- Modify: `src/pages/versions/commentNotification.ts`
- Modify: `src/pages/versions/reviewIssueActions.ts`
- Modify: related tests that mock direct comment email sending

**Interfaces:**
- Produces: `resolveNotificationPreferences(data: unknown) => { commentEmailEnabled: boolean, hourlyActivityDigestEnabled: boolean }` in backend.
- Produces: `createCommentNotificationHandler({ admin, logger, sendTextEmail, appOrigin }) => async (event) => void`
- Produces: `stageNotificationEvents({ db, admin, recipients, eventData }) => Promise<void>`
- Consumes: `sendTextEmail({ to, cc?, subject, text })`.

- [ ] **Step 1: Write backend tests for preference resolution and immediate filtering**

In `functions/commentNotifications.test.js`, test a comment with three participants:

```js
assert.deepEqual(sentEmails[0].to, ["enabled@example.com"])
assert.doesNotMatch(sentEmails[0].text, /disabled@example\.com/u)
assert.doesNotMatch(sentEmails[0].text, /actor@example\.com/u)
```

Also assert that notification events are created for related users except the actor.

- [ ] **Step 2: Run backend tests to verify they fail**

Run: `cd functions && npm test -- commentNotifications.test.js`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement backend modules**

Implement `notificationPreferences.js` with the same defaults as frontend. Implement `commentNotifications.js` to load comment, thread, version, document, participant profiles, filter immediate recipients by `commentEmailEnabled`, send one email, and stage `notificationEvents` for users with digest events.

- [ ] **Step 4: Export Firestore trigger**

In `functions/index.js`, import `onDocumentCreated` from `firebase-functions/v2/firestore` and export `sendCommentNotification = onDocumentCreated("comments/{commentId}", createCommentNotificationHandler(...))`.

- [ ] **Step 5: Remove client-side participant email authority**

Stop calling `notifyCommentParticipants` from `handleAddComment`. Keep comment creation success and warning behavior scoped to the Firestore write. If a client-visible notification status is retained, make it say notification is handled in the background, not that email was sent.

- [ ] **Step 6: Run tests**

Run:

```bash
cd functions && npm test -- commentNotifications.test.js
cd .. && npx vitest run src/pages/versions/reviewIssueActions.test.ts src/pages/versions/VersionsModals.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/notificationPreferences.js functions/commentNotifications.js functions/commentNotifications.test.js functions/index.js src/pages/versions/commentNotification.ts src/pages/versions/reviewIssueActions.ts src/pages/versions/*.test.ts src/pages/versions/*.test.tsx
git commit -m "feat: send comment notifications from backend"
```

### Task 5: Hourly Notification Digest

**Files:**
- Create: `functions/hourlyNotificationDigest.js`
- Create: `functions/hourlyNotificationDigest.test.js`
- Modify: `functions/index.js`
- Modify: `functions/.env.example`
- Modify: `firestore.indexes.json` if a required compound index is identified.

**Interfaces:**
- Produces: `buildHourlyNotificationDigest(events: NotificationEvent[], hourKey: string) => { subject: string, text: string }`
- Produces: `createHourlyNotificationDigestJob({ admin, logger, now, getTimeZone, sendTextEmail }) => async () => void`
- Consumes: `notificationEvents` staged by Task 4.

- [ ] **Step 1: Write digest formatting and idempotency tests**

In `functions/hourlyNotificationDigest.test.js`, assert:

```js
assert.equal(emails.length, 1)
assert.match(emails[0].subject, /\[QT4\] Hourly activity summary/u)
assert.match(emails[0].text, /Issue:/u)
assert.match(emails[0].text, /Comment:/u)
assert.equal(digestWrites[0].id, "user-1_2026-09-28T18")
```

Add a retry test where a sent digest doc already exists and `sendTextEmail` is not called.

- [ ] **Step 2: Run digest tests to verify they fail**

Run: `cd functions && npm test -- hourlyNotificationDigest.test.js`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement digest module**

Query `notificationEvents` with `digestStatus == "pending"` for closed hour keys, group by `userId` and `digestHourKey`, claim `notificationDigests/{userId}_{digestHourKey}` before sending, reload user profile, skip if digest preference is off, send one email per group, then mark events `sent`, `skipped`, or `failed`.

- [ ] **Step 4: Wire scheduler**

In `functions/index.js`, export `sendHourlyNotificationDigest = onSchedule({ schedule: getEnv("NOTIFICATION_DIGEST_SCHEDULE", "every hour"), timeZone: getEnv("NOTIFICATION_DIGEST_TIME_ZONE", "America/Mexico_City"), maxInstances: 1 }, createHourlyNotificationDigestJob(...))`. Add env comments to `functions/.env.example`.

- [ ] **Step 5: Run backend tests**

Run: `cd functions && npm test -- hourlyNotificationDigest.test.js commentNotifications.test.js slowUiDigest.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/hourlyNotificationDigest.js functions/hourlyNotificationDigest.test.js functions/index.js functions/.env.example firestore.indexes.json
git commit -m "feat: add hourly notification digest"
```

### Task 6: Regression and End-to-End Verification

**Files:**
- Modify: `src/test/e2e/ui-error-states.spec.ts` or add focused e2e coverage if existing fake layer supports account settings.
- Modify: fake Firestore/Auth test support only if required.
- Modify: `README.md` or runbook only if new environment variables need operator documentation.

**Interfaces:**
- Consumes: completed Tasks 1-5.
- Produces: validated implementation and documentation update.

- [ ] **Step 1: Add or update regression tests**

Pin that comment creation succeeds even when backend notification sending fails. Pin that account settings can be reached by an authenticated user and the two checkboxes render.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
npx vitest run src/lib/notificationPreferences.test.ts src/pages/AccountSettingsPage.test.tsx src/pages/versions/reviewIssueActions.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run backend tests**

Run: `cd functions && npm test`

Expected: PASS.

- [ ] **Step 4: Run rules tests**

Run: `npm run test:rules`

Expected: PASS.

- [ ] **Step 5: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Optional live validation prompt**

Offer `npm run dev:live` for local validation against production services. Before running it for any workflow that creates, updates, or deletes data, remind the user it connects to live production services.

- [ ] **Step 7: Commit**

```bash
git add README.md src/test/e2e src/test/e2e/fakes
git commit -m "test: verify notification preference flows"
```

## Final Verification

- [ ] Run `git status --short` and confirm only intentional files are changed.
- [ ] Run `npm test`.
- [ ] Run `cd functions && npm test`.
- [ ] Run `npm run test:rules`.
- [ ] Run `npm run build`.
- [ ] Report any skipped command, environment limitation, and residual risk.

