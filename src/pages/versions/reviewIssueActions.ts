// src/pages/versions/reviewIssueActions.ts
// Creates handlers for review issues, comments, and issue status transitions.
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { logAudit } from "../../lib/audit";
import { db } from "../../lib/firebase";
import { canAddCommentInWindow } from "../../lib/reviewWindow";
import { notifyCommentParticipants } from "./commentNotification";
import {
  THREAD_STATUS_CONFLICT_MESSAGE,
  isExpectedThreadStatusConflictError,
} from "../../lib/versionStatusConflict";
import {
  buildThreadStatsMismatchMessage,
  getThreadStatsFromLoadedData,
  normalizeIssueTitleInput,
  toTimestampDate,
} from "./utils";
import type {
  CommentSummary,
  DocumentSummary,
  ThreadSummary,
  VersionSummary,
} from "./types";

type ReportVersionsError = (
  error: unknown,
  action: string,
  source?: "firestore" | "storage" | "auth" | "ui" | "network" | "unknown",
  overrides?: { versionId?: string | null; threadId?: string | null },
) => void;

type ReviewIssueActionParams = {
  canAddComment: boolean;
  canCreateThread: boolean;
  canParticipateReview: boolean;
  commentsByThread: Record<string, CommentSummary[]>;
  currentDocumentAuthorId: string;
  docId?: string;
  documentData: DocumentSummary | null;
  formatUserLabel: (memberUserId: string) => string;
  newCommentBody: string;
  newThreadTitle: string;
  projectId: string;
  reloadAndRestoreSelection: (
    versionId: string | null,
    threadId?: string | null,
  ) => Promise<void>;
  reportVersionsError: ReportVersionsError;
  resolveUserEmail: (memberUserId: string) => string | null;
  selectedThread: ThreadSummary | null;
  selectedThreadComments: CommentSummary[];
  selectedVersion: VersionSummary | null;
  selectedVersionInActiveReview: boolean;
  setEmailNotifyMessage: (value: string) => void;
  setEmailNotifyStatus: (value: "idle" | "sending") => void;
  setError: (value: string | null) => void;
  setIsBusy: (value: boolean) => void;
  setNewCommentBody: (value: string) => void;
  setNewThreadTitle: (value: string) => void;
  setPendingThreadStatusChange: (value: ThreadSummary | null) => void;
  setSelectedThreadId: (value: string | null) => void;
  setSuccessEmailRecipients: (
    value: { to: string[]; cc: string[] } | null,
  ) => void;
  setSuccessMessage: (value: string | null) => void;
  setWarningMessage: (value: string | null) => void;
  threads: ThreadSummary[];
  userEmail?: string | null;
  userId: string;
};

