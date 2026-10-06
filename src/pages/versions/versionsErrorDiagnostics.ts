// Builds safe page-state diagnostics for failures reported by Versions actions.
import type { MonitorSource } from "../../lib/errorMonitor";
import type { FileRefSummary, ThreadSummary, VersionSummary } from "./types";

type VersionsErrorDiagnosticsInput = {
  action: string;
  canParticipateReview: boolean;
  docId?: string;
  latestVersion: VersionSummary | null;
  projectId: string;
  selectedFileRef: FileRefSummary | null;
  selectedThread: ThreadSummary | null;
  selectedVersion: VersionSummary | null;
  selectedVersionInReview: boolean;
  source: MonitorSource;
  threadId?: string;
  userId: string;
  versionId?: string;
};

const summarizeVersion = (version: VersionSummary | null) =>
  version
    ? {
        id: version.id,
        number: version.number,
        status: version.status,
        createdBy: version.createdBy,
        reviewerCount: version.reviewerIds.length,
        reviewDurationDays: version.reviewDurationDays,
        hasFile: version.hasFile,
        fileRefId: version.fileRefId,
        counters: {
          numThreads: version.numThreads,
          numOpenThreads: version.numOpenThreads,
          numComments: version.numComments,
          numThreadsWithTwoPlusComments: version.numThreadsWithTwoPlusComments,
        },
      }
    : null;

const buildVersionsErrorDiagnostics = ({
  action,
  canParticipateReview,
  docId = "",
  latestVersion,
  projectId,
  selectedFileRef,
  selectedThread,
  selectedVersion,
  selectedVersionInReview,
  source,
  threadId = "",
  userId,
  versionId = "",
}: VersionsErrorDiagnosticsInput) => ({
  diagnosticArea: "versions",
  diagnosticDisclaimer:
    "Client-side diagnostic; Firestore and storage services remain authoritative.",
  operation: {
    action,
    source,
    projectId,
    docId,
    versionId,
    threadId,
    actorPresent: Boolean(userId),
  },
  clientGates: {
    canParticipateReview,
    selectedVersionInReview,
  },
  selectedVersion: summarizeVersion(selectedVersion),
  latestVersion: summarizeVersion(latestVersion),
  selectedThread: selectedThread
    ? {
        id: selectedThread.id,
        status: selectedThread.status,
        createdBy: selectedThread.createdBy,
        commentCount: selectedThread.commentCount,
      }
    : null,
  selectedFile: selectedFileRef
    ? {
        id: selectedFileRef.id,
        fileName: selectedFileRef.fileName,
        contentType: selectedFileRef.contentType,
        sizeBytes: selectedFileRef.sizeBytes,
        storageProvider: selectedFileRef.storageProvider,
        fileKeyPresent: Boolean(selectedFileRef.fileKey),
        metadataMatchesRequest:
          selectedFileRef.projectId === projectId &&
          selectedFileRef.docId === docId &&
          selectedFileRef.versionId === (versionId || selectedVersion?.id),
      }
    : null,
});

export { buildVersionsErrorDiagnostics };
export type { VersionsErrorDiagnosticsInput };
