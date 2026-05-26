// src/pages/versions/useVersionsDerivedModel.ts
// Derives permissions, labels, columns, and reporting helpers for VersionsPage.
import { useCallback, useMemo } from "react";
import { versionNumberToString } from "../../domain/types";
import { reportAbnormalError } from "../../lib/errorMonitor";
import { getEffectiveFileStorageProviderHint } from "../../lib/fileStorage";
import { isOfflineFirestoreError, parseDashboardFocusTarget } from "./utils";
import useReviewDerivedState from "./reviewDerivedState";
import useDocumentTitleEditing from "./documentTitleEditing";
import useVersionsErrorChecklistModel from "./useVersionsErrorChecklistModel";
import useVersionsPeopleAndTablesModel from "./useVersionsPeopleAndTablesModel";
import useVersionsPermissionModel from "./useVersionsPermissionModel";
import type { VersionSummary } from "./types";
import type { VersionsPageState } from "./versionsPageState";

type VersionsErrorSource =
  | "firestore"
  | "storage"
  | "auth"
  | "ui"
  | "network"
  | "unknown";
type VersionsErrorOverrides = {
  versionId?: string | null;
  threadId?: string | null;
};

type UseVersionsDerivedModelParams = {
  docId?: string;
  searchParams: URLSearchParams;
  user: {
    uid?: string;
    email?: string | null;
    displayName?: string | null;
  } | null;
  userId: string;
  state: VersionsPageState;
};

