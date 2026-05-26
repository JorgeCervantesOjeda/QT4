// src/pages/versions/commentNotification.ts
// Sends participant email notifications after a review comment is created.
import { versionNumberToString } from "../../domain/types";
import { notifyEmailUsingActiveProvider } from "../../lib/notifications";
import type {
  CommentSummary,
  DocumentSummary,
  ThreadSummary,
  VersionSummary,
} from "./types";

type CommentNotificationParams = {
  currentDocumentAuthorId: string;
  docId?: string;
  documentData: DocumentSummary | null;
  formatUserLabel: (memberUserId: string) => string;
  projectId: string;
  resolveUserEmail: (memberUserId: string) => string | null;
  selectedThread: ThreadSummary | null;
  selectedThreadComments: CommentSummary[];
  selectedVersion: VersionSummary | null;
  setEmailNotifyMessage: (value: string) => void;
  setEmailNotifyStatus: (value: "idle" | "sending") => void;
  setSuccessEmailRecipients: (
    value: { to: string[]; cc: string[] } | null,
  ) => void;
  setWarningMessage: (value: string | null) => void;
  userId: string;
};

const notifyCommentParticipants = async (
  params: CommentNotificationParams,
  commentId: string,
  commentBody: string,
) => {
  const {
    currentDocumentAuthorId,
    documentData,
    projectId,
    selectedThread,
    selectedThreadComments,
    selectedVersion,
    userId,
  } = params;
  if (!selectedThread || !selectedVersion || !params.docId) return;
  const participantIds = new Set<string>();
  if (selectedVersion.createdBy) participantIds.add(selectedVersion.createdBy);
  if (selectedThread.createdBy) participantIds.add(selectedThread.createdBy);
  selectedVersion.reviewerIds.forEach(
    (reviewerId) => reviewerId && participantIds.add(reviewerId),
  );
  selectedThreadComments.forEach(
    (comment) => comment.createdBy && participantIds.add(comment.createdBy),
  );
  if (currentDocumentAuthorId) participantIds.add(currentDocumentAuthorId);
  participantIds.delete(userId);
  const recipientEmails = Array.from(participantIds)
    .map((participantId) => params.resolveUserEmail(participantId))
    .filter((email): email is string => Boolean(email));
  const normalizedRecipientEmails = Array.from(
    new Set(recipientEmails.map((email) => email.toLowerCase())),
  );
  const toRecipients = normalizedRecipientEmails.slice(0, 1);
  const ccRecipients = normalizedRecipientEmails.slice(1);
  if (toRecipients.length === 0) {
    params.setWarningMessage(
      "Comment added, but no recipient email was resolved for participants.",
    );
    return;
  }
  const commentUrlQuery = new URLSearchParams();
  if (projectId) commentUrlQuery.set("projectId", projectId);
  commentUrlQuery.set("versionId", selectedVersion.id);
  commentUrlQuery.set("threadId", selectedThread.id);
  commentUrlQuery.set("commentId", commentId);
  commentUrlQuery.set("focus", "comments");
  const commentDirectUrl = `${window.location.origin}/documents/${encodeURIComponent(
    params.docId,
  )}/versions?${commentUrlQuery.toString()}`;
  const docLabel =
    `${documentData?.shortId ?? documentData?.id ?? "Document"} - ${documentData?.title ?? ""}`.trim();
  const commentBodyForEmail =
    commentBody.length > 1600
      ? `${commentBody.slice(0, 1600)}...`
      : commentBody;
  try {
    params.setEmailNotifyStatus("sending");
    params.setEmailNotifyMessage("Sending comment notifications...");
    await notifyEmailUsingActiveProvider({
      to: toRecipients,
      cc: ccRecipients,
      subject: `New Comment: ${
        Number.isFinite(documentData?.shortId)
          ? String(documentData?.shortId)
          : "Unassigned"
      } - ${selectedThread.title.trim() || "Untitled issue"}`,
      text: `A new comment was added.
Document: ${docLabel}
Version: ${versionNumberToString(selectedVersion.number)}
Issue: ${selectedThread.title}
Document author: ${params.formatUserLabel(currentDocumentAuthorId)}
Comment author: ${params.formatUserLabel(userId)}

Comment:
${commentBodyForEmail}

Open this comment directly:
${commentDirectUrl}
`,
    });
    params.setSuccessEmailRecipients({
      to: [...toRecipients],
      cc: [...ccRecipients],
    });
  } catch (err) {
    console.warn("Email notify failed (add comment):", err);
    const message = err instanceof Error ? err.message : "Unexpected error";
    params.setWarningMessage(
      `Comment added, but email notification failed: ${message}`,
    );
  } finally {
    params.setEmailNotifyStatus("idle");
    params.setEmailNotifyMessage("");
  }
};

export { notifyCommentParticipants };
