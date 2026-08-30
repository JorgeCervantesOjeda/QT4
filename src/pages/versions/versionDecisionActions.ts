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
import {
  ACCEPTED_DERIVED_DOCUMENT_MESSAGE,
  DERIVED_GENERATION_IN_PROGRESS_MESSAGE,
  buildDerivationLineKey,
} from "../../lib/documentDerivation";
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

const STALE_DERIVED_DOCUMENT_MESSAGE =
  "This derived variant no longer matches the active accepted change requests. Create a new derived variant before accepting.";

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const areStringSetsEqual = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false;
  }
  const rightValues = new Set(right);
  return left.every((item) => rightValues.has(item));
};

const derivedConfigurationRefFor = (value: {
  variantProjectId: string;
  originProjectId: string;
  originDocumentId: string;
  originVersionId: string;
}) =>
  doc(
    db,
    "derivedConfigurations",
    buildDerivationLineKey({
      variantProjectId: value.variantProjectId,
      originProjectId: value.originProjectId,
      originDocumentId: value.originDocumentId,
      originVersionId: value.originVersionId,
    }),
  );

const validateChangeRequestAcceptable = async (value: {
  documentData: DocumentSummary;
  projectId: string;
}) => {
  const baseProjectId = value.documentData.baseProjectId ?? "";
  const baseDocId = value.documentData.baseDocId ?? "";
  const baseVersionId = value.documentData.baseVersionId ?? "";
  if (!baseProjectId || !baseDocId || !baseVersionId) {
    return {
      message: "Invalid change request data: baseProjectId, baseDocId and baseVersionId are required.",
    };
  }
  const configRef = derivedConfigurationRefFor({
    variantProjectId: value.projectId,
    originProjectId: baseProjectId,
    originDocumentId: baseDocId,
    originVersionId: baseVersionId,
  });
  const configSnapshot = await getDoc(configRef);
  const configData = configSnapshot.exists() ? configSnapshot.data() : {};
  if (configData.status === "Accepted") {
    return { message: ACCEPTED_DERIVED_DOCUMENT_MESSAGE };
  }
  if (configData.generationStatus === "generating") {
    return { message: DERIVED_GENERATION_IN_PROGRESS_MESSAGE };
  }
  return {
    configRef,
    activeChangeRequestVersionIds: asStringArray(configData.activeChangeRequestVersionIds),
    message: null,
  };
};

const validateDerivedDocumentAcceptable = async (value: {
  documentData: DocumentSummary;
  projectId: string;
}) => {
  const originProjectId = value.documentData.originProjectId ?? "";
  const originDocumentId = value.documentData.originDocumentId ?? "";
  const originVersionId = value.documentData.originVersionId ?? "";
  if (!originProjectId || !originDocumentId || !originVersionId) {
    return "Invalid derived document data: originProjectId, originDocumentId and originVersionId are required.";
  }
  const configSnapshot = await getDoc(
    derivedConfigurationRefFor({
      variantProjectId: value.projectId,
      originProjectId,
      originDocumentId,
      originVersionId,
    }),
  );
  const configData = configSnapshot.exists() ? configSnapshot.data() : {};
  const activeChangeRequestVersionIds = asStringArray(configData.activeChangeRequestVersionIds);
  const incorporatedChangeRequestVersionIds = value.documentData.incorporatedChangeRequestVersionIds ?? [];
  if (!areStringSetsEqual(activeChangeRequestVersionIds, incorporatedChangeRequestVersionIds)) {
    return STALE_DERIVED_DOCUMENT_MESSAGE;
  }
  return null;
};

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
      const changeRequestAcceptValidation = documentData?.type === "changeRequest"
        ? await validateChangeRequestAcceptable({
            documentData,
            projectId,
          })
        : null;
      if (changeRequestAcceptValidation?.message) {
        setError(changeRequestAcceptValidation.message);
        logBlockedVersionDecision("accept", changeRequestAcceptValidation.message);
        return;
      }
      const derivedDocumentAcceptValidation = documentData?.type === "derivedDocument"
        ? await validateDerivedDocumentAcceptable({
            documentData,
            projectId,
          })
        : null;
      if (derivedDocumentAcceptValidation) {
        setError(derivedDocumentAcceptValidation);
        logBlockedVersionDecision("accept", derivedDocumentAcceptValidation);
        return;
      }
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
        documentData?.type === "changeRequest" &&
        changeRequestAcceptValidation?.configRef
      ) {
        batch.set(
          changeRequestAcceptValidation.configRef,
          {
            key: buildDerivationLineKey({
              variantProjectId: projectId,
              originProjectId: documentData.baseProjectId ?? "",
              originDocumentId: documentData.baseDocId ?? "",
              originVersionId: documentData.baseVersionId ?? "",
            }),
            projectId,
            originProjectId: documentData.baseProjectId ?? "",
            originDocumentId: documentData.baseDocId ?? "",
            originVersionId: documentData.baseVersionId ?? "",
            activeChangeRequestVersionIds: [
              ...new Set([
                ...changeRequestAcceptValidation.activeChangeRequestVersionIds,
                latestVersion.id,
              ]),
            ].sort(),
            status: "Open",
            generationStatus: "open",
            updatedAt: serverTimestamp(),
            updatedBy: userId,
          },
          { merge: true },
        );
      }
      if (
        documentData?.type === "derivedDocument" &&
        documentData.originProjectId &&
        documentData.originDocumentId &&
        documentData.originVersionId
      ) {
        batch.set(
          derivedConfigurationRefFor({
            variantProjectId: projectId,
            originProjectId: documentData.originProjectId,
            originDocumentId: documentData.originDocumentId,
            originVersionId: documentData.originVersionId,
          }),
          {
            status: "Accepted",
            generationStatus: "accepted",
            acceptedDerivedDocumentId: documentData.id,
            acceptedDerivedVersionId: latestVersion.id,
            updatedAt: serverTimestamp(),
            updatedBy: userId,
          },
          { merge: true },
        );
      }
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