const useVersionsDerivedModel = ({
  docId,
  searchParams,
  user,
  userId,
  state,
}: UseVersionsDerivedModelParams) => {
  const {
    versions,
    documentData,
    setDocumentData,
    projectName,
    projectShortId,
    projectMembers,
    selectedReviewerIds,
    setSelectedReviewerIds,
    selectedAuthorId,
    setSelectedAuthorId,
    selectedVersionId,
    downloadStatus,
    setDownloadStatus,
    setDownloadMessage,
    selectedFileRef,
    threadsViewMode,
    isAdmin,
    isLeader,
    isBusy,
    setIsBusy,
    error,
    setError,
    setSuccessMessage,
    setSuccessEmailRecipients,
    userDirectoryById,
    errorReportGate,
    threads,
    visibleThreadRows,
    commentsByThread,
    selectedThreadId,
    newThreadTitle,
    newCommentBody,
    clockNowMs,
  } = state;
  const projectIdFromQuery = searchParams.get("projectId") ?? "";
  const versionIdFromQuery = searchParams.get("versionId") ?? "";
  const threadIdFromQuery = searchParams.get("threadId") ?? "";
  const commentIdFromQuery = searchParams.get("commentId") ?? "";
  const dashboardFocusTarget = parseDashboardFocusTarget(
    searchParams.get("focus"),
  );
  const projectId = documentData?.projectId ?? projectIdFromQuery;
  const latestVersion = versions[0] ?? null;
  const selectedVersion =
    (selectedVersionId &&
      versions.find((version) => version.id === selectedVersionId)) ||
    latestVersion;
  const selectedDownloadProvider = getEffectiveFileStorageProviderHint(
    selectedFileRef?.storageProvider ?? null,
  );
  const effectiveSelectedThreadId = threadIdFromQuery || selectedThreadId;
  const getVersionDownloadProvider = useCallback(
    (version: VersionSummary) =>
      selectedVersion?.id === version.id && selectedFileRef?.storageProvider
        ? getEffectiveFileStorageProviderHint(selectedFileRef.storageProvider)
        : getEffectiveFileStorageProviderHint(),
    [selectedVersion?.id, selectedFileRef],
  );
  const documentAuthorId = documentData?.createdBy ?? "";
  const currentDocumentAuthorId = documentData?.authorId ?? documentAuthorId;
  const latestAuthorId = latestVersion?.createdBy ?? documentAuthorId;
  const isSelectedAuthor = !!(
    userId &&
    (selectedVersion
      ? selectedVersion.createdBy === userId
      : documentAuthorId === userId)
  );
  const isLatestAuthor = !!(
    userId &&
    latestAuthorId &&
    latestAuthorId === userId
  );
  const canEditDocumentTitle = !!(
    userId &&
    documentData &&
    (currentDocumentAuthorId === userId || isLeader || isAdmin)
  );
  const {
    isDocumentTitleModalOpen,
    documentTitleDraft,
    documentTitleError,
    setDocumentTitleDraft,
    requestDocumentTitleEdit,
    closeDocumentTitleModal,
    handleSaveDocumentTitle,
  } = useDocumentTitleEditing({
    docId,
    projectId,
    documentData,
    userId,
    userEmail: user?.email,
    canEditDocumentTitle,
    setDocumentData,
    setIsBusy,
    setSuccessEmailRecipients,
    setSuccessMessage,
    setError,
  });
  const canManageLatestVersion = isLatestAuthor || isLeader || isAdmin;
  const canApproveVersion = isLatestAuthor || isLeader || isAdmin;
  const canCreateVersionActor = isLatestAuthor || isLeader || isAdmin;
  const isReviewer = !!(
    selectedVersion && selectedVersion.reviewerIds.includes(userId)
  );
  const canParticipateReview =
    isSelectedAuthor || isLeader || isReviewer || isAdmin;
  const latestVersionInReviewed = !!(
    latestVersion && latestVersion.status === "Reviewed"
  );
  const latestVersionInAccepted = !!(
    latestVersion && latestVersion.status === "Accepted"
  );
  const selectedVersionInReview = !!(
    selectedVersion && selectedVersion.status === "In Review"
  );
  const selectedThread = effectiveSelectedThreadId
    ? (threads.find((thread) => thread.id === effectiveSelectedThreadId) ??
      null)
    : null;
  const projectReportLabel = projectName
    ? `${projectShortId ?? "Unassigned"} - ${projectName}`
    : "";
  const documentReportLabel = `${documentData?.shortId ?? "Unassigned"} - ${documentData?.title ?? docId ?? "Unknown"}`;
  const versionReportLabel = selectedVersion
    ? `${versionNumberToString(selectedVersion.number)} - ${selectedVersion.status}`
    : "";
  const threadReportLabel = selectedThread?.title.trim() ?? "";
  const reportVersionsError = useCallback(
    (
      error2: unknown,
      action: string,
      source: VersionsErrorSource = "firestore",
      overrides?: VersionsErrorOverrides,
    ) => {
      if (!isOfflineFirestoreError(error2)) {
        reportAbnormalError({
          error: error2,
          source,
          action,
          projectId,
          docId: docId ?? "",
          versionId:
            overrides?.versionId ??
            selectedVersion?.id ??
            latestVersion?.id ??
            versionIdFromQuery,
          threadId:
            overrides?.threadId ?? selectedThread?.id ?? threadIdFromQuery,
          userId,
          userEmail: user?.email ?? "",
        });
      }
    },
    [
      projectId,
      docId,
      selectedVersion?.id,
      latestVersion?.id,
      versionIdFromQuery,
      selectedThread?.id,
      threadIdFromQuery,
      userId,
      user?.email,
    ],
  );
  const selectedThreadOpen = !!(
    selectedThread && selectedThread.status === "open"
  );
  const {
    selectedThreadComments,
    selectedThreadLatestCommentAt,
    latestVersionIsSelected,
    latestSelectedVersionCommentAt,
    selectedVersionReviewGraceRemainingMs,
    selectedVersionHasReviewGrace,
    selectedVersionInActiveReview,
    latestVersionInReviewDecisionWindow,
    canCreateThread,
    canAddComment,
    getThreadCommentWindowMeta,
    commentWindowCountdownLabel,
    selectedCommentWindowState,
    hasSelectedVersionComments,
  } = useReviewDerivedState({
    selectedVersion,
    latestVersion,
    selectedThread,
    commentsByThread,
    threads,
    canParticipateReview,
    newThreadTitle,
    newCommentBody,
    clockNowMs,
  });
  const {
    commentColumns,
    formatUserLabel,
    membersTableRows,
    requestDownloadVersionFile,
    resolveUserEmail,
    versionColumns,
  } = useVersionsPeopleAndTablesModel({
    clockNowMs,
    downloadStatus,
    getVersionDownloadProvider,
    isBusy,
    projectMembers,
    reportVersionsError,
    selectedAuthorId,
    selectedReviewerIds,
    setDownloadMessage,
    setDownloadStatus,
    setError,
    setSuccessMessage,
    userDirectoryById,
    userDisplayName: user?.displayName,
    userEmail: user?.email,
    userId,
  });
  const orderedThreads = useMemo(
    () => (threadsViewMode === "table" ? visibleThreadRows : threads),
    [threadsViewMode, visibleThreadRows, threads],
  );
  const selectedThreadIndex = useMemo(
    () =>
      orderedThreads.findIndex(
        (thread) => thread.id === effectiveSelectedThreadId,
      ),
    [orderedThreads, effectiveSelectedThreadId],
  );
  const hasPreviousThread = selectedThreadIndex > 0;
  const hasNextThread =
    selectedThreadIndex >= 0 && selectedThreadIndex < orderedThreads.length - 1;
  const threadNavigationStatusLabel =
    selectedThreadIndex >= 0
      ? `Issue ${selectedThreadIndex + 1} of ${orderedThreads.length}`
      : "Selected issue is hidden by the current table filters.";
  const {
    allowedReviewerIds,
    canAcceptOrReject,
    canAssignReviewers,
    canCreateErrorReportActor,
    canCreateVersion,
    canStartReview,
    canUploadFile,
    createButtonLabel,
    handleAssignAuthor,
    handleToggleAllReviewers,
    handleToggleReviewer,
    logBlockedVersionDecision,
    statusClassName,
  } = useVersionsPermissionModel({
    canApproveVersion,
    canCreateVersionActor,
    canManageLatestVersion,
    docId,
    errorReportGate,
    isAdmin,
    isLeader,
    isSelectedAuthor,
    latestVersion,
    latestVersionInReviewDecisionWindow,
    projectId,
    projectMembers,
    selectedAuthorId,
    selectedReviewerIds,
    selectedVersion,
    setError,
    setIsBusy,
    setSelectedAuthorId,
    setSelectedReviewerIds,
    userEmail: user?.email,
    userId,
    versionsLength: versions.length,
    reportVersionsError,
  });
  const errorChecklist = useVersionsErrorChecklistModel({
    canParticipateReview,
    clockNowMs,
    docId,
    documentAuthorId,
    documentData,
    error,
    errorReportGate,
    isAdmin,
    isLeader,
    isLatestAuthor,
    isReviewer,
    isSelectedAuthor,
    latestVersion,
    latestVersionInAccepted,
    latestVersionInReviewDecisionWindow,
    latestVersionInReviewed,
    newCommentBody,
    newThreadTitle,
    selectedThread,
    selectedThreadLatestCommentAt,
    selectedThreadOpen,
    selectedVersion,
    selectedVersionInActiveReview,
    selectedVersionInReview,
    userId,
    versionsLength: versions.length,
  });

  return {
    projectIdFromQuery,
    versionIdFromQuery,
    threadIdFromQuery,
    commentIdFromQuery,
    dashboardFocusTarget,
    projectId,
    latestVersion,
    selectedVersion,
    selectedDownloadProvider,
    effectiveSelectedThreadId,
    getVersionDownloadProvider,
    documentAuthorId,
    currentDocumentAuthorId,
    isSelectedAuthor,
    isLatestAuthor,
    canEditDocumentTitle,
    isDocumentTitleModalOpen,
    documentTitleDraft,
    documentTitleError,
    setDocumentTitleDraft,
    requestDocumentTitleEdit,
    closeDocumentTitleModal,
    handleSaveDocumentTitle,
    canManageLatestVersion,
    canApproveVersion,
    canCreateVersionActor,
    isReviewer,
    canParticipateReview,
    latestVersionInReviewed,
    latestVersionInAccepted,
    selectedVersionInReview,
    selectedThread,
    projectReportLabel,
    documentReportLabel,
    versionReportLabel,
    threadReportLabel,
    reportVersionsError,
    selectedThreadOpen,
    selectedThreadComments,
    selectedThreadLatestCommentAt,
    latestVersionIsSelected,
    latestSelectedVersionCommentAt,
    selectedVersionReviewGraceRemainingMs,
    selectedVersionHasReviewGrace,
    selectedVersionInActiveReview,
    latestVersionInReviewDecisionWindow,
    canCreateThread,
    canAddComment,
    getThreadCommentWindowMeta,
    commentWindowCountdownLabel,
    selectedCommentWindowState,
    hasSelectedVersionComments,
    formatUserLabel,
    orderedThreads,
    selectedThreadIndex,
    hasPreviousThread,
    hasNextThread,
    threadNavigationStatusLabel,
    resolveUserEmail,
    membersTableRows,
    requestDownloadVersionFile,
    statusClassName,
    allowedReviewerIds,
    createButtonLabel,
    canCreateVersion,
    canAssignReviewers,
    canUploadFile,
    handleToggleReviewer,
    handleToggleAllReviewers,
    handleAssignAuthor,
    canCreateErrorReportActor,
    canStartReview,
    canAcceptOrReject,
    logBlockedVersionDecision,
    errorChecklist,
    versionColumns,
    commentColumns,
  };
};

export default useVersionsDerivedModel;
export type { VersionsErrorOverrides, VersionsErrorSource };
