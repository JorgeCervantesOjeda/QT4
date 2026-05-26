// src/pages/versions/versionsPageState.ts
// Owns local state and refs for the Versions page controller.
import { useRef, useState } from "react";
import type { SortingState } from "@tanstack/react-table";
import type {
  AcceptedErrorReportSummary,
  CommentSummary,
  DocumentSummary,
  FileRefSummary,
  PendingVersionAction,
  ProjectMember,
  ThreadSummary,
  VersionSummary,
} from "./types";

const readStoredViewMode = (storageKey: string): "card" | "table" => {
  const storedView = window.localStorage.getItem(storageKey);
  return storedView === "table" || storedView === "card" ? storedView : "card";
};

const useVersionsPageState = () => {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [documentData, setDocumentData] = useState<DocumentSummary | null>(
    null,
  );
  const [baseDocumentData, setBaseDocumentData] = useState<{
    id: string;
    title: string;
    shortId: number | null;
  } | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectShortId, setProjectShortId] = useState<number | null>(null);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>([]);
  const [selectedAuthorId, setSelectedAuthorId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [uploadMessage, setUploadMessage] = useState("");
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "downloading">(
    "idle",
  );
  const [downloadMessage, setDownloadMessage] = useState("");
  const [emailNotifyStatus, setEmailNotifyStatus] = useState<
    "idle" | "sending"
  >("idle");
  const [emailNotifyMessage, setEmailNotifyMessage] = useState("");
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileRef, setSelectedFileRef] = useState<FileRefSummary | null>(
    null,
  );
  const localFileRefByIdRef = useRef<Map<string, FileRefSummary>>(new Map());
  const [fileMetadataNotice, setFileMetadataNotice] = useState<string | null>(
    null,
  );
  const [isErrorReportModalOpen, setIsErrorReportModalOpen] = useState(false);
  const [versionDecisionModal, setVersionDecisionModal] = useState<
    "accept" | "reject" | null
  >(null);
  const [pendingVersionAction, setPendingVersionAction] =
    useState<PendingVersionAction | null>(null);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [errorReportTitle, setErrorReportTitle] = useState("");
  const [errorReportTitleError, setErrorReportTitleError] = useState<
    string | null
  >(null);
  const [viewMode, setViewMode] = useState<"card" | "table">(() =>
    readStoredViewMode("qt4_versions_view"),
  );
  const [threadsViewMode, setThreadsViewMode] = useState<"card" | "table">(() =>
    readStoredViewMode("qt4_versions_threads_view"),
  );
  const [commentsViewMode, setCommentsViewMode] = useState<"card" | "table">(
    () => readStoredViewMode("qt4_versions_thread_comments_view"),
  );
  const [versionSorting, setVersionSorting] = useState<SortingState>([
    {
      id: "number",
      desc: true,
    },
  ]);
  const [membersSorting, setMembersSorting] = useState<SortingState>([
    {
      id: "memberLabel",
      desc: false,
    },
  ]);
  const [threadsSorting, setThreadsSorting] = useState<SortingState>([
    {
      id: "title",
      desc: false,
    },
  ]);
  const [commentsSorting, setCommentsSorting] = useState<SortingState>([
    {
      id: "createdAt",
      desc: false,
    },
  ]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLeader, setIsLeader] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingVersions, setIsLoadingVersions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [successEmailRecipients, setSuccessEmailRecipients] = useState<{
    to: string[];
    cc: string[];
  } | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  const successOkButtonRef = useRef<HTMLButtonElement | null>(null);
  const documentTitleInputRef = useRef<HTMLInputElement | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const preservedThreadNavigationScrollYRef = useRef<number | null>(null);
  const versionsActionsRef = useRef<HTMLDivElement | null>(null);
  const filePanelRef = useRef<HTMLElement | null>(null);
  const reviewIssuesPanelRef = useRef<HTMLElement | null>(null);
  const lastAppliedDashboardFocusRef = useRef<string | null>(null);
  const commentsRetryTimeoutRef = useRef<number | null>(null);
  const [userDirectoryById, setUserDirectoryById] = useState<
    Record<
      string,
      {
        email?: string | null;
        displayName?: string | null;
      }
    >
  >({});
  const [errorReportGate, setErrorReportGate] = useState({
    isBlocking: false,
    isLoading: false,
  });
  const [acceptedErrorReports, setAcceptedErrorReports] = useState<
    AcceptedErrorReportSummary[]
  >([]);
  const [acceptedErrorReportsStatus, setAcceptedErrorReportsStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [visibleThreadRows, setVisibleThreadRows] = useState<ThreadSummary[]>(
    [],
  );
  const [commentsByThread, setCommentsByThread] = useState<
    Record<string, CommentSummary[]>
  >({});
  const [commentsRetryToken, setCommentsRetryToken] = useState(0);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [highlightedCommentId, setHighlightedCommentId] = useState<
    string | null
  >(null);
  const [pendingThreadStatusChange, setPendingThreadStatusChange] =
    useState<ThreadSummary | null>(null);
  const lastAppliedVersionQueryRef = useRef<string | null>(null);
  const lastAppliedThreadQueryRef = useRef<string | null>(null);
  const lastAppliedCommentQueryRef = useRef<string | null>(null);
  const pendingManualThreadSelectionRef = useRef<string | null>(null);
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [newCommentBody, setNewCommentBody] = useState("");
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [isMembersTableCompact, setIsMembersTableCompact] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 480px)").matches
      : false,
  );
  const autoReviewUpdateRef = useRef<string | null>(null);
  const autoReviewPermissionDeniedVersionIdsRef = useRef<Set<string>>(
    new Set(),
  );

  return {
    versions,
    setVersions,
    documentData,
    setDocumentData,
    baseDocumentData,
    setBaseDocumentData,
    projectName,
    setProjectName,
    projectShortId,
    setProjectShortId,
    projectMembers,
    setProjectMembers,
    selectedReviewerIds,
    setSelectedReviewerIds,
    selectedAuthorId,
    setSelectedAuthorId,
    selectedVersionId,
    setSelectedVersionId,
    uploadStatus,
    setUploadStatus,
    uploadMessage,
    setUploadMessage,
    downloadStatus,
    setDownloadStatus,
    downloadMessage,
    setDownloadMessage,
    emailNotifyStatus,
    setEmailNotifyStatus,
    emailNotifyMessage,
    setEmailNotifyMessage,
    uploadInputRef,
    selectedFileRef,
    setSelectedFileRef,
    localFileRefByIdRef,
    fileMetadataNotice,
    setFileMetadataNotice,
    isErrorReportModalOpen,
    setIsErrorReportModalOpen,
    versionDecisionModal,
    setVersionDecisionModal,
    pendingVersionAction,
    setPendingVersionAction,
    pendingUploadFile,
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
    isAdmin,
    setIsAdmin,
    isLeader,
    setIsLeader,
    isBusy,
    setIsBusy,
    isLoadingVersions,
    setIsLoadingVersions,
    error,
    setError,
    successMessage,
    setSuccessMessage,
    successEmailRecipients,
    setSuccessEmailRecipients,
    warningMessage,
    setWarningMessage,
    lastErrorRef,
    successOkButtonRef,
    documentTitleInputRef,
    commentInputRef,
    preservedThreadNavigationScrollYRef,
    versionsActionsRef,
    filePanelRef,
    reviewIssuesPanelRef,
    lastAppliedDashboardFocusRef,
    commentsRetryTimeoutRef,
    userDirectoryById,
    setUserDirectoryById,
    errorReportGate,
    setErrorReportGate,
    acceptedErrorReports,
    setAcceptedErrorReports,
    acceptedErrorReportsStatus,
    setAcceptedErrorReportsStatus,
    threads,
    setThreads,
    visibleThreadRows,
    setVisibleThreadRows,
    commentsByThread,
    setCommentsByThread,
    commentsRetryToken,
    setCommentsRetryToken,
    selectedThreadId,
    setSelectedThreadId,
    highlightedCommentId,
    setHighlightedCommentId,
    pendingThreadStatusChange,
    setPendingThreadStatusChange,
    lastAppliedVersionQueryRef,
    lastAppliedThreadQueryRef,
    lastAppliedCommentQueryRef,
    pendingManualThreadSelectionRef,
    newThreadTitle,
    setNewThreadTitle,
    newCommentBody,
    setNewCommentBody,
    isLoadingThreads,
    setIsLoadingThreads,
    clockNowMs,
    setClockNowMs,
    isMembersTableCompact,
    setIsMembersTableCompact,
    autoReviewUpdateRef,
    autoReviewPermissionDeniedVersionIdsRef,
  };
};

export default useVersionsPageState;
export type VersionsPageState = ReturnType<typeof useVersionsPageState>;
