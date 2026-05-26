// src/pages/versions/VersionsPageView.tsx
// Renders the Versions page UI from controller-provided state and callbacks.
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import type React from "react";
import { GiphyInline } from "../../giphy/GiphyProvider";
import type { FileStorageProviderKind } from "../../domain/types";
import AcceptedErrorReportsPanel from "./AcceptedErrorReportsPanel";
import AuthorReviewerAssignmentPanel from "./AuthorReviewerAssignmentPanel";
import ReviewIssuesPanel from "./ReviewIssuesPanel";
import VersionFilePanel from "./VersionFilePanel";
import VersionListPanel from "./VersionListPanel";
import VersionsHeader from "./VersionsHeader";
import VersionsModals from "./VersionsModals";
import VersionsToolbar from "./VersionsToolbar";
import type {
  AcceptedErrorReportSummary,
  CommentSummary,
  DocumentSummary,
  FileRefSummary,
  PendingVersionAction,
  ThreadSummary,
  VersionSummary,
} from "./types";

type VersionsPageViewProps = {
  acceptedErrorReports: AcceptedErrorReportSummary[];
  acceptedErrorReportsStatus: "idle" | "loading" | "ready" | "error";
  allowedReviewerIds: string[];
  baseDocumentData: {
    id: string;
    title: string;
    shortId: number | null;
  } | null;
  canAssignReviewers: boolean;
  canEditDocumentTitle: boolean;
  canUploadFile: boolean;
  clockNowMs: number;
  closeDocumentTitleModal: () => void;
  commentColumns: ColumnDef<CommentSummary, unknown>[];
  commentInputRef: React.RefObject<HTMLTextAreaElement | null>;
  commentWindowCountdownLabel: string | null;
  commentsByThread: Record<string, CommentSummary[]>;
  commentsSorting: SortingState;
  commentsViewMode: "card" | "table";
  createButtonLabel: string;
  docId?: string;
  documentData: DocumentSummary | null;
  documentReportLabel: string;
  documentTitleDraft: string;
  documentTitleError: string | null;
  documentTitleInputRef: React.RefObject<HTMLInputElement | null>;
  downloadMessage: string;
  downloadStatus: "idle" | "downloading";
  effectiveSelectedThreadId: string | null;
  emailNotifyMessage: string;
  emailNotifyStatus: "idle" | "sending";
  error: string | null;
  errorChecklist: React.ComponentProps<typeof VersionsModals>["errorChecklist"];
  errorReportTitle: string;
  errorReportTitleError: string | null;
  fileMetadataNotice: string | null;
  filePanelRef: React.RefObject<HTMLElement | null>;
  formatUserLabel: (memberUserId: string) => string;
  getThreadCommentWindowMeta: React.ComponentProps<
    typeof ReviewIssuesPanel
  >["getThreadCommentWindowMeta"];
  getVersionDownloadProvider: (
    version: VersionSummary,
  ) => FileStorageProviderKind | null;
  handleAddComment: () => void;
  handleCloseSuccessMessage: () => void;
  handleConfirmPendingVersionAction: () => void;
  handleConfirmThreadStatusChange: () => void;
  handleConfirmVersionDecision: () => void;
  handleCreateErrorReport: (title: string) => void;
  handleCreateThread: () => void;
  handleSaveDocumentTitle: () => void;
  handleSelectAdjacentThread: (direction: -1 | 1) => void;
  handleClosePendingVersionAction: () => void;
  handleToggleAllReviewers: React.ComponentProps<
    typeof AuthorReviewerAssignmentPanel
  >["onToggleAllReviewers"];
  handleUploadFile: (file: File) => void;
  hasNextThread: boolean;
  hasPreviousThread: boolean;
  highlightedCommentId: string | null;
  isBusy: boolean;
  isDocumentTitleModalOpen: boolean;
  isErrorReportModalOpen: boolean;
  isLoadingThreads: boolean;
  isLoadingVersions: boolean;
  latestVersion: VersionSummary | null;
  memberColumns: React.ComponentProps<
    typeof AuthorReviewerAssignmentPanel
  >["memberColumns"];
  membersSorting: SortingState;
  membersTableRows: React.ComponentProps<
    typeof AuthorReviewerAssignmentPanel
  >["membersTableRows"];
  moveSelectedVersion: (direction: 1 | -1) => void;
  navigate: (path: string) => void;
  newCommentBody: string;
  newThreadTitle: string;
  openReviewIssuesForVersion: (versionId: string) => void;
  pendingThreadStatusChange: ThreadSummary | null;
  pendingVersionAction: PendingVersionAction | null;
  projectId: string;
  projectName: string;
  projectReportLabel: string;
  projectShortId: number | null;
  requestCreateVersionConfirmation: () => void;
  requestDownloadSelectedFile: () => void;
  requestDownloadVersionFile: (version: VersionSummary) => void;
  requestErrorReportCreation: () => void;
  requestReplaceFileConfirmation: (file: File) => void;
  requestStartReviewConfirmation: () => void;
  requestThreadStatusChangeConfirmation: (thread: ThreadSummary) => void;
  requestVersionDecisionConfirmation: (decision: "accept" | "reject") => void;
  requestDocumentTitleEdit: () => void;
  reviewIssuesPanelRef: React.RefObject<HTMLElement | null>;
  selectedCommentWindowState: string;
  selectedDownloadProvider: FileStorageProviderKind | null;
  selectedFileRef: FileRefSummary | null;
  selectedReviewTimerLabel: string | null;
  selectedReviewTimerState: string;
  selectedReviewerIds: string[];
  selectedThread: ThreadSummary | null;
  selectedThreadComments: CommentSummary[];
  selectedVersion: VersionSummary | null;
  selectThreadKeepingViewport: (threadId: string) => void;
  selectVersionAndClearThreadQuery: (versionId: string | null) => void;
  setCommentsSorting: React.Dispatch<React.SetStateAction<SortingState>>;
  setCommentsViewMode: React.Dispatch<React.SetStateAction<"card" | "table">>;
  setDocumentTitleDraft: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setErrorReportTitle: React.Dispatch<React.SetStateAction<string>>;
  setErrorReportTitleError: React.Dispatch<React.SetStateAction<string | null>>;
  setIsErrorReportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMembersSorting: React.Dispatch<React.SetStateAction<SortingState>>;
  setNewCommentBody: React.Dispatch<React.SetStateAction<string>>;
  setNewThreadTitle: React.Dispatch<React.SetStateAction<string>>;
  setPendingThreadStatusChange: React.Dispatch<
    React.SetStateAction<ThreadSummary | null>
  >;
  setPendingUploadFile: React.Dispatch<React.SetStateAction<File | null>>;
  setPendingVersionAction: React.Dispatch<
    React.SetStateAction<PendingVersionAction | null>
  >;
  setThreadsSorting: React.Dispatch<React.SetStateAction<SortingState>>;
  setThreadsViewMode: React.Dispatch<React.SetStateAction<"card" | "table">>;
  setVersionDecisionModal: React.Dispatch<
    React.SetStateAction<"accept" | "reject" | null>
  >;
  setVersionSorting: React.Dispatch<React.SetStateAction<SortingState>>;
  setViewMode: React.Dispatch<React.SetStateAction<"card" | "table">>;
  setVisibleThreadRows: React.Dispatch<React.SetStateAction<ThreadSummary[]>>;
  successEmailRecipients: { to: string[]; cc: string[] } | null;
  successMessage: string | null;
  successOkButtonRef: React.RefObject<HTMLButtonElement | null>;
  threadColumns: ColumnDef<ThreadSummary, unknown>[];
  threadNavigationStatusLabel: string;
  threadReportLabel: string;
  threads: ThreadSummary[];
  threadsSorting: SortingState;
  threadsViewMode: "card" | "table";
  uploadInputRef: React.RefObject<HTMLInputElement | null>;
  uploadMessage: string;
  uploadStatus: "idle" | "uploading" | "success" | "error";
  versionColumns: ColumnDef<VersionSummary, unknown>[];
  versionDecisionModal: "accept" | "reject" | null;
  versionReportLabel: string;
  versionSelectStatusClassName: (
    version?: Pick<VersionSummary, "status" | "reviewEndAt"> | null,
  ) => string;
  versionSorting: SortingState;
  versionStatusClassName: (
    version?: Pick<VersionSummary, "status" | "reviewEndAt"> | null,
  ) => string;
  versionStatusColor: (
    version?: Pick<VersionSummary, "status" | "reviewEndAt"> | null,
  ) => string;
  versions: VersionSummary[];
  versionsActionsRef: React.RefObject<HTMLDivElement | null>;
  viewMode: "card" | "table";
  warningMessage: string | null;
};

