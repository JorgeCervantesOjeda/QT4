import { useEffect, useMemo, useRef, useState } from 'react'
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
import { GiphyInline } from '../giphy/GiphyProvider'
import { useErrorChecklistModal } from '../hooks/useErrorChecklistModal'
import { db } from '../lib/firebase'
import {
  refreshDashboard,
  type DashboardRefreshScope,
  type DashboardTask,
  type DashboardTaskType,
} from '../lib/dashboard'
import { formatTimeAgo } from '../lib/time'

function DashboardPage() {
  const { user } = useAuth()
  const userId = user?.uid ?? ''
  const navigate = useNavigate()
  const { error, errorChecklist, openError, clearError } = useErrorChecklistModal()
  const [tasks, setTasks] = useState<DashboardTask[]>([] )
  const [activeRefreshScope, setActiveRefreshScope] = useState<DashboardRefreshScope | null>( null )
  const [dashboardUpdatedAt, setDashboardUpdatedAt] = useState<Date | null>( null )
  const loadInFlightRef = useRef( false )
  const loadQueuedScopeRef = useRef<DashboardRefreshScope | null>( null )
  const pendingFocusScopeRef = useRef<DashboardRefreshScope | null>( null )
  const refreshButtonRefs = useRef<Partial<Record<DashboardRefreshScope, HTMLButtonElement | null>>>( {} )
  const [viewMode, setViewMode] = useState<'card' | 'table'>( () => {
    const storedView = window.localStorage.getItem( 'qt4_dashboard_view' )
    return storedView === 'table' || storedView === 'card' ? storedView : 'card'
  } )
  const [sorting, setSorting] = useState<SortingState>( [ { id: 'createdAt', desc: false } ] )
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
      authoring: tasks.filter( ( task ) => task.type === 'authoring' ),
      reply: tasks.filter( ( task ) => task.type === 'reply' ),
      reviewer: tasks.filter( ( task ) => task.type === 'reviewer' ),
      acceptedReport: tasks.filter( ( task ) => task.type === 'acceptedReport' ),
    } ),
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
        cell: ( info ) => formatTimeAgo( info.row.original.createdAt ),
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
        await refreshDashboard( userId, refreshOptions )
      } catch( err ) {
        const message = err instanceof Error ? err.message : 'Unexpected error'
        openError( `Dashboard tasks failed: ${message}`, [
          { label: '(user is signed in)', ok: Boolean( userId ) },
          { label: '(network connection is available)', ok: typeof navigator !== 'undefined' ? navigator.onLine : true },
        ] )
      } finally {
        setActiveRefreshScope( null )
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
        } ) )
        setTasks( nextTasks )
        const updatedAt = toTimestampDate( data.updatedAt )
        setDashboardUpdatedAt( updatedAt )
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
    window.localStorage.setItem( 'qt4_dashboard_sorting', JSON.stringify( sorting ) )
  }, [ sorting ] )

  const renderTaskCard = (task: DashboardTask) => (
    <article
      key={task.id}
      className="project-card"
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
        Created: {task.createdAt ? formatTimeAgo( task.createdAt ) : 'Unknown'}
      </p>
    </article>
  )

  const renderSection = (
    title: string,
    scope: DashboardTaskType,
    sectionTasks: DashboardTask[],
  ) => (
    <div className="stack">
      <div className="panel-header">
        <h3>{title}</h3>
        <button
          type="button"
          className="ghost"
          ref={bindRefreshButtonRef( scope )}
          onClick={() => triggerLoadTasks( scope )}
          disabled={isLoadingTasks}
        >
          Refresh section
        </button>
      </div>
      {sectionTasks.length > 0 ? (
        <div className="dashboard-card-grid">
          {sectionTasks.map( ( task ) => renderTaskCard( task ) )}
        </div>
      ) : (
        <p className="muted">No pending tasks in this section.</p>
      )}
    </div>
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
            Last refresh: {dashboardUpdatedAt ? formatTimeAgo( dashboardUpdatedAt ) : 'Not refreshed yet'}
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
          </div>
        </section>
        {error ? (
          <ErrorChecklistModal error={error} checklist={errorChecklist} onClose={clearError} />
        ) : null}

        {isLoadingTasks ? (
          <section className="panel">
            <GiphyInline reason="teamwork" />
          </section>
        ) : (
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
            {tasks.length === 0 ? (
              <p className="muted">No pending tasks right now. Use a refresh button to load data.</p>
            ) : null}
            {viewMode === 'table' ? (
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
                  <button
                    type="button"
                    className="ghost"
                    ref={bindRefreshButtonRef( 'reply' )}
                    onClick={() => triggerLoadTasks( 'reply' )}
                    disabled={isLoadingTasks}
                  >
                    Refresh Replies
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    ref={bindRefreshButtonRef( 'reviewer' )}
                    onClick={() => triggerLoadTasks( 'reviewer' )}
                    disabled={isLoadingTasks}
                  >
                    Refresh In Review
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    ref={bindRefreshButtonRef( 'acceptedReport' )}
                    onClick={() => triggerLoadTasks( 'acceptedReport' )}
                    disabled={isLoadingTasks}
                  >
                    Refresh Accepted Reports
                  </button>
                </div>
                <DataTable
                  columns={taskColumns}
                  data={taskTableRows}
                  sorting={sorting}
                  onSortingChange={setSorting}
                  tableClassName="data-table--dashboard"
                  storageKey="qt4_table_dashboard"
                  onRowClick={( row ) => navigate( row.link )}
                />
              </>
            ) : (
              <div className="stack">
                {renderSection( 'In Creation (Author)', 'authoring', taskGroups.authoring )}
                {renderSection( 'Replies Needed', 'reply', taskGroups.reply )}
                {renderSection( 'In Review (Reviewer, no comments)', 'reviewer', taskGroups.reviewer )}
                {renderSection( 'Accepted Versions With Accepted Error Reports', 'acceptedReport', taskGroups.acceptedReport )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

export default DashboardPage
