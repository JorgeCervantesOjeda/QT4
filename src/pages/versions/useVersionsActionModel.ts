// src/pages/versions/useVersionsActionModel.ts
// Groups user-triggered mutations and table action columns for VersionsPage.
import { useCallback } from "react";
import { useMemberColumns, useThreadColumns } from "./columns";
import { createErrorReportActions } from "./errorReportActions";
import { createReviewIssueActions } from "./reviewIssueActions";
import { createVersionCreateAndReviewActions } from "./versionCreateAndReviewActions";
import { createVersionDecisionActions } from "./versionDecisionActions";
import type useVersionsDerivedModel from "./useVersionsDerivedModel";
import type useVersionsRuntimeModel from "./useVersionsRuntimeModel";
import type { ThreadSummary } from "./types";
import type { VersionsPageState } from "./versionsPageState";

type UseVersionsActionModelParams = {
  derived: ReturnType<typeof useVersionsDerivedModel>;
  docId?: string;
  navigate: (path: string) => void;
  runtime: ReturnType<typeof useVersionsRuntimeModel>;
  state: VersionsPageState;
  userEmail?: string | null;
  userId: string;
};

const useVersionsActionModel = ({
  derived,
  docId,
  navigate,
  runtime,
  state,
  userEmail,
  userId,
}: UseVersionsActionModelParams) => {
  const {
    handleUploadFile,
    loadDocumentAndVersions,
    reloadAndRestoreSelection,
    selectThreadKeepingViewport,
    selectVersionAndClearThreadQuery,
  } = runtime;
  const {
    commentsByThread,
    documentData,
    errorReportGate,
    isAdmin,
    isBusy,
    isLeader,
    isMembersTableCompact,
    newCommentBody,
    newThreadTitle,
    pendingThreadStatusChange,
    pendingUploadFile,
    pendingVersionAction,
    selectedVersionId,
    setEmailNotifyMessage,
    setEmailNotifyStatus,
    setError,
    setErrorReportTitle,
    setErrorReportTitleError,
    setIsBusy,
    setIsErrorReportModalOpen,
    setNewCommentBody,
    setNewThreadTitle,
    setPendingThreadStatusChange,
    setPendingUploadFile,
    setPendingVersionAction,
    setSelectedThreadId,
    setSuccessEmailRecipients,
    setSuccessMessage,
    setVersionDecisionModal,
    setWarningMessage,
    threads,
    uploadInputRef,
    versionDecisionModal,
    versions,
  } = state;

  const { handleCreateVersion, handleStartReview } =
    createVersionCreateAndReviewActions({
      canCreateVersion: derived.canCreateVersion,
      canStartReview: derived.canStartReview,
      docId,
      documentData: documentData,
      errorReportGate: errorReportGate,
      formatUserLabel: derived.formatUserLabel,
      latestVersion: derived.latestVersion,
      loadDocumentAndVersions,
      projectId: derived.projectId,
      reportVersionsError: derived.reportVersionsError,
      resolveUserEmail: derived.resolveUserEmail,
      setEmailNotifyMessage: setEmailNotifyMessage,
      setEmailNotifyStatus: setEmailNotifyStatus,
      setError: setError,
      setIsBusy: setIsBusy,
      setSuccessEmailRecipients: setSuccessEmailRecipients,
      setSuccessMessage: setSuccessMessage,
      setWarningMessage: setWarningMessage,
      userEmail,
      userId,
      versions: versions,
    });

  const memberColumns = useMemberColumns({
    handleAssignAuthor: derived.handleAssignAuthor,
    handleToggleReviewer: derived.handleToggleReviewer,
    isBusy: isBusy,
    isMembersTableCompact: isMembersTableCompact,
  });

  const { handleConfirmVersionDecision, requestVersionDecisionConfirmation } =
    createVersionDecisionActions({
      canAcceptOrReject: derived.canAcceptOrReject,
      docId,
      documentData: documentData,
      isAdmin: isAdmin,
      isLeader: isLeader,
      latestVersion: derived.latestVersion,
      loadDocumentAndVersions,
      logBlockedVersionDecision: derived.logBlockedVersionDecision,
      projectId: derived.projectId,
      reportVersionsError: derived.reportVersionsError,
      setError: setError,
      setIsBusy: setIsBusy,
      setSuccessMessage: setSuccessMessage,
      setVersionDecisionModal: setVersionDecisionModal,
      userEmail,
      userId,
      versionDecisionModal: versionDecisionModal,
      versions: versions,
    });

  const { handleCreateErrorReport, requestErrorReportCreation } =
    createErrorReportActions({
      canCreateErrorReportActor: derived.canCreateErrorReportActor,
      docId,
      latestVersion: derived.latestVersion,
      navigate,
      projectId: derived.projectId,
      setError: setError,
      setErrorReportTitle: setErrorReportTitle,
      setErrorReportTitleError: setErrorReportTitleError,
      setIsBusy: setIsBusy,
      setIsErrorReportModalOpen: setIsErrorReportModalOpen,
      setSuccessMessage: setSuccessMessage,
      userEmail,
      userId,
    });

  const handleConfirmPendingVersionAction = async () => {
    const action = pendingVersionAction;
    const file = pendingUploadFile;
    setPendingVersionAction(null);
    setPendingUploadFile(null);
    if (action === "createVersion") {
      await handleCreateVersion();
      return;
    }
    if (action === "startReview") {
      await handleStartReview();
      return;
    }
    if (action === "replaceFile") {
      if (file) {
        await handleUploadFile(file);
      } else {
        setError("Select a file before replacing the current one.");
      }
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
    }
  };

  const handleClosePendingVersionAction = () => {
    setPendingVersionAction(null);
    setPendingUploadFile(null);
    const uploadInput = uploadInputRef.current;
    if (uploadInput) {
      uploadInput.value = "";
    }
  };

  const requestCreateVersionConfirmation = () => {
    if (!docId || !derived.projectId || !userId || !documentData) {
      setError("Sign in and select a document before creating a version.");
      return;
    }
    if (!derived.canCreateVersion) {
      if (
        derived.latestVersion &&
        derived.latestVersion.status === "Accepted" &&
        errorReportGate.isLoading
      ) {
        setError(
          "Please wait while we check related error reports, then try again.",
        );
        return;
      }
      if (
        derived.latestVersion &&
        derived.latestVersion.status === "Accepted" &&
        errorReportGate.isBlocking
      ) {
        setError(
          "To create the next version from an Accepted version, at least one related error report must have latest version in Accepted.",
        );
        return;
      }
      setError(
        [
          "To create a version: ((user is project leader) or",
          "(user is latest version author) or (user is admin)) and",
          "((latest version status = 'In Review' or 'Reviewed') or",
          "((latest version status = 'Accepted') and",
          "(exists related error report with latest version status = 'Accepted'))).",
        ].join(" "),
      );
      return;
    }
    setError(null);
    setPendingVersionAction("createVersion");
  };

  const requestStartReviewConfirmation = () => {
    if (!derived.latestVersion || !userId) {
      setError("Select a version to start review.");
      return;
    }
    if (!derived.canStartReview) {
      setError(
        [
          "To start review, the version must be In Creation,",
          "have linked file metadata (fileRefId), have at least one reviewer,",
          "and you must be the author or leader.",
        ].join(" "),
      );
      return;
    }
    setError(null);
    setPendingVersionAction("startReview");
  };

  const requestReplaceFileConfirmation = (file: File) => {
    if (!docId || !derived.projectId || !derived.selectedVersion || !userId) {
      setError("Select a version to upload a file.");
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      return;
    }
    if (!derived.canUploadFile) {
      setError("You can upload a file only while the version is In Creation.");
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      return;
    }
    setError(null);
    setPendingUploadFile(file);
    setPendingVersionAction("replaceFile");
  };

  const reviewIssueActions = createReviewIssueActions({
    canAddComment: derived.canAddComment,
    canCreateThread: derived.canCreateThread,
    canParticipateReview: derived.canParticipateReview,
    commentsByThread: commentsByThread,
    currentDocumentAuthorId: derived.currentDocumentAuthorId,
    docId,
    documentData: documentData,
    formatUserLabel: derived.formatUserLabel,
    newCommentBody: newCommentBody,
    newThreadTitle: newThreadTitle,
    projectId: derived.projectId,
    reloadAndRestoreSelection,
    reportVersionsError: derived.reportVersionsError,
    resolveUserEmail: derived.resolveUserEmail,
    selectedThread: derived.selectedThread,
    selectedThreadComments: derived.selectedThreadComments,
    selectedVersion: derived.selectedVersion,
    selectedVersionInActiveReview: derived.selectedVersionInActiveReview,
    setEmailNotifyMessage: setEmailNotifyMessage,
    setEmailNotifyStatus: setEmailNotifyStatus,
    setError: setError,
    setIsBusy: setIsBusy,
    setNewCommentBody: setNewCommentBody,
    setNewThreadTitle: setNewThreadTitle,
    setPendingThreadStatusChange: setPendingThreadStatusChange,
    setSelectedThreadId: setSelectedThreadId,
    setSuccessEmailRecipients: setSuccessEmailRecipients,
    setSuccessMessage: setSuccessMessage,
    setWarningMessage: setWarningMessage,
    threads: threads,
    userEmail,
    userId,
  });

  const requestThreadStatusChangeConfirmation = useCallback(
    (thread: ThreadSummary) => {
      if (reviewIssueActions.canChangeThreadStatus(thread)) {
        selectThreadKeepingViewport(thread.id);
        setError(null);
        setPendingThreadStatusChange(thread);
      }
    },
    [
      reviewIssueActions,
      selectThreadKeepingViewport,
      setError,
      setPendingThreadStatusChange,
    ],
  );

  const threadColumns = useThreadColumns({
    formatUserLabel: derived.formatUserLabel,
    getThreadCommentWindowMeta: derived.getThreadCommentWindowMeta,
    requestThreadStatusChangeConfirmation,
    isBusy: isBusy,
  });

  const handleConfirmThreadStatusChange = async () => {
    await reviewIssueActions.handleConfirmThreadStatusChange(
      pendingThreadStatusChange,
    );
  };

  const openReviewIssuesForVersion = (versionId: string) => {
    if (!isBusy) {
      selectVersionAndClearThreadQuery(versionId);
    }
  };

  const moveSelectedVersion = useCallback(
    (direction: 1 | -1) => {
      if (isBusy || versions.length === 0) return;
      const currentIndex = selectedVersionId
        ? versions.findIndex((version) => version.id === selectedVersionId)
        : -1;
      if (currentIndex < 0) {
        selectVersionAndClearThreadQuery(versions[0].id);
        return;
      }
      const nextIndex = Math.min(
        versions.length - 1,
        Math.max(0, currentIndex + direction),
      );
      selectVersionAndClearThreadQuery(versions[nextIndex].id);
    },
    [isBusy, selectedVersionId, selectVersionAndClearThreadQuery, versions],
  );

  return {
    handleAddComment: reviewIssueActions.handleAddComment,
    handleClosePendingVersionAction,
    handleConfirmPendingVersionAction,
    handleConfirmThreadStatusChange,
    handleConfirmVersionDecision,
    handleCreateErrorReport,
    handleCreateThread: reviewIssueActions.handleCreateThread,
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
  };
};

export default useVersionsActionModel;
