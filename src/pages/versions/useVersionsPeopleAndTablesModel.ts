// src/pages/versions/useVersionsPeopleAndTablesModel.ts
// Derives user labels, member rows, download handlers, and table column models.
import { useCallback, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { FileStorageProviderKind } from "../../domain/types";
import { useCommentColumns, useVersionColumns } from "./columns";
import {
  downloadVersionFile,
  requestDownloadVersionFile as requestDownloadVersionFileOperation,
} from "./downloadOperations";
import type { ProjectMember, VersionSummary } from "./types";

type UserDirectoryEntry = {
  displayName?: string | null;
  email?: string | null;
};

type UseVersionsPeopleAndTablesModelParams = {
  clockNowMs: number;
  downloadStatus: "idle" | "downloading";
  getVersionDownloadProvider: (
    version: VersionSummary,
  ) => FileStorageProviderKind | null;
  isBusy: boolean;
  projectMembers: ProjectMember[];
  reportVersionsError: (
    error: unknown,
    action: string,
    source?: "firestore" | "storage" | "auth" | "ui" | "network" | "unknown",
    overrides?: { versionId?: string | null; threadId?: string | null },
  ) => void;
  selectedAuthorId: string;
  selectedReviewerIds: string[];
  setDownloadMessage: Dispatch<SetStateAction<string>>;
  setDownloadStatus: Dispatch<SetStateAction<"idle" | "downloading">>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string | null>>;
  userDirectoryById: Record<string, UserDirectoryEntry>;
  userDisplayName?: string | null;
  userEmail?: string | null;
  userId: string;
};

const useVersionsPeopleAndTablesModel = ({
  clockNowMs,
  downloadStatus,
  getVersionDownloadProvider,
  isBusy,
  projectMembers,
  reportVersionsError,
  selectedAuthorId,
  selectedReviewerIds,
  setDownloadMessage,
  setDownloadStatus,
  setError,
  setSuccessMessage,
  userDirectoryById,
  userDisplayName,
  userEmail,
  userId,
}: UseVersionsPeopleAndTablesModelParams) => {
  const formatUserLabel = useCallback(
    (memberUserId: string) => {
      const entry = userDirectoryById[memberUserId];
      const memberEntry = projectMembers.find(
        (member) => member.userId === memberUserId,
      );
      const displayName =
        entry?.displayName ??
        (memberUserId === userId ? (userDisplayName ?? "") : "");
      const email =
        entry?.email ??
        memberEntry?.email ??
        (memberUserId === userId ? (userEmail ?? "") : "");
      return displayName && email
        ? `${displayName} (${email})`
        : displayName || email || "Unknown user";
    },
    [userDirectoryById, projectMembers, userId, userDisplayName, userEmail],
  );

  const resolveUserEmail = useCallback(
    (memberUserId: string) => {
      const entry = userDirectoryById[memberUserId];
      const memberEntry = projectMembers.find(
        (member) => member.userId === memberUserId,
      );
      const email =
        entry?.email ??
        memberEntry?.email ??
        (memberUserId === userId ? (userEmail ?? "") : "");
      return email?.trim() ? email.trim() : null;
    },
    [userDirectoryById, projectMembers, userId, userEmail],
  );

  const membersTableRows = useMemo(
    () =>
      projectMembers.map((member) => {
        const isAuthor = selectedAuthorId === member.userId;
        const isReviewer =
          selectedReviewerIds.includes(member.userId) && !isAuthor;
        return {
          userId: member.userId,
          role: member.role,
          memberLabel: formatUserLabel(member.userId),
          statusLabel: isAuthor
            ? "Author"
            : isReviewer
              ? "Reviewer"
              : "Not assigned",
          isAuthor,
          isReviewer,
        };
      }),
    [projectMembers, selectedAuthorId, selectedReviewerIds, formatUserLabel],
  );

  const handleDownloadVersionFile = useCallback(
    async (version: VersionSummary) => {
      await downloadVersionFile({
        version,
        setError,
        setSuccessMessage,
        setDownloadStatus,
        setDownloadMessage,
        reportVersionsError,
      });
    },
    [
      reportVersionsError,
      setDownloadMessage,
      setDownloadStatus,
      setError,
      setSuccessMessage,
    ],
  );

  const requestDownloadVersionFile = useCallback(
    (version: VersionSummary) => {
      requestDownloadVersionFileOperation({
        version,
        downloadStatus,
        userId,
        setError,
        download: (nextVersion: VersionSummary) => {
          handleDownloadVersionFile(nextVersion);
        },
      });
    },
    [userId, handleDownloadVersionFile, downloadStatus, setError],
  );

  const versionColumns = useVersionColumns({
    formatUserLabel,
    requestDownloadVersionFile,
    isBusy,
    downloadStatus,
    getVersionDownloadProvider,
    clockNowMs,
  });
  const commentColumns = useCommentColumns(formatUserLabel);

  return {
    commentColumns,
    formatUserLabel,
    handleDownloadVersionFile,
    membersTableRows,
    requestDownloadVersionFile,
    resolveUserEmail,
    versionColumns,
  };
};

export default useVersionsPeopleAndTablesModel;