const VersionsPageView = (props: VersionsPageViewProps) => {
  if (props.isLoadingVersions && props.versions.length === 0) {
    return (
      <VersionsPageShell {...props}>
        <section className="panel">
          <GiphyInline reason="loading" />
        </section>
      </VersionsPageShell>
    );
  }

  return (
    <VersionsPageShell {...props}>
      <section className="panel stack">
        <VersionsToolbar
          versionsActionsRef={props.versionsActionsRef}
          versions={props.versions}
          selectedVersion={props.selectedVersion}
          isBusy={props.isBusy}
          createButtonLabel={props.createButtonLabel}
          viewMode={props.viewMode}
          versionSelectStatusClassName={props.versionSelectStatusClassName}
          versionStatusColor={props.versionStatusColor}
          selectVersionAndClearThreadQuery={
            props.selectVersionAndClearThreadQuery
          }
          moveSelectedVersion={props.moveSelectedVersion}
          requestCreateVersionConfirmation={
            props.requestCreateVersionConfirmation
          }
          requestStartReviewConfirmation={props.requestStartReviewConfirmation}
          requestVersionDecisionConfirmation={
            props.requestVersionDecisionConfirmation
          }
          requestErrorReportCreation={props.requestErrorReportCreation}
          setViewMode={props.setViewMode}
        />
        <VersionsPagePanels {...props} />
      </section>
    </VersionsPageShell>
  );
};

