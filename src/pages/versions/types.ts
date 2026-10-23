// src/pages/versions/types.ts: View-model types for normalized version and issue documents.
import type { FileStorageProviderKind } from '../../domain/types'
import type { PropagatedErrorReportFailure } from '../../lib/propagatedErrorReports'

type VersionSummary = {
  id: string
  number: number
  status: string
  createdBy: string
  createdAt?: Date | null
  activityAt?: Date | null
  reviewerIds: string[]
  reviewStartAt?: Date | null
  reviewEndAt?: Date | null
  reviewDurationDays: number
  hasFile: boolean
  fileRefId: string | null
  numThreads: number
  numOpenThreads: number
  numComments: number
  numThreadsWithTwoPlusComments: number
  acceptedErrorReportId: string | null
}

type DocumentSummary = {
  id: string
  projectId: string
  title: string
  createdBy: string
  type: string
  shortId: number | null
  baseProjectId?: string | null
  baseDocId?: string | null
  baseVersionId?: string | null
  originProjectId?: string | null
  originDocumentId?: string | null
  originVersionId?: string | null
  incorporatedChangeRequestVersionIds?: string[]
}

type BaseDocumentSummary = {
  id: string
  projectId: string
  projectShortId: number | null
  title: string
  shortId: number | null
  versionId: string | null
  versionNumber: number | null
  versionStatus: string | null
  hasFile: boolean
  fileRefId: string | null
}

type ProjectMember = {
  userId: string
  role: string
  email?: string | null
}

type FileRefSummary = {
  id: string
  fileKey: string
  fileName: string
  contentType: string
  sizeBytes: number
  isPermanent: boolean
  expireAfterDays: number | null
  storageProvider: FileStorageProviderKind
  createdBy: string
  projectId: string
  docId: string
  versionId: string
}

type ThreadSummary = {
  id: string
  issueNumber?: number
  status: 'open' | 'closed'
  title: string
  createdBy: string
  commentCount: number
  lastCommentAt?: Date | null
  createdAt?: Date | null
  updatedAt?: Date | null
}

type CommentSummary = {
  id: string
  threadId: string
  body: string
  createdBy: string
  isInitialIssueComment?: boolean
  createdAt?: Date
}

type CommentReactionKind = 'good' | 'regular' | 'bad'

type CommentReactionCounts = Record<CommentReactionKind, number>

type CommentReactionState = {
  counts: CommentReactionCounts
  currentUserReaction: CommentReactionKind | null
}

type AcceptedErrorReportSummary = {
  docId: string
  title: string
  shortId: number | null
  latestVersionId: string
  latestVersionNumber: number
  acceptedAt?: Date | null
}

type PendingVersionAction = 'createVersion' | 'startReview' | 'replaceFile'
type DashboardFocusTarget = 'actions' | 'file' | 'issues' | 'comments'
type PropagationFailurePrompt = {
  projectId: string
  docId: string
  versionId: string
  message: string
  failures: PropagatedErrorReportFailure[]
}

export type {
  AcceptedErrorReportSummary,
  BaseDocumentSummary,
  CommentReactionCounts,
  CommentReactionKind,
  CommentReactionState,
  CommentSummary,
  DashboardFocusTarget,
  DocumentSummary,
  FileRefSummary,
  PendingVersionAction,
  ProjectMember,
  PropagationFailurePrompt,
  ThreadSummary,
  VersionSummary,
}
