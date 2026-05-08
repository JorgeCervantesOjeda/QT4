import { useState } from 'react'
import { reportUserVisibleError, type MonitorSource } from '../lib/errorMonitor'
import { GiphyInline } from '../giphy/GiphyProvider'
import ModalDialog from './ModalDialog'

type ChecklistPart = {
  label: string
  ok: boolean
}

type ChecklistItem = {
  label?: string
  ok?: boolean
  parts?: ChecklistPart[]
  operator?: 'and' | 'or'
  groups?: ChecklistPart[][]
  groupOperator?: 'and' | 'or'
  innerOperator?: 'and' | 'or'
}

type ErrorChecklistModalProps = {
  title?: string
  error: string
  checklist: ChecklistItem[]
  onClose: () => void
  reportContext?: {
    action?: string
    source?: MonitorSource
    projectId?: string
    docId?: string
    versionId?: string
    threadId?: string
    pageLabel?: string
    projectLabel?: string
    docLabel?: string
    versionLabel?: string
    threadLabel?: string
  } | null
}

type ResolvedReportContext = {
  action: string
  projectId: string
  docId: string
  versionId: string
  threadId: string
  pageLabel: string
}

const stripOuterParens = (value: string) => value.replace( /^\(|\)$/g, '' )
const formatClause = (label: string, ok: boolean) => `(${stripOuterParens( label )} ${ok ? '[OK]' : '[NO]'})`
const resolveRequestedAction = (error: string): string | null => {
  if( error.includes( 'create a version' ) || error.includes( 'create the next version' ) ) {
    return 'create_next_version'
  }
  if( error.includes( 'start review' ) ) {
    return 'start_review'
  }
  if( error.includes( 'accept' ) ) {
    return 'accept_latest_version'
  }
  if( error.includes( 'reject' ) ) {
    return 'reject_latest_version'
  }
  if( error.includes( 'upload a file' ) || error.includes( 'replacing the current one' ) ) {
    return 'upload_or_replace_file'
  }
  if( error.includes( 'assign reviewers' ) ) {
    return 'assign_reviewers'
  }
  if( error.includes( 'change the author' ) ) {
    return 'change_author'
  }
  if( error.includes( 'create an issue' ) ) {
    return 'create_issue'
  }
  if( error.includes( 'add a comment' ) ) {
    return 'add_comment'
  }
  if( error.includes( 'create an error report' ) ) {
    return 'create_error_report'
  }
  if( error.includes( 'close or reopen' ) || error.includes( 'update an issue' ) ) {
    return 'close_or_reopen_issue'
  }
  if( error.includes( 'running the audit report' ) ) {
    return 'run_audit_report'
  }
  if( error.includes( 'password reset' ) ) {
    return 'request_password_reset'
  }
  if( error.includes( 'credentials match an existing account' ) || error.includes( 'sign in' ) ) {
    return 'log_in'
  }
  if( error.includes( 'already in use' ) ) {
    return 'create_account'
  }
  if( error.includes( 'Project create failed' ) ) {
    return 'create_project'
  }
  if( error.includes( 'Project membership failed' ) ) {
    return 'add_project_member'
  }
  if( error.includes( 'create documents' ) || error.includes( 'document title is provided' ) ) {
    return 'create_document'
  }
  return null
}

const buildChecklistSummary = (checklist: ChecklistItem[]): string[] => checklist.flatMap( ( item ) => {
  if( item.parts && item.parts.length > 0 ) {
    return item.parts.map( ( part ) => formatClause( part.label, part.ok ) )
  }
  if( item.groups && item.groups.length > 0 ) {
    return item.groups.flatMap( ( group ) => group.map( ( part ) => formatClause( part.label, part.ok ) ) )
  }
  if( item.label ) {
    return [ formatClause( item.label, Boolean( item.ok ) ) ]
  }
  return []
} )

const resolveFallbackReportContext = (requestedAction: string | null): ResolvedReportContext => {
  if( typeof window === 'undefined' ) {
    return {
      action: requestedAction ? `ui.${requestedAction}` : 'ui.reportVisibleError',
      projectId: '',
      docId: '',
      versionId: '',
      threadId: '',
      pageLabel: '',
    }
  }

  const currentUrl = new URL( window.location.href )
  const pathParts = currentUrl.pathname.split( '/' ).filter( Boolean )
  const searchParams = currentUrl.searchParams
  let projectId = searchParams.get( 'projectId' ) ?? ''
  let docId = ''
  const versionId = searchParams.get( 'versionId' ) ?? ''
  const threadId = searchParams.get( 'threadId' ) ?? ''

  if( pathParts[0] === 'projects' ) {
    projectId = projectId || pathParts[1] || ''
    if( pathParts[2] === 'documents' ) {
      docId = pathParts[3] || ''
    }
  } else if( pathParts[0] === 'documents' ) {
    docId = pathParts[1] || ''
  }

  return {
    action: requestedAction ? `ui.${requestedAction}` : 'ui.reportVisibleError',
    projectId,
    docId,
    versionId,
    threadId,
    pageLabel: document.title.trim(),
  }
}

