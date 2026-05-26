// Local view-model types for the Versions page. These summarize Firestore documents after normalization.
import type { FileStorageProviderKind } from '../../domain/types'

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
  authorId?: string | null
  type: string
  shortId: number | null
  baseDocId?: string | null
  baseVersionId?: string | null
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
  status: 'open' | 'closed'
  title: string
  createdBy: string
  commentCount: number
  lastCommentAt?: Date | null
}

type CommentSummary = {
  id: string
  threadId: string
  body: string
  createdBy: string
  createdAt?: Date
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

export type {
  AcceptedErrorReportSummary,
  CommentSummary,
  DashboardFocusTarget,
  DocumentSummary,
  FileRefSummary,
  PendingVersionAction,
  ProjectMember,
  ThreadSummary,
  VersionSummary,
}
