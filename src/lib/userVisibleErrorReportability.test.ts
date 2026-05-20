import { describe, expect, it } from 'vitest'
import { isReportableUserVisibleError } from './userVisibleErrorReportability'

describe( 'isReportableUserVisibleError', () => {
  it.each( [
    'Enter your email before logging in.',
    'Project name cannot be empty.',
    'Document title cannot be empty.',
    'Start date is invalid. Use a valid date in YYYY-MM-DD format.',
    'You can create an error report only when the latest version is Accepted.',
    'To create an issue, the version must be in active review time or grace, you must be the author, leader, or reviewer, and the title cannot be empty.',
    'To add a comment, the issue must be open, and either review is still active or the issue has a last comment less than one hour old after review expiry.',
    'Reviewers must be project members (including the leader). Select a member from the list.',
    'Firebase: Error (auth/invalid-credential).',
  ] )( 'hides admin reporting for normal validation: %s', (message) => {
    expect( isReportableUserVisibleError( message ) ).toBe( false )
  } )

  it.each( [
    'Project documents failed at latest-versions: Missing or insufficient permissions.',
    'Dashboard tasks failed to load: FirebaseError: unavailable.',
    'Download failed (timeout): the server took too long to respond.',
    'Cannot download this file: version metadata is incomplete (fileRefId is missing). Please re-upload/replace the file for this version.',
    'This version has inconsistent issue counters (numThreads stored=1, actual=2). An admin must run Data model update before closing or reopening issues.',
    'Issue status changed on the server. Reload and try again.',
    'Invalid error report data: baseDocId and baseVersionId are required.',
  ] )( 'keeps admin reporting for real failures: %s', (message) => {
    expect( isReportableUserVisibleError( message ) ).toBe( true )
  } )
} )
