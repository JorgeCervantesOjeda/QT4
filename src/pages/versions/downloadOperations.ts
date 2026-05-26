// Download request guards and storage-provider download execution for version files.
import type { Dispatch, SetStateAction } from "react";
import { doc, getDoc } from "firebase/firestore";
import {
  type FileStorageProviderKind,
  versionNumberToString,
} from "../../domain/types";
import { downloadFileByProvider } from "../../lib/fileStorage";
import { db } from "../../lib/firebase";
import { normalizeFileStorageProvider } from "../../lib/runtimeConfig";
import type { VersionSummary } from "./types";
import {
  DOWNLOAD_SLOW_NOTICE_MS,
  DOWNLOAD_TIMEOUT_MS,
  hasLinkedFileMetadata,
} from "./utils";

const normalizeDownloadError = (rawMessage: string) => {
  const lowered = rawMessage.toLowerCase();
  if (
    lowered.includes("action blocked") ||
    lowered.includes("(403)") ||
    lowered.includes(" 403")
  ) {
    return "Download blocked by Files API authorization (Action blocked).";
  }
  return rawMessage;
};

const executeDownloadWithTimeout = async (
  action: () => Promise<void>,
  options: {
    attemptId?: string;
    timeoutMessage?: string;
    onSlowNotice?: () => void;
  } = {},
) => {
  const attemptId =
    options.attemptId ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  let timeoutId: number | undefined;
  let slowNoticeId: number | undefined;
  let slowNoticeShown = false;
  console.info("[download][start]", {
    attemptId,
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    slowNoticeMs: DOWNLOAD_SLOW_NOTICE_MS,
  });
  try {
    slowNoticeId = window.setTimeout(() => {
      slowNoticeShown = true;
      options.onSlowNotice?.();
      console.info("[download][slow_notice]", {
        attemptId,
        elapsedMs: Date.now() - startedAt,
      });
    }, DOWNLOAD_SLOW_NOTICE_MS);
    await Promise.race([
      action(),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(
            new Error(
              options.timeoutMessage ??
                "Download failed (timeout): the server took too long to respond.",
            ),
          );
        }, DOWNLOAD_TIMEOUT_MS);
      }),
    ]);
    console.info("[download][success]", {
      attemptId,
      elapsedMs: Date.now() - startedAt,
      slowNoticeShown,
    });
  } catch (err) {
    console.warn("[download][error]", {
      attemptId,
      elapsedMs: Date.now() - startedAt,
      slowNoticeShown,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
    if (slowNoticeId !== undefined) {
      window.clearTimeout(slowNoticeId);
    }
  }
};

type DownloadVersionFileParams = {
  version: VersionSummary;
  setError: Dispatch<SetStateAction<string | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string | null>>;
  setDownloadStatus: Dispatch<SetStateAction<"idle" | "downloading">>;
  setDownloadMessage: Dispatch<SetStateAction<string>>;
  reportVersionsError: (
    error: unknown,
    action: string,
    source: "firestore" | "storage" | "auth" | "ui" | "network" | "unknown",
    overrides?: { versionId?: string | null; threadId?: string | null },
  ) => void;
};

const downloadVersionFile = async (params: DownloadVersionFileParams) => {
  const {
    version,
    setError,
    setSuccessMessage,
    setDownloadStatus,
    setDownloadMessage,
    reportVersionsError,
  } = params;
  setError(null);
  setSuccessMessage(null);
  setDownloadStatus("downloading");
  setDownloadMessage("Preparing download...");
  const attemptId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const metadataStartedAt = Date.now();
  try {
    if (!version.fileRefId) {
      throw new Error(
        "Cannot download this file: version metadata is incomplete " +
          "(fileRefId is missing). Please re-upload/replace the file for this version.",
      );
    }
    let fileKey = "";
    let fileName = `version-${versionNumberToString(version.number)}`;
    let storageProvider: FileStorageProviderKind = "files-api";

    const fileSnapshot = await getDoc(doc(db, "files", version.fileRefId));
    if (fileSnapshot.exists()) {
      const fileData = fileSnapshot.data();
      fileKey = (fileData.fileKey as string | undefined) ?? "";
      fileName = (fileData.fileName as string | undefined) ?? fileName;
      storageProvider = normalizeFileStorageProvider(fileData.storageProvider);
    }
    console.info("[download][metadata_resolved]", {
      attemptId,
      versionId: version.id,
      versionNumber: version.number,
      fileRefId: version.fileRefId,
      fileKey,
      storageProvider,
      elapsedMs: Date.now() - metadataStartedAt,
    });

    if (!fileKey) {
      throw new Error(
        "Cannot download this file: linked file metadata is missing file key.",
      );
    }
    setDownloadMessage("Downloading file...");
    await executeDownloadWithTimeout(
      () => downloadFileByProvider(fileKey, fileName, storageProvider),
      {
        attemptId,
        timeoutMessage:
          "Download failed (timeout): the server took too long to respond.",
        onSlowNotice: () =>
          setDownloadMessage("Still downloading from the server..."),
      },
    );
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : "Unexpected error";
    reportVersionsError(err, "versions.downloadFile", "storage", {
      versionId: version.id,
    });
    setError(normalizeDownloadError(rawMessage));
  } finally {
    setDownloadStatus("idle");
    setDownloadMessage("");
  }
};

const requestDownloadVersionFile = (params: {
  version: VersionSummary;
  downloadStatus: "idle" | "downloading";
  userId: string;
  setError: Dispatch<SetStateAction<string | null>>;
  download: (version: VersionSummary) => void;
}) => {
  if (params.downloadStatus === "downloading") {
    return;
  }
  if (!params.userId) {
    params.setError("Sign in before downloading a file.");
    return;
  }
  if (!hasLinkedFileMetadata(params.version)) {
    params.setError("No file is linked to this version.");
    return;
  }
  params.download(params.version);
};

export {
  downloadVersionFile,
  executeDownloadWithTimeout,
  normalizeDownloadError,
  requestDownloadVersionFile,
};