function ErrorChecklistModal( { title = 'Action blocked', error, checklist, onClose, reportContext = null }: ErrorChecklistModalProps ) {
  const requestedAction = resolveRequestedAction( error )
  const [isReporting, setIsReporting] = useState( false )
  const [reportFeedback, setReportFeedback] = useState<string | null>( null )
  const [reportSent, setReportSent] = useState( false )
  const handleReport = async () => {
    if( isReporting || reportSent ) {
      return
    }
    setIsReporting( true )
    setReportFeedback( null )
    const fallbackContext = resolveFallbackReportContext( requestedAction )
    const readableContextLines = [
      reportContext?.pageLabel ?? fallbackContext.pageLabel ? 'Context:' : null,
      reportContext?.pageLabel ?? fallbackContext.pageLabel ? `Page: ${reportContext?.pageLabel ?? fallbackContext.pageLabel}` : null,
      reportContext?.projectLabel ? `Project: ${reportContext.projectLabel}` : null,
      reportContext?.docLabel ? `Document: ${reportContext.docLabel}` : null,
      reportContext?.versionLabel ? `Version: ${reportContext.versionLabel}` : null,
      reportContext?.threadLabel ? `Issue: ${reportContext.threadLabel}` : null,
    ].filter( Boolean )
    const reportMessage = [
      `User-visible error: ${error}`,
      readableContextLines.length > 0 ? '' : null,
      ...readableContextLines,
      checklist.length > 0 ? '' : null,
      checklist.length > 0 ? 'Checklist:' : null,
      ...buildChecklistSummary( checklist ),
    ].filter( Boolean ).join( '\n' )
    const ok = await reportUserVisibleError( {
      message: reportMessage,
      action: reportContext?.action ?? fallbackContext.action,
      source: reportContext?.source ?? 'ui',
      projectId: reportContext?.projectId ?? fallbackContext.projectId,
      docId: reportContext?.docId ?? fallbackContext.docId,
      versionId: reportContext?.versionId ?? fallbackContext.versionId,
      threadId: reportContext?.threadId ?? fallbackContext.threadId,
      pageLabel: reportContext?.pageLabel ?? fallbackContext.pageLabel,
      projectLabel: reportContext?.projectLabel,
      docLabel: reportContext?.docLabel,
      versionLabel: reportContext?.versionLabel,
      threadLabel: reportContext?.threadLabel,
    } )
    setIsReporting( false )
    if( ok ) {
      setReportSent( true )
      setReportFeedback( 'This error was sent to the admin user.' )
      return
    }
    setReportFeedback( 'The error could not be reported. Please try again.' )
  }
  return (
    <ModalDialog onClose={onClose} cardClassName="modal-card--checklist">
        {checklist.length > 0 ? (
          <section className="checklist-card" aria-label="Validation checklist">
            <h4>{title}</h4>
            <GiphyInline reason="dislike_rejected_nope" mode="inline" showLabel={false} />
            {requestedAction ? <p className="muted">Requested action: {requestedAction}</p> : null}
            <p className="error">{error}</p>
            <div className="stack">
              <p className="muted">Do you want to report this message to admin?</p>
            </div>
            <ul className="checklist-list">
              {checklist.map( ( item, index ) => {
                const showAnd = index < checklist.length - 1
                if( item.parts && item.parts.length > 0 ) {
                  return (
                    <li key={`expr-${index}`} className="checklist-expression">
                      <span>(</span>
                      {item.parts.map( ( part, partIndex ) => (
                        <span key={`${part.label}-${partIndex}`} className={part.ok ? 'checklist-part checklist-item--ok' : 'checklist-part checklist-item--fail'}>
                          {partIndex > 0 ? <span className="checklist-operator">{`\n  ${item.operator ?? 'and'} `}</span> : null}
                          <span>{formatClause( part.label, part.ok )}</span>
                        </span>
                      ) )}
                      <span>)</span>
                      {showAnd ? <span className="checklist-operator"> and</span> : null}
                    </li>
                  )
                }
                if( item.groups && item.groups.length > 0 ) {
                  return (
                    <li key={`groups-${index}`} className="checklist-expression">
                      <span>(</span>
                      {item.groups.map( ( group, groupIndex ) => (
                        <span key={`group-${groupIndex}`} className="checklist-part">
                          {groupIndex > 0 ? <span className="checklist-operator">{`\n  ${item.groupOperator ?? 'and'} `}</span> : null}
                          <span>(</span>
                          {group.map( ( part, partIndex ) => (
                            <span key={`${part.label}-${partIndex}`} className={part.ok ? 'checklist-part checklist-item--ok' : 'checklist-part checklist-item--fail'}>
                              {partIndex > 0 ? <span className="checklist-operator">{` ${item.innerOperator ?? 'and'} `}</span> : null}
                              <span>{formatClause( part.label, part.ok )}</span>
                            </span>
                          ) )}
                          <span>)</span>
                        </span>
                      ) )}
                      <span>)</span>
                      {showAnd ? <span className="checklist-operator"> and</span> : null}
                    </li>
                  )
                }
                const ok = Boolean( item.ok )
                return (
                  <li key={item.label ?? `item-${index}`} className={ok ? 'checklist-item checklist-item--ok' : 'checklist-item checklist-item--fail'}>
                    <span>{formatClause( item.label ?? '', ok )}</span>
                    {showAnd ? <span className="checklist-operator"> and</span> : null}
                  </li>
                )
              } )}
            </ul>
          </section>
        ) : (
          <section className="checklist-card" aria-label="Validation checklist">
            <h4>{title}</h4>
            <GiphyInline reason="dislike_rejected_nope" mode="inline" showLabel={false} />
            <p className="error">{error}</p>
            <div className="stack">
              <p className="muted">Do you want to report this message to admin?</p>
            </div>
          </section>
        )}
        <div className="actions">
          <button type="button" className="ghost" onClick={() => void handleReport()} disabled={isReporting || reportSent}>
            {isReporting ? 'Reporting...' : reportSent ? 'Reported' : 'Report to admin'}
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {reportFeedback ? <p className={reportSent ? 'muted' : 'error'}>{reportFeedback}</p> : null}
    </ModalDialog>
  )
}

export type { ChecklistItem }
export default ErrorChecklistModal
