import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  QuerySnapshot,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import AppBrand from '../components/AppBrand'
import BackStack from '../components/BackStack'
import DataTable from '../components/DataTable'
import ErrorChecklistModal from '../components/ErrorChecklistModal'
import ModalDialog from '../components/ModalDialog'
import { GiphyInline } from '../giphy/GiphyProvider'
import { useErrorChecklistModal } from '../hooks/useErrorChecklistModal'
import { FIRST_VERSION_NUMBER, versionNumberToString } from '../domain/types'
import { logAudit } from '../lib/audit'
import { db } from '../lib/firebase'
import { formatTimeAgo } from '../lib/time'

type DocumentSummary = {
  id: string
  title: string
  createdBy: string
  type: string
  shortId: number | null
  baseDocId?: string | null
  latestVersionNumber: number | null
  latestStatus: string | null
  createdAt?: Date | null
  updatedAt?: Date | null
}

type ProjectSummary = {
  id: string
  name: string
  shortId: number | null
}

type DocumentFilter = 'all' | 'mine'

function ProjectDocumentsPage() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const userId = user?.uid ?? ''
  const navigate = useNavigate()

  const [project, setProject] = useState<ProjectSummary | null>( null )
  const [documents, setDocuments] = useState<DocumentSummary[]>([] )
  const [filter, setFilter] = useState<DocumentFilter>( 'all' )
  const [title, setTitle] = useState( '' )
  const [isBusy, setIsBusy] = useState( false )
  const [isLoadingDocuments, setIsLoadingDocuments] = useState( true )
  const { error, errorChecklist, openError, clearError } = useErrorChecklistModal()
  const [successMessage, setSuccessMessage] = useState<string | null>( null )
  const [viewMode, setViewMode] = useState<'card' | 'table'>( () => {
    const storedView = window.localStorage.getItem( 'qt4_documents_view' )
    return storedView === 'table' || storedView === 'card' ? storedView : 'card'
  } )
  const [sorting, setSorting] = useState<SortingState>( [ { id: 'shortId', desc: false } ] )
  const lastErrorRef = useRef<string | null>( null )
  const successOkButtonRef = useRef<HTMLButtonElement | null>( null )
  const titleInputRef = useRef<HTMLInputElement | null>( null )
  const shouldRestoreTitleFocusRef = useRef( false )
  const [userDirectoryById, setUserDirectoryById] = useState<Record<string, { email?: string | null; displayName?: string | null }>>( {} )

  const canSubmit = useMemo(
    () => title.trim().length > 0 && !isBusy && Boolean( projectId ) && Boolean( project ),
    [ title, isBusy, projectId, project ],
  )

  const formatUserLabel = useCallback( (memberUserId: string) => {
    const entry = userDirectoryById[memberUserId]
    const displayName = entry?.displayName ?? ''
    const email = entry?.email ?? ''
    if( displayName ) {
      return displayName
    }
    if( email ) {
      return email
    }
    return 'Unknown user'
  }, [ userDirectoryById ] )

  const documentTableRows = useMemo(
    () =>
      documents.map( ( documentItem ) => ( {
        ...documentItem,
        creatorLabel: formatUserLabel( documentItem.createdBy ),
        updatedAtMs: documentItem.updatedAt ? documentItem.updatedAt.getTime() : 0,
      } ) ),
    [ documents, formatUserLabel ],
  )

  const baseDocumentById = useMemo( () => {
    const map = new Map<string, DocumentSummary>()
    documents.forEach( ( docItem ) => {
      if( docItem.id ) {
        map.set( docItem.id, docItem )
      }
    } )
    return map
  }, [ documents ] )

  const documentColumns = useMemo<ColumnDef<DocumentSummary & { creatorLabel: string; updatedAtMs: number }>[]>(
    () => [
      {
        header: 'Short id',
        accessorKey: 'shortId',
        cell: ( info ) => String( info.getValue<number | null>() ?? 'Unassigned' ),
      },
      {
        header: 'Title',
        accessorKey: 'title',
        cell: ( info ) => {
          const row = info.row.original
          return row.type === 'errorReport' ? `Error report - ${row.title}` : row.title
        },
      },
      {
        header: 'For',
        accessorKey: 'baseDocId',
        cell: ( info ) => {
          const row = info.row.original
          if( row.type !== 'errorReport' ) {
            return '-'
          }
          if( row.baseDocId && baseDocumentById.has( row.baseDocId ) ) {
            const baseDoc = baseDocumentById.get( row.baseDocId )
            return (
              <span className="error-report-for">
                <span className="error-report-for__short">
                  {baseDoc?.shortId ?? 'Unassigned'}
                </span>
                <span className="error-report-for__full">
                  {`${baseDoc?.shortId ?? 'Unassigned'} - ${baseDoc?.title ?? 'Unknown'}`}
                </span>
              </span>
            )
          }
          if( row.baseDocId ) {
            return (
              <span className="error-report-for">
                <span className="error-report-for__short">Unknown</span>
                <span className="error-report-for__full">{`Document ${row.baseDocId}`}</span>
              </span>
            )
          }
          return 'Unknown'
        },
      },
      {
        header: 'Status',
        accessorKey: 'latestStatus',
        cell: ( info ) => String( info.getValue<string | null>() ?? 'In Creation' ),
      },
      {
        header: 'Creator',
        accessorKey: 'creatorLabel',
      },
      {
        header: 'Updated',
        accessorKey: 'updatedAtMs',
        cell: ( info ) => formatTimeAgo( info.row.original.updatedAt ),
      },
    ],
    [ baseDocumentById ],
  )

  const sortedDocumentCards = useMemo( () => {
    if( sorting.length === 0 ) {
      return documentTableRows
    }
    const { id, desc } = sorting[0]
    const sorted = [ ...documentTableRows ].sort( ( a, b ) => {
      const aValue = ( a as Record<string, unknown> )[id]
      const bValue = ( b as Record<string, unknown> )[id]
      if( typeof aValue === 'number' && typeof bValue === 'number' ) {
        return aValue - bValue
      }
      return String( aValue ?? '' ).localeCompare( String( bValue ?? '' ) )
    } )
    return desc ? sorted.reverse() : sorted
  }, [ documentTableRows, sorting ] )

  useEffect( () => {
    const storedSorting = window.localStorage.getItem( 'qt4_documents_sorting' )
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
    const storedFilter = window.localStorage.getItem( 'qt4_documents_filter' )
    if( storedFilter === 'all' || storedFilter === 'mine' ) {
      setFilter( storedFilter )
    }
  }, [] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_documents_view', viewMode )
  }, [ viewMode ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_documents_sorting', JSON.stringify( sorting ) )
  }, [ sorting ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_documents_filter', filter )
  }, [ filter ] )

  const statusClassName = (status?: string | null) => {
    switch( status ) {
      case 'In Creation':
        return 'status-card--in-creation'
      case 'In Review':
        return 'status-card--in-review'
      case 'Reviewed':
        return 'status-card--reviewed'
      case 'Accepted':
        return 'status-card--accepted'
      case 'Rejected':
        return 'status-card--rejected'
      case 'Replaced':
        return 'status-card--replaced'
      default:
        return ''
    }
  }

  const loadProject = useCallback( async () => {
    if( !projectId ) {
      setProject( null )
      return
    }
    try {
      const projectSnapshot = await getDoc( doc( db, 'projects', projectId ) )
      if( !projectSnapshot.exists() ) {
        setProject( null )
        return
      }
      const data = projectSnapshot.data()
      setProject( {
        id: projectSnapshot.id,
        name: ( data.name as string ) ?? 'Untitled project',
        shortId: Number.isFinite( data.shortId ) ? Number( data.shortId ) : null,
      } )
    } catch {
      setProject( null )
    }
  }, [ projectId ] )

  const loadDocuments = useCallback( async (snapshot: QuerySnapshot) => {
    if( !projectId ) {
      return
    }
    clearError()
    setIsLoadingDocuments( true )
    let step = 'start'
    try {

      step = 'documents'

      const baseDocuments = snapshot.docs.map( ( docSnapshot ) => {
        const data = docSnapshot.data()
        const createdAt = data.createdAt?.toDate?.() ?? null
        const updatedAt = data.updatedAt?.toDate?.() ?? null
        return {
          id: docSnapshot.id,
          title: ( data.title as string ) ?? '',
          createdBy: ( data.createdBy as string ) ?? ( data.authorId as string ) ?? '',
          type: ( data.type as string | undefined ) ?? 'document',
          shortId: Number.isFinite( data.shortId ) ? Number( data.shortId ) : null,
          baseDocId: ( data.baseDocId as string | undefined ) ?? null,
          latestVersionNumber: null,
          latestStatus: null,
          createdAt,
          updatedAt,
        }
      } )

      step = 'latest-versions'
      const latestVersions = await Promise.all(
        baseDocuments.map( async ( documentItem ) => {
          try {
            const versionQuery = query(
              collection( db, 'versions' ),
              where( 'projectId', '==', projectId ),
              where( 'docId', '==', documentItem.id ),
              orderBy( 'number', 'desc' ),
              limit( 1 ),
            )
            const versionSnapshot = await getDocs( versionQuery )
            const versionData = versionSnapshot.docs[0]?.data()
            if( !versionData ) {
              return { documentItem, isMine: documentItem.createdBy === userId }
            }
            const createdBy = ( versionData.createdBy as string | undefined ) ?? ''
            const reviewerIds = ( versionData.reviewerIds as string[] | undefined ) ?? []
            const isMine = createdBy === userId || reviewerIds.includes( userId )
            const latestVersionNumber = Number( versionData.number ?? 0 )
            const latestStatus = ( versionData.status as string | undefined ) ?? 'In Creation'
            return {
              documentItem: {
                ...documentItem,
                latestVersionNumber,
                latestStatus,
              },
              isMine,
            }
          } catch( err ) {
            console.warn( 'ProjectDocuments latest version read failed', {
              documentId: documentItem.id,
              error: err,
            } )
            return { documentItem, isMine: documentItem.createdBy === userId }
          }
        } ),
      )
      if( filter === 'mine' && userId ) {
        const filtered = latestVersions
          .filter( ( entry ) => entry.isMine )
          .map( ( entry ) => entry.documentItem )
        setDocuments( filtered )
      } else if( filter === 'mine' && !userId ) {
        setDocuments( [] )
      } else {
        setDocuments( latestVersions.map( ( entry ) => entry.documentItem ) )
      }

      step = 'user-directory'
      const creatorIds = Array.from(
        new Set( baseDocuments.map( ( docItem ) => docItem.createdBy ).filter( Boolean ) ),
      )
      const chunks: string[][] = []
      for( let index = 0; index < creatorIds.length; index += 10 ) {
        chunks.push( creatorIds.slice( index, index + 10 ) )
      }
      const directorySnapshots = await Promise.all(
        chunks.map( ( chunk ) =>
          getDocs( query( collection( db, 'userDirectory' ), where( 'userId', 'in', chunk ) ) ),
        ),
      )
      const nextDirectoryById: Record<string, { email?: string | null; displayName?: string | null }> = {}
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
        nextDirectoryById[userId] = {
          email: user?.email ?? null,
          displayName: user?.displayName ?? null,
        }
      }
      const missingProfileIds = creatorIds.filter(
        ( creatorId ) => creatorId && !nextDirectoryById[creatorId]?.displayName,
      )
      if( missingProfileIds.length > 0 ) {
        await Promise.all(
          missingProfileIds.map( async ( creatorId: string ) => {
            try {
              const profileSnapshot = await getDoc( doc( db, 'userProfiles', creatorId ) )
              const profileName = ( profileSnapshot.data()?.displayName as string | undefined ) ?? ''
              if( profileName ) {
                nextDirectoryById[creatorId] = {
                  ...nextDirectoryById[creatorId],
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
      console.error( `ProjectDocuments loadDocuments failed at ${step}:`, err )
      openError( `Project documents failed at ${step}: ${message}`, [
        { label: '(project is selected)', ok: Boolean( projectId ) },
        { label: '(network connection is available)', ok: typeof navigator !== 'undefined' ? navigator.onLine : true },
      ] )
    } finally {
      setIsLoadingDocuments( false )
    }
  }, [ projectId, clearError, userId, filter, user?.email, user?.displayName, openError ] )

  useEffect( () => {
    void loadProject()
  }, [ loadProject ] )

  useEffect( () => {
    if( !projectId ) {
      return
    }
    setIsLoadingDocuments( true )
    const documentsQuery = query( collection( db, 'documents' ), where( 'projectId', '==', projectId ) )
    const unsubscribe = onSnapshot(
      documentsQuery,
      ( snapshot ) => {
        void loadDocuments( snapshot )
      },
      ( err ) => {
        const message = err instanceof Error ? err.message : 'Unexpected error'
        openError( `Project documents failed to load: ${message}`, [
          { label: '(project is selected)', ok: Boolean( projectId ) },
          { label: '(network connection is available)', ok: typeof navigator !== 'undefined' ? navigator.onLine : true },
        ] )
        setIsLoadingDocuments( false )
      },
    )
    return () => {
      unsubscribe()
    }
  }, [ projectId, loadDocuments, openError ] )

  useEffect( () => {
    if( error ) {
      if( lastErrorRef.current !== error ) {
        console.error( 'ProjectDocuments error modal:', error )
        lastErrorRef.current = error
      }
    }
  }, [ error ] )

  useEffect( () => {
    if( successMessage && successOkButtonRef.current ) {
      successOkButtonRef.current.focus()
    }
  }, [ successMessage ] )

  const handleCloseSuccessMessage = () => {
    const shouldRestoreFocus = shouldRestoreTitleFocusRef.current
    setSuccessMessage( null )
    if( shouldRestoreFocus ) {
      window.setTimeout( () => {
        titleInputRef.current?.focus()
      }, 0 )
    }
    shouldRestoreTitleFocusRef.current = false
  }

  const handleCreateDocument = async ( event: React.FormEvent<HTMLFormElement> ) => {
    event.preventDefault()
    if( !projectId || !project || !userId ) {
      openError( 'Sign in and select an existing project before creating documents.', [
        { label: '(project is selected)', ok: Boolean( projectId ) },
        { label: '(project exists)', ok: Boolean( project ) },
        { label: '(user is signed in)', ok: Boolean( userId ) },
      ] )
      return
    }
    if( title.trim().length === 0 ) {
      openError( 'Document title cannot be empty.', [
        { label: '(project is selected)', ok: Boolean( projectId ) },
        { label: '(user is signed in)', ok: Boolean( userId ) },
        { label: '(document title is provided)', ok: false },
      ] )
      return
    }
    clearError()
    setSuccessMessage( null )
    setIsBusy( true )
    try {
      const counterRef = doc( db, 'counters', `documents_${projectId}` )
      const documentRef = doc( collection( db, 'documents' ) )
      const versionRef = doc( collection( db, 'versions' ) )
      const versionCounterRef = doc( db, 'counters', `versions_${documentRef.id}` )
      await runTransaction( db, async ( transaction ) => {
        const counterSnap = await transaction.get( counterRef )
        const nextNumberRaw = counterSnap.data()?.nextNumber
        const nextNumber = typeof nextNumberRaw === 'number' ? nextNumberRaw : 1
        transaction.set(
          counterRef,
          {
            nextNumber: nextNumber + 1,
            projectId,
          },
          { merge: true },
        )
        transaction.set( documentRef, {
          projectId,
          title: title.trim(),
          createdBy: userId,
          updatedBy: userId,
          shortId: nextNumber,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } )
        transaction.set( versionRef, {
          projectId,
          docId: documentRef.id,
          number: FIRST_VERSION_NUMBER,
          status: 'In Creation',
          createdBy: userId,
          reviewerIds: [],
          reviewStartAt: null,
          reviewEndAt: null,
          hasFile: false,
          fileRefId: null,
          stats: {
            numThreads: 0,
            numOpenThreads: 0,
            numComments: 0,
            numThreadsWithTwoPlusComments: 0,
          },
          numThreads: 0,
          numOpenThreads: 0,
          numComments: 0,
          numThreadsWithTwoPlusComments: 0,
          acceptedErrorReportId: null,
          previousVersionId: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        } )
        transaction.set(
          versionCounterRef,
          {
            nextNumber: FIRST_VERSION_NUMBER + 1,
            docId: documentRef.id,
            projectId,
            previousVersionId: null,
          },
          { merge: true },
        )
      } )
      setTitle( '' )
      shouldRestoreTitleFocusRef.current = true
      setSuccessMessage( 'Document created successfully.' )
      void ( async () => {
        try {
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'createDocument',
            entityType: 'document',
            entityId: documentRef.id,
            projectId,
            docId: documentRef.id,
            versionId: versionRef.id,
          } )
          await logAudit( {
            actorId: userId,
            actorEmail: user?.email ?? null,
            action: 'taskAppear',
            entityType: 'task',
            entityId: `authoring:${versionRef.id}:${userId}`,
            projectId,
            docId: documentRef.id,
            versionId: versionRef.id,
            targetUserId: userId,
            metadata: {
              taskType: 'authoring',
              taskKey: `authoring:${versionRef.id}:${userId}`,
            },
          } )
        } catch( err ) {
          console.warn( 'Audit log failed (create document):', err )
        }
      } )()
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      openError( message, [
        { label: '(project is selected)', ok: Boolean( projectId ) },
        { label: '(user is signed in)', ok: Boolean( userId ) },
        { label: '(document title is provided)', ok: title.trim().length > 0 },
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
          <AppBrand pageTitle="Project Documents" />
          <Link className="context-nav-button" to="/projects">
            <span className="document-title-prefix">Project</span>
            <span className="document-title-text">
              {project ? `${project.shortId ?? 'Unassigned'} - ${project.name}` : 'Unknown project'}
            </span>
          </Link>
        </div>
        <BackStack links={[ { label: 'Projects', to: '/projects' } ]} />
      </header>

      <main className="app-main">
        <section className="panel stack">
          {!isBusy ? <h2>Create document</h2> : null}
          <form className="form" onSubmit={handleCreateDocument}>
            <label className="field">
              <span>Title</span>
              <input
                ref={titleInputRef}
                type="text"
                name="title"
                required
                value={title}
                onChange={( event ) => setTitle( event.target.value )}
              />
            </label>
            <div className="actions">
              <button type="submit" disabled={!canSubmit}>
                Create document
              </button>
            </div>
          </form>
        </section>

        {isLoadingDocuments && documents.length === 0 ? (
          <section className="panel">
            <GiphyInline reason="loading" />
          </section>
        ) : (
          <section className="panel stack">
            <div className="panel-header">
              <h2>Documents</h2>
              <div className="actions">
                <label className="field">
                  <span>Filter</span>
                  <div className="view-toggle">
                    <button
                      type="button"
                      aria-pressed={filter === 'all'}
                      onClick={() => setFilter( 'all' )}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      aria-pressed={filter === 'mine'}
                      onClick={() => setFilter( 'mine' )}
                    >
                      Mine
                    </button>
                  </div>
                </label>
              </div>
            </div>
            {error ? (
              <ErrorChecklistModal error={error} checklist={errorChecklist} onClose={clearError} />
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
            {!isLoadingDocuments && documentTableRows.length === 0 ? (
              <p className="muted">No documents yet for this project.</p>
            ) : viewMode === 'table' ? (
              <DataTable
                key={`qt4_table_documents_${projectId ?? 'unknown'}`}
                columns={documentColumns}
                data={documentTableRows}
                sorting={sorting}
                onSortingChange={setSorting}
                tableClassName="data-table--documents"
                storageKey={`qt4_table_documents_${projectId ?? 'unknown'}`}
                getRowClassName={( row ) => statusClassName( row.latestStatus )}
                onRowClick={( row ) => {
                  if( projectId ) {
                    navigate( `/documents/${row.id}/versions?projectId=${projectId}` )
                  }
                }}
              />
            ) : (
              <div className="project-grid">
                {sortedDocumentCards.map( ( documentItem ) => (
                  <article
                    key={documentItem.id}
                    className={`project-card ${statusClassName( documentItem.latestStatus )}`}
                    onClick={() => {
                      if( projectId ) {
                        navigate( `/documents/${documentItem.id}/versions?projectId=${projectId}` )
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={( event ) => {
                      if( event.key === 'Enter' || event.key === ' ' ) {
                        event.preventDefault()
                        if( projectId ) {
                          navigate( `/documents/${documentItem.id}/versions?projectId=${projectId}` )
                        }
                      }
                    }}
                  >
                    <h3>
                    {documentItem.type === 'errorReport'
                      ? `Error report - ${documentItem.shortId ?? 'Unassigned'} - ${documentItem.title}`
                      : `${documentItem.shortId ?? 'Unassigned'} - ${documentItem.title}`}
                    </h3>
                    {documentItem.type === 'errorReport' ? (
                      <p className="muted">
                        For document:{' '}
                        {documentItem.baseDocId && baseDocumentById.has( documentItem.baseDocId )
                          ? `${baseDocumentById.get( documentItem.baseDocId )?.shortId ?? 'Unassigned'} - ${
                              baseDocumentById.get( documentItem.baseDocId )?.title ?? 'Unknown'
                            }`
                          : 'Unknown'}
                      </p>
                    ) : null}
                    <p className="muted">
                      {documentItem.latestVersionNumber
                        ? `Version ${versionNumberToString( documentItem.latestVersionNumber )} - ${
                            documentItem.latestStatus ?? 'In Creation'
                          }`
                        : 'No versions yet'}
                    </p>
                    <p className="muted">Creator: {formatUserLabel( documentItem.createdBy )}</p>
                    <p className="muted">Created: {formatTimeAgo( documentItem.createdAt )}</p>
                    <p className="muted">Updated: {formatTimeAgo( documentItem.updatedAt )}</p>
                    <div className="actions">
                      <span className="muted">Open versions</span>
                    </div>
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

export default ProjectDocumentsPage
