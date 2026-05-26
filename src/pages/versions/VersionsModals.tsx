// Central modal presenter for confirmations, document title edits, success messages, and error reporting context.
import type { Dispatch, RefObject, SetStateAction } from "react";
import ErrorChecklistModal, {
  type ChecklistItem,
} from "../../components/ErrorChecklistModal";
import ModalDialog from "../../components/ModalDialog";
import { GiphyInline } from "../../giphy/GiphyProvider";
import type { PendingVersionAction, ThreadSummary } from "./types";
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
  pendingVersionAction: PendingVersionAction | null;
  onClosePendingVersionAction: () => void;
  onConfirmPendingVersionAction: () => void;
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
    pendingVersionAction,
    onClosePendingVersionAction,
    onConfirmPendingVersionAction,
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
        <ModalDialog onClose={onCloseVersionDecisionModal}>
          <h3>
            {versionDecisionModal === "accept"
              ? "Accept latest version"
              : "Reject latest version"}
          </h3>
          <GiphyInline reason="thinking" mode="inline" />
          <p className="muted">
            {versionDecisionModal === "accept"
              ? "Confirm acceptance of the latest version. This will update its status to Accepted."
              : "Confirm rejection of the latest version. This will update its status to Rejected."}
          </p>
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
                ? "Confirm starting review for the latest version."
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
        <ModalDialog onClose={onClosePendingThreadStatusChange}>
          <h3>
            {pendingThreadStatusChange.status === "open"
              ? "Close issue"
              : "Reopen issue"}
          </h3>
          <GiphyInline reason="thinking" mode="inline" />
          <p className="muted">
            {pendingThreadStatusChange.status === "open"
              ? "Confirm closing this issue."
              : "Confirm reopening this issue."}
          </p>
          <div className="actions">
            <button
              type="button"
              onClick={onClosePendingThreadStatusChange}
              disabled={isBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmThreadStatusChange}
              disabled={isBusy}
            >
              Confirm
            </button>
          </div>
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

function ProgressModal({ title, message }: { title: string; message: string }) {
  return (
    <ModalDialog>
      <h3>{title}</h3>
      <GiphyInline reason="loading" mode="inline" />
      <p className="muted">{message}</p>
    </ModalDialog>
  );
}

export default VersionsModals;
