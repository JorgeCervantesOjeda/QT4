import { describe, expect, it } from "vitest";
import { buildVersionsErrorDiagnostics } from "./versionsErrorDiagnostics";

describe("buildVersionsErrorDiagnostics", () => {
  it("describes version, thread, file, and client gate state without content", () => {
    const diagnostics = buildVersionsErrorDiagnostics({
      action: "versions.downloadFile",
      canParticipateReview: true,
      docId: "document-1",
      latestVersion: {
        id: "version-2",
        number: 2,
        status: "In Creation",
        createdBy: "user-1",
        reviewerIds: ["reviewer-1"],
        reviewDurationDays: 7,
        hasFile: true,
        fileRefId: "file-2",
        numThreads: 2,
        numOpenThreads: 1,
        numComments: 3,
        numThreadsWithTwoPlusComments: 1,
        acceptedErrorReportId: null,
      },
      projectId: "project-1",
      selectedFileRef: {
        id: "file-2",
        fileKey: "private-key",
        fileName: "report.pdf",
        contentType: "application/pdf",
        sizeBytes: 123,
        isPermanent: true,
        expireAfterDays: null,
        storageProvider: "files-api",
        createdBy: "user-1",
        projectId: "project-1",
        docId: "document-1",
        versionId: "version-2",
      },
      selectedThread: {
        id: "thread-1",
        status: "open",
        title: "Private title must not be copied",
        createdBy: "user-1",
        commentCount: 2,
      },
      selectedVersion: {
        id: "version-1",
        number: 1,
        status: "In Review",
        createdBy: "author-1",
        reviewerIds: ["user-1", "reviewer-1"],
        reviewDurationDays: 7,
        hasFile: false,
        fileRefId: null,
        numThreads: 1,
        numOpenThreads: 1,
        numComments: 1,
        numThreadsWithTwoPlusComments: 0,
        acceptedErrorReportId: null,
      },
      selectedVersionInReview: true,
      source: "storage",
      threadId: "thread-1",
      userId: "user-1",
      versionId: "version-1",
    });

    expect(diagnostics).toMatchObject({
      diagnosticArea: "versions",
      operation: { action: "versions.downloadFile", source: "storage" },
      clientGates: {
        canParticipateReview: true,
        selectedVersionInReview: true,
      },
      selectedVersion: {
        id: "version-1",
        status: "In Review",
        reviewerCount: 2,
      },
      selectedThread: {
        id: "thread-1",
        status: "open",
        commentCount: 2,
      },
      selectedFile: {
        id: "file-2",
        fileName: "report.pdf",
        fileKeyPresent: true,
        storageProvider: "files-api",
      },
    });
    expect(JSON.stringify(diagnostics)).not.toContain("Private title");
    expect(JSON.stringify(diagnostics)).not.toContain("private-key");
  });
});
