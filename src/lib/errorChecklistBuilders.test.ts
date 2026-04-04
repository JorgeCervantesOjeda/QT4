import { describe, expect, it } from 'vitest'
import { buildAdminAuditErrorChecklist, buildVersionsErrorChecklist } from './errorChecklistBuilders'

const baseVersionsContext = {
  docSelected: true,
  userSignedIn: true,
  networkAvailable: true,
  hasAnyVersion: false,
  userIsProjectLeader: false,
  userIsDocumentAuthor: false,
  userIsLatestVersionAuthor: true,
  userIsSelectedVersionAuthor: false,
  userIsReviewer: false,
  userIsAdmin: false,
  hasLatestVersion: false,
  latestVersionInReview: false,
  latestVersionInReviewed: false,
  latestVersionInCreation: false,
  latestVersionInAccepted: false,
  selectedVersionInCreation: false,
  selectedVersionInActiveReview: false,
  selectedVersionCommentWindowOpen: false,
  latestVersionHasFile: false,
  latestVersionHasReviewer: false,
  latestVersionHasIssues: false,
  latestVersionHasIssueWithAtLeastTwoComments: false,
  latestVersionNoOpenIssues: false,
  hasAcceptedRelatedErrorReport: false,
  selectedVersionIsLatest: false,
  selectedVersionInReview: false,
  selectedThreadOpen: false,
  selectedIssueHasAtLeastTwoComments: false,
  hasSelectedVersion: false,
  selectedVersionHasFile: false,
  issueTitleProvided: false,
  hasSelectedThread: false,
  commentBodyProvided: false,
}

describe( 'lib/errorChecklistBuilders', () => {
  it( 'builds the first-version checklist when there is no existing version', () => {
    const checklist = buildVersionsErrorChecklist(
      'You can create a version only when the prerequisites are met.',
      baseVersionsContext,
    )

    expect( checklist ).toContainEqual( { label: '(no_existing_version)', ok: true } )
    expect( checklist[2] ).toMatchObject( {
      operator: 'or',
    } )
  } )

  it( 'builds the add-comment checklist with the review-state alternatives', () => {
    const checklist = buildVersionsErrorChecklist(
      'You can add a comment only when the issue is actionable.',
      {
        ...baseVersionsContext,
        hasSelectedThread: true,
        selectedVersionInActiveReview: false,
        selectedVersionCommentWindowOpen: true,
        selectedThreadOpen: true,
        userIsReviewer: true,
        commentBodyProvided: false,
      },
    )

    expect( checklist ).toContainEqual( { label: '(an issue is selected)', ok: true } )
    expect( checklist ).toContainEqual( { label: '(comment body is provided)', ok: false } )
    expect( checklist[3] ).toMatchObject( {
      groupOperator: 'or',
      innerOperator: 'and',
    } )
  } )

  it( 'builds the admin audit sign-in checklist for unauthenticated users', () => {
    expect(
      buildAdminAuditErrorChecklist(
        'Sign in before running the audit report',
        {
          userSignedIn: false,
          selectedUserValid: false,
          isStartDateValid: true,
          isEndDateValid: true,
          networkAvailable: true,
        },
      ),
    ).toEqual( [
      { label: '(user is signed in)', ok: false },
    ] )
  } )
} )
