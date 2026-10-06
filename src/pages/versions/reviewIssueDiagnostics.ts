// src/pages/versions/reviewIssueDiagnostics.ts
// Builds safe, non-authoritative diagnostics for review issue write failures.
import { toTimestampDate } from "./utils";

type ClientGate = {
  canCreateThread: boolean;
  canParticipateReview: boolean;
  selectedVersionInActiveReview: boolean;
  hasInitialComment: boolean;
};

type ClientVersion = {
  id: string;
  status: string;
  createdBy: string;
  reviewerCount: number;
};

type ReviewIssueDiagnosticInput = {
  actorId: string;
  clientGate: ClientGate;
  clientVersion: ClientVersion;
  docId: string;
  memberData: Record<string, unknown> | null;
  nowMs: number;
  profileData: Record<string, unknown> | null;
  projectId: string;
  versionData: Record<string, unknown>;
  versionId: string;
};

type VersionCounters = {
  numComments: number;
  numOpenThreads: number;
  numThreads: number;
  numThreadsWithTwoPlusComments: number;
};

const readCounter = (
  versionData: Record<string, unknown>,
  counter: keyof VersionCounters,
): number => {
  const stats = versionData.stats;
  const nestedValue =
    stats && typeof stats === "object"
      ? (stats as Record<string, unknown>)[counter]
      : undefined;
  return Number(nestedValue ?? versionData[counter] ?? 0);
};

const readVersionCounters = (
  versionData: Record<string, unknown>,
): VersionCounters => ({
  numComments: readCounter(versionData, "numComments"),
  numOpenThreads: readCounter(versionData, "numOpenThreads"),
  numThreads: readCounter(versionData, "numThreads"),
  numThreadsWithTwoPlusComments: readCounter(
    versionData,
    "numThreadsWithTwoPlusComments",
  ),
});

const toIsoString = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

const buildReviewIssueDiagnostics = ({
  actorId,
  clientGate,
  clientVersion,
  docId,
  memberData,
  nowMs,
  profileData,
  projectId,
  versionData,
  versionId,
}: ReviewIssueDiagnosticInput) => {
  const reviewerIds = Array.isArray(versionData.reviewerIds)
    ? versionData.reviewerIds.filter((value): value is string => typeof value === "string")
    : [];
  const reviewEndAt = toTimestampDate(versionData.reviewEndAt);
  const storedCounters = readVersionCounters(versionData);
  const attemptedCounters: VersionCounters = {
    ...storedCounters,
    numComments: storedCounters.numComments + 1,
    numOpenThreads: storedCounters.numOpenThreads + 1,
    numThreads: storedCounters.numThreads + 1,
  };
  const invalidCounterKeys = Object.entries(storedCounters)
    .filter(([, value]) => !Number.isInteger(value) || value < 0)
    .map(([key]) => key);
  const role = typeof memberData?.role === "string" ? memberData.role : null;
  const isAdmin = profileData?.isAdmin === true;
  const isLeader = role === "leader";
  const isVersionAuthor = versionData.createdBy === actorId;
  const isVersionReviewer = reviewerIds.includes(actorId);
  const canContribute = isAdmin || isLeader || isVersionAuthor || isVersionReviewer;
  const likelyCauses: string[] = [];

  if (!canContribute) {
    likelyCauses.push("actor_not_authorized");
  }
  if (versionData.status !== "In Review") {
    likelyCauses.push("version_not_in_review");
  }
  if (invalidCounterKeys.length > 0) {
    likelyCauses.push("invalid_version_stats");
  }
  if (likelyCauses.length === 0) {
    likelyCauses.push("firestore_rule_or_data_mismatch");
  }

  return {
    diagnosticScope: "versions.createThread",
    diagnosticDisclaimer: "Client-side diagnostic; Firestore remains authoritative.",
    likelyCauses,
    authorization: {
      canContribute,
      isAdmin,
      isLeader,
      isVersionAuthor,
      isVersionReviewer,
      memberExists: memberData !== null,
      profileExists: profileData !== null,
      role,
    },
    clientGate,
    clientVersion,
    serverVersion: {
      id: versionId,
      projectId: typeof versionData.projectId === "string" ? versionData.projectId : null,
      docId: typeof versionData.docId === "string" ? versionData.docId : null,
      status: typeof versionData.status === "string" ? versionData.status : null,
      createdBy: typeof versionData.createdBy === "string" ? versionData.createdBy : null,
      reviewerCount: reviewerIds.length,
      isInReview: versionData.status === "In Review",
      hasFile: versionData.hasFile === true,
      reviewEndAt: toIsoString(reviewEndAt),
      reviewWindowExpired: reviewEndAt ? reviewEndAt.getTime() <= nowMs : null,
      projectMatchesRequest: versionData.projectId === projectId,
      docMatchesRequest: versionData.docId === docId,
    },
    stateDifferences: {
      statusChanged: clientVersion.status !== versionData.status,
      authorChanged: clientVersion.createdBy !== versionData.createdBy,
      reviewerCountChanged: clientVersion.reviewerCount !== reviewerIds.length,
    },
    counters: {
      stored: storedCounters,
      afterCreateAttempt: attemptedCounters,
      invalidKeys: invalidCounterKeys,
    },
  };
};

export { buildReviewIssueDiagnostics };
export type { ReviewIssueDiagnosticInput, VersionCounters };