const createReviewIssueActions = (params: ReviewIssueActionParams) => {
  const handleCreateThread = async () => {
    const { selectedVersion, projectId, docId, userId } = params;
    if (!selectedVersion || !projectId || !docId || !userId) {
      params.setError("Select a version to create an issue.");
      return;
    }
    if (!params.canCreateThread) {
      params.setError(
        [
          "To create an issue, the version must be in active review time",
          "or grace, you must be the author, leader, or reviewer,",
          "and the title cannot be empty.",
        ].join(" "),
      );
      return;
    }
    const lockedVersionId = selectedVersion.id;
    params.setError(null);
    params.setIsBusy(true);
    try {
      const threadRef = doc(collection(db, "threads"));
      const versionRef = doc(db, "versions", selectedVersion.id);
      const threadTitle = normalizeIssueTitleInput(
        params.newThreadTitle,
      ).trim();
      await runTransaction(db, async (transaction) => {
        const versionSnap = await transaction.get(versionRef);
        if (!versionSnap.exists()) throw new Error("Version not found.");
        const versionData = versionSnap.data();
        const currentStats = readVersionStats(versionData);
        transaction.set(threadRef, {
          projectId,
          docId,
          versionId: selectedVersion.id,
          status: "open",
          title: threadTitle,
          createdBy: userId,
          commentCount: 0,
          lastCommentAt: null,
          lastCommentBy: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
        transaction.update(versionRef, {
          stats: {
            ...currentStats,
            numThreads: currentStats.numThreads + 1,
            numOpenThreads: currentStats.numOpenThreads + 1,
          },
          numThreads: currentStats.numThreads + 1,
          numOpenThreads: currentStats.numOpenThreads + 1,
          numComments: currentStats.numComments,
          numThreadsWithTwoPlusComments:
            currentStats.numThreadsWithTwoPlusComments,
          activityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
      });
      params.setNewThreadTitle("");
      params.setSelectedThreadId(threadRef.id);
      params.setSuccessMessage("Issue created successfully.");
      logAudit({
        actorId: userId,
        actorEmail: params.userEmail ?? null,
        action: "createThread",
        entityType: "thread",
        entityId: threadRef.id,
        projectId,
        docId,
        versionId: selectedVersion.id,
        threadId: threadRef.id,
      }).catch((err) => {
        console.warn("Audit log failed (create issue):", err);
      });
      await params.reloadAndRestoreSelection(lockedVersionId, threadRef.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      params.reportVersionsError(err, "versions.createThread", "firestore", {
        versionId: selectedVersion.id,
      });
      params.setError(message);
    } finally {
      params.setIsBusy(false);
    }
  };

  const handleAddComment = async () => {
    const { selectedVersion, selectedThread, projectId, docId, userId } =
      params;
    if (
      !selectedVersion ||
      !projectId ||
      !docId ||
      !selectedThread ||
      !userId
    ) {
      params.setError("Select a version and issue to add a comment.");
      return;
    }
    if (!params.canAddComment) {
      params.setError(
        [
          "To add a comment, the issue must be open, and either review",
          "is still active or the issue has a last comment less than",
          "one hour old after review expiry.",
        ].join(" "),
      );
      return;
    }
    const lockedVersionId = selectedVersion.id;
    const commentBody = params.newCommentBody.trim();
    params.setError(null);
    params.setSuccessEmailRecipients(null);
    params.setEmailNotifyStatus("idle");
    params.setEmailNotifyMessage("");
    params.setIsBusy(true);
    try {
      const commentRef = doc(collection(db, "comments"));
      const versionRef = doc(db, "versions", selectedVersion.id);
      const threadRef = doc(db, "threads", selectedThread.id);
      await runTransaction(db, async (transaction) => {
        const [versionSnap, threadSnap] = await Promise.all([
          transaction.get(versionRef),
          transaction.get(threadRef),
        ]);
        if (!versionSnap.exists() || !threadSnap.exists())
          throw new Error("Version or issue not found.");
        const versionData = versionSnap.data();
        const threadData = threadSnap.data();
        if (
          !canAddCommentInWindow({
            versionStatus: versionData.status ?? "",
            reviewEndAt: toTimestampDate(versionData.reviewEndAt),
            threadStatus: threadData.status ?? "open",
            lastThreadCommentAt: toTimestampDate(threadData.lastCommentAt),
            canParticipate: params.canParticipateReview,
            hasBody: commentBody.length > 0,
          })
        ) {
          throw new Error("Comment window expired for this issue.");
        }
        const currentStats = readVersionStats(versionData);
        const previousThreadCommentCount = Number(threadData.commentCount ?? 0);
        const nextThreadCommentCount = previousThreadCommentCount + 1;
        const incrementTwoPlusCounter =
          previousThreadCommentCount < 2 && nextThreadCommentCount >= 2 ? 1 : 0;
        transaction.set(commentRef, {
          projectId,
          docId,
          versionId: selectedVersion.id,
          threadId: selectedThread.id,
          body: commentBody,
          createdBy: userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        transaction.update(threadRef, {
          commentCount: nextThreadCommentCount,
          lastCommentAt: serverTimestamp(),
          lastCommentBy: userId,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
        transaction.update(versionRef, {
          stats: {
            ...currentStats,
            numComments: currentStats.numComments + 1,
            numThreadsWithTwoPlusComments:
              currentStats.numThreadsWithTwoPlusComments +
              incrementTwoPlusCounter,
          },
          numThreads: currentStats.numThreads,
          numOpenThreads: currentStats.numOpenThreads,
          numComments: currentStats.numComments + 1,
          numThreadsWithTwoPlusComments:
            currentStats.numThreadsWithTwoPlusComments +
            incrementTwoPlusCounter,
          activityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
      });
      params.setNewCommentBody("");
      logAudit({
        actorId: userId,
        actorEmail: params.userEmail ?? null,
        action: "createComment",
        entityType: "comment",
        entityId: commentRef.id,
        projectId,
        docId,
        versionId: selectedVersion.id,
        threadId: selectedThread.id,
        commentId: commentRef.id,
      }).catch((err) => {
        console.warn("Audit log failed (add comment):", err);
      });
      await notifyCommentParticipants(params, commentRef.id, commentBody);
      params.setSuccessMessage("The comment was added successfully.");
      await params.reloadAndRestoreSelection(
        lockedVersionId,
        selectedThread.id,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      params.reportVersionsError(err, "versions.addComment", "firestore", {
        versionId: selectedVersion.id,
        threadId: selectedThread.id,
      });
      params.setError(message);
    } finally {
      params.setEmailNotifyStatus("idle");
      params.setEmailNotifyMessage("");
      params.setIsBusy(false);
    }
  };

  const canChangeThreadStatus = (thread: ThreadSummary) => {
    if (
      !params.selectedVersion ||
      !params.projectId ||
      !params.docId ||
      !params.userId
    ) {
      params.setError("Select a version to update an issue.");
      return false;
    }
    if (!params.canParticipateReview || !params.selectedVersionInActiveReview) {
      params.setError(
        "To close or reopen issues, the version must be in active review time or grace and you must be the author, leader, or reviewer.",
      );
      return false;
    }
    const loadedCommentsCount = params.commentsByThread[thread.id]?.length ?? 0;
    if (Math.max(Number(thread.commentCount ?? 0), loadedCommentsCount) < 2) {
      params.setError(
        "To close or reopen an issue, it must have at least two comments.",
      );
      return false;
    }
    const statsMismatchMessage = buildThreadStatsMismatchMessage(
      params.selectedVersion,
      getThreadStatsFromLoadedData(params.threads, params.commentsByThread),
    );
    if (statsMismatchMessage) {
      params.setError(statsMismatchMessage);
      return false;
    }
    return true;
  };

  const handleToggleThreadStatus = async (thread: ThreadSummary) => {
    if (!canChangeThreadStatus(thread) || !params.selectedVersion) return;
    const lockedVersionId = params.selectedVersion.id;
    const requestedThreadStatus = thread.status;
    const requestedIsClosing = requestedThreadStatus === "open";
    params.setError(null);
    params.setIsBusy(true);
    try {
      const versionRef = doc(db, "versions", params.selectedVersion.id);
      const threadRef = doc(db, "threads", thread.id);
      await runTransaction(db, async (transaction) => {
        const [versionSnap, threadSnap] = await Promise.all([
          transaction.get(versionRef),
          transaction.get(threadRef),
        ]);
        if (!versionSnap.exists() || !threadSnap.exists())
          throw new Error("Version or issue not found.");
        const versionData = versionSnap.data();
        const currentThreadStatus = threadSnap.data().status ?? "open";
        if (currentThreadStatus !== requestedThreadStatus)
          throw new Error(THREAD_STATUS_CONFLICT_MESSAGE);
        const isClosing = currentThreadStatus === "open";
        const currentStats = readVersionStats(versionData);
        const nextOpenThreads = isClosing
          ? Math.max(0, currentStats.numOpenThreads - 1)
          : currentStats.numOpenThreads + 1;
        transaction.update(threadRef, {
          status: isClosing ? "closed" : "open",
          closedBy: isClosing ? params.userId : null,
          closedAt: isClosing ? serverTimestamp() : null,
          reopenedBy: isClosing ? null : params.userId,
          reopenedAt: isClosing ? null : serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: params.userId,
        });
        transaction.update(versionRef, {
          stats: { ...currentStats, numOpenThreads: nextOpenThreads },
          numThreads: currentStats.numThreads,
          numOpenThreads: nextOpenThreads,
          numComments: currentStats.numComments,
          numThreadsWithTwoPlusComments:
            currentStats.numThreadsWithTwoPlusComments,
          activityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: params.userId,
        });
      });
      params.setSuccessMessage(
        requestedIsClosing
          ? "Issue closed successfully."
          : "Issue reopened successfully.",
      );
      await params.reloadAndRestoreSelection(lockedVersionId, thread.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      if (isExpectedThreadStatusConflictError(err)) {
        await params.reloadAndRestoreSelection(lockedVersionId, thread.id);
      } else {
        params.reportVersionsError(
          err,
          "versions.toggleThreadStatus",
          "firestore",
          {
            versionId: params.selectedVersion?.id ?? null,
            threadId: thread.id,
          },
        );
      }
      params.setError(message);
    } finally {
      params.setIsBusy(false);
    }
  };

  const handleConfirmThreadStatusChange = async (
    pendingThreadStatusChange: ThreadSummary | null,
  ) => {
    if (!pendingThreadStatusChange) return;
    params.setPendingThreadStatusChange(null);
    await handleToggleThreadStatus(pendingThreadStatusChange);
  };

  return {
    canChangeThreadStatus,
    handleAddComment,
    handleConfirmThreadStatusChange,
    handleCreateThread,
    handleToggleThreadStatus,
  };
};

const readVersionStats = (versionData: Record<string, unknown>) => ({
  numThreads: Number(
    (versionData.stats as { numThreads?: unknown } | undefined)?.numThreads ??
      versionData.numThreads ??
      0,
  ),
  numOpenThreads: Number(
    (versionData.stats as { numOpenThreads?: unknown } | undefined)
      ?.numOpenThreads ??
      versionData.numOpenThreads ??
      0,
  ),
  numComments: Number(
    (versionData.stats as { numComments?: unknown } | undefined)?.numComments ??
      versionData.numComments ??
      0,
  ),
  numThreadsWithTwoPlusComments: Number(
    (
      versionData.stats as
        | { numThreadsWithTwoPlusComments?: unknown }
        | undefined
    )?.numThreadsWithTwoPlusComments ??
      versionData.numThreadsWithTwoPlusComments ??
      0,
  ),
});

export { createReviewIssueActions };
