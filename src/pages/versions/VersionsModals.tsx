// src/pages/versions/VersionsModals.tsx
// Presents confirmations, document title edits, success messages, and error reporting context.
import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import ErrorChecklistModal, {
  type ChecklistItem,
} from "../../components/ErrorChecklistModal";
import ModalDialog from "../../components/ModalDialog";
import ProgressModal from "../../components/ProgressModal";
import { GiphyInline } from "../../giphy/GiphyProvider";
import { reportUserVisibleError } from "../../lib/errorMonitor";
import type {
  PendingVersionAction,
  PropagationFailurePrompt,
  ThreadSummary,
} from "./types";
import { formatEmailRecipientsLine } from "./utils";

type ErrorReportContext = {
  projectId: string;
  docId: string;
  versionId?: string;
  threadId?: string;
  pageLabel: string;
  projectLabel: string;
  docLabel: string;
  versionLabel: string;
  threadLabel: string;
};

type VersionsModalsProps = {
  isBusy: boolean;
  isDocumentTitleModalOpen: boolean;
  documentTitleInputRef: RefObject<HTMLInputElement | null>;
  documentTitleDraft: string;
  documentTitleError: string | null;
  setDocumentTitleDraft: Dispatch<SetStateAction<string>>;
  onCloseDocumentTitleModal: () => void;
  onSaveDocumentTitle: () => void;
  isErrorReportModalOpen: boolean;
  errorReportTitle: string;
  errorReportTitleError: string | null;
  setErrorReportTitle: Dispatch<SetStateAction<string>>;
  onCloseErrorReportModal: () => void;
  onCreateErrorReport: (title: string) => void;
  versionDecisionModal: "accept" | "reject" | null;
  onCloseVersionDecisionModal: () => void;
  onConfirmVersionDecision: () => void;
  propagationFailurePrompt: PropagationFailurePrompt | null;
  onClosePropagationFailurePrompt: () => void;
  onReportPropagationFailure: () => void;
  onRetryPropagatedErrorReports: () => void;
  pendingVersionAction: PendingVersionAction | null;
  onClosePendingVersionAction: () => void;
  onConfirmPendingVersionAction: () => void;
  reviewDurationDays: number;
  pendingThreadStatusChange: ThreadSummary | null;
  onClosePendingThreadStatusChange: () => void;
  onConfirmThreadStatusChange: () => void;
  uploadStatus: "idle" | "uploading" | "success" | "error";
  uploadMessage: string;
  downloadStatus: "idle" | "downloading";
  downloadMessage: string;
  emailNotifyStatus: "idle" | "sending";
  emailNotifyMessage: string;
  successMessage: string | null;
  successEmailRecipients: { to: string[]; cc: string[] } | null;
  successOkButtonRef: RefObject<HTMLButtonElement | null>;
  onCloseSuccessMessage: () => void;
  error: string | null;
  errorChecklist: ChecklistItem[];
  onCloseError: () => void;
  errorReportContext: ErrorReportContext;
};

