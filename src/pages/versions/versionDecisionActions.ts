// src/pages/versions/versionDecisionActions.ts
// Creates handlers for accepting, rejecting, and confirming latest-version decisions.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { isIntegerVersionNumber } from "../../domain/types";
import { logAudit } from "../../lib/audit";
import { db } from "../../lib/firebase";
import type { DocumentSummary, VersionSummary } from "./types";

type ReportVersionsError = (
  error: unknown,
  action: string,
  source?: "firestore" | "storage" | "auth" | "ui" | "network" | "unknown",
  overrides?: { versionId?: string | null; threadId?: string | null },
) => void;

type VersionDecision = "accept" | "reject";

type VersionDecisionActionParams = {
  canAcceptOrReject: boolean;
  docId?: string;
  documentData: DocumentSummary | null;
  isAdmin: boolean;
  isLeader: boolean;
  latestVersion: VersionSummary | null;
  loadDocumentAndVersions: () => void;
  logBlockedVersionDecision: (
    decision: VersionDecision,
    message: string,
  ) => void;
  projectId: string;
  reportVersionsError: ReportVersionsError;
  setError: (value: string | null) => void;
  setIsBusy: (value: boolean) => void;
  setSuccessMessage: (value: string | null) => void;
  setVersionDecisionModal: (value: VersionDecision | null) => void;
  userEmail?: string | null;
  userId: string;
  versionDecisionModal: VersionDecision | null;
  versions: VersionSummary[];
};

const acceptBlockedMessage =
  "To accept, the latest version must be in review time or grace, " +
  "have a file, all issues closed, and at least one issue with two or more " +
  "comments; you must be author, leader, or admin.";

const rejectBlockedMessage =
  "To reject, the latest version must be in review time or grace, " +
  "have a file, all issues closed, and at least one issue with two or more " +
  "comments; you must be author, leader, or admin.";

