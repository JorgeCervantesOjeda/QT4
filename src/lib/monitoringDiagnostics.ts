// Builds bounded, non-sensitive diagnostic context shared by monitor alerts.
import type { MonitorSource } from "./errorMonitor";

type CommonMonitorDiagnosticsInput = {
  action: string;
  appVersion: string;
  docId?: string;
  online: boolean;
  projectId?: string;
  source: MonitorSource;
  threadId?: string;
  userId?: string;
  versionId?: string;
  visibilityState: string;
};

type MonitorDiagnosticDetails = Record<string, unknown>;

const buildCommonMonitorDiagnostics = ({
  action,
  appVersion,
  docId = "",
  online,
  projectId = "",
  source,
  threadId = "",
  userId = "",
  versionId = "",
  visibilityState,
}: CommonMonitorDiagnosticsInput): MonitorDiagnosticDetails => ({
  diagnosticVersion: 1,
  operation: { action, source },
  resources: { projectId, docId, versionId, threadId },
  session: {
    authenticated: Boolean(userId),
    online,
    visibilityState,
  },
  client: { appVersion },
});

const mergeMonitorDiagnosticDetails = (
  common: MonitorDiagnosticDetails,
  specific?: MonitorDiagnosticDetails,
): MonitorDiagnosticDetails => {
  if (!specific) {
    return common;
  }
  return {
    ...common,
    ...specific,
    operation: {
      ...asRecord(common.operation),
      ...asRecord(specific.operation),
    },
    resources: {
      ...asRecord(common.resources),
      ...asRecord(specific.resources),
    },
    session: {
      ...asRecord(common.session),
      ...asRecord(specific.session),
    },
    client: {
      ...asRecord(common.client),
      ...asRecord(specific.client),
    },
  };
};

const asRecord = (value: unknown): MonitorDiagnosticDetails =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as MonitorDiagnosticDetails)
    : {};

export {
  buildCommonMonitorDiagnostics,
  mergeMonitorDiagnosticDetails,
};
export type { CommonMonitorDiagnosticsInput };
