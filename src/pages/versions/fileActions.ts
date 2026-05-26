// File upload, replacement cleanup, and selected-file download actions for versions.
import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import type { FileStorageProviderKind } from "../../domain/types";
import { logAudit } from "../../lib/audit";
import {
  buildFileKey,
  deleteFileByProvider,
  downloadFileByProvider,
  uploadFileUsingActiveProvider,
} from "../../lib/fileStorage";
import { db } from "../../lib/firebase";
import type { FileRefSummary, VersionSummary } from "./types";
import {
  executeDownloadWithTimeout,
  normalizeDownloadError,
} from "./downloadOperations";
import { assertValidFileMetadataLink, hasLinkedFileMetadata } from "./utils";

type VersionsErrorReporter = (
  error: unknown,
  action: string,
  source?: "firestore" | "storage" | "auth" | "ui" | "network" | "unknown",
  overrides?: { versionId?: string | null; threadId?: string | null },
) => void;

type UseFileActionsParams = {
  docId: string | undefined;
  projectId: string;
  userId: string;
  userEmail?: string | null;
  selectedVersion: VersionSummary | null;
  selectedFileRef: FileRefSummary | null;
  canUploadFile: boolean;
  downloadStatus: "idle" | "downloading";
  uploadInputRef: RefObject<HTMLInputElement | null>;
  localFileRefByIdRef: MutableRefObject<Map<string, FileRefSummary>>;
  reloadAndRestoreSelection: (
    versionId: string | null,
    threadId?: string | null,
  ) => Promise<void>;
  reportVersionsError: VersionsErrorReporter;
  setError: Dispatch<SetStateAction<string | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string | null>>;
  setIsBusy: Dispatch<SetStateAction<boolean>>;
  setUploadStatus: Dispatch<
    SetStateAction<"idle" | "uploading" | "success" | "error">
  >;
  setUploadMessage: Dispatch<SetStateAction<string>>;
  setDownloadStatus: Dispatch<SetStateAction<"idle" | "downloading">>;
  setDownloadMessage: Dispatch<SetStateAction<string>>;
  setSelectedFileRef: Dispatch<SetStateAction<FileRefSummary | null>>;
  setFileMetadataNotice: Dispatch<SetStateAction<string | null>>;
};