function VersionsModals(props: VersionsModalsProps) {
  const {
    isBusy,
    isDocumentTitleModalOpen,
    documentTitleInputRef,
    documentTitleDraft,
    documentTitleError,
    setDocumentTitleDraft,
    onCloseDocumentTitleModal,
    onSaveDocumentTitle,
    isErrorReportModalOpen,
    errorReportTitle,
    errorReportTitleError,
    setErrorReportTitle,
    onCloseErrorReportModal,
    onCreateErrorReport,
    versionDecisionModal,
    onCloseVersionDecisionModal,
    onConfirmVersionDecision,
    propagationFailurePrompt,
    onClosePropagationFailurePrompt,
    onReportPropagationFailure,
    onRetryPropagatedErrorReports,
    pendingVersionAction,
    onClosePendingVersionAction,
    onConfirmPendingVersionAction,
    reviewDurationDays,
    pendingThreadStatusChange,
    onClosePendingThreadStatusChange,
    onConfirmThreadStatusChange,
    uploadStatus,
    uploadMessage,
    downloadStatus,
    downloadMessage,
    emailNotifyStatus,
    emailNotifyMessage,
    successMessage,
    successEmailRecipients,
    successOkButtonRef,
    onCloseSuccessMessage,
    error,
    errorChecklist,
    onCloseError,
    errorReportContext,
  } = props;
  const [propagationReportStatus, setPropagationReportStatus] = useState<
    "idle" | "sending" | "sent" | "failed"
  >("idle");
  const isReportingPropagationFailure = propagationReportStatus === "sending";
  const propagationFailureGiphyReason =
    isBusy || isReportingPropagationFailure
      ? "loading"
      : propagationReportStatus === "sent"
        ? "good_job"
        : propagationReportStatus === "failed"
          ? "dislike_rejected_nope"
          : "thinking";
  const versionDecisionProgressTitle =
    versionDecisionModal === "accept"
      ? "Accepting latest version"
      : "Rejecting latest version";
  const versionDecisionConfirmationTitle =
    versionDecisionModal === "accept"
      ? "Accept latest version"
      : "Reject latest version";
  const versionDecisionProgressMessage =
    versionDecisionModal === "accept"
      ? "Applying acceptance to the latest version..."
      : "Applying rejection to the latest version...";
  const versionDecisionConfirmationMessage =
    versionDecisionModal === "accept"
      ? "Confirm acceptance of the latest version. This will update its status to Accepted."
      : "Confirm rejection of the latest version. This will update its status to Rejected.";
  const threadStatusProgressTitle =
    pendingThreadStatusChange?.status === "open"
      ? "Closing issue"
      : "Reopening issue";
  const threadStatusConfirmationTitle =
    pendingThreadStatusChange?.status === "open"
      ? "Close issue"
      : "Reopen issue";
  const threadStatusProgressMessage =
    pendingThreadStatusChange?.status === "open"
      ? "Applying issue closure..."
      : "Applying issue reopening...";
  const threadStatusConfirmationMessage =
    pendingThreadStatusChange?.status === "open"
      ? "Confirm closing this issue."
      : "Confirm reopening this issue.";
  const reportPropagationFailure = async () => {
    if( !propagationFailurePrompt ) {
      return;
    }
    setPropagationReportStatus( "sending" );
    const failureReasons = propagationFailurePrompt.failures
      .map( (failure) => failure.reason )
      .join( ", " );
    const readableContextLines = [
      `Page: ${errorReportContext.pageLabel}`,
      errorReportContext.projectLabel ? `Project: ${errorReportContext.projectLabel}` : null,
      errorReportContext.docLabel ? `Document: ${errorReportContext.docLabel}` : null,
      errorReportContext.versionLabel ? `Version: ${errorReportContext.versionLabel}` : null,
      errorReportContext.threadLabel ? `Issue: ${errorReportContext.threadLabel}` : null,
    ].filter( Boolean );
    const reportMessage = [
      `User-visible error: ${propagationFailurePrompt.message}`,
      readableContextLines.length > 0 ? "" : null,
      ...readableContextLines,
      "",
      `Failures: ${failureReasons || "unknown"}`,
    ].filter( (line) => line !== null ).join( "\n" );
    const wasReported = await reportUserVisibleError( {
      message: reportMessage,
      action: "versions.propagateAcceptedErrorReport",
      source: "storage",
      projectId: propagationFailurePrompt.projectId,
      docId: propagationFailurePrompt.docId,
      versionId: propagationFailurePrompt.versionId,
      pageLabel: errorReportContext.pageLabel,
      projectLabel: errorReportContext.projectLabel,
      docLabel: errorReportContext.docLabel,
      versionLabel: errorReportContext.versionLabel,
      threadLabel: errorReportContext.threadLabel,
    } );
    onReportPropagationFailure();
    setPropagationReportStatus( wasReported ? "sent" : "failed" );
  };

  return (
    <>
      {isDocumentTitleModalOpen ? (
        <ModalDialog
          onClose={onCloseDocumentTitleModal}
          initialFocusRef={documentTitleInputRef}
        >
          <h3>Edit document title</h3>
          <GiphyInline reason="thinking" mode="inline" />
          <label className="field">
            <span>Title</span>
            <input
              ref={documentTitleInputRef}
              type="text"
              value={documentTitleDraft}
              onChange={(event) => setDocumentTitleDraft(event.target.value)}
              placeholder="Enter document title"
              disabled={isBusy}
            />
          </label>
          {documentTitleError ? (
            <p className="error">{documentTitleError}</p>
          ) : null}
          <div className="actions">
            <button
              type="button"
              onClick={onCloseDocumentTitleModal}
              disabled={isBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSaveDocumentTitle}
              disabled={isBusy}
            >
              Save title
            </button>
          </div>
        </ModalDialog>
      ) : null}
      {isErrorReportModalOpen ? (
        <ModalDialog onClose={onCloseErrorReportModal}>
          <h3>Create error report</h3>
          <GiphyInline reason="thinking" mode="inline" />
          <label className="field">
            <span>Title</span>
            <input
              type="text"
              value={errorReportTitle}
              onChange={(event) => setErrorReportTitle(event.target.value)}
              placeholder="Enter error report title"
            />
          </label>
          {errorReportTitleError ? (
            <p className="error">{errorReportTitleError}</p>
          ) : null}
          <div className="actions">
            <button type="button" onClick={onCloseErrorReportModal}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onCreateErrorReport(errorReportTitle)}
              disabled={isBusy}
            >
              Confirm
            </button>
          </div>
        </ModalDialog>
      ) : null}
      {versionDecisionModal ? (
        <ModalDialog onClose={isBusy ? undefined : onCloseVersionDecisionModal}>
          <h3>
            {isBusy ? versionDecisionProgressTitle : versionDecisionConfirmationTitle}
          </h3>
          <GiphyInline reason={isBusy ? "loading" : "thinking"} mode="inline" />
          <p className="muted">
            {isBusy ? versionDecisionProgressMessage : versionDecisionConfirmationMessage}
          </p>
          {!isBusy ? (
            <div className="actions">
              <button
                type="button"
                onClick={onCloseVersionDecisionModal}
                disabled={isBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmVersionDecision}
                disabled={isBusy}
              >
                Confirm
              </button>
            </div>
          ) : null}
        </ModalDialog>
      ) : null}
      {propagationFailurePrompt ? (
        <ModalDialog
          onClose={isBusy || isReportingPropagationFailure ? undefined : onClosePropagationFailurePrompt}
        >
          <h3>
            {isBusy
              ? "Retrying error report propagation"
              : isReportingPropagationFailure
                ? "Reporting propagation failure"
                : "Error report propagation failed"}
          </h3>
          <GiphyInline reason={propagationFailureGiphyReason} mode="inline" showLabel={false} />
          <p className="muted">
            {isBusy
              ? "Retrying propagated error report creation..."
              : isReportingPropagationFailure
                ? "Reporting the propagation failure to the admin..."
                : propagationFailurePrompt.message}
          </p>
          {propagationFailurePrompt.failures.length > 0 ? (
            <ul className="muted">
              {propagationFailurePrompt.failures.map( (failure, index) => (
                <li key={`${failure.reason}-${index}`}>
                  {failure.reason}
                </li>
              ) )}
            </ul>
          ) : null}
          {propagationReportStatus === "sent" ? (
            <p className="muted">The error was reported to the admin.</p>
          ) : null}
          {propagationReportStatus === "failed" ? (
            <p className="error">The admin report could not be sent.</p>
          ) : null}
          <div className="actions">
            <button
              type="button"
              onClick={reportPropagationFailure}
              disabled={isBusy || propagationReportStatus === "sending"}
            >
              {propagationReportStatus === "sending" ? "Reporting..." : "Report to admin"}
            </button>
            <button
              type="button"
              onClick={onRetryPropagatedErrorReports}
              disabled={isBusy || isReportingPropagationFailure}
            >
              Retry
            </button>
            <button
              type="button"
              onClick={onClosePropagationFailurePrompt}
              disabled={isBusy || isReportingPropagationFailure}
            >
              Close
            </button>
          </div>
        </ModalDialog>
      ) : null}
      {pendingVersionAction ? (
        <ModalDialog onClose={onClosePendingVersionAction}>
          <h3>
            {pendingVersionAction === "createVersion"
              ? "Create new version"
              : pendingVersionAction === "startReview"
                ? "Start review"
                : "Replace file"}
          </h3>
          <GiphyInline reason="thinking" mode="inline" />
          <p className="muted">
            {pendingVersionAction === "createVersion"
              ? "Confirm creating a new version."
              : pendingVersionAction === "startReview"
                ? `Confirm starting review for the latest version. Duration: ${reviewDurationDays} ${reviewDurationDays === 1 ? "day" : "days"}.`
                : "Confirm replacing the current file."}
          </p>
          <div className="actions">
            <button
              type="button"
              onClick={onClosePendingVersionAction}
              disabled={isBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmPendingVersionAction}
              disabled={isBusy}
            >
              Confirm
            </button>
          </div>
        </ModalDialog>
      ) : null}
      {pendingThreadStatusChange ? (
        <ModalDialog onClose={isBusy ? undefined : onClosePendingThreadStatusChange}>
          <h3>{isBusy ? threadStatusProgressTitle : threadStatusConfirmationTitle}</h3>
          <GiphyInline reason={isBusy ? "loading" : "thinking"} mode="inline" />
          <p className="muted">
            {isBusy ? threadStatusProgressMessage : threadStatusConfirmationMessage}
          </p>
          {!isBusy ? (
            <div className="actions">
              <button type="button" onClick={onClosePendingThreadStatusChange}>
                Cancel
              </button>
              <button type="button" onClick={onConfirmThreadStatusChange}>
                Confirm
              </button>
            </div>
          ) : null}
        </ModalDialog>
      ) : null}
      {uploadStatus === "uploading" ? (
        <ProgressModal
          title="Uploading file"
          message={uploadMessage || "Uploading..."}
        />
      ) : null}
      {downloadStatus === "downloading" ? (
        <ProgressModal
          title="Downloading file"
          message={downloadMessage || "Downloading..."}
        />
      ) : null}
      {emailNotifyStatus === "sending" ? (
        <ProgressModal
          title="Sending email notifications"
          message={emailNotifyMessage || "Sending notifications..."}
        />
      ) : null}
      {successMessage ? (
        <ModalDialog
          onClose={onCloseSuccessMessage}
          initialFocusRef={successOkButtonRef}
        >
          <h3>Success</h3>
          <GiphyInline reason="good_job" mode="inline" showLabel={false} />
          <p className="muted">{successMessage}</p>
          {successEmailRecipients ? (
            <details className="success-email-recipients">
              <summary>{`Email recipients (${successEmailRecipients.to.length + successEmailRecipients.cc.length})`}</summary>
              <p className="muted">
                {formatEmailRecipientsLine(successEmailRecipients)}
              </p>
            </details>
          ) : null}
          <div className="actions">
            <button
              ref={successOkButtonRef}
              type="button"
              onClick={onCloseSuccessMessage}
            >
              OK
            </button>
          </div>
        </ModalDialog>
      ) : null}
      {error ? (
        <ErrorChecklistModal
          error={error}
          checklist={errorChecklist}
          onClose={onCloseError}
          reportContext={errorReportContext}
        />
      ) : null}
    </>
  );
}

export default VersionsModals;
