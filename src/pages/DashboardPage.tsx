import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import {
  doc,
  onSnapshot,
} from 'firebase/firestore'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import AppBrand from '../components/AppBrand'
import BackStack from '../components/BackStack'
import DataTable from '../components/DataTable'
import ErrorChecklistModal from '../components/ErrorChecklistModal'
import ModalDialog from '../components/ModalDialog'
import { GiphyInline } from '../giphy/GiphyProvider'
import { useErrorChecklistModal } from '../hooks/useErrorChecklistModal'
import { db } from '../lib/firebase'
import {
  refreshDashboard,
  type DashboardBuildProgress,
  type DashboardRefreshScope,
  type DashboardTask,
  type DashboardTaskType,
} from '../lib/dashboard'
import { formatTimeAgoWithTimestamp } from '../lib/time'

type DashboardSectionKey = DashboardTaskType | 'expired' | 'activeTable'
const DASHBOARD_COLLAPSE_STORAGE_KEY = 'qt4_dashboard_collapsed_sections_v2'

function DashboardPage() {
  const { user } = useAuth()
  const userId = user?.uid ?? ''
  const navigate = useNavigate()
  const { error, errorChecklist, openError, clearError } = useErrorChecklistModal()
  const [tasks, setTasks] = useState<DashboardTask[]>([] )
  const [activeRefreshScope, setActiveRefreshScope] = useState<DashboardRefreshScope | null>( null )
  const [dashboardUpdatedAt, setDashboardUpdatedAt] = useState<Date | null>( null )
  const [nowMs, setNowMs] = useState( () => Date.now() )
  const [refreshProgress, setRefreshProgress] = useState<DashboardBuildProgress | null>( null )
  const [lastRefreshByScope, setLastRefreshByScope] = useState<Record<DashboardRefreshScope, Date | null>>( {
    all: null,
    authoring: null,
    reply: null,
    reviewer: null,
    acceptedReport: null,
  } )
  const loadInFlightRef = useRef( false )
  const loadQueuedScopeRef = useRef<DashboardRefreshScope | null>( null )
  const pendingFocusScopeRef = useRef<DashboardRefreshScope | null>( null )
  const refreshButtonRefs = useRef<Partial<Record<DashboardRefreshScope, HTMLButtonElement | null>>>( {} )
  const [viewMode, setViewMode] = useState<'card' | 'table'>( () => {
    const storedView = window.localStorage.getItem( 'qt4_dashboard_view' )
    return storedView === 'table' || storedView === 'card' ? storedView : 'card'
  } )
  const [collapsedSections, setCollapsedSections] = useState<Record<DashboardSectionKey, boolean>>( () => {
    const defaultState: Record<DashboardSectionKey, boolean> = {
      authoring: true,
      reply: true,
      reviewer: true,
      acceptedReport: true,
      expired: true,
      activeTable: true,
    }
    const storedSections = window.localStorage.getItem( DASHBOARD_COLLAPSE_STORAGE_KEY )
    if( !storedSections ) {
      return defaultState
    }
    try {
      const parsed = JSON.parse( storedSections ) as Partial<Record<DashboardSectionKey, boolean>>
      return {
        ...defaultState,
        ...parsed,
      }
    } catch {
      return defaultState
    }
  } )
  const [sorting, setSorting] = useState<SortingState>( [ { id: 'createdAt', desc: false } ] )
  const [expiredSorting, setExpiredSorting] = useState<SortingState>( () => {
    const storedSorting = window.localStorage.getItem( 'qt4_dashboard_expired_sorting' )
    if( storedSorting ) {
      try {
        const parsed = JSON.parse( storedSorting ) as SortingState
        if( Array.isArray( parsed ) ) {
          return parsed
        }
      } catch {
        // ignore parse errors
      }
    }
    return [ { id: 'createdAtMs', desc: true } ]
  } )
  const isLoadingTasks = activeRefreshScope !== null
  const refreshScopeLabel: Record<DashboardRefreshScope, string> = {
    all: 'all sections',
    authoring: 'In Creation (Author)',
    reply: 'Replies Needed',
    reviewer: 'In Review (Reviewer)',
    acceptedReport: 'Accepted Error Reports',
  }

  const toTimestampDate = (value: unknown): Date | null => {
    if( !value ) {
      return null
    }
    if( typeof value === 'object' && value && 'toDate' in value && typeof ( value as { toDate?: () => Date } ).toDate === 'function' ) {
      return ( value as { toDate: () => Date } ).toDate()
    }
    if( value instanceof Date ) {
      return value
    }
    return null
  }

  const taskGroups = useMemo(
    () => ( {
      authoring: tasks.filter( ( task ) => task.type === 'authoring' && task.lifecycleState !== 'expired' ),
      reply: tasks.filter( ( task ) => task.type === 'reply' && task.lifecycleState !== 'expired' ),
      reviewer: tasks.filter( ( task ) => task.type === 'reviewer' && task.lifecycleState !== 'expired' ),
      acceptedReport: tasks.filter( ( task ) => task.type === 'acceptedReport' && task.lifecycleState !== 'expired' ),
      expired: tasks.filter( ( task ) => task.lifecycleState === 'expired' ),
    } ),
    [ tasks ],
  )
  const activeTasks = useMemo(
    () => tasks.filter( ( task ) => task.lifecycleState !== 'expired' ),
    [ tasks ],
  )

  const taskTableRows = useMemo(
    () =>
      tasks.map( ( task ) => ( {
        ...task,
        createdAtMs: task.createdAt ? task.createdAt.getTime() : 0,
      } ) ),
    [ tasks ],
  )
  const activeTaskTableRows = useMemo(
    () => taskTableRows.filter( ( task ) => task.lifecycleState !== 'expired' ),
    [ taskTableRows ],
  )
  const expiredTaskTableRows = useMemo(
    () => taskTableRows.filter( ( task ) => task.lifecycleState === 'expired' ),
    [ taskTableRows ],
  )

  const taskColumns = useMemo<ColumnDef<DashboardTask & { createdAtMs: number }>[]>( 
    () => [
      {
        header: 'Type',
        accessorKey: 'type',
      },
      {
        header: 'Title',
        accessorKey: 'title',
      },
      {
        header: 'Detail',
        accessorKey: 'detail',
      },
      {
        header: 'Created',
        accessorKey: 'createdAtMs',
        cell: ( info ) => formatTimeAgoWithTimestamp( info.row.original.createdAt ),
      },
    ],
    [],
  )

  const triggerLoadTasks = (scope: DashboardRefreshScope = 'all') => {
    pendingFocusScopeRef.current = scope
    if( loadInFlightRef.current ) {
      if( scope === 'all' || loadQueuedScopeRef.current === null ) {
        loadQueuedScopeRef.current = scope
      }
      return
    }
    loadInFlightRef.current = true
    void (async () => {
      if( !userId ) {
        openError( 'Sign in before refreshing dashboard tasks.', [
          { label: '(user is signed in)', ok: false },
        ] )
        loadInFlightRef.current = false
        return
      }
      clearError()
      setActiveRefreshScope( scope )
      try {
        const refreshOptions = scope === 'all' ? {} : { types: [ scope ] as DashboardTaskType[] }
        await refreshDashboard( userId, {
          ...refreshOptions,
          onProgress: setRefreshProgress,
        } )
        const refreshAt = new Date()
        setLastRefreshByScope( ( previous ) => {
          if( scope === 'all' ) {
            return {
              all: refreshAt,
              authoring: refreshAt,
              reply: refreshAt,
              reviewer: refreshAt,
              acceptedReport: refreshAt,
            }
          }
          return {
            ...previous,
            [scope]: refreshAt,
          }
        } )
      } catch( err ) {
        const message = err instanceof Error ? err.message : 'Unexpected error'
        openError( `Dashboard tasks failed: ${message}`, [
          { label: '(user is signed in)', ok: Boolean( userId ) },
          { label: '(network connection is available)', ok: typeof navigator !== 'undefined' ? navigator.onLine : true },
        ] )
      } finally {
        setActiveRefreshScope( null )
        setRefreshProgress( null )
      }
      loadInFlightRef.current = false
      if( loadQueuedScopeRef.current ) {
        const queuedScope = loadQueuedScopeRef.current
        loadQueuedScopeRef.current = null
        triggerLoadTasks( queuedScope )
      }
    })()
  }

  useEffect( () => {
    if( activeRefreshScope !== null ) {
      return
    }
    const scope = pendingFocusScopeRef.current
    if( !scope ) {
      return
    }
    const target = refreshButtonRefs.current[scope]
    if( target ) {
      window.setTimeout( () => {
        target.focus()
      }, 0 )
    }
    pendingFocusScopeRef.current = null
  }, [ activeRefreshScope ] )

  const bindRefreshButtonRef = (scope: DashboardRefreshScope) => (element: HTMLButtonElement | null) => {
    refreshButtonRefs.current[scope] = element
  }

  useEffect( () => {
    const timerId = window.setInterval( () => {
      setNowMs( Date.now() )
    }, 1000 )
    return () => {
      window.clearInterval( timerId )
    }
  }, [] )

  useEffect( () => {
    if( !userId ) {
      return
    }
    const dashboardRef = doc( db, 'dashboard', userId )
    const unsubscribe = onSnapshot(
      dashboardRef,
      ( snapshot ) => {
        if( !snapshot.exists() ) {
          setTasks( [] )
          setDashboardUpdatedAt( null )
          return
        }
        const data = snapshot.data()
        const rawTasks = ( data.tasks as DashboardTask[] | undefined ) ?? []
        const nextTasks = rawTasks.map( ( task ) => ( {
          ...task,
          createdAt: toTimestampDate( task.createdAt ),
          reviewEndAt: toTimestampDate( task.reviewEndAt ),
        } ) )
        setTasks( nextTasks )
        const updatedAt = toTimestampDate( data.updatedAt )
        setDashboardUpdatedAt( updatedAt )
        if( updatedAt ) {
          setLastRefreshByScope( ( previous ) => ( {
            all: previous.all ?? updatedAt,
            authoring: previous.authoring ?? updatedAt,
            reply: previous.reply ?? updatedAt,
            reviewer: previous.reviewer ?? updatedAt,
            acceptedReport: previous.acceptedReport ?? updatedAt,
          } ) )
        }
      },
      ( err ) => {
        const message = err instanceof Error ? err.message : 'Unexpected error'
        openError( `Dashboard failed to load: ${message}`, [
          { label: '(user is signed in)', ok: Boolean( userId ) },
          { label: '(network connection is available)', ok: typeof navigator !== 'undefined' ? navigator.onLine : true },
        ] )
      },
    )
    return () => {
      unsubscribe()
    }
  }, [ userId, openError ] )

  useEffect( () => {
    setDashboardUpdatedAt( null )
    setTasks( [] )
    setActiveRefreshScope( null )
    setLastRefreshByScope( {
      all: null,
      authoring: null,
      reply: null,
      reviewer: null,
      acceptedReport: null,
    } )
    loadQueuedScopeRef.current = null
    if( !userId ) {
      clearError()
    }
  }, [ userId, clearError ] )

  useEffect( () => {
    const storedSorting = window.localStorage.getItem( 'qt4_dashboard_sorting' )
    if( storedSorting ) {
      try {
        const parsed = JSON.parse( storedSorting ) as SortingState
        if( Array.isArray( parsed ) ) {
          setSorting( parsed )
        }
      } catch {
        // ignore parse errors
      }
    }
  }, [] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_dashboard_view', viewMode )
  }, [ viewMode ] )

  useEffect( () => {
    window.localStorage.setItem( DASHBOARD_COLLAPSE_STORAGE_KEY, JSON.stringify( collapsedSections ) )
  }, [ collapsedSections ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_dashboard_sorting', JSON.stringify( sorting ) )
  }, [ sorting ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_dashboard_expired_sorting', JSON.stringify( expiredSorting ) )
  }, [ expiredSorting ] )

  const toggleSection = (sectionKey: DashboardSectionKey) => {
    setCollapsedSections( ( previous ) => ( {
      ...previous,
      [sectionKey]: !previous[sectionKey],
    } ) )
  }

  const formatElapsed = (value: Date | null) => {
    if( !value ) {
      return '--:--:--'
    }
    const deltaSeconds = Math.max( 0, Math.floor( ( nowMs - value.getTime() ) / 1000 ) )
    const hours = Math.floor( deltaSeconds / 3600 )
    const minutes = Math.floor( ( deltaSeconds % 3600 ) / 60 )
    const seconds = deltaSeconds % 60
    return `${String( hours ).padStart( 2, '0' )}:${String( minutes ).padStart( 2, '0' )}:${String( seconds ).padStart( 2, '0' )}`
  }

  const resolveTaskStatusClassName = (task: Pick<DashboardTask, 'type' | 'reviewEndAt' | 'reviewPeriodState' | 'lifecycleState'>) => {
    if( task.lifecycleState === 'expired' ) {
      return 'status-card--in-review-expired'
    }
    if( task.type !== 'reviewer' ) {
      return ''
    }
    if( task.reviewPeriodState === 'grace' ) {
      return 'status-card--in-review'
    }
    if( task.reviewEndAt && task.reviewEndAt.getTime() <= nowMs ) {
      return 'status-card--in-review-expired'
    }
    return 'status-card--in-review'
  }

  const resolveTaskVisualClassName = (task: Pick<DashboardTask, 'visualState' | 'type' | 'reviewEndAt' | 'reviewPeriodState' | 'lifecycleState'>) => {
    switch( task.visualState ) {
      case 'inCreation':
        return 'status-card--in-creation'
      case 'accepted':
        return 'status-card--accepted'
      case 'reviewGrace':
        return 'status-card--in-review-expired'
      case 'reviewExpired':
        return 'status-card--in-review-expired'
      case 'reviewActive':
        return 'status-card--in-review'
      default:
        return resolveTaskStatusClassName( task )
    }
  }

  const renderTaskCard = (task: DashboardTask) => (
    <article
      key={task.id}
      className={`project-card ${resolveTaskVisualClassName( task )}`.trim()}
      onClick={() => navigate( task.link )}
      role="button"
      tabIndex={0}
      onKeyDown={( event ) => {
        if( event.key === 'Enter' || event.key === ' ' ) {
          event.preventDefault()
          navigate( task.link )
        }
      }}
    >
      <h4>{task.title}</h4>
      <p className="muted">{task.detail}</p>
      <p className="muted">
        Created: {formatTimeAgoWithTimestamp( task.createdAt )}
      </p>
      {task.visualState === 'reviewGrace' ? <p className="muted">Reply or review is in grace period.</p> : null}
    </article>
  )

  const renderSection = (
    title: string,
    sectionKey: DashboardSectionKey,
    scope: DashboardTaskType | null,
    sectionTasks: DashboardTask[],
    emptyMessage: string = 'No pending tasks in this section.',
  ) => (
    <div className="stack">
      <div className="panel-header">
        <h3>{title}</h3>
        <div className="actions">
          <button
            type="button"
            className="ghost"
            aria-expanded={!collapsedSections[sectionKey]}
            onClick={() => toggleSection( sectionKey )}
          >
            <span aria-hidden="true">{collapsedSections[sectionKey] ? '+' : '-'}</span>{' '}
            {collapsedSections[sectionKey] ? 'Expand section' : 'Collapse section'}
          </button>
          {scope ? (
            <>
              <button
                type="button"
                className="ghost"
                ref={bindRefreshButtonRef( scope )}
                onClick={() => triggerLoadTasks( scope )}
                disabled={isLoadingTasks}
              >
                Refresh section
              </button>
              <span className="muted">Since refresh: {formatElapsed( lastRefreshByScope[scope] )}</span>
            </>
          ) : (
            <span className="muted">Refresh reviewer and reply sections to recalculate expired tasks.</span>
          )}
        </div>
      </div>
      {collapsedSections[sectionKey] ? null : sectionTasks.length > 0 ? (
        <div className="dashboard-card-grid">
          {sectionTasks.map( ( task ) => renderTaskCard( task ) )}
        </div>
      ) : (
        <p className="muted">{emptyMessage}</p>
      )}
    </div>
  )

  const renderTableSection = (
    title: string,
    sectionKey: DashboardSectionKey,
    content: ReactNode,
    emptyMessage?: string,
  ) => (
    <div className="stack">
      <div className="panel-header">
        <h3>{title}</h3>
        <div className="actions">
          <button
            type="button"
            className="ghost"
            aria-expanded={!collapsedSections[sectionKey]}
            onClick={() => toggleSection( sectionKey )}
          >
            <span aria-hidden="true">{collapsedSections[sectionKey] ? '+' : '-'}</span>{' '}
            {collapsedSections[sectionKey] ? 'Expand section' : 'Collapse section'}
          </button>
        </div>
      </div>
      {collapsedSections[sectionKey]
        ? null
        : content ?? ( emptyMessage ? <p className="muted">{emptyMessage}</p> : null )}
    </div>
  )

  const renderExpiredTableSection = () =>
    renderTableSection(
      'Expired Uncompleted Tasks',
      'expired',
      expiredTaskTableRows.length > 0 ? (
        <>
          <p className="muted">Refresh reviewer and reply sections to recalculate expired tasks.</p>
          <DataTable
            columns={taskColumns}
            data={expiredTaskTableRows}
            sorting={expiredSorting}
            onSortingChange={setExpiredSorting}
            tableClassName="data-table--dashboard"
            getRowClassName={( row ) => resolveTaskVisualClassName( row )}
            storageKey="qt4_table_dashboard_expired"
            enablePagination
            initialPageSize={10}
            onRowClick={( row ) => navigate( row.link )}
          />
        </>
      ) : null,
      'No tasks expired without completion.',
    )

  return (
    <div className="app-shell">
      <BackStack links={[]} />
      <header className="app-header">
        <div>
          <AppBrand pageTitle="Dashboard" />
          {isLoadingTasks ? (
            <p className="muted">
              {`Refreshing ${refreshScopeLabel[activeRefreshScope ?? 'all']}...`}
            </p>
          ) : null}
        </div>
      </header>

      <main className="app-main">
        <section className="panel">
          <p className="muted">User: {user?.email ?? 'No email'}</p>
          <p className="dashboard-refresh">
            Last refresh: {dashboardUpdatedAt ? formatTimeAgoWithTimestamp( dashboardUpdatedAt ) : 'Not refreshed yet'}
          </p>
          <div className="actions actions--dashboard-primary">
            <Link className="link" to="/projects">
              Go to Projects
            </Link>
            <Link className="link" to="/admin/audit">
              Activity log
            </Link>
            <button
              type="button"
              className="ghost"
              ref={bindRefreshButtonRef( 'all' )}
              onClick={() => triggerLoadTasks( 'all' )}
              disabled={isLoadingTasks}
            >
              Refresh all sections
            </button>
            <span className="muted">Since refresh: {formatElapsed( lastRefreshByScope.all )}</span>
          </div>
        </section>
        {error ? (
          <ErrorChecklistModal error={error} checklist={errorChecklist} onClose={clearError} />
        ) : null}
        {isLoadingTasks ? (
          <ModalDialog cardClassName="dashboard-progress-modal">
            <h3>Refreshing dashboard</h3>
            <GiphyInline reason="teamwork" mode="inline" />
            {refreshProgress ? (
              <div className="dashboard-progress">
                <div className="dashboard-progress__track" aria-hidden="true">
                  <div
                    className="dashboard-progress__bar"
                    style={{ width: `${Math.max( 8, Math.round( ( refreshProgress.currentStep / refreshProgress.totalSteps ) * 100 ) )}%` }}
                  />
                </div>
                <p className="muted">
                  {`Step ${refreshProgress.currentStep} of ${refreshProgress.totalSteps}: ${refreshProgress.label}`}
                </p>
              </div>
            ) : (
              <p className="muted">Preparing refresh...</p>
            )}
          </ModalDialog>
        ) : null}

        {!isLoadingTasks ? (
          <section className="panel stack">
            <div className="panel-header">
              <h2>Pending tasks</h2>
            </div>
            <div className="actions">
              <label className="field">
                <span>View</span>
                <div className="view-toggle">
                  <button
                    type="button"
                    aria-pressed={viewMode === 'card'}
                    onClick={() => setViewMode( 'card' )}
                  >
                    Cards
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewMode === 'table'}
                    onClick={() => setViewMode( 'table' )}
                  >
                    Table
                  </button>
                </div>
              </label>
            </div>
            {activeTasks.length === 0 ? (
              <p className="muted">No pending tasks right now. Use a refresh button to load data.</p>
            ) : null}
            {viewMode === 'table' ? (
              <>
                {renderTableSection(
                  'Active pending tasks',
                  'activeTable',
                  <>
                    <div className="actions">
                      <button
                        type="button"
                        className="ghost"
                        ref={bindRefreshButtonRef( 'authoring' )}
                        onClick={() => triggerLoadTasks( 'authoring' )}
                        disabled={isLoadingTasks}
                      >
                        Refresh In Creation
                      </button>
                      <span className="muted">Since refresh: {formatElapsed( lastRefreshByScope.authoring )}</span>
                      <button
                        type="button"
                        className="ghost"
                        ref={bindRefreshButtonRef( 'reply' )}
                        onClick={() => triggerLoadTasks( 'reply' )}
                        disabled={isLoadingTasks}
                      >
                        Refresh Replies
                      </button>
                      <span className="muted">Since refresh: {formatElapsed( lastRefreshByScope.reply )}</span>
                      <button
                        type="button"
                        className="ghost"
                        ref={bindRefreshButtonRef( 'reviewer' )}
                        onClick={() => triggerLoadTasks( 'reviewer' )}
                        disabled={isLoadingTasks}
                      >
                        Refresh In Review
                      </button>
                      <span className="muted">Since refresh: {formatElapsed( lastRefreshByScope.reviewer )}</span>
                      <button
                        type="button"
                        className="ghost"
                        ref={bindRefreshButtonRef( 'acceptedReport' )}
                        onClick={() => triggerLoadTasks( 'acceptedReport' )}
                        disabled={isLoadingTasks}
                      >
                        Refresh Accepted Reports
                      </button>
                      <span className="muted">Since refresh: {formatElapsed( lastRefreshByScope.acceptedReport )}</span>
                    </div>
                    <DataTable
                      columns={taskColumns}
                      data={activeTaskTableRows}
                      sorting={sorting}
                      onSortingChange={setSorting}
                      tableClassName="data-table--dashboard"
                      getRowClassName={( row ) => resolveTaskVisualClassName( row )}
                      storageKey="qt4_table_dashboard"
                      onRowClick={( row ) => navigate( row.link )}
                    />
                  </>,
                )}
              </>
            ) : (
              <div className="stack">
                {renderSection( 'In Creation (Author)', 'authoring', 'authoring', taskGroups.authoring )}
                {renderSection( 'Replies Needed', 'reply', 'reply', taskGroups.reply )}
                {renderSection( 'In Review (Reviewer, no comments)', 'reviewer', 'reviewer', taskGroups.reviewer )}
                {renderSection( 'Accepted Versions With Accepted Error Reports', 'acceptedReport', 'acceptedReport', taskGroups.acceptedReport )}
                {renderExpiredTableSection()}
              </div>
            )}
            {viewMode === 'table' ? renderExpiredTableSection() : null}
          </section>
        ) : null}
      </main>
    </div>
  )
}

export default DashboardPage
