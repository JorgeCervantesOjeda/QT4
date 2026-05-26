// src/pages/versions/useVersionsPermissionModel.ts
// Derives version permissions and reviewer/author assignment actions.
import { useCallback, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { logAudit } from "../../lib/audit";
import useAssignmentActions from "./assignmentActions";
import { hasLinkedFileMetadata } from "./utils";
import type { ProjectMember, VersionSummary } from "./types";

type UseVersionsPermissionModelParams = {
  canApproveVersion: boolean;
  canCreateVersionActor: boolean;
  canManageLatestVersion: boolean;
  docId?: string;
  errorReportGate: { isBlocking: boolean; isLoading: boolean };
  isAdmin: boolean;
  isLeader: boolean;
  isSelectedAuthor: boolean;
  latestVersion: VersionSummary | null;
  latestVersionInReviewDecisionWindow: boolean;
  projectId: string;
  projectMembers: ProjectMember[];
  selectedAuthorId: string;
  selectedReviewerIds: string[];
  selectedVersion: VersionSummary | null;
  setError: Dispatch<SetStateAction<string | null>>;
  setIsBusy: Dispatch<SetStateAction<boolean>>;
  setSelectedAuthorId: Dispatch<SetStateAction<string>>;
  setSelectedReviewerIds: Dispatch<SetStateAction<string[]>>;
  userEmail?: string | null;
  userId: string;
  versionsLength: number;
  reportVersionsError: (
    error: unknown,
    action: string,
    source?: "firestore" | "storage" | "auth" | "ui" | "network" | "unknown",
    overrides?: { versionId?: string | null; threadId?: string | null },
  ) => void;
};

const statusClassName = (status?: string | null) => {
  switch (status) {
    case "In Creation":
      return "status-card--in-creation";
    case "In Review":
      return "status-card--in-review";
    case "Reviewed":
      return "status-card--reviewed";
    case "Accepted":
      return "status-card--accepted";
    case "Rejected":
      return "status-card--rejected";
    case "Replaced":
      return "status-card--replaced";
    default:
      return "";
  }
};

const useVersionsPermissionModel = ({
  canApproveVersion,
  canCreateVersionActor,
  canManageLatestVersion,
  docId,
  errorReportGate,
  isAdmin,
  isLeader,
  isSelectedAuthor,
  latestVersion,
  latestVersionInReviewDecisionWindow,
  projectId,
  projectMembers,
  selectedAuthorId,
  selectedReviewerIds,
  selectedVersion,
  setError,
  setIsBusy,
  setSelectedAuthorId,
  setSelectedReviewerIds,
  userEmail,
  userId,
  versionsLength,
  reportVersionsError,
}: UseVersionsPermissionModelParams) => {
  const allowedReviewerIds = useMemo(
    () =>
      projectMembers
        .map((member) => member.userId)
        .filter(
          (memberId) => !!memberId && memberId !== selectedVersion?.createdBy,
        ),
    [projectMembers, selectedVersion?.createdBy],
  );
  const createButtonLabel = useMemo(
    () =>
      versionsLength === 0 ? "Create initial version" : "Create next version",
    [versionsLength],
  );
  const canCreateVersion = useMemo(
    () =>
      canCreateVersionActor
        ? versionsLength === 0
          ? !0
          : latestVersion
            ? latestVersion.status === "In Review" ||
              latestVersion.status === "Reviewed"
              ? !0
              : latestVersion.status === "Accepted"
                ? !errorReportGate.isBlocking && !errorReportGate.isLoading
                : !1
            : !1
        : !1,
    [canCreateVersionActor, versionsLength, latestVersion, errorReportGate],
  );
  const canAssignReviewers = useMemo(
    () =>
      !!(
        selectedVersion &&
        selectedVersion.status === "In Creation" &&
        (isSelectedAuthor || isLeader || isAdmin)
      ),
    [selectedVersion, isSelectedAuthor, isLeader, isAdmin],
  );
  const canUploadFile = useMemo(
    () =>
      !!(
        selectedVersion &&
        selectedVersion.status === "In Creation" &&
        (isSelectedAuthor || isLeader || isAdmin)
      ),
    [selectedVersion, isSelectedAuthor, isLeader, isAdmin],
  );
  const canAssignAuthor = useMemo(
    () =>
      !!(
        selectedVersion &&
        selectedVersion.status === "In Creation" &&
        (isLeader || isAdmin)
      ),
    [selectedVersion, isLeader, isAdmin],
  );
  const { handleToggleReviewer, handleToggleAllReviewers, handleAssignAuthor } =
    useAssignmentActions({
      selectedVersion,
      userId,
      userEmail,
      projectId,
      docId,
      canAssignReviewers,
      canAssignAuthor,
      allowedReviewerIds,
      selectedReviewerIds,
      selectedAuthorId,
      projectMembers,
      setSelectedReviewerIds,
      setSelectedAuthorId,
      setIsBusy,
      setError,
      reportVersionsError,
    });
  const canCreateErrorReportActor =
    useMemo(
      () =>
        !!(userId && projectMembers.some((member) => member.userId === userId)),
      [projectMembers, userId],
    ) || isAdmin;
  const canStartReview = useMemo(
    () =>
      !!(
        latestVersion &&
        latestVersion.status === "In Creation" &&
        hasLinkedFileMetadata(latestVersion) &&
        latestVersion.reviewerIds.length > 0 &&
        canManageLatestVersion
      ),
    [latestVersion, canManageLatestVersion],
  );
  const canAcceptOrReject = useMemo(
    () =>
      !!(
        latestVersion &&
        latestVersionInReviewDecisionWindow &&
        latestVersion.hasFile &&
        latestVersion.numThreads > 0 &&
        latestVersion.numThreadsWithTwoPlusComments > 0 &&
        latestVersion.numOpenThreads === 0 &&
        canApproveVersion
      ),
    [latestVersion, latestVersionInReviewDecisionWindow, canApproveVersion],
  );
  const logBlockedVersionDecision = useCallback(
    (decision: "accept" | "reject", message: string) => {
      if (!(!userId || !docId)) {
        logAudit({
          actorId: userId,
          actorEmail: userEmail ?? null,
          action: "actionBlocked",
          entityType: "version",
          entityId: latestVersion?.id ?? docId,
          projectId,
          docId,
          versionId: latestVersion?.id ?? void 0,
          metadata: {
            blockedAction:
              decision === "accept" ? "acceptVersion" : "rejectVersion",
            message,
            latestVersionStatus: latestVersion?.status ?? null,
            latestVersionNumber: latestVersion?.number ?? null,
            latestVersionHasFile: latestVersion?.hasFile ?? null,
            latestVersionNumThreads: latestVersion?.numThreads ?? null,
            latestVersionNumOpenThreads: latestVersion?.numOpenThreads ?? null,
            latestVersionNumComments: latestVersion?.numComments ?? null,
            latestVersionNumThreadsWithTwoPlusComments:
              latestVersion?.numThreadsWithTwoPlusComments ?? null,
            latestVersionReviewEndAt:
              latestVersion?.reviewEndAt?.toISOString() ?? null,
            latestVersionInReviewDecisionWindow,
            canApproveVersion,
          },
        });
      }
    },
    [
      userId,
      userEmail,
      docId,
      latestVersion,
      projectId,
      latestVersionInReviewDecisionWindow,
      canApproveVersion,
    ],
  );

  return {
    allowedReviewerIds,
    canAcceptOrReject,
    canAssignAuthor,
    canAssignReviewers,
    canCreateErrorReportActor,
    canCreateVersion,
    canStartReview,
    canUploadFile,
    createButtonLabel,
    handleAssignAuthor,
    handleToggleAllReviewers,
    handleToggleReviewer,
    logBlockedVersionDecision,
    statusClassName,
  };
};

export default useVersionsPermissionModel;
