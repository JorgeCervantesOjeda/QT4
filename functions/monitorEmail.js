// functions/monitorEmail.js
// Builds the plain-text email for abnormal client monitor events.
const stringifyDetails = (value) => {
  try {
    return JSON.stringify( value, null, 2 )
  } catch {
    return "{}"
  }
}

const buildMonitorEmailText = ({ payload, consoleUrl }) => {
  const projectLine = payload.projectLabel || payload.projectId || "-"
  const documentLine = payload.docLabel || payload.docId || "-"
  const versionLine = payload.versionLabel || payload.versionId || "-"
  const threadLine = payload.threadLabel || payload.threadId || "-"
  return [
    "QT4 abnormal client error detected.",
    "",
    `Severity: ${payload.severity}`,
    `Category: ${payload.category}`,
    `Source: ${payload.source}`,
    `Action: ${payload.action}`,
    `Page: ${payload.pageLabel || payload.route || "(unknown)"}`,
    `Code: ${payload.code || "(none)"}`,
    `Actor: ${payload.actorId || "(unknown)"}`,
    `Actor email: ${payload.actorEmail || "(unknown)"}`,
    `Project: ${projectLine}`,
    `Document: ${documentLine}`,
    `Version: ${versionLine}`,
    `Issue: ${threadLine}`,
    `Fingerprint: ${payload.fingerprint}`,
    `Client timestamp: ${payload.clientTimestamp || "-"}`,
    `Build: ${payload.appBuild || "-"}`,
    `App version: ${payload.appVersion || payload.appBuild || "-"}`,
    `Online: ${payload.online === null ? "unknown" : payload.online ? "yes" : "no"}`,
    `Visibility: ${payload.visibilityState || "unknown"}`,
    `Active Firestore listeners: ${payload.activeFirestoreListeners.length}`,
    "",
    payload.route ? `Route: ${payload.route}` : "",
    payload.projectId ? `Project ID: ${payload.projectId}` : "",
    payload.docId ? `Document ID: ${payload.docId}` : "",
    payload.versionId ? `Version ID: ${payload.versionId}` : "",
    payload.threadId ? `Issue ID: ${payload.threadId}` : "",
    payload.route || payload.projectId || payload.docId || payload.versionId || payload.threadId ? "" : "",
    "Message:",
    payload.messageRaw,
    payload.diagnosticDetails
      ? `\nDiagnostic details (client-side; not authoritative):\n${stringifyDetails( payload.diagnosticDetails )}`
      : "",
    payload.stack ? `\nStack:\n${payload.stack}` : "",
    payload.pageUrl ? `\nPage URL:\n${payload.pageUrl}` : "",
    payload.activeFirestoreListeners.length > 0
      ? `\nActive listeners:\n${stringifyDetails( payload.activeFirestoreListeners )}`
      : "",
    payload.recentDiagnostics.length > 0
      ? `\nRecent diagnostics:\n${stringifyDetails( payload.recentDiagnostics )}`
      : "",
    consoleUrl ? `\nFirestore event:\n${consoleUrl}` : "",
  ].filter( Boolean ).join( "\n" )
}

module.exports = {
  buildMonitorEmailText,
}
