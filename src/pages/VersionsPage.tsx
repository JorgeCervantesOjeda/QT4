// src/pages/VersionsPage.tsx
// Coordinates the Versions page state, permissions, server actions, and extracted presentation modules.
// Keep domain-specific logic in pages/versions helpers so this route controller stays bounded.
import { useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import VersionsPageView from "./versions/VersionsPageView";
import useVersionsPageState from "./versions/versionsPageState";
import useVersionsActionModel from "./versions/useVersionsActionModel";
import useVersionsDerivedModel from "./versions/useVersionsDerivedModel";
import useVersionsRuntimeModel from "./versions/useVersionsRuntimeModel";
import useVersionsStatusModel from "./versions/useVersionsStatusModel";

function VersionsPage() {
  const { docId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const userId = user?.uid ?? "";
  const navigate = useNavigate();
  const versionsPageState = useVersionsPageState();
  const derived = useVersionsDerivedModel({
    docId,
    searchParams,
    user,
    userId,
    state: versionsPageState,
  });
  const {
    versions,
    documentData,
    baseDocumentData,
    projectName,
    projectShortId,
    selectedReviewerIds,
    uploadStatus,
    uploadMessage,
    downloadStatus,
    downloadMessage,
    emailNotifyStatus,
    emailNotifyMessage,
    uploadInputRef,
    selectedFileRef,
    fileMetadataNotice,
    isErrorReportModalOpen,
    setIsErrorReportModalOpen,
    versionDecisionModal,
    setVersionDecisionModal,
    pendingVersionAction,
    setPendingVersionAction,
    setPendingUploadFile,
    errorReportTitle,
    setErrorReportTitle,
    errorReportTitleError,
    setErrorReportTitleError,
    viewMode,
    setViewMode,
    threadsViewMode,
    setThreadsViewMode,
    commentsViewMode,
    setCommentsViewMode,
    versionSorting,
    setVersionSorting,
    membersSorting,
    setMembersSorting,
    threadsSorting,
    setThreadsSorting,
    commentsSorting,
    setCommentsSorting,
    isBusy,
    isLoadingVersions,
    error,
    setError,
    successMessage,
    setSuccessMessage,
    successEmailRecipients,
    setSuccessEmailRecipients,
    warningMessage,
    successOkButtonRef,
    documentTitleInputRef,
    commentInputRef,
    versionsActionsRef,
    filePanelRef,
    reviewIssuesPanelRef,
    acceptedErrorReports,
    acceptedErrorReportsStatus,
    threads,
    setVisibleThreadRows,
    commentsByThread,
    highlightedCommentId,
    pendingThreadStatusChange,
    setPendingThreadStatusChange,
    newThreadTitle,
    setNewThreadTitle,
    newCommentBody,
    setNewCommentBody,
    isLoadingThreads,
    clockNowMs,
    setClockNowMs,
    setIsMembersTableCompact,
    autoReviewUpdateRef,
    autoReviewPermissionDeniedVersionIdsRef,
  } = versionsPageState;
  const {
    projectId,
    latestVersion,
    selectedVersion,
    selectedDownloadProvider,
    effectiveSelectedThreadId,
    getVersionDownloadProvider,
    canEditDocumentTitle,
    isDocumentTitleModalOpen,
    documentTitleDraft,
    documentTitleError,
    setDocumentTitleDraft,
    requestDocumentTitleEdit,
    closeDocumentTitleModal,
    handleSaveDocumentTitle,
    canManageLatestVersion,
    selectedThread,
    projectReportLabel,
    documentReportLabel,
    versionReportLabel,
    threadReportLabel,
    selectedThreadComments,
    latestVersionIsSelected,
    latestSelectedVersionCommentAt,
    selectedVersionReviewGraceRemainingMs,
    selectedVersionHasReviewGrace,
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
    membersTableRows,
    requestDownloadVersionFile,
    statusClassName,
    allowedReviewerIds,
    createButtonLabel,
    canAssignReviewers,
    canUploadFile,
    handleToggleAllReviewers,
    errorChecklist,
    versionColumns,
    commentColumns,
  } = derived;
  const runtime = useVersionsRuntimeModel({
    derived,
    docId,
    searchParams,
    setSearchParams,
    state: versionsPageState,
    user,
    userId,
  });
  const {
    handleUploadFile,
    requestDownloadSelectedFile,
    selectThreadKeepingViewport,
    selectVersionAndClearThreadQuery,
  } = runtime;
  const handleCloseSuccessMessage = () => {
    const shouldRestoreCommentFocus =
        successMessage === "The comment was added successfully.",
      shouldRestoreNewIssueCommentFocus =
        successMessage === "Issue created successfully.";
    setSuccessEmailRecipients(null);
    setSuccessMessage(null);
    if (shouldRestoreCommentFocus) {
      window.setTimeout(() => {
        commentInputRef.current?.focus();
      }, 0);
    }
    if (shouldRestoreNewIssueCommentFocus) {
      window.setTimeout(() => {
        commentInputRef.current?.focus();
      }, 0);
    }
  };
  const handleSelectAdjacentThread = useCallback(
    (direction: -1 | 1) => {
      if (selectedThreadIndex < 0) return;
      const targetThread = orderedThreads[selectedThreadIndex + direction];
      if (targetThread) {
        selectThreadKeepingViewport(targetThread.id);
      }
    },
    [selectedThreadIndex, orderedThreads, selectThreadKeepingViewport],
  );
  const {
    selectedReviewTimerLabel,
    selectedReviewTimerState,
    versionSelectStatusClassName,
    versionStatusClassName,
    versionStatusColor,
  } = useVersionsStatusModel({
    autoReviewPermissionDeniedVersionIdsRef,
    autoReviewUpdateRef,
    canManageLatestVersion,
    clockNowMs,
    documentData,
    hasSelectedVersionComments,
    isLoadingThreads,
    latestSelectedVersionCommentAt,
    latestVersion,
    latestVersionIsSelected,
    selectedVersion,
    selectedVersionHasReviewGrace,
    selectedVersionReviewGraceRemainingMs,
    setClockNowMs,
    setError,
    setIsMembersTableCompact,
    statusClassName,
    userId,
  });
  const actions = useVersionsActionModel({
    derived,
    docId,
    navigate,
    runtime,
    state: versionsPageState,
    userEmail: user?.email,
    userId,
  });
  const {
    handleAddComment,
    handleClosePendingVersionAction,
    handleConfirmPendingVersionAction,
    handleConfirmThreadStatusChange,
    handleConfirmVersionDecision,
    handleCreateErrorReport,
    handleCreateThread,
    memberColumns,
    moveSelectedVersion,
    openReviewIssuesForVersion,
    requestCreateVersionConfirmation,
    requestErrorReportCreation,
    requestReplaceFileConfirmation,
    requestStartReviewConfirmation,
    requestThreadStatusChangeConfirmation,
    requestVersionDecisionConfirmation,
    threadColumns,
  } = actions;
  return (
    <VersionsPageView
      acceptedErrorReports={acceptedErrorReports}
      acceptedErrorReportsStatus={acceptedErrorReportsStatus}
      allowedReviewerIds={allowedReviewerIds}
      baseDocumentData={baseDocumentData}
      canAssignReviewers={canAssignReviewers}
      canEditDocumentTitle={canEditDocumentTitle}
      canUploadFile={canUploadFile}
      clockNowMs={clockNowMs}
      closeDocumentTitleModal={closeDocumentTitleModal}
      commentColumns={commentColumns}
      commentInputRef={commentInputRef}
      commentWindowCountdownLabel={commentWindowCountdownLabel}
      commentsByThread={commentsByThread}
      commentsSorting={commentsSorting}
      commentsViewMode={commentsViewMode}
      createButtonLabel={createButtonLabel}
      documentData={documentData}
      documentReportLabel={documentReportLabel}
      documentTitleDraft={documentTitleDraft}
      documentTitleError={documentTitleError}
      documentTitleInputRef={documentTitleInputRef}
      downloadMessage={downloadMessage}
      downloadStatus={downloadStatus}
      effectiveSelectedThreadId={effectiveSelectedThreadId}
      emailNotifyMessage={emailNotifyMessage}
      emailNotifyStatus={emailNotifyStatus}
      error={error}
      errorChecklist={errorChecklist}
      errorReportTitle={errorReportTitle}
      errorReportTitleError={errorReportTitleError}
      fileMetadataNotice={fileMetadataNotice}
      filePanelRef={filePanelRef}
      formatUserLabel={formatUserLabel}
      getThreadCommentWindowMeta={getThreadCommentWindowMeta}
      getVersionDownloadProvider={getVersionDownloadProvider}
      handleAddComment={handleAddComment}
      handleCloseSuccessMessage={handleCloseSuccessMessage}
      handleConfirmPendingVersionAction={handleConfirmPendingVersionAction}
      handleClosePendingVersionAction={handleClosePendingVersionAction}
      handleConfirmThreadStatusChange={handleConfirmThreadStatusChange}
      handleConfirmVersionDecision={handleConfirmVersionDecision}
      handleCreateErrorReport={handleCreateErrorReport}
      handleCreateThread={handleCreateThread}
      handleSaveDocumentTitle={handleSaveDocumentTitle}
      handleSelectAdjacentThread={handleSelectAdjacentThread}
      handleToggleAllReviewers={handleToggleAllReviewers}
      handleUploadFile={handleUploadFile}
      hasNextThread={hasNextThread}
      hasPreviousThread={hasPreviousThread}
      highlightedCommentId={highlightedCommentId}
      isBusy={isBusy}
      isDocumentTitleModalOpen={isDocumentTitleModalOpen}
      isErrorReportModalOpen={isErrorReportModalOpen}
      isLoadingThreads={isLoadingThreads}
      isLoadingVersions={isLoadingVersions}
      latestVersion={latestVersion}
      memberColumns={memberColumns}
      membersSorting={membersSorting}
      membersTableRows={membersTableRows}
      moveSelectedVersion={moveSelectedVersion}
      navigate={navigate}
      newCommentBody={newCommentBody}
      newThreadTitle={newThreadTitle}
      openReviewIssuesForVersion={openReviewIssuesForVersion}
      pendingThreadStatusChange={pendingThreadStatusChange}
      pendingVersionAction={pendingVersionAction}
      projectId={projectId}
      projectName={projectName}
      projectReportLabel={projectReportLabel}
      projectShortId={projectShortId}
      requestCreateVersionConfirmation={requestCreateVersionConfirmation}
      requestDownloadSelectedFile={requestDownloadSelectedFile}
      requestDownloadVersionFile={requestDownloadVersionFile}
      requestErrorReportCreation={requestErrorReportCreation}
      requestReplaceFileConfirmation={requestReplaceFileConfirmation}
      requestStartReviewConfirmation={requestStartReviewConfirmation}
      requestThreadStatusChangeConfirmation={
        requestThreadStatusChangeConfirmation
      }
      requestVersionDecisionConfirmation={requestVersionDecisionConfirmation}
      requestDocumentTitleEdit={requestDocumentTitleEdit}
      reviewIssuesPanelRef={reviewIssuesPanelRef}
      selectedCommentWindowState={selectedCommentWindowState}
      selectedDownloadProvider={selectedDownloadProvider}
      selectedFileRef={selectedFileRef}
      selectedReviewTimerLabel={selectedReviewTimerLabel}
      selectedReviewTimerState={selectedReviewTimerState}
      selectedReviewerIds={selectedReviewerIds}
      selectedThread={selectedThread}
      selectedThreadComments={selectedThreadComments}
      selectedVersion={selectedVersion}
      selectThreadKeepingViewport={selectThreadKeepingViewport}
      selectVersionAndClearThreadQuery={selectVersionAndClearThreadQuery}
      setCommentsSorting={setCommentsSorting}
      setCommentsViewMode={setCommentsViewMode}
      setDocumentTitleDraft={setDocumentTitleDraft}
      setError={setError}
      setErrorReportTitle={setErrorReportTitle}
      setErrorReportTitleError={setErrorReportTitleError}
      setIsErrorReportModalOpen={setIsErrorReportModalOpen}
      setMembersSorting={setMembersSorting}
      setNewCommentBody={setNewCommentBody}
      setNewThreadTitle={setNewThreadTitle}
      setPendingThreadStatusChange={setPendingThreadStatusChange}
      setPendingUploadFile={setPendingUploadFile}
      setPendingVersionAction={setPendingVersionAction}
      setThreadsSorting={setThreadsSorting}
      setThreadsViewMode={setThreadsViewMode}
      setVersionDecisionModal={setVersionDecisionModal}
      setVersionSorting={setVersionSorting}
      setViewMode={setViewMode}
      setVisibleThreadRows={setVisibleThreadRows}
      successEmailRecipients={successEmailRecipients}
      successMessage={successMessage}
      successOkButtonRef={successOkButtonRef}
      threadColumns={threadColumns}
      threadNavigationStatusLabel={threadNavigationStatusLabel}
      threadReportLabel={threadReportLabel}
      threads={threads}
      threadsSorting={threadsSorting}
      threadsViewMode={threadsViewMode}
      uploadInputRef={uploadInputRef}
      uploadMessage={uploadMessage}
      uploadStatus={uploadStatus}
      versionColumns={versionColumns}
      versionDecisionModal={versionDecisionModal}
      versionReportLabel={versionReportLabel}
      versionSelectStatusClassName={versionSelectStatusClassName}
      versionSorting={versionSorting}
      versionStatusClassName={versionStatusClassName}
      versionStatusColor={versionStatusColor}
      versions={versions}
      versionsActionsRef={versionsActionsRef}
      viewMode={viewMode}
      warningMessage={warningMessage}
    />
  );
}

export default VersionsPage;
