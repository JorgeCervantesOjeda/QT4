// src/pages/versions/useVersionsRuntimeModel.ts
// Wires data loading, realtime subscriptions, URL navigation, and file operations for VersionsPage.
import { useCallback, useEffect, useRef } from "react";
import {
  loadAcceptedErrorReportsForBaseVersion as loadAcceptedErrorReportsForBaseVersionData,
  loadDocumentAndVersions as loadDocumentAndVersionsData,
} from "./dataLoaders";
import useAcceptedErrorReports from "./acceptedErrorReportHooks";
import {
  useDocumentSubscription,
  useSelectedFileMetadata,
} from "./documentAndFileHooks";
import {
  useRoleSubscriptions,
  useThreadsAndCommentsSubscription,
} from "./realtimeHooks";
import {
  useDashboardFocus,
  useThreadQueryNavigation,
  useVersionPreferences,
} from "./navigationHooks";
import {
  useSelectedVersionSync,
  useUserDirectoryRefresh,
  useVersionsProjectSubscription,
} from "./versionRealtimeHooks";
import useFileActions from "./fileActions";
import type useVersionsDerivedModel from "./useVersionsDerivedModel";
import type { VersionsPageState } from "./versionsPageState";

type UseVersionsRuntimeModelParams = {
  derived: ReturnType<typeof useVersionsDerivedModel>;
  docId?: string;
  searchParams: URLSearchParams;
  setSearchParams: (
    nextInit: URLSearchParams,
    navigateOptions?: { replace?: boolean; preventScrollReset?: boolean },
  ) => void;
  state: VersionsPageState;
  user: { email?: string | null; displayName?: string | null } | null;
  userId: string;
};

