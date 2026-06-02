const normalizeVisibleErrorMessage = (message: string): string =>
  message.replace( /\s+/g, ' ' ).trim()

const EXPECTED_AUTH_CODES = [
  'auth/email-already-in-use',
  'auth/invalid-credential',
  'auth/invalid-email',
  'auth/missing-password',
  'auth/user-not-found',
  'auth/wrong-password',
  'auth/weak-password',
]

const REAL_FAILURE_PATTERNS = [
  /\bfailed\b/i,
  /\bfailure\b/i,
  /\bmissing or insufficient permissions\b/i,
  /\bpermission-denied\b/i,
  /\btimeout\b/i,
  /\bunavailable\b/i,
  /\binternal\b/i,
  /\bunexpected\b/i,
  /\brequires an index\b/i,
  /\bquery requires an index\b/i,
  /\bnot found\b/i,
  /\bincomplete\b/i,
  /\binconsistent\b/i,
  /\bchanged on the server\b/i,
  /\binvalid error report data\b/i,
]

const NORMAL_VALIDATION_PATTERNS = [
  /^enter\b/i,
  /^select\b/i,
  /^sign in\b/i,
  /^please wait\b/i,
  /^project name cannot be empty\.?$/i,
  /^document title cannot be empty\.?$/i,
  /^start date is invalid\b/i,
  /^end date is invalid\b/i,
  /^start date must be on or before end date\.?$/i,
  /^you can\b/i,
  /^to create\b/i,
  /^to start\b/i,
  /^to add\b/i,
  /^to close\b/i,
  /^only project members\b/i,
  /^reviewers must\b/i,
  /^the author must\b/i,
  /^comment window expired\b/i,
]

const containsExpectedAuthCode = (message: string): boolean =>
  EXPECTED_AUTH_CODES.some( ( code ) => message.toLowerCase().includes( code ) )

const isReportableUserVisibleError = (message: string): boolean => {
  const normalizedMessage = normalizeVisibleErrorMessage( message )
  if( !normalizedMessage ) {
    return false
  }
  if( containsExpectedAuthCode( normalizedMessage ) ) {
    return false
  }
  if( REAL_FAILURE_PATTERNS.some( ( pattern ) => pattern.test( normalizedMessage ) ) ) {
    return true
  }
  if( NORMAL_VALIDATION_PATTERNS.some( ( pattern ) => pattern.test( normalizedMessage ) ) ) {
    return false
  }
  return true
}

export { isReportableUserVisibleError }
