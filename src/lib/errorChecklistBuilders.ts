import type { ChecklistItem } from '../components/ErrorChecklistModal'

type VersionsErrorChecklistContext = {
  docSelected: boolean
  userSignedIn: boolean
  networkAvailable: boolean
  hasAnyVersion: boolean
  userIsProjectLeader: boolean
  userIsDocumentAuthor: boolean
  userIsLatestVersionAuthor: boolean
  userIsSelectedVersionAuthor: boolean
  userIsReviewer: boolean
  userIsAdmin: boolean
  hasLatestVersion: boolean
  latestVersionInReview: boolean
  latestVersionInReviewed: boolean
  latestVersionInCreation: boolean
  latestVersionInAccepted: boolean
  selectedVersionInCreation: boolean
  selectedVersionInActiveReview: boolean
  selectedVersionCommentWindowOpen: boolean
  latestVersionHasFile: boolean
  latestVersionHasReviewer: boolean
  latestVersionHasIssues: boolean
  latestVersionHasIssueWithAtLeastTwoComments: boolean
  latestVersionNoOpenIssues: boolean
  hasAcceptedRelatedErrorReport: boolean
  selectedVersionIsLatest: boolean
  selectedVersionInReview: boolean
  selectedThreadOpen: boolean
  selectedIssueHasAtLeastTwoComments: boolean
  hasSelectedVersion: boolean
  selectedVersionHasFile: boolean
  issueTitleProvided: boolean
  hasSelectedThread: boolean
  commentBodyProvided: boolean
}