const VersionsPageShell = (
  props: VersionsPageViewProps & { children: React.ReactNode },
) => (
  <div className="app-shell">
    <VersionsHeader
      projectId={props.projectId}
      projectName={props.projectName}
      projectShortId={props.projectShortId}
      documentData={props.documentData}
      baseDocumentData={props.baseDocumentData}
      docId={props.docId}
      canEditDocumentTitle={props.canEditDocumentTitle}
      isBusy={props.isBusy}
      onEditDocumentTitle={props.requestDocumentTitleEdit}
    />
    <main className="app-main">{props.children}</main>
  </div>
);

const VersionsPagePanels = (props: VersionsPageViewProps) => (
  <>
    {props.selectedReviewTimerLabel ? (
      <section
        className={`review-timer review-timer--${props.selectedReviewTimerState}`}
      >
        <p className="review-timer__eyebrow">Version review time remaining</p>
        <p className="review-timer__value">{props.selectedReviewTimerLabel}</p>
      </section>
    ) : null}
    {props.warningMessage ? (
      <p className="notice-warning">{props.warningMessage}</p>
    ) : null}
    <VersionListPanel
      docId={props.docId}
      versions={props.versions}
      selectedVersion={props.selectedVersion}
      versionColumns={props.versionColumns}
      versionSorting={props.versionSorting}
      viewMode={props.viewMode}
      isBusy={props.isBusy}
      isLoadingVersions={props.isLoadingVersions}
      downloadStatus={props.downloadStatus}
      clockNowMs={props.clockNowMs}
      formatUserLabel={props.formatUserLabel}
      getVersionDownloadProvider={props.getVersionDownloadProvider}
      versionStatusClassName={props.versionStatusClassName}
      setVersionSorting={props.setVersionSorting}
      openReviewIssuesForVersion={props.openReviewIssuesForVersion}
      requestDownloadVersionFile={props.requestDownloadVersionFile}
    />
    <SelectedVersionPanels {...props} />
    <VersionsPageDialogs {...props} />
    <ReviewIssuesArea {...props} />
  </>
);

