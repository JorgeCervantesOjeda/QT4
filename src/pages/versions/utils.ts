// Pure helpers for timestamp normalization, issue statistics, labels, and Firestore error classification.
import type { FileStorageProviderKind } from "../../domain/types";
import { formatApproxCountdown } from "../../lib/reviewWindow";
import { formatTimestamp } from "../../lib/time";
import type {
  CommentSummary,
  DashboardFocusTarget,
  ProjectMember,
  ThreadSummary,
  VersionSummary,
} from "./types";

const DOWNLOAD_SLOW_NOTICE_MS = 5000;
const DOWNLOAD_TIMEOUT_MS = 25000;
const ISSUE_TITLE_MAX_LENGTH = 120;

const toTimestampDate = (value: unknown): Date | null => {
  if (!value) {
    return null;
  }
  if (
    typeof value === "object" &&
    value &&
    "toDate" in value &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  return null;
};

const hasLinkedFileMetadata = (
  version: Pick<VersionSummary, "hasFile" | "fileRefId"> | null | undefined,
) => Boolean(version?.hasFile && version.fileRefId);

const assertValidFileMetadataLink = (value: {
  projectId: string;
  docId: string;
  versionId: string;
  fileRefId?: string;
}) => {
  if (!value.projectId || !value.docId || !value.versionId) {
    const fileRefLabel = value.fileRefId
      ? ` for fileRefId ${value.fileRefId}`
      : "";
    throw new Error(
      `Invalid linked file metadata${fileRefLabel}: projectId, docId, and versionId are required.`,
    );
  }
};

const isPermissionDeniedError = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const code =
    "code" in value ? String((value as { code?: unknown }).code ?? "") : "";
  const message = value instanceof Error ? value.message.toLowerCase() : "";
  return (
    code.includes("permission-denied") ||
    message.includes("permission-denied") ||
    message.includes("missing or insufficient permissions")
  );
};

const normalizeIssueTitleInput = (value: string) =>
  value.replace(/\s+/g, " ").slice(0, ISSUE_TITLE_MAX_LENGTH);

const formatStorageProviderLabel = (
  provider: FileStorageProviderKind | null,
): string => {
  if (provider === "firebase-storage") {
    return "Firebase Storage";
  }
  if (provider === "files-api") {
    return "Files API";
  }
  return "Unknown";
};

const formatReviewPeriodLabel = (
  version: Pick<VersionSummary, "reviewEndAt">,
  clockNowMs: number,
) => {
  if (!version.reviewEndAt) {
    return "No expiration";
  }
  const remainingMs = version.reviewEndAt.getTime() - clockNowMs;
  if (remainingMs <= 0) {
    return `Ended (${formatTimestamp(version.reviewEndAt)})`;
  }
  return `${formatApproxCountdown(remainingMs)} (${formatTimestamp(version.reviewEndAt)})`;
};

const parseDashboardFocusTarget = (
  value: string | null,
): DashboardFocusTarget | null => {
  if (
    value === "actions" ||
    value === "file" ||
    value === "issues" ||
    value === "comments"
  ) {
    return value;
  }
  return null;
};

const buildCommentAnchorId = (commentId: string) => `qt4-comment-${commentId}`;
const toDateMs = (value?: Date | null): number | null =>
  value ? value.getTime() : null;

const areStringArraysEqual = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
};

const areVersionsEqual = (left: VersionSummary[], right: VersionSummary[]) => {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.id !== b.id ||
      a.number !== b.number ||
      a.status !== b.status ||
      a.createdBy !== b.createdBy ||
      toDateMs(a.createdAt) !== toDateMs(b.createdAt) ||
      toDateMs(a.activityAt) !== toDateMs(b.activityAt) ||
      !areStringArraysEqual(a.reviewerIds, b.reviewerIds) ||
      toDateMs(a.reviewStartAt) !== toDateMs(b.reviewStartAt) ||
      toDateMs(a.reviewEndAt) !== toDateMs(b.reviewEndAt) ||
      a.hasFile !== b.hasFile ||
      a.fileRefId !== b.fileRefId ||
      a.numThreads !== b.numThreads ||
      a.numOpenThreads !== b.numOpenThreads ||
      a.numComments !== b.numComments ||
      a.numThreadsWithTwoPlusComments !== b.numThreadsWithTwoPlusComments ||
      a.acceptedErrorReportId !== b.acceptedErrorReportId
    ) {
      return false;
    }
  }
  return true;
};

const areProjectMembersEqual = (
  left: ProjectMember[],
  right: ProjectMember[],
) => {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.userId !== b.userId ||
      a.role !== b.role ||
      (a.email ?? null) !== (b.email ?? null)
    ) {
      return false;
    }
  }
  return true;
};

const areThreadsEqual = (left: ThreadSummary[], right: ThreadSummary[]) => {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.id !== b.id ||
      a.status !== b.status ||
      a.title !== b.title ||
      a.createdBy !== b.createdBy ||
      a.commentCount !== b.commentCount ||
      toDateMs(a.lastCommentAt) !== toDateMs(b.lastCommentAt)
    ) {
      return false;
    }
  }
  return true;
};

