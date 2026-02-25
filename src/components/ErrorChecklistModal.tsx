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

function ErrorChecklistModal( { title = 'Action blocked', error, checklist, onClose }: ErrorChecklistModalProps ) {
  const requestedAction = resolveRequestedAction( error )
  return (
    <ModalDialog onClose={onClose} cardClassName="modal-card--checklist">
        {checklist.length > 0 ? (
          <section className="checklist-card" aria-label="Validation checklist">
            <h4>{title}</h4>
            <GiphyInline reason="dislike_rejected_nope" mode="inline" showLabel={false} />
            {requestedAction ? <p className="muted">Requested action: {requestedAction}</p> : null}
            <p className="error">{error}</p>
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
          </section>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
    </ModalDialog>
  )
}

export type { ChecklistItem }
export default ErrorChecklistModal
