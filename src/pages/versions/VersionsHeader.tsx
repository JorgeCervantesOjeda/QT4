// Header and document identity controls for the Versions page. Keeps route chrome separate from workflow logic.
import AppBrand from '../../components/AppBrand'
import BackStack from '../../components/BackStack'
import type { DocumentSummary } from './types'

type VersionsHeaderProps = {
  projectId: string
  projectName: string
  projectShortId: number | null
  documentData: DocumentSummary | null
  baseDocumentData: {
    id: string
    title: string
    shortId: number | null
  } | null
  docId?: string
  canEditDocumentTitle: boolean
  isBusy: boolean
  onEditDocumentTitle: () => void
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
}: VersionsHeaderProps ) {
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
              {documentData?.type === 'errorReport' ? 'Error report' : 'Document'}
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
        {documentData?.type === 'errorReport' ? (
          <p className="muted">
            This document is an error report for:{' '}
            {baseDocumentData
              ? `${baseDocumentData.shortId ?? 'Unassigned'} - ${baseDocumentData.title}`
              : documentData?.baseDocId
                ? `Document ${documentData.baseDocId}`
                : 'Unknown'}
          </p>
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
