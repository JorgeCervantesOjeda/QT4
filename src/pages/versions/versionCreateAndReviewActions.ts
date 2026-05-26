// src/pages/versions/versionCreateAndReviewActions.ts
// Creates the handlers for creating a version and starting review.
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import {
  FIRST_VERSION_NUMBER,
  versionNumberToString,
} from "../../domain/types";
import { logAudit } from "../../lib/audit";
import { db } from "../../lib/firebase";
import { notifyEmailUsingActiveProvider } from "../../lib/notifications";
import { REVIEW_WINDOW_MS } from "../../lib/reviewWindow";
import type { DocumentSummary, VersionSummary } from "./types";

type ReportVersionsError = (
  error: unknown,
  action: string,
  source?: "firestore" | "storage" | "auth" | "ui" | "network" | "unknown",
  overrides?: { versionId?: string | null; threadId?: string | null },
) => void;

type VersionCreateAndReviewActionParams = {
  canCreateVersion: boolean;
  canStartReview: boolean;
  docId?: string;
  documentData: DocumentSummary | null;
  errorReportGate: { isBlocking: boolean; isLoading: boolean };
  formatUserLabel: (memberUserId: string) => string;
  latestVersion: VersionSummary | null;
  loadDocumentAndVersions: () => void;
  projectId: string;
  reportVersionsError: ReportVersionsError;
  resolveUserEmail: (memberUserId: string) => string | null;
  setEmailNotifyMessage: (value: string) => void;
  setEmailNotifyStatus: (value: "idle" | "sending") => void;
  setError: (value: string | null) => void;
  setIsBusy: (value: boolean) => void;
  setSuccessEmailRecipients: (
    value: { to: string[]; cc: string[] } | null,
  ) => void;
  setSuccessMessage: (value: string | null) => void;
  setWarningMessage: (value: string | null) => void;
  userEmail?: string | null;
  userId: string;
  versions: VersionSummary[];
};

const createVersionPermissionMessage =
  "To create a version: ((user is project leader) or " +
  "(user is latest version author) or (user is admin)) and " +
  "((latest version status = 'In Review' or 'Reviewed') or " +
  "((latest version status = 'Accepted') and " +
  "(exists related error report with latest version status = 'Accepted'))).";

const startReviewPermissionMessage =
  "To start review, the version must be In Creation, " +
  "have linked file metadata (fileRefId), have at least one reviewer, " +
  "and you must be the author or leader.";