const buildVersionsErrorChecklist = (
  error: string | null,
  context: VersionsErrorChecklistContext,
): ChecklistItem[] => {
  if( !error ) {
    return []
  }

  const shared: ChecklistItem[] = [
    { label: '(document is selected)', ok: context.docSelected },
    { label: '(user is signed in)', ok: context.userSignedIn },
  ]

  if(
    error.includes( 'create a version' ) ||
    error.includes( 'create the next version' ) ||
    error.includes( 'check related error reports' )
  ) {
    const baseChecklist: ChecklistItem[] = [
      { label: '(document_is_selected)', ok: context.docSelected },
      { label: '(user_is_signed_in)', ok: context.userSignedIn },
      {
        parts: [
          { label: '(user_is_project_leader)', ok: context.userIsProjectLeader },
          { label: '(user_is_latest_version_author)', ok: context.userIsLatestVersionAuthor },
          { label: '(user_is_admin)', ok: context.userIsAdmin },
        ],
        operator: 'or',
      },
    ]
    if( !context.hasAnyVersion ) {
      return [
        ...baseChecklist,
        { label: '(no_existing_version)', ok: true },
      ]
    }
    return [
      ...baseChecklist,
      { label: '(latest_version_exists)', ok: context.hasLatestVersion },
      {
        groups: [
          [ { label: '(version_in_review)', ok: context.latestVersionInReview } ],
          [ { label: '(version_reviewed)', ok: context.latestVersionInReviewed } ],
          [
            { label: '(version_accepted)', ok: context.latestVersionInAccepted },
            { label: '(exists_accepted_error_report)', ok: context.hasAcceptedRelatedErrorReport },
          ],
        ],
        groupOperator: 'or',
        innerOperator: 'and',
      },
    ]
  }

  if( error.includes( 'start review' ) ) {
    return [
      ...shared,
      { label: '(a latest version exists)', ok: context.hasLatestVersion },
      { label: "(latest version status = 'In Creation')", ok: context.latestVersionInCreation },
      { label: '(latest version has a file)', ok: context.latestVersionHasFile },
      { label: '(latest version reviewer count >= 1)', ok: context.latestVersionHasReviewer },
      {
        parts: [
          { label: '(user_is_latest_version_author)', ok: context.userIsLatestVersionAuthor },
          { label: '(user_is_project_leader)', ok: context.userIsProjectLeader },
          { label: '(user_is_admin)', ok: context.userIsAdmin },
        ],
        operator: 'or',
      },
    ]
  }

  if( error.includes( 'accept' ) || error.includes( 'reject' ) ) {
    return [
      ...shared,
      { label: '(a latest version exists)', ok: context.hasLatestVersion },
      { label: "(latest version is in review time or grace)", ok: context.latestVersionInReview },
      { label: '(latest version has a file)', ok: context.latestVersionHasFile },
      { label: '(latest version issue count >= 1)', ok: context.latestVersionHasIssues },
      {
        label: '(exists at least one issue with comment count >= 2)',
        ok: context.latestVersionHasIssueWithAtLeastTwoComments,
      },
      { label: '(open issue count = 0)', ok: context.latestVersionNoOpenIssues },
      {
        parts: [
          { label: '(user_is_latest_version_author)', ok: context.userIsLatestVersionAuthor },
          { label: '(user_is_project_leader)', ok: context.userIsProjectLeader },
          { label: '(user_is_admin)', ok: context.userIsAdmin },
        ],
        operator: 'or',
      },
    ]
  }

  if( error.includes( 'upload a file' ) ) {
    return [
      ...shared,
      { label: '(a version is selected)', ok: context.hasSelectedVersion },
      { label: "(selected version status = 'In Creation')", ok: context.selectedVersionInCreation },
      {
        parts: [
          { label: '(user_is_selected_version_author)', ok: context.userIsSelectedVersionAuthor },
          { label: '(user_is_project_leader)', ok: context.userIsProjectLeader },
          { label: '(user_is_admin)', ok: context.userIsAdmin },
        ],
        operator: 'or',
      },
    ]
  }

  if( error.includes( 'Select a file before replacing the current one' ) ) {
    return [
      ...shared,
      { label: '(a version is selected)', ok: context.hasSelectedVersion },
      { label: '(a replacement file is selected)', ok: false },
    ]
  }

  if(
    error.includes( 'No file is linked to this version' ) ||
    error.includes( 'Cannot download this file' ) ||
    error.includes( 'Download failed' ) ||
    error.includes( 'File not found' ) ||
    error.includes( 'Download blocked by Files API authorization' )
  ) {
    const lowerError = error.toLowerCase()
    const filesApiDenied = (
      lowerError.includes( 'action blocked' ) ||
      lowerError.includes( '403' ) ||
      lowerError.includes( 'download blocked by files api authorization' )
    )
    const metadataIncomplete = (
      lowerError.includes( 'filerefid is missing' ) ||
      lowerError.includes( 'missing file key' ) ||
      lowerError.includes( 'metadata is incomplete' )
    )
    return [
      ...shared,
      { label: '(a version is selected)', ok: context.hasSelectedVersion },
      { label: '(the selected version has a linked file)', ok: context.selectedVersionHasFile },
      { label: '(download metadata is complete: fileRefId and fileKey)', ok: !metadataIncomplete },
      {
        label: '(files API request is authorized for this user and file)',
        ok: !filesApiDenied,
      },
      { label: '(network connection is available)', ok: context.networkAvailable },
    ]
  }

  if( error.includes( 'assign reviewers' ) ) {
    return [
      ...shared,
      { label: '(a version is selected)', ok: context.hasSelectedVersion },
      { label: "(selected version status = 'In Creation')", ok: context.selectedVersionInCreation },
      {
        parts: [
          { label: '(user_is_selected_version_author)', ok: context.userIsSelectedVersionAuthor },
          { label: '(user_is_project_leader)', ok: context.userIsProjectLeader },
          { label: '(user_is_admin)', ok: context.userIsAdmin },
        ],
        operator: 'or',
      },
    ]
  }

  if( error.includes( 'Reviewers must be project members' ) ) {
    return [
      ...shared,
      { label: '(a version is selected)', ok: context.hasSelectedVersion },
      { label: '(selected reviewer is a project member and is not the current author)', ok: false },
    ]
  }

  if( error.includes( 'change the author' ) ) {
    return [
      ...shared,
      { label: '(a version is selected)', ok: context.hasSelectedVersion },
      { label: "(selected version status = 'In Creation')", ok: context.selectedVersionInCreation },
      {
        parts: [
          { label: '(user_is_project_leader)', ok: context.userIsProjectLeader },
          { label: '(user_is_admin)', ok: context.userIsAdmin },
        ],
        operator: 'or',
      },
    ]
  }

  if( error.includes( 'Select a project member as the new author' ) ) {
    return [
      ...shared,
      { label: '(a version is selected)', ok: context.hasSelectedVersion },
      { label: '(new author is selected)', ok: false },
    ]
  }

  if( error.includes( 'author must be a project member' ) ) {
    return [
      ...shared,
      { label: '(a version is selected)', ok: context.hasSelectedVersion },
      { label: '(new author is a project member and is not the current author)', ok: false },
    ]
  }

  if( error.includes( 'create an issue' ) ) {
    return [
      ...shared,
      { label: '(a version is selected)', ok: context.hasSelectedVersion },
      { label: "(selected version is in active review time or grace)", ok: context.selectedVersionInActiveReview },
      {
        parts: [
          { label: '(user_is_selected_version_author)', ok: context.userIsSelectedVersionAuthor },
          { label: '(user_is_project_leader)', ok: context.userIsProjectLeader },
          { label: '(user_is_selected_version_reviewer)', ok: context.userIsReviewer },
          { label: '(user_is_admin)', ok: context.userIsAdmin },
        ],
        operator: 'or',
      },
      { label: '(issue title is provided)', ok: context.issueTitleProvided },
    ]
  }

  if( error.includes( 'add a comment' ) || error.includes( 'Comment window expired' ) ) {
    return [
      ...shared,
      { label: '(an issue is selected)', ok: context.hasSelectedThread },
      {
        groups: [
          [ { label: "(selected version is in active review time or grace)", ok: context.selectedVersionInActiveReview } ],
          [ { label: '(selected version comment window is still open)', ok: context.selectedVersionCommentWindowOpen } ],
        ],
        groupOperator: 'or',
        innerOperator: 'and',
      },
      { label: "(selected issue status = 'open')", ok: context.selectedThreadOpen },
      {
        parts: [
          { label: '(user_is_selected_version_author)', ok: context.userIsSelectedVersionAuthor },
          { label: '(user_is_project_leader)', ok: context.userIsProjectLeader },
          { label: '(user_is_selected_version_reviewer)', ok: context.userIsReviewer },
          { label: '(user_is_admin)', ok: context.userIsAdmin },
        ],
        operator: 'or',
      },
      { label: '(comment body is provided)', ok: context.commentBodyProvided },
    ]
  }

  if( error.includes( 'create an error report only when the latest version is Accepted' ) || error.includes( 'Select an Accepted latest version to create an error report' ) ) {
    return [
      ...shared,
      { label: '(a latest version exists)', ok: context.hasLatestVersion },
      { label: '(selected version is the latest version)', ok: context.selectedVersionIsLatest },
      { label: "(latest version status = 'Accepted')", ok: context.latestVersionInAccepted },
    ]
  }

  if(
    error.includes( 'close or reopen issues' ) ||
    error.includes( 'close or reopen an issue' ) ||
    error.includes( 'update an issue' )
  ) {
    return [
      ...shared,
      { label: '(an issue is selected)', ok: context.hasSelectedThread },
      { label: "(selected version is in active review time or grace)", ok: context.selectedVersionInActiveReview },
      {
        parts: [
          { label: '(user_is_selected_version_author)', ok: context.userIsSelectedVersionAuthor },
          { label: '(user_is_project_leader)', ok: context.userIsProjectLeader },
          { label: '(user_is_selected_version_reviewer)', ok: context.userIsReviewer },
          { label: '(user_is_admin)', ok: context.userIsAdmin },
        ],
        operator: 'or',
      },
      { label: '(selected issue comment count >= 2)', ok: context.selectedIssueHasAtLeastTwoComments },
    ]
  }

  return [
    ...shared,
    { label: '(network connection is available)', ok: context.networkAvailable },
  ]
}

type AdminAuditErrorChecklistContext = {
  userSignedIn: boolean
  selectedUserValid: boolean
  isStartDateValid: boolean
  isEndDateValid: boolean
  networkAvailable: boolean
}

const buildAdminAuditErrorChecklist = (
  error: string | null,
  context: AdminAuditErrorChecklistContext,
): ChecklistItem[] => {
  if( !error ) {
    return []
  }
  if( error.includes( 'Sign in before running the audit report' ) ) {
    return [
      { label: '(user is signed in)', ok: context.userSignedIn },
    ]
  }

  if( error.includes( 'Select a user before running the audit report' ) ) {
    return [
      { label: '(a user is selected in report mode)', ok: context.selectedUserValid },
    ]
  }

  return [
    { label: '(start date format is valid)', ok: context.isStartDateValid },
    { label: '(end date format is valid)', ok: context.isEndDateValid },
    { label: '(network connection is available)', ok: context.networkAvailable },
  ]
}

export { buildVersionsErrorChecklist, buildAdminAuditErrorChecklist }
