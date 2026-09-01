// src/pages/versions/VersionsModals.test.tsx
// Verifies visible modal states for version-page confirmations and progress.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import VersionsModals from './VersionsModals'

vi.mock( '../../components/ErrorChecklistModal', () => ( {
  default: () => null,
} ) )

vi.mock( '../../components/ModalDialog', () => ( {
  default: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
} ) )

vi.mock( '../../giphy/GiphyProvider', () => ( {
  GiphyInline: ({
    reason,
    showLabel = true,
  }: {
    reason: string
    showLabel?: boolean
  }) => (
    <span data-testid="giphy-reason" data-show-label={String( showLabel )}>
      {reason}
    </span>
  ),
} ) )

const renderVersionDecisionModal = (isBusy: boolean) => render(
  <VersionsModals
    isBusy={isBusy}
    isDocumentTitleModalOpen={false}
    documentTitleInputRef={{ current: null }}
    documentTitleDraft=""
    documentTitleError={null}
    setDocumentTitleDraft={() => undefined}
    onCloseDocumentTitleModal={() => undefined}
    onSaveDocumentTitle={() => undefined}
    isErrorReportModalOpen={false}
    errorReportTitle=""
    errorReportTitleError={null}
    setErrorReportTitle={() => undefined}
    onCloseErrorReportModal={() => undefined}
    onCreateErrorReport={() => undefined}
    versionDecisionModal="accept"
    onCloseVersionDecisionModal={() => undefined}
    onConfirmVersionDecision={() => undefined}
    propagationFailurePrompt={null}
    onClosePropagationFailurePrompt={() => undefined}
    onReportPropagationFailure={() => undefined}
    onRetryPropagatedErrorReports={() => undefined}
    pendingVersionAction={null}
    onClosePendingVersionAction={() => undefined}
    onConfirmPendingVersionAction={() => undefined}
    reviewDurationDays={1}
    pendingThreadStatusChange={null}
    onClosePendingThreadStatusChange={() => undefined}
    onConfirmThreadStatusChange={() => undefined}
    uploadStatus="idle"
    uploadMessage=""
    downloadStatus="idle"
    downloadMessage=""
    emailNotifyStatus="idle"
    emailNotifyMessage=""
    successMessage={null}
    successEmailRecipients={null}
    successOkButtonRef={{ current: null }}
    onCloseSuccessMessage={() => undefined}
    error={null}
    errorChecklist={[]}
    onCloseError={() => undefined}
    errorReportContext={{
      projectId: 'project-1',
      docId: 'doc-1',
      pageLabel: 'Document Versions',
      projectLabel: 'Project',
      docLabel: 'Document',
      versionLabel: 'Version',
      threadLabel: 'Issue',
    }}
  />,
)

const renderThreadStatusModal = (isBusy: boolean) => render(
  <VersionsModals
    isBusy={isBusy}
    isDocumentTitleModalOpen={false}
    documentTitleInputRef={{ current: null }}
    documentTitleDraft=""
    documentTitleError={null}
    setDocumentTitleDraft={() => undefined}
    onCloseDocumentTitleModal={() => undefined}
    onSaveDocumentTitle={() => undefined}
    isErrorReportModalOpen={false}
    errorReportTitle=""
    errorReportTitleError={null}
    setErrorReportTitle={() => undefined}
    onCloseErrorReportModal={() => undefined}
    onCreateErrorReport={() => undefined}
    versionDecisionModal={null}
    onCloseVersionDecisionModal={() => undefined}
    onConfirmVersionDecision={() => undefined}
    propagationFailurePrompt={null}
    onClosePropagationFailurePrompt={() => undefined}
    onReportPropagationFailure={() => undefined}
    onRetryPropagatedErrorReports={() => undefined}
    pendingVersionAction={null}
    onClosePendingVersionAction={() => undefined}
    onConfirmPendingVersionAction={() => undefined}
    reviewDurationDays={1}
    pendingThreadStatusChange={{
      id: 'thread-1',
      status: 'open',
      title: 'Clarify source',
      createdBy: 'reviewer-1',
      commentCount: 2,
    }}
    onClosePendingThreadStatusChange={() => undefined}
    onConfirmThreadStatusChange={() => undefined}
    uploadStatus="idle"
    uploadMessage=""
    downloadStatus="idle"
    downloadMessage=""
    emailNotifyStatus="idle"
    emailNotifyMessage=""
    successMessage={null}
    successEmailRecipients={null}
    successOkButtonRef={{ current: null }}
    onCloseSuccessMessage={() => undefined}
    error={null}
    errorChecklist={[]}
    onCloseError={() => undefined}
    errorReportContext={{
      projectId: 'project-1',
      docId: 'doc-1',
      pageLabel: 'Document Versions',
      projectLabel: 'Project',
      docLabel: 'Document',
      versionLabel: 'Version',
      threadLabel: 'Issue',
    }}
  />,
)

