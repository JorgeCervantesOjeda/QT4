import { describe, expect, it } from "vitest";
import {
  buildCommonMonitorDiagnostics,
  mergeMonitorDiagnosticDetails,
} from "./monitoringDiagnostics";

describe("monitoring diagnostics", () => {
  it("builds safe common context for every monitored operation", () => {
    expect(
      buildCommonMonitorDiagnostics({
        action: "projects.load",
        appVersion: "4.12.0",
        docId: "document-1",
        online: true,
        projectId: "project-1",
        source: "firestore",
        threadId: "thread-1",
        userId: "user-1",
        versionId: "version-1",
        visibilityState: "visible",
      }),
    ).toEqual({
      diagnosticVersion: 1,
      operation: {
        action: "projects.load",
        source: "firestore",
      },
      resources: {
        projectId: "project-1",
        docId: "document-1",
        versionId: "version-1",
        threadId: "thread-1",
      },
      session: {
        authenticated: true,
        online: true,
        visibilityState: "visible",
      },
      client: {
        appVersion: "4.12.0",
      },
    });
  });

  it("preserves specific diagnostics while retaining common nested context", () => {
    expect(
      mergeMonitorDiagnosticDetails(
        {
          diagnosticVersion: 1,
          operation: { action: "versions.createThread", source: "firestore" },
          resources: { projectId: "project-1", versionId: "version-1" },
          session: { authenticated: true, online: true },
          client: { appVersion: "4.12.0" },
        },
        {
          diagnosticScope: "versions.createThread",
          likelyCauses: ["version_not_in_review"],
          operation: { phase: "transaction" },
        },
      ),
    ).toEqual({
      diagnosticVersion: 1,
      diagnosticScope: "versions.createThread",
      operation: {
        action: "versions.createThread",
        source: "firestore",
        phase: "transaction",
      },
      resources: { projectId: "project-1", versionId: "version-1" },
      session: { authenticated: true, online: true },
      client: { appVersion: "4.12.0" },
      likelyCauses: ["version_not_in_review"],
    });
  });
});