const areCommentsByThreadEqual = (
  left: Record<string, CommentSummary[]>,
  right: Record<string, CommentSummary[]>,
) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    const leftComments = left[key] ?? [];
    const rightComments = right[key] ?? [];
    if (leftComments.length !== rightComments.length) {
      return false;
    }
    for (let index = 0; index < leftComments.length; index += 1) {
      const a = leftComments[index];
      const b = rightComments[index];
      if (
        a.id !== b.id ||
        a.threadId !== b.threadId ||
        a.body !== b.body ||
        a.createdBy !== b.createdBy ||
        toDateMs(a.createdAt) !== toDateMs(b.createdAt)
      ) {
        return false;
      }
    }
  }
  return true;
};

const getThreadStatsFromLoadedData = (
  threads: ThreadSummary[],
  commentsByThread: Record<string, CommentSummary[]>,
) => {
  const numThreads = threads.length;
  const numOpenThreads = threads.filter(
    (thread) => thread.status === "open",
  ).length;
  const numComments = Object.values(commentsByThread).reduce(
    (total, threadComments) => total + threadComments.length,
    0,
  );
  const numThreadsWithTwoPlusComments = threads.reduce((total, thread) => {
    const loadedCommentsCount = commentsByThread[thread.id]?.length ?? 0;
    const commentCount = Math.max(
      Number(thread.commentCount ?? 0),
      loadedCommentsCount,
    );
    return total + (commentCount >= 2 ? 1 : 0);
  }, 0);
  return {
    numThreads,
    numOpenThreads,
    numComments,
    numThreadsWithTwoPlusComments,
  };
};

const buildThreadStatsMismatchMessage = (
  version: Pick<
    VersionSummary,
    | "numThreads"
    | "numOpenThreads"
    | "numComments"
    | "numThreadsWithTwoPlusComments"
  >,
  actual: ReturnType<typeof getThreadStatsFromLoadedData>,
) => {
  const mismatches: string[] = [];
  if (version.numThreads !== actual.numThreads) {
    mismatches.push(
      `numThreads stored=${version.numThreads}, actual=${actual.numThreads}`,
    );
  }
  if (version.numOpenThreads !== actual.numOpenThreads) {
    mismatches.push(
      `numOpenThreads stored=${version.numOpenThreads}, actual=${actual.numOpenThreads}`,
    );
  }
  if (version.numComments !== actual.numComments) {
    mismatches.push(
      `numComments stored=${version.numComments}, actual=${actual.numComments}`,
    );
  }
  if (
    version.numThreadsWithTwoPlusComments !==
    actual.numThreadsWithTwoPlusComments
  ) {
    mismatches.push(
      `numThreadsWithTwoPlusComments stored=${version.numThreadsWithTwoPlusComments}, actual=${actual.numThreadsWithTwoPlusComments}`,
    );
  }
  return mismatches.length > 0 ? mismatches.join("; ") : "";
};

const areUserDirectoryEqual = (
  left: Record<string, { email?: string | null; displayName?: string | null }>,
  right: Record<string, { email?: string | null; displayName?: string | null }>,
) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    const leftEntry = left[key] ?? {};
    const rightEntry = right[key] ?? {};
    if (
      (leftEntry.email ?? null) !== (rightEntry.email ?? null) ||
      (leftEntry.displayName ?? null) !== (rightEntry.displayName ?? null)
    ) {
      return false;
    }
  }
  return true;
};

const formatEmailRecipientsLine = (recipients: {
  to: string[];
  cc: string[];
}) => {
  const toPart = `To: ${recipients.to.join(", ")}`;
  const ccPart =
    recipients.cc.length > 0 ? ` | Cc: ${recipients.cc.join(", ")}` : "";
  return `${toPart}${ccPart}`;
};

const formatFileSize = (sizeBytes: number) => {
  if (!Number.isFinite(sizeBytes)) {
    return "Unknown size";
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
};

const isOfflineFirestoreError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const loweredMessage = message.toLowerCase();
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "").toLowerCase()
      : "";
  return (
    loweredMessage.includes("client is offline") ||
    loweredMessage.includes(
      "failed to get document because the client is offline",
    ) ||
    loweredMessage.includes("offline") ||
    code.includes("unavailable") ||
    code.includes("deadline-exceeded")
  );
};

const isIndexBuildingFirestoreError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const loweredMessage = message.toLowerCase();
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "").toLowerCase()
      : "";
  return (
    loweredMessage.includes("requires an index") ||
    loweredMessage.includes("the query requires an index") ||
    loweredMessage.includes("index is currently building") ||
    code.includes("failed-precondition")
  );
};

export {
  DOWNLOAD_SLOW_NOTICE_MS,
  DOWNLOAD_TIMEOUT_MS,
  ISSUE_TITLE_MAX_LENGTH,
  areCommentsByThreadEqual,
  areProjectMembersEqual,
  areStringArraysEqual,
  areThreadsEqual,
  areUserDirectoryEqual,
  areVersionsEqual,
  assertValidFileMetadataLink,
  buildCommentAnchorId,
  buildThreadStatsMismatchMessage,
  formatEmailRecipientsLine,
  formatFileSize,
  formatReviewPeriodLabel,
  formatStorageProviderLabel,
  getThreadStatsFromLoadedData,
  hasLinkedFileMetadata,
  isIndexBuildingFirestoreError,
  isOfflineFirestoreError,
  isPermissionDeniedError,
  normalizeIssueTitleInput,
  parseDashboardFocusTarget,
  toTimestampDate,
};
