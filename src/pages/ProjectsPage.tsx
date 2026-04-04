import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  QuerySnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
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

const isLikelyEmail = (value: string) => /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test( value )

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
  const [memberEmails, setMemberEmails] = useState<Record<string, string>>( {} )
  const [memberErrors, setMemberErrors] = useState<Record<string, string | null>>( {} )
  const [memberBusyProjectId, setMemberBusyProjectId] = useState<string | null>( null )
  const [selectedLeaderProjectId, setSelectedLeaderProjectId] = useState<string>( '' )
  const [membersByProject, setMembersByProject] = useState<Record<string, ProjectMember[]>>( {} )
  const [userDirectoryById, setUserDirectoryById] = useState<Record<string, { email?: string | null; displayName?: string | null }>>( {} )
  const successOkButtonRef = useRef<HTMLButtonElement | null>( null )
  const projectNameInputRef = useRef<HTMLInputElement | null>( null )
  const memberInputRefs = useRef<Record<string, HTMLInputElement | null>>( {} )
  const pendingSuccessFocusRef = useRef<{ type: 'projectName' | 'member'; projectId?: string } | null>( null )

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

  const leaderProjectOptions = useMemo(
    () => projectTableRows.filter( ( project ) => project.leaderId === userId ),
    [ projectTableRows, userId ],
  )

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

  useEffect( () => {
    if( leaderProjectOptions.length === 0 ) {
      if( selectedLeaderProjectId ) {
        setSelectedLeaderProjectId( '' )
      }
      return
    }
    const exists = leaderProjectOptions.some( ( option ) => option.id === selectedLeaderProjectId )
    if( !exists ) {
      setSelectedLeaderProjectId( leaderProjectOptions[0]?.id ?? '' )
    }
  }, [ leaderProjectOptions, selectedLeaderProjectId ] )

  const handleCloseSuccessMessage = () => {
    const target = pendingSuccessFocusRef.current
    setSuccessMessage( null )
    window.setTimeout( () => {
      if( target?.type === 'projectName' ) {
        projectNameInputRef.current?.focus()
      }
      if( target?.type === 'member' && target.projectId ) {
        memberInputRefs.current[target.projectId]?.focus()
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
      void reportAbnormalError( {
        error: err,
        source: 'firestore',
        action: 'projects.loadProjects',
      } )
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

  const handleAddMember = async ( projectId: string ) => {
    if( !userId ) {
      setMemberErrors( ( prev ) => ( {
        ...prev,
        [projectId]: 'Sign in before adding a member.',
      } ) )
      return
    }
    const rawEmail = memberEmails[projectId] ?? ''
    const memberEmailInput = rawEmail.trim()
    const memberEmailLower = memberEmailInput.toLowerCase()
    if( !memberEmailLower ) {
      setMemberErrors( ( prev ) => ( { ...prev, [projectId]: 'Provide an email address.' } ) )
      return
    }
    if( !isLikelyEmail( memberEmailInput ) ) {
      setMemberErrors( ( prev ) => ( { ...prev, [projectId]: 'Provide a valid email address.' } ) )
      return
    }
    let directorySnapshot
    try {
      directorySnapshot = await getDoc( doc( db, 'userDirectory', memberEmailInput ) )
      if( !directorySnapshot.exists() && memberEmailInput !== memberEmailLower ) {
        directorySnapshot = await getDoc( doc( db, 'userDirectory', memberEmailLower ) )
      }
      if( !directorySnapshot.exists() ) {
        const directoryQuery = query(
          collection( db, 'userDirectory' ),
          where( 'emailLower', '==', memberEmailLower ),
          limit( 1 ),
        )
        const directoryMatches = await getDocs( directoryQuery )
        if( directoryMatches.docs.length > 0 ) {
          directorySnapshot = directoryMatches.docs[0]
        }
      }
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      void reportAbnormalError( {
        error: err,
        source: 'firestore',
        action: 'projects.lookupMember',
        projectId,
      } )
      setMemberErrors( ( prev ) => ( {
        ...prev,
        [projectId]: `Member lookup failed: ${message}`,
      } ) )
      return
    }
    if( !directorySnapshot.exists() ) {
      setMemberErrors( ( prev ) => ( {
        ...prev,
        [projectId]: 'No user found for that email address.',
      } ) )
      return
    }
    const directoryData = directorySnapshot.data()
    const memberUserId = ( directoryData.userId as string | undefined ) ?? ''
    const memberEmail = ( directoryData.email as string | undefined ) ?? memberEmailInput
    if( !memberUserId ) {
      setMemberErrors( ( prev ) => ( {
        ...prev,
        [projectId]: 'Member lookup returned an invalid user.',
      } ) )
      return
    }
    const currentMembers = membersByProject[projectId] ?? []
    if( currentMembers.some( ( member ) => member.userId === memberUserId ) ) {
      setMemberErrors( ( prev ) => ( {
        ...prev,
        [projectId]: 'That user is already a project member.',
      } ) )
      return
    }
    if( memberUserId === userId ) {
      setMemberErrors( ( prev ) => ( {
        ...prev,
        [projectId]: 'You are already the project leader.',
      } ) )
      return
    }
    setSuccessMessage( null )
    setMemberErrors( ( prev ) => ( { ...prev, [projectId]: null } ) )
    setMemberBusyProjectId( projectId )
    const previousMembers = membersByProject[projectId] ?? []
    const optimisticMember: ProjectMember = {
      projectId,
      userId: memberUserId,
      role: 'member',
      email: memberEmail,
    }
    setMembersByProject( ( prev ) => ( {
      ...prev,
      [projectId]: [ ...previousMembers, optimisticMember ],
    } ) )
    setUserDirectoryById( ( prev ) => ( {
      ...prev,
      [memberUserId]: {
        email: memberEmail,
        displayName: prev[memberUserId]?.displayName ?? null,
      },
    } ) )
    try {
      await setDoc(
        doc( db, 'projectMembers', `${projectId}_${memberUserId}` ),
        {
          projectId,
          userId: memberUserId,
          role: 'member',
          email: memberEmail,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
      setMemberEmails( ( prev ) => ( { ...prev, [projectId]: '' } ) )
      pendingSuccessFocusRef.current = { type: 'member', projectId }
      setSuccessMessage( 'Member added successfully.' )
      void ( async () => {
        try {
          await logAudit( {
            actorId: userId,
            actorEmail: userEmail,
            action: 'addProjectMember',
            entityType: 'projectMember',
            entityId: `${projectId}_${memberUserId}`,
            projectId,
            targetUserId: memberUserId,
            metadata: {
              role: 'member',
            },
          } )
        } catch( err ) {
          console.warn( 'Audit log failed (add member):', err )
        }
      } )()
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      void reportAbnormalError( {
        error: err,
        source: 'firestore',
        action: 'projects.addMember',
        projectId,
      } )
      setMemberErrors( ( prev ) => ( {
        ...prev,
        [projectId]: `Member add failed: ${message}`,
      } ) )
      setMembersByProject( ( prev ) => ( {
        ...prev,
        [projectId]: previousMembers,
      } ) )
    } finally {
      setMemberBusyProjectId( null )
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
            {leaderProjectOptions.length > 0 ? (
              <form
                className="form"
                onSubmit={( event ) => {
                  event.preventDefault()
                  if( selectedLeaderProjectId ) {
                    void handleAddMember( selectedLeaderProjectId )
                  }
                }}
              >
                <div className="actions actions--capture-row">
                  <label className="field">
                    <span>Project</span>
                    <select
                      value={selectedLeaderProjectId}
                      onChange={( event ) => setSelectedLeaderProjectId( event.target.value )}
                      disabled={isBusy}
                    >
                      {leaderProjectOptions.map( ( project ) => (
                        <option key={project.id} value={project.id}>
                          {`${project.shortId ?? 'Unassigned'} - ${project.name}`}
                        </option>
                      ) )}
                    </select>
                  </label>
                  <label className="field">
                    <span>Add member (email)</span>
                    <input
                      ref={( element ) => {
                        if( selectedLeaderProjectId ) {
                          memberInputRefs.current[selectedLeaderProjectId] = element
                        }
                      }}
                      type="text"
                      value={selectedLeaderProjectId ? ( memberEmails[selectedLeaderProjectId] ?? '' ) : ''}
                      onChange={( event ) => {
                        const targetProjectId = selectedLeaderProjectId
                        if( !targetProjectId ) {
                          return
                        }
                        setMemberEmails( ( prev ) => ( {
                          ...prev,
                          [targetProjectId]: event.target.value,
                        } ) )
                      }}
                      placeholder="user@example.com"
                      disabled={isBusy}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!selectedLeaderProjectId || memberBusyProjectId === selectedLeaderProjectId || isBusy}
                  >
                    Add member
                  </button>
                </div>
                {selectedLeaderProjectId && memberErrors[selectedLeaderProjectId] ? (
                  <p className="error">{memberErrors[selectedLeaderProjectId]}</p>
                ) : null}
              </form>
            ) : null}
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
                    <div className="project-members">
                      <p className="muted">Members</p>
                      <ul className="member-list">
                        {( membersByProject[project.id] ?? [] ).map( ( member ) => (
                          <li key={`${project.id}-${member.userId}`}>
                            <span>{formatUserLabel( member.userId, member.email ?? null )}</span>
                            <span className="muted">({member.role})</span>
                          </li>
                        ) )}
                      </ul>
                    </div>
                    {project.leaderId === userId ? (
                      <form
                        className="form"
                        onClick={( event ) => event.stopPropagation()}
                        onKeyDown={( event ) => event.stopPropagation()}
                        onSubmit={( event ) => {
                          event.preventDefault()
                          void handleAddMember( project.id )
                        }}
                      >
                        <label className="field">
                          <span>Add member (email)</span>
                          <input
                            ref={( element ) => {
                              memberInputRefs.current[project.id] = element
                            }}
                            type="text"
                            name={`member-${project.id}`}
                            value={memberEmails[project.id] ?? ''}
                            onChange={( event ) =>
                              setMemberEmails( ( prev ) => ( {
                                ...prev,
                                [project.id]: event.target.value,
                              } ) )
                            }
                            placeholder="user@example.com"
                            onClick={( event ) => event.stopPropagation()}
                            onKeyDown={( event ) => {
                              if( event.key === 'Enter' || event.key === ' ' ) {
                                event.stopPropagation()
                              }
                            }}
                          />
                        </label>
                        {memberErrors[project.id] ? (
                          <p className="error">{memberErrors[project.id]}</p>
                        ) : null}
                        <div className="actions">
                          <button
                            type="submit"
                            disabled={memberBusyProjectId === project.id || isBusy}
                            onClick={( event ) => event.stopPropagation()}
                            onKeyDown={( event ) => {
                              if( event.key === 'Enter' || event.key === ' ' ) {
                                event.stopPropagation()
                              }
                            }}
                          >
                            Add member
                          </button>
                        </div>
                      </form>
                    ) : null}
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
