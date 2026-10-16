// src/pages/versions/reviewIssueDiagnostics.test.ts
// Verifies safe diagnostics for review issue permission failures.
import { describe, expect, it } from "vitest";
import { buildReviewIssueDiagnostics } from "./reviewIssueDiagnostics";

describe("buildReviewIssueDiagnostics", () => {
  it("separates server authorization state from the stale client gate", () => {
    const diagnostics = buildReviewIssueDiagnostics({
      actorId: "user-1",
      clientGate: {
        canCreateThread: true,
        canParticipateReview: true,
        selectedVersionInActiveReview: true,
        hasInitialComment: true,
      },
      clientVersion: {
        id: "version-1",
        status: "In Review",
        createdBy: "author-1",
        reviewerCount: 1,
      },
      docId: "document-1",
      memberData: { role: "member" },
      nowMs: 5_000,
      profileData: { isAdmin: false },
      projectId: "project-1",
      versionData: {
        createdBy: "author-1",
        docId: "document-1",
        projectId: "project-1",
        reviewerIds: ["reviewer-2"],
        reviewEndAt: new Date( 1_000 ),
        status: "Reviewed",
        stats: {
          numComments: 2,
          numOpenThreads: 1,
          numThreads: 1,
          numThreadsWithTwoPlusComments: 1,
        },
      },
      versionId: "version-1",
    });

    expect(diagnostics.authorization).toEqual({
      canContribute: false,
      isAdmin: false,
      isLeader: false,
      isVersionAuthor: false,
      isVersionReviewer: false,
      memberExists: true,
      profileExists: true,
      role: "member",
    });
    expect(diagnostics.clientVersion.status).toBe("In Review");
    expect(diagnostics.serverVersion.status).toBe("Reviewed");
    expect(diagnostics.serverVersion.reviewWindowExpired).toBe(true);
    expect(diagnostics.likelyCauses).toEqual([
      "actor_not_authorized",
      "version_not_in_review",
    ]);
  });

  it("reports mismatches between nested and legacy version counters", () => {
    const diagnostics = buildReviewIssueDiagnostics({
      actorId: "reviewer-1",
      clientGate: {
        canCreateThread: true,
        canParticipateReview: true,
        selectedVersionInActiveReview: true,
        hasInitialComment: true,
      },
      clientVersion: {
        id: "version-1",
        status: "In Review",
        createdBy: "author-1",
        reviewerCount: 1,
      },
      docId: "document-1",
      memberData: { role: "member" },
      nowMs: 5_000,
      profileData: { isAdmin: false },
      projectId: "project-1",
      versionData: {
        createdBy: "author-1",
        docId: "document-1",
        numComments: 1,
        numOpenThreads: 0,
        numThreads: 1,
        numThreadsWithTwoPlusComments: 0,
        projectId: "project-1",
        reviewerIds: ["reviewer-1"],
        reviewEndAt: new Date( 10_000 ),
        status: "In Review",
        stats: {
          numComments: 2,
          numOpenThreads: 1,
          numThreads: 2,
          numThreadsWithTwoPlusComments: 1,
        },
      },
      versionId: "version-1",
    });

    expect(diagnostics.counters.topLevel).toEqual({
      numComments: 1,
      numOpenThreads: 0,
      numThreads: 1,
      numThreadsWithTwoPlusComments: 0,
    });
    expect(diagnostics.counters.mismatchedKeys).toEqual([
      "numComments",
      "numOpenThreads",
      "numThreads",
      "numThreadsWithTwoPlusComments",
    ]);
    expect(diagnostics.likelyCauses).toContain("inconsistent_version_stats");
  });
});
