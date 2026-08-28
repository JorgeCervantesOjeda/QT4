# Change Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build cross-project change requests while blocking same-project bases and leaving same-project corrections on the error-report flow.

**Architecture:** Store each change request as a specialized `documents` record with `type: "changeRequest"` and `baseProjectId`, `baseDocId`, `baseVersionId`. Reuse the existing `versions` workflow by creating an initial version in `In Creation`, then surface the base context in project document lists and the versions page.

**Tech Stack:** React 19, TypeScript, Firebase Firestore, Firestore security rules, Vitest, Playwright fake e2e where appropriate.

**Spec:** `docs/superpowers/specs/2026-08-27-change-requests-design.md`

## Global Constraints

- No legacy change-request migration is required for this implementation.
- Same-project change requests are invalid.
- Error reports remain the same-project correction mechanism.
- New behavior must have automated regression coverage before production code.
- UI state-changing work must show immediate visible state while creating records.

---

### Task 1: Shared Change-Request Validation

**Files:**
- Create: `src/lib/changeRequests.ts`
- Create: `src/lib/changeRequests.test.ts`

**Interfaces:**
- Produces: `validateChangeRequestCreation(input): ChangeRequestCreationValidationResult`
- Produces: `buildChangeRequestTitle(baseTitle): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { buildChangeRequestTitle, validateChangeRequestCreation } from './changeRequests'

describe( 'lib/changeRequests', () => {
  it( 'rejects a same-project base with the report guidance message', () => {
    const result = validateChangeRequestCreation( {
      targetProjectId: 'project-1',
      baseProjectId: 'project-1',
      baseDocId: 'doc-1',
      baseVersionId: 'version-1',
      baseVersionStatus: 'Accepted',
      title: 'Client variation',
      userId: 'user-1',
    } )

    expect( result ).toEqual( {
      ok: false,
      message: 'For changes to accepted requirements inside this same project, create an error report instead.',
    } )
  } )

  it( 'accepts an accepted base version from another project', () => {
    const result = validateChangeRequestCreation( {
      targetProjectId: 'project-2',
      baseProjectId: 'project-1',
      baseDocId: 'doc-1',
      baseVersionId: 'version-1',
      baseVersionStatus: 'Accepted',
      title: 'Client variation',
      userId: 'user-1',
    } )

    expect( result ).toEqual( { ok: true } )
  } )

  it( 'builds the default title from the base document title', () => {
    expect( buildChangeRequestTitle( 'Core requirements' ) ).toBe( 'Change request - Core requirements' )
  } )
} )
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test -- src/lib/changeRequests.test.ts`

Expected: failure because `src/lib/changeRequests.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/changeRequests.ts` with the validation result union, a trimmed title builder, and explicit checks for signed-in user, target project, base project, base document, base version, cross-project base, accepted base status, and non-empty title.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test -- src/lib/changeRequests.test.ts`

Expected: all tests pass.

### Task 2: Project Documents Creation UI

**Files:**
- Modify: `src/pages/ProjectDocumentsPage.tsx`
- Modify: `src/pages/ProjectDocumentsPage.test.tsx`

**Interfaces:**
- Consumes: `validateChangeRequestCreation(input)`
- Consumes: `buildChangeRequestTitle(baseTitle)`
- Produces: visible "Create change request" flow that selects another project and an accepted base version.

- [ ] **Step 1: Write failing UI tests**

Add tests that render a second accessible project with an accepted document version, open the change-request dialog, verify the active project is not offered as a base project, create the request, and assert that the created document payload has `type: "changeRequest"`, `baseProjectId`, `baseDocId`, and `baseVersionId`.

- [ ] **Step 2: Run the focused page test and verify it fails**

Run: `npm run test -- src/pages/ProjectDocumentsPage.test.tsx`

Expected: failure because there is no change-request UI.

- [ ] **Step 3: Implement the UI and write path**

Add state for the create dialog, load accessible base projects from `projectMembers`, load accepted base versions for the selected different project, show creating progress by disabling the submit action and changing the button label, write the document and initial version in a transaction, log `createChangeRequest`, then navigate to the new versions page.

- [ ] **Step 4: Run the focused page test and verify it passes**

Run: `npm run test -- src/pages/ProjectDocumentsPage.test.tsx`

Expected: all page tests pass.

### Task 3: Versions Page Context

**Files:**
- Modify: `src/pages/versions/types.ts`
- Modify: `src/pages/versions/dataLoaders.ts`
- Modify: `src/pages/versions/VersionsHeader.tsx`
- Test: existing relevant versions tests or add focused unit coverage if the behavior is already isolated.

**Interfaces:**
- Consumes: `documentData.type === "changeRequest"`
- Produces: versions page labels and base context for change requests.

- [ ] **Step 1: Add failing assertion**

Extend existing versions tests or create the narrowest test that expects a change-request document to show `Change request` and base document context.

- [ ] **Step 2: Run the test and verify it fails**

Run the focused test file selected in Step 1.

Expected: failure because only error reports have special labels.

- [ ] **Step 3: Implement loader and header support**

Carry `baseProjectId` through `DocumentSummary`, validate missing base linkage for `changeRequest`, and show `Change request` in the header with base document context.

- [ ] **Step 4: Run the focused test and verify it passes**

Run the focused test file selected in Step 1.

Expected: all selected tests pass.

### Task 4: Firestore Rule Enforcement

**Files:**
- Modify: `firestore.rules`
- Test: add or extend Firestore rules verification if the repository has an existing harness; otherwise verify with static build/lint and document the missing emulator-rule harness.

**Interfaces:**
- Produces: document create validation for `type: "document"`, `type: "errorReport"`, and `type: "changeRequest"`.

- [ ] **Step 1: Add the narrowest available failing rule test**

If a rules test harness exists, add one allowed cross-project create and one denied same-project create. If no harness exists, record this limitation and rely on syntax/build verification plus app-level tests.

- [ ] **Step 2: Implement rule helpers**

Add helpers for valid document type, normal document create, error report base linkage, and change request base linkage. Require the requester to be a member/admin of both target and base projects for change requests.

- [ ] **Step 3: Run verification**

Run the available rules test command or the closest syntax/build verification available in the project.

Expected: no syntax errors and the selected verification passes.

### Task 5: Final Regression

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run focused tests**

Run: `npm run test -- src/lib/changeRequests.test.ts src/pages/ProjectDocumentsPage.test.tsx`

- [ ] **Step 2: Run static verification**

Run: `npm run lint`

- [ ] **Step 3: Run build**

Run: `npm run build`

- [ ] **Step 4: Review diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only intended files changed.
