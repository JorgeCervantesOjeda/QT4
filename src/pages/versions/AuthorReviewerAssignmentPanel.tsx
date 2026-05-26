// Author and reviewer assignment UI used while a version is still in creation.
import type { ColumnDef, OnChangeFn, SortingState } from '@tanstack/react-table'
import DataTable from '../../components/DataTable'

type MemberAssignmentRow = {
  userId: string
  role: string
  memberLabel: string
  statusLabel: string
  isAuthor: boolean
  isReviewer: boolean
}

type AuthorReviewerAssignmentPanelProps = {
  projectId: string
  allowedReviewerIds: string[]
  selectedReviewerIds: string[]
  isBusy: boolean
  canAssignReviewers: boolean
  onToggleAllReviewers: (checked: boolean) => void
  memberColumns: ColumnDef<MemberAssignmentRow>[]
  membersTableRows: MemberAssignmentRow[]
  membersSorting: SortingState
  setMembersSorting: OnChangeFn<SortingState>
}

function AuthorReviewerAssignmentPanel( {
  projectId,
  allowedReviewerIds,
  selectedReviewerIds,
  isBusy,
  canAssignReviewers,
  onToggleAllReviewers,
  memberColumns,
  membersTableRows,
  membersSorting,
  setMembersSorting,
}: AuthorReviewerAssignmentPanelProps ) {
  return (
    <section className="panel">
      <h3>Author Assignment (Before Review)</h3>
      <p className="muted">Select the version author before starting review.</p>
      <h3>Reviewer Assignment (Before Review)</h3>
      <p className="muted">Select reviewers before starting review.</p>
      <div className="actions">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={allowedReviewerIds.length > 0 && selectedReviewerIds.length === allowedReviewerIds.length}
            onChange={( event ) => onToggleAllReviewers( event.target.checked )}
            disabled={isBusy || !canAssignReviewers || allowedReviewerIds.length === 0}
          />
          <span>Select all reviewers</span>
        </label>
      </div>
      <DataTable
        key={`qt4_table_members_${projectId ?? 'unknown'}`}
        columns={memberColumns}
        data={membersTableRows}
        sorting={membersSorting}
        onSortingChange={setMembersSorting}
        tableClassName="data-table--members"
        storageKey={`qt4_table_members_${projectId ?? 'unknown'}`}
      />
    </section>
  )
}

export type { MemberAssignmentRow }
export default AuthorReviewerAssignmentPanel
