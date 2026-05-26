import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  QuerySnapshot,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import AppBrand from '../components/AppBrand'
import BackStack from '../components/BackStack'
import DataTable from '../components/DataTable'
import ErrorChecklistModal from '../components/ErrorChecklistModal'
import ModalDialog from '../components/ModalDialog'
import { GiphyInline } from '../giphy/GiphyProvider'
import { useErrorChecklistModal } from '../hooks/useErrorChecklistModal'
import { logAudit } from '../lib/audit'
import { reportAbnormalError } from '../lib/errorMonitor'
import { db } from '../lib/firebase'

type ProjectSummary = {
  id: string
  shortId: number | null
  name: string
  leaderId: string
}

type ProjectMember = {
  projectId: string
  userId: string
  role: 'leader' | 'member'
  email?: string | null
}

const isOfflineFirestoreError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String( error ?? '' )
  const loweredMessage = message.toLowerCase()
  const code = error && typeof error === 'object' && 'code' in error ? String( ( error as { code?: unknown } ).code ?? '' ).toLowerCase() : ''
  return (
    loweredMessage.includes( 'client is offline' )
    || loweredMessage.includes( 'failed to get document because the client is offline' )
    || loweredMessage.includes( 'offline' )
    || code.includes( 'unavailable' )
    || code.includes( 'deadline-exceeded' )
  )
}

function ProjectsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectSummary[]>([] )
  const [name, setName] = useState( '' )
  const [isBusy, setIsBusy] = useState( false )
  const [isLoadingProjects, setIsLoadingProjects] = useState( true )
  const { error, errorChecklist, openError, clearError } = useErrorChecklistModal()
  const [successMessage, setSuccessMessage] = useState<string | null>( null )
  const [viewMode, setViewMode] = useState<'card' | 'table'>( () => {
    const storedView = window.localStorage.getItem( 'qt4_projects_view' )
    return storedView === 'table' || storedView === 'card' ? storedView : 'card'
  } )
  const [sorting, setSorting] = useState<SortingState>( [ { id: 'shortId', desc: false } ] )
  const [membersByProject, setMembersByProject] = useState<Record<string, ProjectMember[]>>( {} )
  const [userDirectoryById, setUserDirectoryById] = useState<Record<string, { email?: string | null; displayName?: string | null }>>( {} )
  const successOkButtonRef = useRef<HTMLButtonElement | null>( null )
  const projectNameInputRef = useRef<HTMLInputElement | null>( null )
  const pendingSuccessFocusRef = useRef<{ type: 'projectName' } | null>( null )

  const userId = user?.uid ?? ''
  const userEmail = user?.email ?? null

  const formatUserLabel = useCallback( (memberUserId: string, fallbackEmail?: string | null) => {
    const entry = userDirectoryById[memberUserId]
    const displayName = entry?.displayName ?? ''
    const email = entry?.email ?? fallbackEmail ?? ''
    if( displayName && email ) {
      return `${displayName} (${email})`
    }
    if( displayName ) {
      return displayName
    }
    if( email ) {
      return email
    }
    if( memberUserId ) {
      return memberUserId
    }
    return 'Unknown user'
  }, [ userDirectoryById ] )

  const resolveProjectLeader = useCallback( (projectId: string, leaderId: string) => {
    const projectMembers = membersByProject[projectId] ?? []
    if( leaderId ) {
      const leaderById = projectMembers.find( ( member ) => member.userId === leaderId )
      return formatUserLabel( leaderId, leaderById?.email ?? null )
    }
    const leaderByRole = projectMembers.find( ( member ) => member.role === 'leader' )
    if( leaderByRole ) {
      return formatUserLabel( leaderByRole.userId, leaderByRole.email ?? null )
    }
    return 'Unknown user'
  }, [ membersByProject, formatUserLabel ] )

  const canSubmit = useMemo(
    () => name.trim().length > 0 && !isBusy,
    [ name, isBusy ],
  )

  const projectTableRows = useMemo(
    () =>
      projects.map( ( project ) => ( {
        id: project.id,
        shortId: project.shortId,
        name: project.name,
        leaderId: project.leaderId,
        leaderName: resolveProjectLeader( project.id, project.leaderId ),
        memberCount: ( membersByProject[project.id] ?? [] ).length,
      } ) ),
    [ projects, membersByProject, resolveProjectLeader ],
  )
  const projectColumns = useMemo<ColumnDef<{ id: string; shortId: number | null; name: string; leaderId: string; leaderName: string; memberCount: number }>[]>( () => [
    {
      header: 'Short id',
      accessorKey: 'shortId',
      sortingFn: ( rowA, rowB, columnId ) => {
        const leftRaw = rowA.getValue<number | null>( columnId )
        const rightRaw = rowB.getValue<number | null>( columnId )
        const left = typeof leftRaw === 'number' ? leftRaw : Number.POSITIVE_INFINITY
        const right = typeof rightRaw === 'number' ? rightRaw : Number.POSITIVE_INFINITY
        return left - right
      },
      cell: ( info ) => String( info.getValue<number | null>() ?? 'Unassigned' ),
    },
    {
      header: 'Name',
      accessorKey: 'name',
      cell: ( info ) => info.getValue<string>(),
    },
    {
      header: 'Leader',
      accessorKey: 'leaderName',
      cell: ( info ) => info.getValue<string>(),
    },
    {
      header: 'Members',
      accessorKey: 'memberCount',
      cell: ( info ) => String( info.getValue<number>() ),
    },
  ], [] )

  const sortedProjectCards = useMemo( () => {
    if( sorting.length === 0 ) {
      return projectTableRows
    }
    const { id, desc } = sorting[0]
    const sorted = [ ...projectTableRows ].sort( ( a, b ) => {
      if( id === 'shortId' ) {
        const left = typeof a.shortId === 'number' ? a.shortId : Number.POSITIVE_INFINITY
        const right = typeof b.shortId === 'number' ? b.shortId : Number.POSITIVE_INFINITY
        return left - right
      }
      const aValue = ( a as Record<string, unknown> )[id]
      const bValue = ( b as Record<string, unknown> )[id]
      if( typeof aValue === 'number' && typeof bValue === 'number' ) {
        return aValue - bValue
      }
      return String( aValue ?? '' ).localeCompare( String( bValue ?? '' ) )
    } )
    return desc ? sorted.reverse() : sorted
  }, [ projectTableRows, sorting ] )

  useEffect( () => {
    const storedSorting = window.localStorage.getItem( 'qt4_projects_sorting' )
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
    window.localStorage.setItem( 'qt4_projects_view', viewMode )
  }, [ viewMode ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_projects_sorting', JSON.stringify( sorting ) )
  }, [ sorting ] )

  useEffect( () => {
    if( successMessage && successOkButtonRef.current ) {
      successOkButtonRef.current.focus()
    }
  }, [ successMessage ] )

  const handleCloseSuccessMessage = () => {
    const target = pendingSuccessFocusRef.current
    setSuccessMessage( null )
    window.setTimeout( () => {
      if( target?.type === 'projectName' ) {
        projectNameInputRef.current?.focus()
      }
      pendingSuccessFocusRef.current = null
    }, 0 )
  }

  const loadProjects = useCallback( async (membersSnapshot: QuerySnapshot) => {
    if( !userId ) {
      return
    }
    clearError()
    setIsLoadingProjects( true )
    try {
      const projectIds = Array.from(
        new Set(
          membersSnapshot.docs
            .map( ( docSnapshot ) => ( docSnapshot.data().projectId as string | undefined ) ?? '' )
            .filter( ( projectId ) => projectId.trim().length > 0 ),
        ),
      )
      if( projectIds.length === 0 ) {
        setProjects( [] )
        setMembersByProject( {} )
        setUserDirectoryById( {} )
        return
      }
      const projectDocs = await Promise.all(
        projectIds.map( ( projectId ) => getDoc( doc( db, 'projects', projectId ) ) ),
      )
      const nextProjects = projectDocs
        .filter( ( docSnapshot ) => docSnapshot.exists() )
        .map( ( docSnapshot ) => {
          const data = docSnapshot.data()
          return {
            id: docSnapshot.id,
            shortId: Number.isFinite( data.shortId ) ? Number( data.shortId ) : null,
            name: ( data.name as string ) ?? '',
            leaderId: ( data.leaderId as string ) ?? '',
          }
        } )
      setProjects( nextProjects )

      const membersSnapshots = await Promise.all(
        projectIds.map( ( projectId ) =>
          getDocs( query( collection( db, 'projectMembers' ), where( 'projectId', '==', projectId ) ) ),
        ),
      )
      const nextMembersByProject: Record<string, ProjectMember[]> = {}
      const nextDirectoryById: Record<string, { email?: string | null; displayName?: string | null }> = {}
      membersSnapshots.forEach( ( snapshot, index ) => {
        const projectId = projectIds[index]
        if( !projectId ) {
          return
        }
        nextMembersByProject[projectId] = snapshot.docs.map( ( memberSnapshot ) => {
          const data = memberSnapshot.data()
          const memberUserId = ( data.userId as string ) ?? ''
          const memberEmail = ( data.email as string | null | undefined ) ?? null
          if( memberUserId ) {
            nextDirectoryById[memberUserId] = {
              email: memberEmail,
              displayName: null,
            }
          }
          return {
            projectId,
            userId: memberUserId,
            role: ( data.role as 'leader' | 'member' ) ?? 'member',
            email: memberEmail,
          }
        } )
      } )
      setMembersByProject( nextMembersByProject )

      const uniqueUserIds = Array.from(
        new Set( Object.keys( nextDirectoryById ).filter( ( memberUserId ) => memberUserId ) ),
      )
      const chunks: string[][] = []
      for( let index = 0; index < uniqueUserIds.length; index += 10 ) {
        chunks.push( uniqueUserIds.slice( index, index + 10 ) )
      }
      const directorySnapshots = await Promise.all(
        chunks.map( ( chunk ) =>
          getDocs( query( collection( db, 'userDirectory' ), where( 'userId', 'in', chunk ) ) ),
        ),
      )
      directorySnapshots.forEach( ( snapshot ) => {
        snapshot.docs.forEach( ( directoryDoc ) => {
          const data = directoryDoc.data()
          const memberUserId = ( data.userId as string | undefined ) ?? ''
          if( memberUserId ) {
            nextDirectoryById[memberUserId] = {
              email: ( data.email as string | null | undefined ) ?? null,
              displayName: ( data.displayName as string | null | undefined ) ?? null,
            }
          }
        } )
      } )
      if( userId ) {
        const existing = nextDirectoryById[userId] ?? {}
        nextDirectoryById[userId] = {
          email: userEmail ?? existing.email ?? null,
          displayName: user?.displayName ?? existing.displayName ?? null,
        }
      }
      const missingProfileIds = uniqueUserIds.filter(
        ( memberUserId ) => memberUserId && !nextDirectoryById[memberUserId]?.displayName,
      )
      if( missingProfileIds.length > 0 ) {
        await Promise.all(
          missingProfileIds.map( async ( memberUserId ) => {
            try {
              const profileSnapshot = await getDoc( doc( db, 'userProfiles', memberUserId ) )
              const profileName = ( profileSnapshot.data()?.displayName as string | undefined ) ?? ''
              if( profileName ) {
                nextDirectoryById[memberUserId] = {
                  ...nextDirectoryById[memberUserId],
                  displayName: profileName,
                }
              }
            } catch {
              // ignore missing profiles
            }
          } ),
        )
      }
      setUserDirectoryById( nextDirectoryById )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      if( !isOfflineFirestoreError( err ) ) {
        void reportAbnormalError( {
          error: err,
          source: 'firestore',
          action: 'projects.loadProjects',
        } )
      }
      openError( message, [
        { label: '(user is signed in)', ok: Boolean( userId ) },
        { label: '(network connection is available)', ok: typeof navigator !== 'undefined' ? navigator.onLine : true },
      ] )
    } finally {
      setIsLoadingProjects( false )
    }
  }, [ userId, clearError, userEmail, user?.displayName, openError ] )

  useEffect( () => {
    if( !userId ) {
      return
    }
    setIsLoadingProjects( true )
    const membersQuery = query(
      collection( db, 'projectMembers' ),
      where( 'userId', '==', userId ),
    )
    const unsubscribe = onSnapshot(
      membersQuery,
      ( snapshot ) => {
        void loadProjects( snapshot )
      },
      ( err ) => {
        const message = err instanceof Error ? err.message : 'Unexpected error'
        if( isOfflineFirestoreError( err ) ) {
          openError( `Projects could not be loaded while offline: ${message}`, [
            { label: '(user is signed in)', ok: Boolean( userId ) },
            { label: '(network connection is available)', ok: false },
          ] )
          setIsLoadingProjects( false )
          return
        }
        openError( `Projects failed to load: ${message}`, [
          { label: '(user is signed in)', ok: Boolean( userId ) },
          { label: '(network connection is available)', ok: typeof navigator !== 'undefined' ? navigator.onLine : true },
        ] )
        setIsLoadingProjects( false )
      },
    )
    return () => {
      unsubscribe()
    }
  }, [ userId, loadProjects, openError ] )

  const handleCreateProject = async ( event: React.FormEvent<HTMLFormElement> ) => {
    event.preventDefault()
    if( !userId ) {
      openError( 'Sign in before creating a project.', [
        { label: '(user is signed in)', ok: false },
      ] )
      return
    }
    if( name.trim().length === 0 ) {
      openError( 'Project name cannot be empty.', [
        { label: '(project name is provided)', ok: false },
        { label: '(user is signed in)', ok: Boolean( userId ) },
      ] )
      return
    }
    clearError()
    setSuccessMessage( null )
    setIsBusy( true )
    try {
      const counterRef = doc( db, 'counters', 'projects' )
      const projectRef = doc( collection( db, 'projects' ) )
      const leaderMemberRef = doc( db, 'projectMembers', `${projectRef.id}_${userId}` )
      await runTransaction( db, async ( transaction ) => {
        const counterSnap = await transaction.get( counterRef )
        const nextNumberRaw = counterSnap.data()?.nextNumber
        const nextNumber = typeof nextNumberRaw === 'number' ? nextNumberRaw : 1
        transaction.set(
          counterRef,
          {
            nextNumber: nextNumber + 1,
            lastProjectId: projectRef.id,
          },
          { merge: true },
        )
        transaction.set( projectRef, {
          name: name.trim(),
          leaderId: userId,
          isActive: true,
          shortId: nextNumber,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } )
        transaction.set( leaderMemberRef, {
          projectId: projectRef.id,
          userId,
          role: 'leader',
          email: userEmail,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } )
      } )
      const projectRefId = projectRef.id
      setName( '' )
      pendingSuccessFocusRef.current = { type: 'projectName' }
      setSuccessMessage( 'Project created successfully.' )
      void ( async () => {
        try {
          await logAudit( {
            actorId: userId,
            actorEmail: userEmail,
            action: 'createProject',
            entityType: 'project',
            entityId: projectRefId,
            projectId: projectRefId,
          } )
        } catch( err ) {
          console.warn( 'Audit log failed (create project):', err )
        }
      } )()
      if( userId ) {
        void ( async () => {
          try {
            const membersQuery = query(
              collection( db, 'projectMembers' ),
              where( 'userId', '==', userId ),
            )
            const membersSnapshot = await getDocs( membersQuery )
            await loadProjects( membersSnapshot )
          } catch( err ) {
            console.warn( 'Project refresh failed (create project):', err )
          }
        } )()
      }
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      void reportAbnormalError( {
        error: err,
        source: 'firestore',
        action: 'projects.createProject',
      } )
      openError( message, [
        { label: '(project name is provided)', ok: name.trim().length > 0 },
        { label: '(user is signed in)', ok: Boolean( userId ) },
        { label: '(network connection is available)', ok: typeof navigator !== 'undefined' ? navigator.onLine : true },
      ] )
    } finally {
      setIsBusy( false )
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <AppBrand pageTitle="Projects" />
          {isLoadingProjects ? <GiphyInline reason="loading" /> : null}
        </div>
        <BackStack links={[]} />
      </header>

      <main className="app-main">
        <section className="panel stack">
          {!isBusy ? <h2>Create project</h2> : null}
          <form className="form" onSubmit={handleCreateProject}>
            <label className="field">
              <span>Name</span>
              <input
                ref={projectNameInputRef}
                type="text"
                name="name"
                required
                value={name}
                onChange={( event ) => setName( event.target.value )}
              />
            </label>
            <div className="actions">
              <button type="submit" disabled={!canSubmit}>
                Create project
              </button>
            </div>
          </form>
        </section>

        {isLoadingProjects && projects.length === 0 ? (
          <section className="panel">
            <GiphyInline reason="loading" />
          </section>
        ) : (
          <section className="panel stack">
            <div className="panel-header">
              <h2>My projects</h2>
            </div>
            <div className="actions">
            </div>
            {error ? (
              <ErrorChecklistModal
                error={error}
                checklist={errorChecklist}
                onClose={clearError}
                reportContext={{
                  pageLabel: 'Projects',
                }}
              />
            ) : null}
            {successMessage ? (
              <ModalDialog onClose={handleCloseSuccessMessage} initialFocusRef={successOkButtonRef}>
                  <h3>Success</h3>
                  <GiphyInline reason="good_job" mode="inline" showLabel={false} />
                  <p className="muted">{successMessage}</p>
                  <div className="actions">
                    <button ref={successOkButtonRef} type="button" onClick={handleCloseSuccessMessage}>
                      OK
                    </button>
                  </div>
              </ModalDialog>
            ) : null}
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
            {!isLoadingProjects && projectTableRows.length === 0 ? (
              <p className="muted">You do not have any assigned projects yet.</p>
            ) : viewMode === 'table' ? (
              <DataTable
                columns={projectColumns}
                data={projectTableRows}
                sorting={sorting}
                onSortingChange={setSorting}
                tableClassName="data-table--projects"
                storageKey="qt4_table_projects"
                onRowClick={( row ) => {
                  navigate( `/projects/${row.id}/documents` )
                }}
              />
            ) : (
              <div className="project-grid">
                {sortedProjectCards.map( ( project ) => (
                  <article
                    key={project.id}
                    className="project-card"
                    onClick={() => navigate( `/projects/${project.id}/documents` )}
                    role="button"
                    tabIndex={0}
                    onKeyDown={( event ) => {
                      if( event.key === 'Enter' || event.key === ' ' ) {
                        event.preventDefault()
                        navigate( `/projects/${project.id}/documents` )
                      }
                    }}
                  >
                  <h3>{`${project.shortId ?? 'Unassigned'} - ${project.name}`}</h3>
                    <p className="muted">Leader: {resolveProjectLeader( project.id, project.leaderId )}</p>
                  </article>
                ) )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

export default ProjectsPage
