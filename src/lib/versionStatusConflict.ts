// Shared detection for expected issue-status race conditions. These conflicts refresh local state instead of reporting abnormal runtime errors.
const THREAD_STATUS_CONFLICT_MESSAGE = 'Issue status changed on the server. Reload and try again.'

const isExpectedThreadStatusConflictError = (error: unknown): boolean =>
  error instanceof Error && error.message === THREAD_STATUS_CONFLICT_MESSAGE

export {
  THREAD_STATUS_CONFLICT_MESSAGE,
  isExpectedThreadStatusConflictError,
}
