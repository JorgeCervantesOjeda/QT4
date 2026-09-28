// src/lib/notificationPreferences.ts: Normalizes account notification preferences for UI and Firestore writes.
import { serverTimestamp, type FieldValue } from 'firebase/firestore'

type NotificationPreferences = {
  commentEmailEnabled: boolean
  hourlyActivityDigestEnabled: boolean
}

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  commentEmailEnabled: true,
  hourlyActivityDigestEnabled: false,
}

const resolveNotificationPreferences = (value: unknown): NotificationPreferences => {
  const rawPreferences = value && typeof value === 'object'
    ? value as Partial<Record<keyof NotificationPreferences, unknown>>
    : {}
  return {
    commentEmailEnabled: typeof rawPreferences.commentEmailEnabled === 'boolean'
      ? rawPreferences.commentEmailEnabled
      : DEFAULT_NOTIFICATION_PREFERENCES.commentEmailEnabled,
    hourlyActivityDigestEnabled: typeof rawPreferences.hourlyActivityDigestEnabled === 'boolean'
      ? rawPreferences.hourlyActivityDigestEnabled
      : DEFAULT_NOTIFICATION_PREFERENCES.hourlyActivityDigestEnabled,
  }
}

const buildNotificationPreferencesUpdate = (
  preferences: NotificationPreferences,
): {
  notificationPreferences: NotificationPreferences
  updatedAt: FieldValue
} => ( {
  notificationPreferences: resolveNotificationPreferences( preferences ),
  updatedAt: serverTimestamp(),
} )

export {
  DEFAULT_NOTIFICATION_PREFERENCES,
  buildNotificationPreferencesUpdate,
  resolveNotificationPreferences,
  type NotificationPreferences,
}

