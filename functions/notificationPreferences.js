// functions/notificationPreferences.js: Normalizes account notification preferences for backend notification jobs.
const DEFAULT_NOTIFICATION_PREFERENCES = {
  commentEmailEnabled: true,
  hourlyActivityDigestEnabled: false,
}

const resolveNotificationPreferences = (value) => {
  const rawPreferences = value && typeof value === "object" ? value : {}
  return {
    commentEmailEnabled: typeof rawPreferences.commentEmailEnabled === "boolean"
      ? rawPreferences.commentEmailEnabled
      : DEFAULT_NOTIFICATION_PREFERENCES.commentEmailEnabled,
    hourlyActivityDigestEnabled: typeof rawPreferences.hourlyActivityDigestEnabled === "boolean"
      ? rawPreferences.hourlyActivityDigestEnabled
      : DEFAULT_NOTIFICATION_PREFERENCES.hourlyActivityDigestEnabled,
  }
}

module.exports = {
  DEFAULT_NOTIFICATION_PREFERENCES,
  resolveNotificationPreferences,
}