describe( 'versions/VersionsModals', () => {
  it( 'shows version decision progress while the accept operation is busy', () => {
    renderVersionDecisionModal( true )

    expect( screen.getByRole( 'heading', { name: 'Accepting latest version' } ) ).toBeTruthy()
    expect( screen.getByTestId( 'giphy-reason' ).textContent ).toBe( 'loading' )
    expect( screen.getByText( 'Applying acceptance to the latest version...' ) ).toBeTruthy()
    expect( screen.queryByRole( 'button', { name: 'Confirm' } ) ).toBeNull()
  } )

  it( 'shows issue status progress while close issue is busy', () => {
    renderThreadStatusModal( true )

    expect( screen.getByRole( 'heading', { name: 'Closing issue' } ) ).toBeTruthy()
    expect( screen.getByTestId( 'giphy-reason' ).textContent ).toBe( 'loading' )
    expect( screen.getByText( 'Applying issue closure...' ) ).toBeTruthy()
    expect( screen.queryByRole( 'button', { name: 'Confirm' } ) ).toBeNull()
  } )

  it( 'shows upload progress without an extra generic Giphy label', () => {
    render(
      <VersionsModals
        isBusy={false}
        isDocumentTitleModalOpen={false}
        documentTitleInputRef={{ current: null }}
        documentTitleDraft=""
        documentTitleError={null}
        setDocumentTitleDraft={() => undefined}
        onCloseDocumentTitleModal={() => undefined}
        onSaveDocumentTitle={() => undefined}
        isErrorReportModalOpen={false}
        errorReportTitle=""
        errorReportTitleError={null}
        setErrorReportTitle={() => undefined}
        onCloseErrorReportModal={() => undefined}
        onCreateErrorReport={() => undefined}
        versionDecisionModal={null}
        onCloseVersionDecisionModal={() => undefined}
        onConfirmVersionDecision={() => undefined}
        propagationFailurePrompt={null}
        onClosePropagationFailurePrompt={() => undefined}
        onReportPropagationFailure={() => undefined}
        onRetryPropagatedErrorReports={() => undefined}
        pendingVersionAction={null}
        onClosePendingVersionAction={() => undefined}
        onConfirmPendingVersionAction={() => undefined}
        reviewDurationDays={1}
        pendingThreadStatusChange={null}
        onClosePendingThreadStatusChange={() => undefined}
        onConfirmThreadStatusChange={() => undefined}
        uploadStatus="uploading"
        uploadMessage="Uploading new version..."
        downloadStatus="idle"
        downloadMessage=""
        emailNotifyStatus="idle"
        emailNotifyMessage=""
        successMessage={null}
        successEmailRecipients={null}
        successOkButtonRef={{ current: null }}
        onCloseSuccessMessage={() => undefined}
        error={null}
        errorChecklist={[]}
        onCloseError={() => undefined}
        errorReportContext={{
          projectId: 'project-1',
          docId: 'doc-1',
          pageLabel: 'Document Versions',
          projectLabel: 'Project',
          docLabel: 'Document',
          versionLabel: 'Version',
          threadLabel: 'Issue',
        }}
      />,
    )

    const giphy = screen.getByTestId( 'giphy-reason' )
    expect( giphy.textContent ).toBe( 'loading' )
    expect( giphy.getAttribute( 'data-show-label' ) ).toBe( 'false' )
    expect( screen.getByText( 'Uploading new version...' ) ).toBeTruthy()
  } )

  it( 'asks the user to report or retry a propagated error report failure', () => {
    const onReportPropagationFailure = vi.fn()
    const onRetryPropagatedErrorReports = vi.fn()

    render(
      <VersionsModals
        isBusy={false}
        isDocumentTitleModalOpen={false}
        documentTitleInputRef={{ current: null }}
        documentTitleDraft=""
        documentTitleError={null}
        setDocumentTitleDraft={() => undefined}
        onCloseDocumentTitleModal={() => undefined}
        onSaveDocumentTitle={() => undefined}
        isErrorReportModalOpen={false}
        errorReportTitle=""
        errorReportTitleError={null}
        setErrorReportTitle={() => undefined}
        onCloseErrorReportModal={() => undefined}
        onCreateErrorReport={() => undefined}
        versionDecisionModal={null}
        onCloseVersionDecisionModal={() => undefined}
        onConfirmVersionDecision={() => undefined}
        propagationFailurePrompt={{
          projectId: 'project-1',
          docId: 'doc-1',
          versionId: 'version-1',
          message: 'The version was accepted, but error report propagation failed.',
          failures: [{ reason: 'storage_copy_failed' }],
        }}
        onClosePropagationFailurePrompt={() => undefined}
        onReportPropagationFailure={onReportPropagationFailure}
        onRetryPropagatedErrorReports={onRetryPropagatedErrorReports}
        pendingVersionAction={null}
        onClosePendingVersionAction={() => undefined}
        onConfirmPendingVersionAction={() => undefined}
        reviewDurationDays={1}
        pendingThreadStatusChange={null}
        onClosePendingThreadStatusChange={() => undefined}
        onConfirmThreadStatusChange={() => undefined}
        uploadStatus="idle"
        uploadMessage=""
        downloadStatus="idle"
        downloadMessage=""
        emailNotifyStatus="idle"
        emailNotifyMessage=""
        successMessage={null}
        successEmailRecipients={null}
        successOkButtonRef={{ current: null }}
        onCloseSuccessMessage={() => undefined}
        error={null}
        errorChecklist={[]}
        onCloseError={() => undefined}
        errorReportContext={{
          projectId: 'project-1',
          docId: 'doc-1',
          pageLabel: 'Document Versions',
          projectLabel: 'Project',
          docLabel: 'Document',
          versionLabel: 'Version',
          threadLabel: 'Issue',
        }}
      />,
    )

    expect( screen.getByRole( 'heading', { name: 'Error report propagation failed' } ) ).toBeTruthy()
    expect( screen.getByRole( 'button', { name: 'Report to admin' } ) ).toBeTruthy()
    expect( screen.getByRole( 'button', { name: 'Retry' } ) ).toBeTruthy()
  } )
} )