function useFileActions(params: UseFileActionsParams) {
  const handleUploadFile = async (file: File) => {
    const {
      docId,
      projectId,
      userId,
      userEmail,
      selectedVersion,
      selectedFileRef,
      canUploadFile,
      uploadInputRef,
      localFileRefByIdRef,
      reloadAndRestoreSelection,
      reportVersionsError,
      setError,
      setSuccessMessage,
      setIsBusy,
      setUploadStatus,
      setUploadMessage,
      setSelectedFileRef,
      setFileMetadataNotice,
    } = params;
    if (!docId || !projectId || !selectedVersion || !userId) {
      setError("Select a version to upload a file.");
      return;
    }
    if (!canUploadFile) {
      setError("You can upload a file only while the version is In Creation.");
      return;
    }
    const lockedVersionId = selectedVersion.id;

    setError(null);
    setSuccessMessage(null);
    setIsBusy(true);
    setUploadStatus("uploading");
    setUploadMessage("Uploading...");
    const fileKey = buildFileKey({
      projectId,
      documentId: docId,
      versionId: selectedVersion.id,
      fileName: file.name,
    });
    let uploadedNewFile = false;
    let shouldDeleteUploadedOnError = true;
    let uploadedProvider: FileStorageProviderKind = "files-api";
    try {
      const existingFileKey = selectedFileRef?.fileKey ?? null;
      const existingFileProvider =
        selectedFileRef?.storageProvider ?? "files-api";
      const shouldDeleteExistingAfterCommit = Boolean(
        existingFileKey && existingFileKey !== fileKey,
      );
      shouldDeleteUploadedOnError =
        !existingFileKey || existingFileKey !== fileKey;
      const uploadResponse = await uploadFileUsingActiveProvider(
        fileKey,
        file,
        { overwrite: true },
      );
      uploadedNewFile = true;
      uploadedProvider = uploadResponse.storageProvider;
      const fileRefDoc = doc(collection(db, "files"));
      const fileRefPayload = {
        fileKey,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: Number(uploadResponse.sizeBytes),
        isPermanent: Boolean(uploadResponse.isPermanent),
        expireAfterDays:
          typeof uploadResponse.expireAfterDays === "number"
            ? Number(uploadResponse.expireAfterDays)
            : null,
        storageProvider: uploadResponse.storageProvider,
        projectId,
        docId,
        versionId: selectedVersion.id,
        createdAt: serverTimestamp(),
        createdBy: userId,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      };
      assertValidFileMetadataLink(fileRefPayload);
      const batch = writeBatch(db);
      batch.set(fileRefDoc, fileRefPayload);
      batch.update(doc(db, "versions", selectedVersion.id), {
        hasFile: true,
        fileRefId: fileRefDoc.id,
        fileUploadedAt: serverTimestamp(),
        fileUploadedBy: userId,
        activityAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
      const localFileRef: FileRefSummary = {
        id: fileRefDoc.id,
        fileKey,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: Number(uploadResponse.sizeBytes),
        isPermanent: Boolean(uploadResponse.isPermanent),
        expireAfterDays:
          typeof uploadResponse.expireAfterDays === "number"
            ? Number(uploadResponse.expireAfterDays)
            : null,
        storageProvider: uploadResponse.storageProvider,
        createdBy: userId,
        projectId,
        docId,
        versionId: selectedVersion.id,
      };
      localFileRefByIdRef.current.set(fileRefDoc.id, localFileRef);
      await batch.commit();
      setSelectedFileRef(localFileRef);
      setFileMetadataNotice(null);
      void logAudit({
        actorId: userId,
        actorEmail: userEmail ?? null,
        action: "uploadFile",
        entityType: "file",
        entityId: fileRefDoc.id,
        projectId,
        docId,
        versionId: selectedVersion.id,
        metadata: { fileKey, fileName: file.name },
      }).catch((err) => console.warn("Audit log failed (upload file):", err));
      if (shouldDeleteExistingAfterCommit && existingFileKey) {
        try {
          await deleteFileByProvider(existingFileKey, existingFileProvider);
        } catch {
          // Ignore cleanup errors; the new upload is already committed.
        }
      }
      setUploadStatus("success");
      setUploadMessage(`Uploaded: ${file.name}`);
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      await reloadAndRestoreSelection(lockedVersionId);
    } catch (err) {
      if (uploadedNewFile && shouldDeleteUploadedOnError) {
        try {
          await deleteFileByProvider(fileKey, uploadedProvider);
        } catch {
          // Ignore cleanup errors when rollback upload fails.
        }
      }
      localFileRefByIdRef.current.forEach((fileRef, fileRefId) => {
        if (
          fileRef.fileKey === fileKey &&
          fileRef.versionId === selectedVersion.id
        ) {
          localFileRefByIdRef.current.delete(fileRefId);
        }
      });
      const message = err instanceof Error ? err.message : "Unexpected error";
      reportVersionsError(err, "versions.uploadFile", "storage", {
        versionId: selectedVersion.id,
      });
      setError(message);
      setUploadStatus("error");
      setUploadMessage(message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleDownloadFile = async () => {
    const {
      selectedVersion,
      selectedFileRef,
      setError,
      setSuccessMessage,
      setDownloadStatus,
      setDownloadMessage,
    } = params;
    if (!selectedVersion) {
      setError("Select a version to download a file.");
      return;
    }
    if (!hasLinkedFileMetadata(selectedVersion)) {
      setError("No file is linked to this version.");
      return;
    }
    if (!selectedFileRef) {
      setError(
        "Cannot download this file: version metadata is incomplete " +
          "(fileRefId is missing). Please re-upload/replace the file for this version.",
      );
      return;
    }
    if (!selectedFileRef.fileKey) {
      setError(
        "Cannot download this file: linked file metadata is missing file key.",
      );
      return;
    }
    setError(null);
    setSuccessMessage(null);
    setDownloadStatus("downloading");
    setDownloadMessage("Preparing download...");
    const attemptId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      setDownloadMessage("Downloading file...");
      await executeDownloadWithTimeout(
        () =>
          downloadFileByProvider(
            selectedFileRef.fileKey,
            selectedFileRef.fileName,
            selectedFileRef.storageProvider,
          ),
        {
          attemptId,
          timeoutMessage:
            "Download failed (timeout): the server took too long to respond.",
          onSlowNotice: () =>
            setDownloadMessage("Still downloading from the server..."),
        },
      );
    } catch (err) {
      const rawMessage =
        err instanceof Error ? err.message : "Unexpected error";
      setError(normalizeDownloadError(rawMessage));
    } finally {
      setDownloadStatus("idle");
      setDownloadMessage("");
    }
  };

  const requestDownloadSelectedFile = () => {
    const { downloadStatus, userId, setError } = params;
    if (downloadStatus === "downloading") {
      return;
    }
    if (!userId) {
      setError("Sign in before downloading a file.");
      return;
    }
    void handleDownloadFile();
  };

  return { handleUploadFile, requestDownloadSelectedFile };
}

export default useFileActions;
