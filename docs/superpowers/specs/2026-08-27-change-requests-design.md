# Change Requests Design

**Goal:** Add change requests to QT4 as cross-project document derivatives, based on the legacy JSF behavior but with the new product rule that change requests cannot target a base document from the same project.

**Status:** Approved design constraint. Implementation has not started.

## Business Rule

A change request represents a client-specific or project-specific variation over a common accepted base from another project.

If the requirements changed inside the same project because the accepted requirements are no longer correct for that project, the user must create an error report instead.

Therefore:

- Change request: target project differs from base project.
- Error report: target project is the same project as the affected document.
- Same-project change requests are invalid.

## Legacy JSF Evidence

In legacy QualiTeam, change requests are implemented as normal `DOCUMENTO` records linked through `solicituddecambio`.

The legacy table stores:

- `idSolicCambio`: document id of the change request.
- `idProy`: target project where the change request is created.
- `idDoctoBase`: base document id.
- `idProyBase`: base project id.
- `versionDoctoBase`: integer base version.

The legacy flow lets the user open the change-request module, choose a base project, choose an accepted base document, then create the change request document. The legacy code does not visibly enforce `idProyBase != idProy`; QT4 must enforce that rule because it is part of the clarified business semantics.

## QT4 Model

Represent a change request as a specialized document:

```ts
type DocumentType = "document" | "errorReport" | "changeRequest";

type ChangeRequestDocument = {
  projectId: string;
  type: "changeRequest";
  baseProjectId: string;
  baseDocId: string;
  baseVersionId: string;
  title: string;
  createdBy: string;
  authorId: string;
  shortId: number;
  createdAt: unknown;
  updatedAt: unknown;
  updatedBy: string;
};
```

Create its initial version in `versions` using the existing version shape:

```ts
{
  projectId,
  docId: changeRequestDocId,
  number: 1,
  status: "In Creation",
  createdBy: userId,
  reviewerIds: [],
  reviewStartAt: null,
  reviewEndAt: null,
  hasFile: false,
  fileRefId: null,
  acceptedErrorReportId: null,
  previousVersionId: null
}
```

This keeps upload, review, comments, issue threads, acceptance, rejection, dashboard authoring tasks and audit logging on the existing document-version workflow.

## Creation Rules

The create action must check all of these before writing:

- User is signed in.
- User is a member of the target project or admin.
- Base project exists.
- Base document exists.
- Base version exists.
- Base version status is `Accepted`.
- Base version belongs to `baseDocId`.
- Base document belongs to `baseProjectId`.
- `baseProjectId !== projectId`.
- User can read the base project or is admin.
- Title is non-empty. Default title may be `Change request - {base document title}`.

When `baseProjectId === projectId`, the UI must block creation with:

> For changes to accepted requirements inside this same project, create an error report instead.

## User Flow

From the target project, the user opens a change-request area and selects a base from another project.

Recommended flow:

1. On the project documents page, expose an entry point for change requests.
2. Show existing change requests for the active target project.
3. Provide a create action for members and admins.
4. In the create dialog or page, list only base projects different from the target project.
5. After a base project is selected, list only accepted base document versions from that project.
6. On confirmation, create a `documents` record with `type: "changeRequest"` and create its initial `versions` record.
7. Navigate to the existing versions page for the created change-request document.

The versions page must label the document as `Change request` and show its base project/document context.

## Relationship To Error Reports

Error reports remain the mechanism that unlocks the next version of a same-project accepted document.

Change requests should not replace the accepted-error-report gate for same-project corrections. A change request may have its own review lifecycle, but it should not satisfy the same-project error-report rule because same-project change requests are invalid.

If a future workflow needs to create a target-project document version from an accepted cross-project change request, that should be designed as a separate promotion rule. It is not part of this first implementation.

## Firestore Rules

Firestore rules should explicitly validate document types instead of allowing arbitrary strings.

For `type == "changeRequest"`, creation should require:

- `request.resource.data.baseProjectId is string`.
- `request.resource.data.baseProjectId != request.resource.data.projectId`.
- `request.resource.data.baseDocId is string`.
- `request.resource.data.baseVersionId is string`.
- `get(/databases/$(database)/documents/documents/$(baseDocId)).data.projectId == baseProjectId`.
- `get(/databases/$(database)/documents/versions/$(baseVersionId)).data.docId == baseDocId`.
- `get(/databases/$(database)/documents/versions/$(baseVersionId)).data.status == "Accepted"`.
- requester is member of the target project or admin.
- requester is member of the base project or admin.

For `type == "errorReport"`, same-project linkage should remain allowed and should continue to require an accepted base version.

## Migration

The legacy migrator currently emits legacy documents as `type: "document"`. It should classify rows from `solicituddecambio` as `type: "changeRequest"` and populate:

- `baseProjectId`
- `baseDocId`
- `baseVersionId`

If legacy data contains same-project change requests, migration should not silently import them as valid change requests. It should either:

- mark them with a migration warning and leave them as ordinary documents, or
- import them as blocked legacy records requiring manual classification.

The selected behavior must be logged with project id, document id, base project id, base document id and impact.

## Test Basis

Correct behavior is observable when:

- A member can create a change request from an accepted base version in another readable project.
- The created change request appears in the target project with base project/document context.
- The created change request opens in the existing versions page with version `0.01` in `In Creation`.
- Same-project base selection is unavailable in the UI.
- Same-project creation is rejected by Firestore rules if attempted directly.
- A same-project requirement correction still uses the existing error-report flow.

## Verification Strategy

Use proportional checks because this crosses persistence, permissions and user navigation:

- Unit tests for change-request payload construction and same-project validation.
- Firestore rules tests for cross-project allowed creation and same-project denial.
- UI or end-to-end test mirroring the existing error-report flow.
- Migration test for classifying `solicituddecambio` rows and logging same-project legacy exceptions.

Passing these checks supports the implemented cases only; it does not prove every historical legacy record is semantically correct. Same-project legacy rows remain a data-quality risk until inspected.