const SelectedVersionPanels = (props: VersionsPageViewProps) => (
  <>
    {props.selectedVersion ? (
      <div className="stack">
        <p className="muted">
          Uploaded:{" "}
          {props.selectedVersion.hasFile
            ? props.selectedVersion.fileRefId
              ? "Yes"
              : "Missing metadata"
            : "No"}
        </p>
      </div>
    ) : null}
    {props.selectedVersion ? (
      <AcceptedErrorReportsPanel
        acceptedErrorReports={props.acceptedErrorReports}
        acceptedErrorReportsStatus={props.acceptedErrorReportsStatus}
        projectId={props.projectId}
        onOpenReport={props.navigate}
      />
    ) : null}
    {props.selectedVersion ? (
      <VersionFilePanel
        selectedVersion={props.selectedVersion}
        selectedFileRef={props.selectedFileRef}
        filePanelRef={props.filePanelRef}
        uploadInputRef={props.uploadInputRef}
        fileMetadataNotice={props.fileMetadataNotice}
        isBusy={props.isBusy}
        canUploadFile={props.canUploadFile}
        uploadStatus={props.uploadStatus}
        uploadMessage={props.uploadMessage}
        downloadStatus={props.downloadStatus}
        selectedDownloadProvider={props.selectedDownloadProvider}
        onSetError={props.setError}
        onUploadFile={props.handleUploadFile}
        onReplaceFile={props.requestReplaceFileConfirmation}
        onDownloadSelectedFile={props.requestDownloadSelectedFile}
      />
    ) : null}
  </>
);

const VersionsPageDialogs = (props: VersionsPageViewProps) => (
  <VersionsModals
    isBusy={props.isBusy}
    isDocumentTitleModalOpen={props.isDocumentTitleModalOpen}
    documentTitleInputRef={props.documentTitleInputRef}
    documentTitleDraft={props.documentTitleDraft}
    documentTitleError={props.documentTitleError}
    setDocumentTitleDraft={props.setDocumentTitleDraft}
    onCloseDocumentTitleModal={props.closeDocumentTitleModal}
    onSaveDocumentTitle={props.handleSaveDocumentTitle}
    isErrorReportModalOpen={props.isErrorReportModalOpen}
    errorReportTitle={props.errorReportTitle}
    errorReportTitleError={props.errorReportTitleError}
    setErrorReportTitle={props.setErrorReportTitle}
    onCloseErrorReportModal={() => {
      props.setIsErrorReportModalOpen(false);
      props.setErrorReportTitleError(null);
    }}
    onCreateErrorReport={props.handleCreateErrorReport}
    versionDecisionModal={props.versionDecisionModal}
    onCloseVersionDecisionModal={() => props.setVersionDecisionModal(null)}
    onConfirmVersionDecision={props.handleConfirmVersionDecision}
    pendingVersionAction={props.pendingVersionAction}
    onClosePendingVersionAction={props.handleClosePendingVersionAction}
    onConfirmPendingVersionAction={props.handleConfirmPendingVersionAction}
    pendingThreadStatusChange={props.pendingThreadStatusChange}
    onClosePendingThreadStatusChange={() =>
      props.setPendingThreadStatusChange(null)
    }
    onConfirmThreadStatusChange={props.handleConfirmThreadStatusChange}
    uploadStatus={props.uploadStatus}
    uploadMessage={props.uploadMessage}
    downloadStatus={props.downloadStatus}
    downloadMessage={props.downloadMessage}
    emailNotifyStatus={props.emailNotifyStatus}
    emailNotifyMessage={props.emailNotifyMessage}
    successMessage={props.successMessage}
    successEmailRecipients={props.successEmailRecipients}
    successOkButtonRef={props.successOkButtonRef}
    onCloseSuccessMessage={props.handleCloseSuccessMessage}
    error={props.error}
    errorChecklist={props.errorChecklist}
    onCloseError={() => props.setError(null)}
    errorReportContext={{
      projectId: props.projectId,
      docId: props.docId ?? "",
      versionId:
        props.selectedVersion?.id ?? props.latestVersion?.id ?? undefined,
      threadId: props.selectedThread?.id ?? undefined,
      pageLabel: "Document Versions",
      projectLabel: props.projectReportLabel,
      docLabel: props.documentReportLabel,
      versionLabel: props.versionReportLabel,
      threadLabel: props.threadReportLabel,
    }}
  />
);