const createVersionDecisionActions = (params: VersionDecisionActionParams) => {
  const handleAcceptLatestVersion = async () => {
    const {
      canAcceptOrReject,
      docId,
      documentData,
      isAdmin,
      isLeader,
      latestVersion,
      loadDocumentAndVersions,
      logBlockedVersionDecision,
      projectId,
      reportVersionsError,
      setError,
      setIsBusy,
      setSuccessMessage,
      userEmail,
      userId,
      versions,
    } = params;

    if (!docId || !userId || !latestVersion) {
      const message = "Select the latest version before accepting.";
      setError(message);
      logBlockedVersionDecision("accept", message);
      return;
    }
    if (!canAcceptOrReject) {
      setError(acceptBlockedMessage);
      logBlockedVersionDecision("accept", acceptBlockedMessage);
      return;
    }
    setError(null);
    setSuccessMessage(null);
    setIsBusy(true);
    try {
      const promotedNumber = (Math.floor(latestVersion.number / 100) + 1) * 100;
      const previousAccepted = versions.find(
        (versionItem) =>
          versionItem.id !== latestVersion.id &&
          versionItem.status === "Accepted" &&
          isIntegerVersionNumber(versionItem.number),
      );
      const batch = writeBatch(db);
      const counterRef = doc(db, "counters", `versions_${docId}`);
      batch.update(doc(db, "versions", latestVersion.id), {
        number: promotedNumber,
        status: "Accepted",
        activityAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
      batch.set(
        counterRef,
        {
          nextNumber: promotedNumber + 1,
          docId,
          projectId,
          previousVersionId: latestVersion.id,
        },
        { merge: true },
      );
      if (
        previousAccepted &&
        (isLeader || isAdmin || previousAccepted.createdBy === userId)
      ) {
        batch.update(doc(db, "versions", previousAccepted.id), {
          status: "Replaced",
          activityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
      }
      await batch.commit();
      setSuccessMessage("Latest version accepted successfully.");
      logAudit({
        actorId: userId,
        actorEmail: userEmail ?? null,
        action: "acceptVersion",
        entityType: "version",
        entityId: latestVersion.id,
        projectId,
        docId,
        versionId: latestVersion.id,
      }).catch((err) => {
        console.warn("Audit log failed (accept version):", err);
      });
      const baseVersionId = documentData?.baseVersionId ?? null;
      if (documentData?.type === "errorReport" && baseVersionId) {
        logAcceptedErrorReportTasks({
          baseVersionId,
          documentData,
          projectId,
          userEmail,
          userId,
        }).catch((err) => {
          console.warn("Accepted error report task logging failed:", err);
        });
      }
      loadDocumentAndVersions();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      reportVersionsError(err, "versions.acceptLatestVersion", "firestore", {
        versionId: latestVersion.id,
      });
      setError(message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleRejectLatestVersion = async () => {
    const {
      canAcceptOrReject,
      docId,
      isAdmin,
      isLeader,
      latestVersion,
      loadDocumentAndVersions,
      logBlockedVersionDecision,
      projectId,
      reportVersionsError,
      setError,
      setIsBusy,
      setSuccessMessage,
      userEmail,
      userId,
      versions,
    } = params;

    if (!docId || !userId || !latestVersion) {
      const message = "Select the latest version before rejecting.";
      setError(message);
      logBlockedVersionDecision("reject", message);
      return;
    }
    if (!canAcceptOrReject) {
      setError(rejectBlockedMessage);
      logBlockedVersionDecision("reject", rejectBlockedMessage);
      return;
    }
    setError(null);
    setSuccessMessage(null);
    setIsBusy(true);
    try {
      const previousAccepted = versions.find(
        (versionItem) =>
          versionItem.id !== latestVersion.id &&
          versionItem.status === "Accepted" &&
          isIntegerVersionNumber(versionItem.number),
      );
      const batch = writeBatch(db);
      batch.update(doc(db, "versions", latestVersion.id), {
        status: "Rejected",
        activityAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
      if (
        previousAccepted &&
        (isLeader || isAdmin || previousAccepted.createdBy === userId)
      ) {
        batch.update(doc(db, "versions", previousAccepted.id), {
          status: "Replaced",
          activityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
      }
      await batch.commit();
      setSuccessMessage("Latest version rejected successfully.");
      logAudit({
        actorId: userId,
        actorEmail: userEmail ?? null,
        action: "rejectVersion",
        entityType: "version",
        entityId: latestVersion.id,
        projectId,
        docId,
        versionId: latestVersion.id,
      }).catch((err) => {
        console.warn("Audit log failed (reject version):", err);
      });
      loadDocumentAndVersions();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      reportVersionsError(err, "versions.rejectLatestVersion", "firestore", {
        versionId: latestVersion.id,
      });
      setError(message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirmVersionDecision = async () => {
    if (params.versionDecisionModal === "accept") {
      params.setVersionDecisionModal(null);
      await handleAcceptLatestVersion();
      return;
    }
    if (params.versionDecisionModal === "reject") {
      params.setVersionDecisionModal(null);
      await handleRejectLatestVersion();
    }
  };

  const requestVersionDecisionConfirmation = (decision: VersionDecision) => {
    if (!params.docId || !params.userId || !params.latestVersion) {
      const message =
        decision === "accept"
          ? "Select the latest version before accepting."
          : "Select the latest version before rejecting.";
      params.setError(message);
      params.logBlockedVersionDecision(decision, message);
      return;
    }
    if (!params.canAcceptOrReject) {
      const message =
        decision === "accept" ? acceptBlockedMessage : rejectBlockedMessage;
      params.setError(message);
      params.logBlockedVersionDecision(decision, message);
      return;
    }
    params.setError(null);
    params.setVersionDecisionModal(decision);
  };

  return {
    handleAcceptLatestVersion,
    handleConfirmVersionDecision,
    handleRejectLatestVersion,
    requestVersionDecisionConfirmation,
  };
};

const logAcceptedErrorReportTasks = async (params: {
  baseVersionId: string;
  documentData: DocumentSummary;
  projectId: string;
  userEmail?: string | null;
  userId: string;
}) => {
  const baseVersionData = (
    await getDoc(doc(db, "versions", params.baseVersionId))
  ).data();
  const baseAuthorId = baseVersionData?.createdBy ?? "";
  const baseProjectId = baseVersionData?.projectId ?? params.projectId;
  const leaderId = (
    baseProjectId
      ? await getDocs(
          query(
            collection(db, "projectMembers"),
            where("projectId", "==", baseProjectId),
            where("role", "==", "leader"),
          ),
        )
      : null
  )?.docs[0]?.data()?.userId;
  const taskTargets = [baseAuthorId, leaderId].filter(Boolean);
  await Promise.all(
    taskTargets.map((targetId) =>
      logAudit({
        actorId: params.userId,
        actorEmail: params.userEmail ?? null,
        action: "taskAppear",
        entityType: "task",
        entityId: `acceptedReport:${params.documentData.baseVersionId}:${targetId}`,
        projectId: baseProjectId,
        docId: params.documentData.baseDocId ?? "",
        versionId: params.documentData.baseVersionId ?? "",
        targetUserId: targetId,
        metadata: {
          taskType: "acceptedReport",
          taskKey: `acceptedReport:${params.documentData.baseVersionId}:${targetId}`,
        },
      }),
    ),
  );
};

export { createVersionDecisionActions };
