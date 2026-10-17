// src/pages/versions/reviewIssueActions.ts
// Creates handlers for review issues, comments, and issue status transitions.
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import type { Dispatch, SetStateAction } from "react";
import { flushSync } from "react-dom";
import { logAudit } from "../../lib/audit";
import type { MonitorDiagnosticDetails } from "../../lib/errorMonitor";
import { AiAssistRequestError, requestAiAssist } from "../../lib/aiAssist";
import { db } from "../../lib/firebase";
import {
  buildReputationAwardMessage,
  waitForReputationEvent,
} from "../../lib/reputationData";
import { canAddCommentInWindow } from "../../lib/reviewWindow";
import { buildReviewIssueDiagnostics } from "./reviewIssueDiagnostics";
import { measureSlowUiAction } from "../../lib/slowUiAction";
import {
  THREAD_STATUS_CONFLICT_MESSAGE,
  isExpectedThreadStatusConflictError,
} from "../../lib/versionStatusConflict";
import {
  buildThreadStatsMismatchMessage,
  getThreadStatsFromLoadedData,
  ISSUE_TITLE_MAX_LENGTH,
  normalizeIssueTitleInput,
  toTimestampDate,
} from "./utils";
import type {
  CommentReactionKind,
  CommentReactionState,
  CommentSummary,
  DocumentSummary,
  ThreadSummary,
  VersionSummary,
} from "./types";

type ReportVersionsError = (
  error: unknown,
  action: string,
  source?: "firestore" | "storage" | "auth" | "ui" | "network" | "unknown",
  overrides?: {
    versionId?: string | null;
    threadId?: string | null;
    diagnosticDetails?: MonitorDiagnosticDetails;
  },
) => void;

