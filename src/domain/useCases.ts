// src/domain/useCases.ts
import type {
  Id,
  Role,
  VersionState,
  VersionNumber,
  Document,
  DocumentVersion,
  Thread,
  Comment,
  FileRef
} from './types';
import {
  FIRST_VERSION_NUMBER,
  isIntegerVersionNumber,
  assertValidStateForVersionNumber
} from './types';

// Tipos base de resultado
export interface UseCaseResult<T> {
  ok: boolean;
  error: string | null;
  data: T | null;
}

// Auth
export interface LoginInput {
  email: string;
  password: string;
}
export interface LoginOutput {
  userId: Id;
  token: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}
export interface RegisterOutput {
  userId: Id;
}

// Projects
export interface CreateProjectInput {
  name: string;
}
export interface CreateProjectOutput {
  projectId: Id;
}

export interface UpdateProjectInput {
  projectId: Id;
  name: string;
}
export interface UpdateProjectOutput {
  projectId: Id;
}

// Documents
export interface CreateDocumentInput {
  projectId: Id;
  title: string;
}
export interface CreateDocumentOutput {
  documentId: Id;
}

export interface CreateNextVersionInput {
  documentId: Id;
  previousVersionId: Id;
}
export interface CreateNextVersionOutput {
  versionId: Id;
  versionNumber: number;
  state: VersionState;
}

export interface StartReviewInput {
  versionId: Id;
  reviewerIds: Id[];
  reviewStartAt: string | null;
  reviewEndAt: string | null;
}
export interface StartReviewOutput {
  versionId: Id;
  state: VersionState;
}

export interface UpdateVersionPropertiesInput {
  versionId: Id;
  title: string;
  reviewerIds: Id[];
}
export interface UpdateVersionPropertiesOutput {
  versionId: Id;
}

export interface AcceptVersionInput {
  versionId: Id;
  acceptedBy: Id;
}
export interface AcceptVersionOutput {
  versionId: Id;
  state: VersionState;
}

export interface RejectVersionInput {
  versionId: Id;
  rejectedBy: Id;
  reason: string;
}
export interface RejectVersionOutput {
  versionId: Id;
  state: VersionState;
}

// Archivos (API dedicada)
export interface UploadFileInput {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isPermanent: boolean;
  expireAfterDays: number | null;
  fileKey: string;
}
export interface UploadFileOutput {
  file: FileRef;
}

export interface LinkFileToVersionInput {
  versionId: Id;
  fileRefId: Id;
}
export interface LinkFileToVersionOutput {
  versionId: Id;
  hasFile: boolean;
}

// Comments and threads
export interface CreateThreadInput {
  versionId: Id;
  title: string;
}
export interface CreateThreadOutput {
  threadId: Id;
}

export interface AddCommentInput {
  threadId: Id;
  body: string;
}
export interface AddCommentOutput {
  commentId: Id;
}

export interface CloseThreadInput {
  threadId: Id;
}
export interface CloseThreadOutput {
  threadId: Id;
  isOpen: boolean;
}

export interface ReopenThreadInput {
  threadId: Id;
}
export interface ReopenThreadOutput {
  threadId: Id;
  isOpen: boolean;
}

// Change requests / error reports / tests
export interface CreateChangeRequestInput {
  projectId: Id;
  baseDocumentId: Id;
}
export interface CreateChangeRequestOutput {
  changeRequestId: Id;
}

export interface CreateErrorReportInput {
  projectId: Id;
  baseDocumentId: Id;
}
export interface CreateErrorReportOutput {
  errorReportId: Id;
}

export interface CreateTestProcedureInput {
  projectId: Id;
  baseDocumentId: Id;
}
export interface CreateTestProcedureOutput {
  testProcedureId: Id;
}

export interface CreateTestLogInput {
  projectId: Id;
  baseDocumentId: Id;
}
export interface CreateTestLogOutput {
  testLogId: Id;
}

export interface CreateTestDesignInput {
  projectId: Id;
  baseDocumentId: Id;
}
export interface CreateTestDesignOutput {
  testDesignId: Id;
}

export interface CreateTestCaseInput {
  projectId: Id;
  baseDocumentId: Id;
  procedureId: Id | null;
}
export interface CreateTestCaseOutput {
  testCaseId: Id;
}

// Utilidades de permisos
export interface PermissionContext {
  userId: Id;
  roles: Role[];
  isAdmin: boolean;
  isLeaLeader: boolean;
  isAuthor: boolean;
  isReviewer: boolean;
  isProjectActive: boolean;
}

export interface VersionContext {
  version: DocumentVersion;
  hasFile: boolean;
  hasThreads: boolean;
  hasComments: boolean;
  allThreadsClosed: boolean;
  reviewIsActive: boolean;
  acceptedErrorReportId: Id | null;
}

export interface ThreadContext {
  thread: Thread;
  comments: Comment[];
}

// Document + versions (used in business cases)
export interface DocumentAggregate {
  document: Document;
  versions: DocumentVersion[];
}

export interface CreateFirstVersionResult {
  version: DocumentVersion;
  document: Document;
}

export interface CreateNextVersionResult {
  version: DocumentVersion;
  document: Document;
}

export interface AcceptLatestRevisionResult {
  document: Document;
  versions: DocumentVersion[];
  acceptedVersionId: Id;
  replacedVersionId: Id | null;
}

export interface RejectDocumentResult {
  document: Document;
  versions: DocumentVersion[];
  rejectedVersionId: Id;
  replacedVersionId: Id | null;
}