const useVersionsRuntimeModel = ({
  derived,
  docId,
  searchParams,
  setSearchParams,
  state,
  user,
  userId,
}: UseVersionsRuntimeModelParams) => {
  const {
    commentInputRef,
    commentsByThread,
    commentsRetryTimeoutRef,
    commentsRetryToken,
    commentsViewMode,
    documentData,
    downloadStatus,
    filePanelRef,
    isLoadingThreads,
    isLoadingVersions,
    lastAppliedCommentQueryRef,
    lastAppliedDashboardFocusRef,
    lastAppliedThreadQueryRef,
    lastAppliedVersionQueryRef,
    localFileRefByIdRef,
    pendingManualThreadSelectionRef,
    preservedThreadNavigationScrollYRef,
    projectMembers,
    reviewIssuesPanelRef,
    selectedAuthorId,
    selectedFileRef,
    selectedThreadId,
    selectedVersionId,
    setAcceptedErrorReports,
    setAcceptedErrorReportsStatus,
    setBaseDocumentData,
    setCommentsByThread,
    setCommentsRetryToken,
    setCommentsViewMode,
    setDocumentData,
    setDownloadMessage,
    setDownloadStatus,
    setError,
    setErrorReportGate,
    setFileMetadataNotice,
    setHighlightedCommentId,
    setIsAdmin,
    setIsBusy,
    setIsLeader,
    setIsLoadingThreads,
    setIsLoadingVersions,
    setNewCommentBody,
    setNewThreadTitle,
    setPendingThreadStatusChange,
    setProjectMembers,
    setProjectName,
    setProjectShortId,
    setSelectedAuthorId,
    setSelectedFileRef,
    setSelectedReviewerIds,
    setSelectedThreadId,
    setSelectedVersionId,
    setSuccessMessage,
    setThreads,
    setUploadMessage,
    setUploadStatus,
    setUserDirectoryById,
    setVersionSorting,
    setVersions,
    setVisibleThreadRows,
    threads,
    threadsViewMode,
    uploadInputRef,
    versionSorting,
    versions,
    versionsActionsRef,
    viewMode,
  } = state;

  const loadAcceptedErrorReportsForBaseVersion = useCallback(
    (activeProjectId: string, baseVersionId: string) =>
      loadAcceptedErrorReportsForBaseVersionData(
        activeProjectId,
        baseVersionId,
      ),
    [],
  );

  useAcceptedErrorReports({
    projectId: derived.projectId,
    latestVersion: derived.latestVersion,
    selectedVersion: derived.selectedVersion,
    loadAcceptedErrorReportsForBaseVersion,
    reportVersionsError: derived.reportVersionsError,
    setAcceptedErrorReports: setAcceptedErrorReports,
    setAcceptedErrorReportsStatus: setAcceptedErrorReportsStatus,
    setErrorReportGate: setErrorReportGate,
  });

  const loadDocumentAndVersions = useCallback(
    () =>
      loadDocumentAndVersionsData({
        docId,
        projectIdFromQuery: derived.projectIdFromQuery,
        versionIdFromQuery: derived.versionIdFromQuery,
        selectedVersionId: selectedVersionId,
        userId,
        userEmail: user?.email,
        userDisplayName: user?.displayName,
        setError: setError,
        setIsBusy: setIsBusy,
        setErrorReportGate: setErrorReportGate,
        setDocumentData: setDocumentData,
        setVersions: setVersions,
        setBaseDocumentData: setBaseDocumentData,
        setProjectMembers: setProjectMembers,
        setProjectName: setProjectName,
        setProjectShortId: setProjectShortId,
        setSelectedReviewerIds: setSelectedReviewerIds,
        setSelectedAuthorId: setSelectedAuthorId,
        setSelectedVersionId: setSelectedVersionId,
        setUserDirectoryById: setUserDirectoryById,
        reportVersionsError: derived.reportVersionsError,
      }),
    [
      derived.projectIdFromQuery,
      derived.reportVersionsError,
      derived.versionIdFromQuery,
      docId,
      selectedVersionId,
      setBaseDocumentData,
      setDocumentData,
      setError,
      setErrorReportGate,
      setIsBusy,
      setProjectMembers,
      setProjectName,
      setProjectShortId,
      setSelectedAuthorId,
      setSelectedReviewerIds,
      setSelectedVersionId,
      setUserDirectoryById,
      setVersions,
      user?.displayName,
      user?.email,
      userId,
    ],
  );

  useDocumentSubscription({
    docId,
    projectIdFromQuery: derived.projectIdFromQuery,
    setDocumentData: setDocumentData,
    setVersions: setVersions,
    setBaseDocumentData: setBaseDocumentData,
    setError: setError,
  });
  useRoleSubscriptions({
    docId,
    userId,
    activeProjectId: documentData?.projectId ?? derived.projectIdFromQuery,
    setIsAdmin: setIsAdmin,
    setIsLeader: setIsLeader,
  });
  useEffect(() => {
    const resetUploadStatusTimer = window.setTimeout(() => {
      setUploadStatus("idle");
      setUploadMessage("");
    }, 0);
    return () => window.clearTimeout(resetUploadStatusTimer);
  }, [selectedVersionId, setUploadMessage, setUploadStatus]);

  const reportVersionsErrorRef = useRef(derived.reportVersionsError);
  useEffect(() => {
    reportVersionsErrorRef.current = derived.reportVersionsError;
  }, [derived.reportVersionsError]);

  useThreadsAndCommentsSubscription({
    selectedVersionId: derived.selectedVersion?.id,
    projectId: derived.projectId,
    docId,
    threadIdFromQuery: derived.threadIdFromQuery,
    commentsRetryToken: commentsRetryToken,
    commentsRetryTimeoutRef: commentsRetryTimeoutRef,
    reportVersionsErrorRef,
    setThreads: setThreads,
    setVisibleThreadRows: setVisibleThreadRows,
    setCommentsByThread: setCommentsByThread,
    setSelectedThreadId: setSelectedThreadId,
    setNewThreadTitle: setNewThreadTitle,
    setNewCommentBody: setNewCommentBody,
    setPendingThreadStatusChange: setPendingThreadStatusChange,
    setIsLoadingThreads: setIsLoadingThreads,
    setCommentsRetryToken: setCommentsRetryToken,
    setError: setError,
    lastAppliedThreadQueryRef: lastAppliedThreadQueryRef,
  });
  useThreadQueryNavigation({
    threadIdFromQuery: derived.threadIdFromQuery,
    effectiveSelectedThreadId: derived.effectiveSelectedThreadId,
    commentIdFromQuery: derived.commentIdFromQuery,
    threads: threads,
    commentsByThread: commentsByThread,
    commentsViewMode: commentsViewMode,
    selectedThreadId: selectedThreadId,
    lastAppliedThreadQueryRef: lastAppliedThreadQueryRef,
    lastAppliedCommentQueryRef: lastAppliedCommentQueryRef,
    pendingManualThreadSelectionRef: pendingManualThreadSelectionRef,
    preservedThreadNavigationScrollYRef: preservedThreadNavigationScrollYRef,
    setSelectedThreadId: setSelectedThreadId,
    setNewCommentBody: setNewCommentBody,
    setCommentsViewMode: setCommentsViewMode,
    setHighlightedCommentId: setHighlightedCommentId,
  });
  useDashboardFocus({
    dashboardFocusTarget: derived.dashboardFocusTarget,
    selectedVersion: derived.selectedVersion,
    selectedThread: derived.selectedThread,
    effectiveSelectedThreadId: derived.effectiveSelectedThreadId,
    isLoadingVersions: isLoadingVersions,
    isLoadingThreads: isLoadingThreads,
    lastAppliedDashboardFocusRef: lastAppliedDashboardFocusRef,
    versionsActionsRef: versionsActionsRef,
    filePanelRef: filePanelRef,
    reviewIssuesPanelRef: reviewIssuesPanelRef,
    commentInputRef: commentInputRef,
  });
  useSelectedFileMetadata({
    selectedVersion: derived.selectedVersion,
    projectId: derived.projectId,
    docId,
    localFileRefByIdRef: localFileRefByIdRef,
    reportVersionsErrorRef,
    setSelectedFileRef: setSelectedFileRef,
    setFileMetadataNotice: setFileMetadataNotice,
    setError: setError,
  });
  useVersionsProjectSubscription({
    docId,
    activeProjectId: documentData?.projectId ?? derived.projectIdFromQuery,
    reportVersionsError: derived.reportVersionsError,
    setError: setError,
    setIsLoadingVersions: setIsLoadingVersions,
    setVersions: setVersions,
    setProjectMembers: setProjectMembers,
    setProjectName: setProjectName,
    setProjectShortId: setProjectShortId,
  });
  useUserDirectoryRefresh({
    projectMembers: projectMembers,
    versions: versions,
    userId,
    userEmail: user?.email,
    userDisplayName: user?.displayName,
    setUserDirectoryById: setUserDirectoryById,
  });
  useSelectedVersionSync({
    versions: versions,
    selectedVersionId: selectedVersionId,
    versionIdFromQuery: derived.versionIdFromQuery,
    projectMembers: projectMembers,
    lastAppliedVersionQueryRef: lastAppliedVersionQueryRef,
    setSelectedReviewerIds: setSelectedReviewerIds,
    setSelectedAuthorId: setSelectedAuthorId,
    setSelectedVersionId: setSelectedVersionId,
  });
  useEffect(() => {
    if (selectedAuthorId) {
      const syncReviewerSelectionTimer = window.setTimeout(() => {
        setSelectedReviewerIds((current) =>
          current.filter((reviewerId) => reviewerId !== selectedAuthorId),
        );
      }, 0);
      return () => window.clearTimeout(syncReviewerSelectionTimer);
    }
  }, [selectedAuthorId, setSelectedReviewerIds]);
  useVersionPreferences({
    viewMode: viewMode,
    versionSorting: versionSorting,
    threadsViewMode: threadsViewMode,
    commentsViewMode: commentsViewMode,
    setVersionSorting: setVersionSorting,
  });

  const reloadAndRestoreSelection = useCallback(
    async (versionId: string | null, threadId?: string | null) => {
      setSelectedVersionId((current) =>
        current === versionId ? current : versionId,
      );
      if (threadId !== undefined) {
        const nextThreadId = threadId ?? null;
        setSelectedThreadId((current) =>
          current === nextThreadId ? current : nextThreadId,
        );
      }
    },
    [setSelectedThreadId, setSelectedVersionId],
  );

  const fileActions = useFileActions({
    docId,
    projectId: derived.projectId,
    userId,
    userEmail: user?.email,
    selectedVersion: derived.selectedVersion,
    selectedFileRef: selectedFileRef,
    canUploadFile: derived.canUploadFile,
    downloadStatus: downloadStatus,
    uploadInputRef: uploadInputRef,
    localFileRefByIdRef: localFileRefByIdRef,
    reloadAndRestoreSelection,
    reportVersionsError: derived.reportVersionsError,
    setError: setError,
    setSuccessMessage: setSuccessMessage,
    setIsBusy: setIsBusy,
    setUploadStatus: setUploadStatus,
    setUploadMessage: setUploadMessage,
    setDownloadStatus: setDownloadStatus,
    setDownloadMessage: setDownloadMessage,
    setSelectedFileRef: setSelectedFileRef,
    setFileMetadataNotice: setFileMetadataNotice,
  });

  const selectVersionAndClearThreadQuery = useCallback(
    (versionId: string | null) => {
      pendingManualThreadSelectionRef.current = null;
      lastAppliedCommentQueryRef.current = null;
      setHighlightedCommentId(null);
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete("threadId");
      nextSearchParams.delete("commentId");
      setSearchParams(nextSearchParams, {
        replace: true,
        preventScrollReset: true,
      });
      setSelectedVersionId(versionId);
    },
    [
      lastAppliedCommentQueryRef,
      pendingManualThreadSelectionRef,
      searchParams,
      setSearchParams,
      setHighlightedCommentId,
      setSelectedVersionId,
    ],
  );

  const selectThreadKeepingViewport = useCallback(
    (threadId: string) => {
      if (!threadId) return;
      preservedThreadNavigationScrollYRef.current = window.scrollY;
      pendingManualThreadSelectionRef.current = threadId;
      if (
        derived.dashboardFocusTarget === "comments" &&
        derived.selectedVersion?.id
      ) {
        lastAppliedDashboardFocusRef.current = `${derived.dashboardFocusTarget}|${derived.selectedVersion.id}|${threadId}`;
      }
      lastAppliedCommentQueryRef.current = null;
      setHighlightedCommentId(null);
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.set("threadId", threadId);
      nextSearchParams.delete("commentId");
      setSearchParams(nextSearchParams, {
        replace: true,
        preventScrollReset: true,
      });
      setSelectedThreadId((current) => {
        if (current === threadId) {
          preservedThreadNavigationScrollYRef.current = null;
          return current;
        }
        return threadId;
      });
    },
    [
      derived,
      lastAppliedCommentQueryRef,
      lastAppliedDashboardFocusRef,
      pendingManualThreadSelectionRef,
      preservedThreadNavigationScrollYRef,
      searchParams,
      setSearchParams,
      setHighlightedCommentId,
      setSelectedThreadId,
    ],
  );

  return {
    ...fileActions,
    loadDocumentAndVersions,
    reloadAndRestoreSelection,
    selectThreadKeepingViewport,
    selectVersionAndClearThreadQuery,
  };
};

export default useVersionsRuntimeModel;
