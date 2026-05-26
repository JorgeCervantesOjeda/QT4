// src/pages/versions/useVersionsErrorChecklistModel.ts
// Builds the diagnostic checklist shown when a Versions page action is blocked.
import { useMemo } from "react";
import { buildVersionsErrorChecklist } from "../../lib/errorChecklistBuilders";
import { canAddCommentInWindow } from "../../lib/reviewWindow";
import { hasLinkedFileMetadata } from "./utils";
import type { DocumentSummary, ThreadSummary, VersionSummary } from "./types";

type UseVersionsErrorChecklistModelParams = {
  canParticipateReview: boolean;
  clockNowMs: number;
  docId?: string;
  documentAuthorId: string;
  documentData: DocumentSummary | null;
  error: string | null;
  errorReportGate: { isBlocking: boolean; isLoading: boolean };
  isAdmin: boolean;
  isLatestAuthor: boolean;
  isLeader: boolean;
  isReviewer: boolean;
  isSelectedAuthor: boolean;
  latestVersion: VersionSummary | null;
  latestVersionInAccepted: boolean;
  latestVersionInReviewDecisionWindow: boolean;
  latestVersionInReviewed: boolean;
  newCommentBody: string;
  newThreadTitle: string;
  selectedThread: ThreadSummary | null;
  selectedThreadLatestCommentAt?: Date | null;
  selectedThreadOpen: boolean;
  selectedVersion: VersionSummary | null;
  selectedVersionInActiveReview: boolean;
  selectedVersionInReview: boolean;
  userId: string;
  versionsLength: number;
};

const useVersionsErrorChecklistModel = ({
  canParticipateReview,
  clockNowMs,
  docId,
  documentAuthorId,
  documentData,
  error,
  errorReportGate,
  isAdmin,
  isLatestAuthor,
  isLeader,
  isReviewer,
  isSelectedAuthor,
  latestVersion,
  latestVersionInAccepted,
  latestVersionInReviewDecisionWindow,
  latestVersionInReviewed,
  newCommentBody,
  newThreadTitle,
  selectedThread,
  selectedThreadLatestCommentAt,
  selectedThreadOpen,
  selectedVersion,
  selectedVersionInActiveReview,
  selectedVersionInReview,
  userId,
  versionsLength,
}: UseVersionsErrorChecklistModelParams) =>
  useMemo(
    () =>
      buildVersionsErrorChecklist(error, {
        docSelected: !!(docId && documentData),
        userSignedIn: !!userId,
        networkAvailable: typeof navigator < "u" ? navigator.onLine : !0,
        hasAnyVersion: versionsLength > 0,
        userIsProjectLeader: isLeader,
        userIsDocumentAuthor: !!(
          userId &&
          documentAuthorId &&
          userId === documentAuthorId
        ),
        userIsLatestVersionAuthor: isLatestAuthor,
        userIsSelectedVersionAuthor: isSelectedAuthor,
        userIsReviewer: isReviewer,
        userIsAdmin: isAdmin,
        hasLatestVersion: !!latestVersion,
        latestVersionInReview: latestVersionInReviewDecisionWindow,
        latestVersionInReviewed,
        latestVersionInCreation: !!(
          selectedVersion && selectedVersion.status === "In Creation"
        ),
        latestVersionInAccepted,
        selectedVersionInCreation: !!(
          selectedVersion && selectedVersion.status === "In Creation"
        ),
        selectedVersionInActiveReview,
        selectedVersionCommentWindowOpen: !!(
          selectedVersion &&
          selectedThread &&
          canAddCommentInWindow({
            versionStatus: selectedVersion.status,
            reviewEndAt: selectedVersion.reviewEndAt,
            threadStatus: selectedThread.status,
            lastThreadCommentAt: selectedThreadLatestCommentAt,
            canParticipate: canParticipateReview,
            hasBody: !0,
            nowMs: clockNowMs,
          })
        ),
        latestVersionHasFile: hasLinkedFileMetadata(latestVersion),
        latestVersionHasReviewer: !!(
          latestVersion && latestVersion.reviewerIds.length > 0
        ),
        latestVersionHasIssues: !!(
          latestVersion && latestVersion.numThreads > 0
        ),
        latestVersionHasIssueWithAtLeastTwoComments: !!(
          latestVersion && latestVersion.numThreadsWithTwoPlusComments > 0
        ),
        latestVersionNoOpenIssues: !!(
          latestVersion && latestVersion.numOpenThreads === 0
        ),
        hasAcceptedRelatedErrorReport:
          latestVersionInAccepted &&
          !errorReportGate.isBlocking &&
          !errorReportGate.isLoading,
        selectedVersionIsLatest: !!(
          selectedVersion &&
          latestVersion &&
          selectedVersion.id === latestVersion.id
        ),
        selectedVersionInReview,
        selectedThreadOpen,
        selectedIssueHasAtLeastTwoComments: !!(
          selectedThread && selectedThread.commentCount >= 2
        ),
        hasSelectedVersion: !!selectedVersion,
        selectedVersionHasFile: hasLinkedFileMetadata(selectedVersion),
        issueTitleProvided: newThreadTitle.trim().length > 0,
        hasSelectedThread: !!selectedThread,
        commentBodyProvided: newCommentBody.trim().length > 0,
      }),
    [
      canParticipateReview,
      clockNowMs,
      docId,
      documentAuthorId,
      documentData,
      error,
      errorReportGate.isBlocking,
      errorReportGate.isLoading,
      isAdmin,
      isLatestAuthor,
      isLeader,
      isReviewer,
      isSelectedAuthor,
      latestVersion,
      latestVersionInAccepted,
      latestVersionInReviewDecisionWindow,
      latestVersionInReviewed,
      newCommentBody,
      newThreadTitle,
      selectedThread,
      selectedThreadLatestCommentAt,
      selectedThreadOpen,
      selectedVersion,
      selectedVersionInActiveReview,
      selectedVersionInReview,
      userId,
      versionsLength,
    ],
  );

export default useVersionsErrorChecklistModel;