type ReviewIssueActionParams = {
  canAddComment: boolean;
  canCreateThread: boolean;
  canParticipateReview: boolean;
  commentReactionsByCommentId: Record<string, CommentReactionState>;
  commentsByThread: Record<string, CommentSummary[]>;
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
  setCommentCreationStatus: (value: "idle" | "adding") => void;
  setCommentReactionsByCommentId: Dispatch<
    SetStateAction<Record<string, CommentReactionState>>
  >;
  setNewCommentBody: (value: string) => void;
  setNewThreadTitle: (value: string) => void;
  setPendingCommentReactionIds: Dispatch<SetStateAction<Record<string, boolean>>>;
  setPendingThreadStatusChange: (value: ThreadSummary | null) => void;
  setSelectedThreadId: (value: string | null) => void;
  setThreadCreationStatus: (value: "idle" | "creating") => void;
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
          "and the initial comment cannot be empty.",
        ].join(" "),
      );
      return;
    }
    const initialCommentBody = params.newThreadTitle.trim();
    const lockedVersionId = selectedVersion.id;
    let transactionDiagnostics: MonitorDiagnosticDetails | null = null;
    params.setError(null);
    flushSync( () => {
      params.setThreadCreationStatus("creating");
      params.setIsBusy(true);
    } );
    try {
      const threadTitle = buildFallbackIssueTitle(initialCommentBody);
      const threadRef = doc(collection(db, "threads"));
      const commentRef = doc(collection(db, "comments"));
      const versionRef = doc(db, "versions", selectedVersion.id);
      const memberRef = doc(db, "projectMembers", `${projectId}_${userId}`);
      const profileRef = doc(db, "userProfiles", userId);
      await measureSlowUiAction(
        {
          action: "versions.createThread",
          page: "Document Versions",
          userId,
          projectId,
          docId,
          versionId: selectedVersion.id,
          hasModal: true,
        },
        () => runTransaction(db, async (transaction) => {
          const [versionSnap, memberSnap, profileSnap] = await Promise.all([
            transaction.get(versionRef),
            transaction.get(memberRef),
            transaction.get(profileRef),
          ]);
          if (!versionSnap || !versionSnap.exists()) throw new Error("Version not found.");
          const versionData = versionSnap.data();
          const currentStats = readVersionStats(versionData);
          transactionDiagnostics = buildReviewIssueDiagnostics({
            actorId: userId,
            clientGate: {
              canCreateThread: params.canCreateThread,
              canParticipateReview: params.canParticipateReview,
              selectedVersionInActiveReview: params.selectedVersionInActiveReview,
              hasInitialComment: initialCommentBody.length > 0,
            },
            clientVersion: {
              id: selectedVersion.id,
              status: selectedVersion.status,
              createdBy: selectedVersion.createdBy,
              reviewerCount: selectedVersion.reviewerIds.length,
            },
            docId,
            memberData: memberSnap?.exists() ? memberSnap.data() : null,
            nowMs: Date.now(),
            profileData: profileSnap?.exists() ? profileSnap.data() : null,
            projectId,
            versionData,
            versionId: selectedVersion.id,
          });
          transaction.set(threadRef, {
            projectId,
            docId,
            versionId: selectedVersion.id,
            status: "open",
            title: threadTitle,
            createdBy: userId,
            commentCount: 1,
            lastCommentAt: serverTimestamp(),
            lastCommentBy: userId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedBy: userId,
          });
          transaction.set(commentRef, {
            projectId,
            docId,
            versionId: selectedVersion.id,
            threadId: threadRef.id,
            body: initialCommentBody,
            createdBy: userId,
            isInitialIssueComment: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          transaction.update(versionRef, {
            stats: {
              ...currentStats,
              numThreads: currentStats.numThreads + 1,
              numOpenThreads: currentStats.numOpenThreads + 1,
              numComments: currentStats.numComments + 1,
            },
            numThreads: currentStats.numThreads + 1,
            numOpenThreads: currentStats.numOpenThreads + 1,
            numComments: currentStats.numComments + 1,
            numThreadsWithTwoPlusComments:
              currentStats.numThreadsWithTwoPlusComments,
            activityAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedBy: userId,
          });
        }),
      );
      params.setNewThreadTitle("");
      params.setSelectedThreadId(threadRef.id);
      const reputationEvent = await waitForReputationEvent({
        projectId,
        sourceId: threadRef.id,
        sourceType: "thread",
        userId,
      });
      params.setSuccessMessage(
        buildReputationAwardMessage("Issue created successfully.", reputationEvent),
      );
      logAudit({
        actorId: userId,
        actorEmail: params.userEmail ?? null,
        action: "createComment",
        entityType: "comment",
        entityId: commentRef.id,
        projectId,
        docId,
        versionId: selectedVersion.id,
        threadId: threadRef.id,
        commentId: commentRef.id,
      }).catch((err) => {
        console.warn("Audit log failed (create initial issue comment):", err);
      });
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
      void updateThreadTitleInBackground({
        commentBody: initialCommentBody,
        docId,
        projectId,
        reportVersionsError: params.reportVersionsError,
        setError: params.setError,
        setSuccessMessage: params.setSuccessMessage,
        threadRef,
        userId,
        versionId: selectedVersion.id,
      });
      await params.reloadAndRestoreSelection(lockedVersionId, threadRef.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      const diagnosticDetails = transactionDiagnostics ?? {
        diagnosticScope: "versions.createThread",
        diagnosticDisclaimer: "Client-side diagnostic; Firestore remains authoritative.",
        collectionReadCompleted: false,
        likelyCauses: ["transaction_read_failed_before_diagnostics"],
        clientGate: {
          canCreateThread: params.canCreateThread,
          canParticipateReview: params.canParticipateReview,
          selectedVersionInActiveReview: params.selectedVersionInActiveReview,
          hasInitialComment: initialCommentBody.length > 0,
        },
        clientVersion: {
          id: selectedVersion.id,
          status: selectedVersion.status,
          createdBy: selectedVersion.createdBy,
          reviewerCount: selectedVersion.reviewerIds.length,
        },
      };
      params.reportVersionsError(err, "versions.createThread", "firestore", {
        versionId: selectedVersion.id,
        diagnosticDetails,
      });
      params.setError(message);
    } finally {
      params.setThreadCreationStatus("idle");
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
    flushSync( () => {
      params.setCommentCreationStatus("adding");
    } );
    params.setIsBusy(true);
    try {
      const commentRef = doc(collection(db, "comments"));
      const versionRef = doc(db, "versions", selectedVersion.id);
      const threadRef = doc(db, "threads", selectedThread.id);
      await measureSlowUiAction(
        {
          action: "versions.addComment",
          page: "Document Versions",
          userId,
          projectId,
          docId,
          versionId: selectedVersion.id,
          threadId: selectedThread.id,
          hasModal: true,
        },
        () => runTransaction(db, async (transaction) => {
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
        }),
      );
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
      const previousComment = params.selectedThreadComments.at(-1);
      const isConsecutiveComment = previousComment?.createdBy === userId;
      const reputationEvent = isConsecutiveComment
        ? null
        : await waitForReputationEvent({
            projectId,
            sourceId: commentRef.id,
            sourceType: "comment",
            userId,
          });
      params.setSuccessMessage(
        isConsecutiveComment
          ? "The comment was added successfully. No additional points were awarded because consecutive comments count as one participation block."
          : buildReputationAwardMessage("The comment was added successfully.", reputationEvent),
      );
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
      params.setCommentCreationStatus("idle");
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

  const handleSetCommentReaction = async (
    comment: CommentSummary,
    reaction: CommentReactionKind,
  ) => {
    const { selectedVersion, projectId, docId, userId } = params;
    if (!selectedVersion || !projectId || !docId || !userId) {
      params.setError("Select a version and comment before reacting to it.");
      return;
    }
    if (!comment.id || !comment.threadId) {
      params.setError("Select a valid comment before reacting to it.");
      return;
    }
    const currentReactionState =
      params.commentReactionsByCommentId[comment.id] ??
      emptyCommentReactionState;
    const reactionRef = doc(
      db,
      "commentReactions",
      buildCommentReactionId(comment.id, userId),
    );
    params.setError(null);
    params.setPendingCommentReactionIds((current) => ({
      ...current,
      [comment.id]: true,
    }));
    params.setCommentReactionsByCommentId((current) =>
      applyOptimisticCommentReaction(current, comment.id, reaction),
    );
    try {
      await measureSlowUiAction(
        {
          action: "versions.setCommentReaction",
          page: "Document Versions",
          userId,
          projectId,
          docId,
          versionId: selectedVersion.id,
          threadId: comment.threadId,
        },
        () => currentReactionState.currentUserReaction
          ? updateDoc(reactionRef, {
            reaction,
            updatedAt: serverTimestamp(),
          })
          : setDoc(reactionRef, {
            projectId,
            docId,
            versionId: selectedVersion.id,
            threadId: comment.threadId,
            commentId: comment.id,
            userId,
            reaction,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      params.setCommentReactionsByCommentId((current) =>
        restoreCommentReactionState(current, comment.id, currentReactionState),
      );
      params.reportVersionsError(
        err,
        "versions.setCommentReaction",
        "firestore",
        {
          versionId: selectedVersion.id,
          threadId: comment.threadId,
        },
      );
      params.setError(message);
    } finally {
      params.setPendingCommentReactionIds((current) => {
        const nextPendingCommentReactionIds = { ...current };
        delete nextPendingCommentReactionIds[comment.id];
        return nextPendingCommentReactionIds;
      });
    }
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
      await measureSlowUiAction(
        {
          action: requestedIsClosing ? "versions.closeThread" : "versions.reopenThread",
          page: "Document Versions",
          userId: params.userId,
          projectId: params.projectId,
          docId: params.docId,
          versionId: params.selectedVersion.id,
          threadId: thread.id,
          hasModal: true,
        },
        () => runTransaction(db, async (transaction) => {
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
        }),
      );
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
    try {
      await handleToggleThreadStatus(pendingThreadStatusChange);
    } finally {
      params.setPendingThreadStatusChange(null);
    }
  };

  return {
    canChangeThreadStatus,
    handleAddComment,
    handleConfirmThreadStatusChange,
    handleCreateThread,
    handleSetCommentReaction,
    handleToggleThreadStatus,
  };
};

const buildCommentReactionId = (commentId: string, userId: string) =>
  `${commentId}_${userId}`;

const emptyCommentReactionState: CommentReactionState = {
  counts: {
    good: 0,
    regular: 0,
    bad: 0,
  },
  currentUserReaction: null,
};

const applyOptimisticCommentReaction = (
  current: Record<string, CommentReactionState>,
  commentId: string,
  reaction: CommentReactionKind,
) => {
  const currentState = current[commentId] ?? emptyCommentReactionState;
  const previousReaction = currentState.currentUserReaction;
  const nextCounts = {
    good: currentState.counts.good ?? 0,
    regular: currentState.counts.regular ?? 0,
    bad: currentState.counts.bad ?? 0,
  };
  if (previousReaction && previousReaction !== reaction) {
    nextCounts[previousReaction] = Math.max(0, nextCounts[previousReaction] - 1);
  }
  if (previousReaction !== reaction) {
    nextCounts[reaction] += 1;
  }
  return {
    ...current,
    [commentId]: {
      counts: nextCounts,
      currentUserReaction: reaction,
    },
  };
};

const restoreCommentReactionState = (
  current: Record<string, CommentReactionState>,
  commentId: string,
  previousState: CommentReactionState,
) => ({
  ...current,
  [commentId]: previousState,
});

const updateThreadTitleInBackground = async ({
  commentBody,
  docId,
  projectId,
  reportVersionsError,
  setError,
  setSuccessMessage,
  threadRef,
  userId,
  versionId,
}: {
  commentBody: string;
  docId: string;
  projectId: string;
  reportVersionsError: ReportVersionsError;
  setError: (value: string | null) => void;
  setSuccessMessage: (value: string | null) => void;
  threadRef: ReturnType<typeof doc>;
  userId: string;
  versionId: string;
}) => {
  let aiTitleWasGenerated = false;
  try {
    const response = await requestAiAssist({
      mode: "draft_issue_title",
      text: commentBody,
    });
    const threadTitle = normalizeIssueTitleInput(response.result).trim();
    if (!threadTitle) {
      throw new AiAssistRequestError(
        "provider_empty_response",
        200,
        "Gemini returned a title that could not be used.",
      );
    }
    aiTitleWasGenerated = true;
    await updateDoc(threadRef, {
      title: threadTitle,
      updatedAt: serverTimestamp(),
      updatedBy: userId,
    });
  } catch (err) {
    const source = aiTitleWasGenerated ? "firestore" : "network";
    const code = err instanceof AiAssistRequestError ? err.code : "unexpected";
    const httpStatus =
      err instanceof AiAssistRequestError ? ` (HTTP ${err.httpStatus})` : "";
    console.warn("AI issue title fallback retained:", {
      cause: err instanceof Error ? err.message : "Unexpected AI title error",
      code,
      impact: "Issue keeps its local summary title.",
      projectId,
      docId,
      versionId,
      threadId: threadRef.id,
    });
    reportVersionsError(err, "versions.generateIssueTitle", source, {
      versionId,
      threadId: threadRef.id,
    });
    setSuccessMessage(null);
    setError(
      aiTitleWasGenerated
        ? "The issue was created, but its automatic title could not be saved. The temporary title remains. You can report this error to the administrator."
        : `The issue was created, but Gemini could not generate its automatic title${httpStatus}. The temporary title remains. Gemini error: ${code}. You can report this error to the administrator.`,
    );
  }
};

const buildFallbackIssueTitle = (commentBody: string) => {
  const firstSentence = commentBody
    .split(/[.!?\n]/u)
    .map((part) => part.trim())
    .find(Boolean) ?? commentBody.trim();
  const words = firstSentence.split(/\s+/u).filter(Boolean).slice(0, 12);
  const title = words.join(" ");
  return normalizeIssueTitleInput(title || "Review issue").slice(
    0,
    ISSUE_TITLE_MAX_LENGTH,
  );
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