const ReviewIssuesArea = (props: VersionsPageViewProps) => (
  <>
    {props.selectedVersion && props.selectedVersion.status === "In Creation" ? (
      <AuthorReviewerAssignmentPanel
        projectId={props.projectId}
        allowedReviewerIds={props.allowedReviewerIds}
        selectedReviewerIds={props.selectedReviewerIds}
        isBusy={props.isBusy}
        canAssignReviewers={props.canAssignReviewers}
        onToggleAllReviewers={props.handleToggleAllReviewers}
        memberColumns={props.memberColumns}
        membersTableRows={props.membersTableRows}
        membersSorting={props.membersSorting}
        setMembersSorting={props.setMembersSorting}
      />
    ) : null}
    {props.selectedVersion ? (
      <ReviewIssuesPanel
        selectedVersion={props.selectedVersion}
        reviewIssuesPanelRef={props.reviewIssuesPanelRef}
        formatUserLabel={props.formatUserLabel}
        newThreadTitle={props.newThreadTitle}
        setNewThreadTitle={props.setNewThreadTitle}
        isBusy={props.isBusy}
        onCreateThread={props.handleCreateThread}
        isLoadingThreads={props.isLoadingThreads}
        threads={props.threads}
        threadsViewMode={props.threadsViewMode}
        setThreadsViewMode={props.setThreadsViewMode}
        threadColumns={props.threadColumns}
        threadsSorting={props.threadsSorting}
        setThreadsSorting={props.setThreadsSorting}
        setVisibleThreadRows={props.setVisibleThreadRows}
        getThreadCommentWindowMeta={props.getThreadCommentWindowMeta}
        effectiveSelectedThreadId={props.effectiveSelectedThreadId}
        selectThreadKeepingViewport={props.selectThreadKeepingViewport}
        commentsByThread={props.commentsByThread}
        requestThreadStatusChangeConfirmation={
          props.requestThreadStatusChangeConfirmation
        }
        selectedThread={props.selectedThread}
        threadNavigationStatusLabel={props.threadNavigationStatusLabel}
        onSelectAdjacentThread={props.handleSelectAdjacentThread}
        hasPreviousThread={props.hasPreviousThread}
        hasNextThread={props.hasNextThread}
        commentsViewMode={props.commentsViewMode}
        setCommentsViewMode={props.setCommentsViewMode}
        selectedThreadComments={props.selectedThreadComments}
        commentColumns={props.commentColumns}
        commentsSorting={props.commentsSorting}
        setCommentsSorting={props.setCommentsSorting}
        highlightedCommentId={props.highlightedCommentId}
        commentWindowCountdownLabel={props.commentWindowCountdownLabel}
        commentInputRef={props.commentInputRef}
        selectedCommentWindowState={props.selectedCommentWindowState}
        newCommentBody={props.newCommentBody}
        setNewCommentBody={props.setNewCommentBody}
        onAddComment={props.handleAddComment}
      />
    ) : null}
  </>
);

export default VersionsPageView;
export type { VersionsPageViewProps };
