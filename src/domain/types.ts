export type Id = string;

// Roles and permissions
export type Role = 'leader' | 'member' | 'author' | 'reviewer' | 'admin';

export interface UserProfile {
  id: Id;
  email: string;
  displayName: string;
  roles: Role[];
  isAdmin: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Version states
export type VersionState =
  | 'In Creation'
  | 'In Review'
  | 'Reviewed'
  | 'Rejected'
  | 'Replaced'
  | 'Accepted';

// Version number stored as integer count of hundredths (e.g. 1.00 -> 100, 0.01 -> 1)
export type VersionNumber = number;

export const FIRST_VERSION_NUMBER: VersionNumber = 1; // 0.01

export const isIntegerVersionNumber = (n: VersionNumber): boolean =>
  n % 100 === 0;

export const versionNumberToString = (n: VersionNumber): string => {
  const integerPart = Math.floor( n / 100 );
  const fraction = n % 100;
  return `${integerPart}.${fraction.toString().padStart( 2, '0' )}`;
};

export const assertValidStateForVersionNumber = (
  n: VersionNumber,
  state: VersionState
): void => {
  const isInteger = isIntegerVersionNumber( n );
  if( isInteger ) {
    if( state !== 'Accepted' && state !== 'Replaced' ) {
      throw new Error(
        `Invalid state '${state}' for integer version ${versionNumberToString(
          n
        )}`
      );
    }
  } else {
    if( state === 'Accepted' || state === 'Replaced' ) {
      throw new Error(
        `Invalid state '${state}' for non-integer version ${versionNumberToString(
          n
        )}`
      );
    }
  }
};

export interface Project {
  id: Id;
  name: string;
  isActive: boolean;
  leaderId: Id;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  id: Id;
  projectId: Id;
  userId: Id;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  id: Id;
  projectId: Id;
  title: string;
  createdBy: Id;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersion {
  id: Id;
  documentId: Id;
  versionNumber: VersionNumber;
  state: VersionState;
  createdBy: Id;
  reviewerIds: Id[];
  reviewStartAt: string | null;
  reviewEndAt: string | null;
  createdAt: string;
  updatedAt: string;
  fileRefId: Id | null;
  hasFile: boolean;
  acceptedErrorReportId: Id | null;
}

export interface Thread {
  id: Id;
  versionId: Id;
  title: string;
  isOpen: boolean;
  createdBy: Id;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedBy: Id | null;
  reopenedAt: string | null;
  reopenedBy: Id | null;
}

export interface Comment {
  id: Id;
  threadId: Id;
  authorId: Id;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeRequest {
  id: Id;
  projectId: Id;
  baseDocumentId: Id;
  createdBy: Id;
  createdAt: string;
  updatedAt: string;
  status: VersionState;
  fileRefId: Id | null;
  hasFile: boolean;
}

export interface ErrorReport {
  id: Id;
  projectId: Id;
  baseDocumentId: Id;
  createdBy: Id;
  createdAt: string;
  updatedAt: string;
  status: VersionState;
  fileRefId: Id | null;
  hasFile: boolean;
}

export interface TestProcedure {
  id: Id;
  projectId: Id;
  baseDocumentId: Id;
  createdBy: Id;
  createdAt: string;
  updatedAt: string;
  status: VersionState;
  fileRefId: Id | null;
  hasFile: boolean;
}

export interface TestLog {
  id: Id;
  projectId: Id;
  baseDocumentId: Id;
  createdBy: Id;
  createdAt: string;
  updatedAt: string;
  status: VersionState;
  fileRefId: Id | null;
  hasFile: boolean;
}

export interface TestDesign {
  id: Id;
  projectId: Id;
  baseDocumentId: Id;
  createdBy: Id;
  createdAt: string;
  updatedAt: string;
  status: VersionState;
  fileRefId: Id | null;
  hasFile: boolean;
}

export interface TestCase {
  id: Id;
  projectId: Id;
  baseDocumentId: Id;
  procedureId: Id | null;
  createdBy: Id;
  createdAt: string;
  updatedAt: string;
  status: VersionState;
  fileRefId: Id | null;
  hasFile: boolean;
}

export interface FileRef {
  id: Id;
  fileKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isPermanent: boolean;
  expireAfterDays: number | null;
  storageProvider: 'files-api';
  createdAt: string;
  createdBy: Id;
  updatedAt: string;
  updatedBy: Id;
}

export const versionStateLabels: Record<VersionState, string> = {
  'In Creation': 'In Creation',
  'In Review': 'In Review',
  Reviewed: 'Reviewed',
  Rejected: 'Rejected',
  Replaced: 'Replaced',
  Accepted: 'Accepted'
};