const createVersionCreateAndReviewActions = (
  params: VersionCreateAndReviewActionParams,
) => {
  const handleCreateVersion = async () => {
    const {
      canCreateVersion,
      docId,
      documentData,
      errorReportGate,
      latestVersion,
      loadDocumentAndVersions,
      projectId,
      reportVersionsError,
      setError,
      setIsBusy,
      setSuccessMessage,
      setWarningMessage,
      userEmail,
      userId,
      versions,
    } = params;

    if (!docId || !projectId || !userId || !documentData) {
      setError("Sign in and select a document before creating a version.");
      return;
    }
    if (!canCreateVersion) {
      if (latestVersion?.status === "Accepted" && errorReportGate.isLoading) {
        setError(
          "Please wait while we check related error reports, then try again.",
        );
        return;
      }
      if (latestVersion?.status === "Accepted" && errorReportGate.isBlocking) {
        setError(
          "To create the next version from an Accepted version, at least one related error report must have latest version in Accepted.",
        );
        return;
      }
      setError(createVersionPermissionMessage);
      return;
    }
    setError(null);
    setSuccessMessage(null);
    setWarningMessage(null);
    setIsBusy(true);
    try {
      const counterRef = doc(db, "counters", `versions_${docId}`);
      const versionRef = doc(collection(db, "versions"));
      await runTransaction(db, async (transaction) => {
        const counterSnap = await transaction.get(counterRef);
        const txFallbackNext =
          versions.length > 0 ? versions[0].number + 1 : FIRST_VERSION_NUMBER;
        const txNextNumberRaw = counterSnap.data()?.nextNumber;
        const txNextNumber =
          typeof txNextNumberRaw === "number" &&
          txNextNumberRaw >= txFallbackNext
            ? txNextNumberRaw
            : txFallbackNext;

        transaction.set(
          counterRef,
          {
            nextNumber: txNextNumber + 1,
            docId,
            projectId,
            previousVersionId: latestVersion?.id ?? null,
          },
          { merge: true },
        );
        transaction.set(versionRef, {
          projectId,
          docId,
          number: txNextNumber,
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
          previousVersionId: latestVersion?.id ?? null,
          createdAt: serverTimestamp(),
          activityAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
        if (latestVersion?.status === "In Review") {
          transaction.update(doc(db, "versions", latestVersion.id), {
            status: "Reviewed",
            updatedAt: serverTimestamp(),
            updatedBy: userId,
          });
        }
      });
      setSuccessMessage("Version created successfully.");
      logAudit({
        actorId: userId,
        actorEmail: userEmail ?? null,
        action: "createVersion",
        entityType: "version",
        entityId: versionRef.id,
        projectId,
        docId,
        versionId: versionRef.id,
      }).catch((err) => {
        console.warn("Audit log failed (create version):", err);
      });
      loadDocumentAndVersions();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      reportVersionsError(err, "versions.createVersion", "firestore");
      const loweredMessage = message.toLowerCase();
      setError(
        loweredMessage.includes("missing or insufficient permissions") ||
          loweredMessage.includes("permission-denied")
          ? createVersionPermissionMessage
          : message,
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleStartReview = async () => {
    const {
      canStartReview,
      docId,
      documentData,
      formatUserLabel,
      latestVersion,
      loadDocumentAndVersions,
      projectId,
      reportVersionsError,
      resolveUserEmail,
      setEmailNotifyMessage,
      setEmailNotifyStatus,
      setError,
      setIsBusy,
      setSuccessEmailRecipients,
      setSuccessMessage,
      setWarningMessage,
      userEmail,
      userId,
    } = params;

    if (!latestVersion || !userId) {
      setError("Select a version to start review.");
      return;
    }
    if (!canStartReview) {
      setError(startReviewPermissionMessage);
      return;
    }
    setError(null);
    setSuccessMessage(null);
    setSuccessEmailRecipients(null);
    setEmailNotifyStatus("idle");
    setEmailNotifyMessage("");
    setIsBusy(true);
    try {
      const reviewEndAt = Timestamp.fromDate(
        new Date(Date.now() + REVIEW_WINDOW_MS),
      );
      const batch = writeBatch(db);
      batch.update(doc(db, "versions", latestVersion.id), {
        status: "In Review",
        reviewStartAt: serverTimestamp(),
        reviewEndAt,
        activityAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
      await batch.commit();
      const reviewerIds = latestVersion.reviewerIds ?? [];
      logAudit({
        actorId: userId,
        actorEmail: userEmail ?? null,
        action: "startReview",
        entityType: "version",
        entityId: latestVersion.id,
        projectId,
        docId,
        versionId: latestVersion.id,
      }).catch((err) => {
        console.warn("Audit log failed (start review):", err);
      });

      const authorEmail = latestVersion.createdBy
        ? resolveUserEmail(latestVersion.createdBy)
        : null;
      const reviewerEmails = reviewerIds
        .map((reviewerId) => resolveUserEmail(reviewerId))
        .filter((email): email is string => Boolean(email))
        .filter((email) => (authorEmail ? email !== authorEmail : true));
      const toRecipients = authorEmail
        ? [authorEmail]
        : reviewerEmails.slice(0, 1);
      const ccRecipients = authorEmail
        ? reviewerEmails
        : reviewerEmails.slice(1);
      let sentReviewEmailRecipients: { to: string[]; cc: string[] } | null =
        null;

      if (toRecipients.length > 0) {
        const docLabel =
          `${documentData?.shortId ?? documentData?.id ?? "Document"} - ${
            documentData?.title ?? ""
          }`.trim();
        const versionLabel = versionNumberToString(latestVersion.number);
        const versionUrlQuery = new URLSearchParams();
        if (projectId) {
          versionUrlQuery.set("projectId", projectId);
        }
        versionUrlQuery.set("versionId", latestVersion.id);
        versionUrlQuery.set("focus", "issues");
        const versionDirectUrl = `${window.location.origin}/documents/${encodeURIComponent(
          docId ?? "",
        )}/versions?${versionUrlQuery.toString()}`;
        try {
          setEmailNotifyStatus("sending");
          setEmailNotifyMessage("Sending review notifications...");
          await notifyEmailUsingActiveProvider({
            to: toRecipients,
            cc: ccRecipients,
            subject: `Review started: ${docLabel} v${versionLabel}`,
            text: `Review started for ${docLabel}.
Version: ${versionLabel}
Reviewers: ${reviewerIds.length > 0 ? reviewerIds.map((reviewerId) => formatUserLabel(reviewerId)).join(", ") : "None"}
Started by: ${formatUserLabel(userId)}

Open this version:
${versionDirectUrl}
`,
          });
          sentReviewEmailRecipients = {
            to: [...toRecipients],
            cc: [...ccRecipients],
          };
        } catch (err) {
          console.warn("Email notify failed (start review):", err);
          const message =
            err instanceof Error ? err.message : "Unexpected error";
          setWarningMessage(
            `Review started, but email notification failed: ${message}`,
          );
        } finally {
          setEmailNotifyStatus("idle");
          setEmailNotifyMessage("");
        }
      } else {
        setWarningMessage(
          "Review started, but no recipient email was resolved for author/reviewers.",
        );
      }
      setSuccessEmailRecipients(sentReviewEmailRecipients);
      setSuccessMessage("Review started successfully.");
      loadDocumentAndVersions();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      reportVersionsError(err, "versions.startReview", "firestore", {
        versionId: latestVersion.id,
      });
      setError(message);
    } finally {
      setEmailNotifyStatus("idle");
      setEmailNotifyMessage("");
      setIsBusy(false);
    }
  };

  return { handleCreateVersion, handleStartReview };
};

export { createVersionCreateAndReviewActions };