const getLatestVersion = (versions: DocumentVersion[]): DocumentVersion => {
  if( versions.length === 0 ) {
    throw new Error( 'No versions found' );
  }
  return versions.reduce( ( latest, current ) =>
    current.versionNumber > latest.versionNumber ? current : latest
  );
};

const getLastAcceptedIntegerVersion = (
  versions: DocumentVersion[]
): DocumentVersion | null => {
  const accepted = versions.filter(
    ( v ) => v.state === 'Accepted' && isIntegerVersionNumber( v.versionNumber )
  );
  if( accepted.length === 0 ) {
    return null;
  }
  return accepted.reduce( ( latest, current ) =>
    current.versionNumber > latest.versionNumber ? current : latest
  );
};

const nextIntegerVersionNumber = (n: VersionNumber): VersionNumber => {
  const integerPart = Math.floor( n / 100 );
  return ( integerPart + 1 ) * 100;
};

export const createFirstVersion = (
  document: Document,
  versionId: Id,
  createdBy: Id,
  now: string
): UseCaseResult<CreateFirstVersionResult> => {
  const version: DocumentVersion = {
    id: versionId,
    documentId: document.id,
    versionNumber: FIRST_VERSION_NUMBER,
    state: 'In Creation',
    createdBy,
    reviewerIds: [],
    reviewStartAt: null,
    reviewEndAt: null,
    createdAt: now,
    updatedAt: now,
    fileRefId: null,
    hasFile: false,
    acceptedErrorReportId: null
  };

  assertValidStateForVersionNumber( version.versionNumber, version.state );

  const updatedDocument: Document = {
    ...document,
    updatedAt: now
  };

  return { ok: true, error: null, data: { version, document: updatedDocument } };
};

export const createNextVersion = (
  aggregate: DocumentAggregate,
  versionId: Id,
  createdBy: Id,
  now: string
): UseCaseResult<CreateNextVersionResult> => {
  const latest = getLatestVersion( aggregate.versions );
  const nextNumber: VersionNumber = latest.versionNumber + 1;

  const version: DocumentVersion = {
    id: versionId,
    documentId: aggregate.document.id,
    versionNumber: nextNumber,
    state: 'In Creation',
    createdBy,
    reviewerIds: [],
    reviewStartAt: null,
    reviewEndAt: null,
    createdAt: now,
    updatedAt: now,
    fileRefId: null,
    hasFile: false,
    acceptedErrorReportId: null
  };

  assertValidStateForVersionNumber( version.versionNumber, version.state );

  const updatedDocument: Document = {
    ...aggregate.document,
    updatedAt: now
  };

  return { ok: true, error: null, data: { version, document: updatedDocument } };
};

export const acceptLatestRevision = (
  aggregate: DocumentAggregate,
  versionId: Id,
  now: string
): UseCaseResult<AcceptLatestRevisionResult> => {
  const latest = getLatestVersion( aggregate.versions );
  if( latest.id !== versionId ) {
    return { ok: false, error: 'Version is not latest', data: null };
  }

  const promotedNumber = nextIntegerVersionNumber( latest.versionNumber );
  const previousAccepted = getLastAcceptedIntegerVersion( aggregate.versions );

  const updatedVersions = aggregate.versions.map( ( v ) => {
    if( v.id === latest.id ) {
      const updated: DocumentVersion = {
        ...v,
        versionNumber: promotedNumber,
        state: 'Accepted',
        updatedAt: now
      };
      assertValidStateForVersionNumber( updated.versionNumber, updated.state );
      return updated;
    }
    if( previousAccepted && v.id === previousAccepted.id ) {
      const updated: DocumentVersion = {
        ...v,
        state: 'Replaced',
        updatedAt: now
      };
      assertValidStateForVersionNumber( updated.versionNumber, updated.state );
      return updated;
    }
    return v;
  } );

  const updatedDocument: Document = {
    ...aggregate.document,
    updatedAt: now
  };

  return {
    ok: true,
    error: null,
    data: {
      document: updatedDocument,
      versions: updatedVersions,
      acceptedVersionId: latest.id,
      replacedVersionId: previousAccepted ? previousAccepted.id : null
    }
  };
};

export const rejectDocument = (
  aggregate: DocumentAggregate,
  versionId: Id,
  now: string
): UseCaseResult<RejectDocumentResult> => {
  const latest = getLatestVersion( aggregate.versions );
  if( latest.id !== versionId ) {
    return { ok: false, error: 'Version is not latest', data: null };
  }

  const previousAccepted = getLastAcceptedIntegerVersion( aggregate.versions );

  const updatedVersions = aggregate.versions.map( ( v ) => {
    if( v.id === latest.id ) {
      const updated: DocumentVersion = {
        ...v,
        state: 'Rejected',
        updatedAt: now
      };
      assertValidStateForVersionNumber( updated.versionNumber, updated.state );
      return updated;
    }
    if( previousAccepted && v.id === previousAccepted.id ) {
      const updated: DocumentVersion = {
        ...v,
        state: 'Replaced',
        updatedAt: now
      };
      assertValidStateForVersionNumber( updated.versionNumber, updated.state );
      return updated;
    }
    return v;
  } );

  const updatedDocument: Document = {
    ...aggregate.document,
    updatedAt: now
  };

  return {
    ok: true,
    error: null,
    data: {
      document: updatedDocument,
      versions: updatedVersions,
      rejectedVersionId: latest.id,
      replacedVersionId: previousAccepted ? previousAccepted.id : null
    }
  };
};
