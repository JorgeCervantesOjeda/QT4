// Header and document identity controls for the Versions page. Keeps route chrome separate from workflow logic.
import AppBrand from '../../components/AppBrand'
import BackStack from '../../components/BackStack'
import { formatShortDocumentReference } from '../../lib/documentDerivation'
import type { BaseDocumentSummary, DocumentSummary } from './types'

type VersionsHeaderProps = {
  projectId: string
  projectName: string
  projectShortId: number | null
  documentData: DocumentSummary | null
  baseDocumentData: BaseDocumentSummary | null
  docId?: string
  canEditDocumentTitle: boolean
  isBusy: boolean
  onEditDocumentTitle: () => void
  onDownloadBaseDocument?: () => void
}

const documentTypeLabel = (documentType?: string) => {
  if( documentType === 'errorReport' ) {
    return 'Error report'
  }
  if( documentType === 'changeRequest' ) {
    return 'Change request'
  }
  if( documentType === 'derivedDocument' ) {
    return 'Derived variant'
  }
  return 'Document'
}

function VersionsHeader( {
  projectId,
  projectName,
  projectShortId,
  documentData,
  baseDocumentData,
  docId,
  canEditDocumentTitle,
  isBusy,
  onEditDocumentTitle,
  onDownloadBaseDocument,
}: VersionsHeaderProps ) {
  const baseDocumentPath =
    ( documentData?.type === 'changeRequest' || documentData?.type === 'derivedDocument' ) && baseDocumentData
    ? `/documents/${baseDocumentData.id}/versions?projectId=${
      documentData.baseProjectId ?? documentData.originProjectId ?? baseDocumentData.projectId
    }&versionId=${documentData.baseVersionId ?? documentData.originVersionId ?? baseDocumentData.versionId ?? ''}`
    : ''

  return (
    <header className="app-header">
      <div>
        <AppBrand pageTitle="Document Versions" />
        <div className="document-title-row">
          {projectName ? (
            <div className="context-nav-label">
              <span className="document-title-prefix">Project</span>
              <span className="document-title-text">
                {`${projectShortId ?? 'Unassigned'} - ${projectName}`}
              </span>
            </div>
          ) : null}
          <div className="context-nav-label">
            <span className="document-title-prefix">
              {documentTypeLabel( documentData?.type )}
            </span>
            <span className="document-title-text">
              {`${documentData?.shortId ?? 'Unassigned'} - ${documentData?.title ?? docId ?? 'Unknown'}`}
            </span>
          </div>
          {canEditDocumentTitle ? (
            <button
              type="button"
              className="ghost"
              onClick={onEditDocumentTitle}
              disabled={isBusy || !documentData}
            >
              Edit title
            </button>
          ) : null}
        </div>
        {documentData?.type === 'errorReport' || documentData?.type === 'changeRequest' || documentData?.type === 'derivedDocument' ? (
          <div className="base-document-reference">
            <p className="muted">
              <span>
                {documentData.type === 'changeRequest'
                  ? 'This document is a change request for:'
                  : documentData.type === 'derivedDocument'
                    ? 'This document is derived from:'
                    : 'This document is an error report for:'}
              </span>{' '}
              {baseDocumentData
                ? formatShortDocumentReference( {
                  projectShortId: baseDocumentData.projectShortId,
                  documentShortId: baseDocumentData.shortId,
                  versionNumber: baseDocumentData.versionNumber,
                  title: baseDocumentData.title,
                } )
                : documentData?.baseDocId
                  ? 'Base document reference unavailable'
                  : 'Unknown'}
            </p>
            {( documentData.type === 'changeRequest' || documentData.type === 'derivedDocument' ) && baseDocumentPath ? (
              <div className="base-document-actions">
                <a className="ghost" href={baseDocumentPath}>
                  Open base document
                </a>
                <button
                  type="button"
                  className="ghost"
                  onClick={onDownloadBaseDocument}
                  disabled={isBusy || !onDownloadBaseDocument}
                >
                  Download base document
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <BackStack
        links={
          projectId
            ? [
              { label: 'Projects', to: '/projects' },
              { label: 'Documents', to: `/projects/${projectId}/documents` },
            ]
            : [
              { label: 'Projects', to: '/projects' },
            ]
        }
      />
    </header>
  )
}

export default VersionsHeader
