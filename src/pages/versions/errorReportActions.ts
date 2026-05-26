// src/pages/versions/errorReportActions.ts
// Creates handlers for opening and creating accepted-version error reports.
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { FIRST_VERSION_NUMBER } from "../../domain/types";
import { logAudit } from "../../lib/audit";
import { db } from "../../lib/firebase";
import type { VersionSummary } from "./types";

type ErrorReportActionParams = {
  canCreateErrorReportActor: boolean;
  docId?: string;
  latestVersion: VersionSummary | null;
  navigate: (path: string) => void;
  projectId: string;
  setError: (value: string | null) => void;
  setErrorReportTitle: (value: string) => void;
  setErrorReportTitleError: (value: string | null) => void;
  setIsBusy: (value: boolean) => void;
  setIsErrorReportModalOpen: (value: boolean) => void;
  setSuccessMessage: (value: string | null) => void;
  userEmail?: string | null;
  userId: string;
};

const createErrorReportActions = (params: ErrorReportActionParams) => {
  const handleCreateErrorReport = async (title: string) => {
    const {
      canCreateErrorReportActor,
      docId,
      latestVersion,
      navigate,
      projectId,
      setError,
      setErrorReportTitle,
      setErrorReportTitleError,
      setIsBusy,
      setIsErrorReportModalOpen,
      setSuccessMessage,
      userEmail,
      userId,
    } = params;

    if (!latestVersion || !projectId || !docId || !userId) {
      setError(
        "Select the latest Accepted version before creating an error report.",
      );
      return;
    }
    if (!canCreateErrorReportActor) {
      setError("Only project members or admins can create an error report.");
      return;
    }
    if (latestVersion.status !== "Accepted") {
      setError(
        "You can create an error report only when the latest version is Accepted.",
      );
      return;
    }
    if (title.trim().length === 0) {
      setErrorReportTitleError(
        "Provide a title for the error report before creating it.",
      );
      return;
    }
    setError(null);
    setSuccessMessage(null);
    setIsBusy(true);
    try {
      const counterRef = doc(db, "counters", `documents_${projectId}`);
      const errorReportRef = doc(collection(db, "documents"));
      const versionRef = doc(collection(db, "versions"));
      const versionCounterRef = doc(
        db,
        "counters",
        `versions_${errorReportRef.id}`,
      );
      await runTransaction(db, async (transaction) => {
        const nextNumberRaw = (await transaction.get(counterRef)).data()
          ?.nextNumber;
        const nextNumber =
          typeof nextNumberRaw === "number" ? nextNumberRaw : 1;
        transaction.set(
          counterRef,
          { nextNumber: nextNumber + 1, docId, projectId },
          { merge: true },
        );
        transaction.set(errorReportRef, {
          projectId,
          title: title.trim(),
          type: "errorReport",
          baseDocId: docId,
          baseVersionId: latestVersion.id,
          createdBy: userId,
          authorId: userId,
          updatedBy: userId,
          shortId: nextNumber,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        transaction.set(versionRef, {
          projectId,
          docId: errorReportRef.id,
          number: FIRST_VERSION_NUMBER,
          status: "In Creation",
          createdBy: userId,
          reviewerIds: [],
          reviewStartAt: null,
          reviewEndAt: null,
          hasFile: false,
          fileRefId: null,
          stats: {
            numThreads: 0,
            numOpenThreads: 0,
            numComments: 0,
            numThreadsWithTwoPlusComments: 0,
          },
          numThreads: 0,
          numOpenThreads: 0,
          numComments: 0,
          numThreadsWithTwoPlusComments: 0,
          acceptedErrorReportId: null,
          previousVersionId: null,
          createdAt: serverTimestamp(),
          activityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
        transaction.set(
          versionCounterRef,
          {
            nextNumber: FIRST_VERSION_NUMBER + 1,
            docId: errorReportRef.id,
            projectId,
            previousVersionId: null,
          },
          { merge: true },
        );
      });
      logAudit({
        actorId: userId,
        actorEmail: userEmail ?? null,
        action: "createErrorReport",
        entityType: "document",
        entityId: errorReportRef.id,
        projectId,
        docId: errorReportRef.id,
        metadata: { baseDocId: docId, baseVersionId: latestVersion.id },
      }).catch((err) => {
        console.warn("Audit log failed (create error report):", err);
      });
      setIsErrorReportModalOpen(false);
      setErrorReportTitle("");
      setErrorReportTitleError(null);
      navigate(
        `/documents/${errorReportRef.id}/versions?projectId=${projectId}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      setError(message);
    } finally {
      setIsBusy(false);
    }
  };

  const requestErrorReportCreation = () => {
    if (!params.latestVersion || !params.userId) {
      params.setError(
        "Select the latest Accepted version before creating an error report.",
      );
      return;
    }
    if (!params.canCreateErrorReportActor) {
      params.setError(
        "Only project members or admins can create an error report.",
      );
      return;
    }
    if (params.latestVersion.status !== "Accepted") {
      params.setError(
        "You can create an error report only when the latest version is Accepted.",
      );
      return;
    }
    params.setErrorReportTitle("");
    params.setErrorReportTitleError(null);
    params.setIsErrorReportModalOpen(true);
  };

  return { handleCreateErrorReport, requestErrorReportCreation };
};

export { createErrorReportActions };
