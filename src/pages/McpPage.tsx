// src/pages/McpPage.tsx: Shows QT4 MCP connection details and user pending MCP confirmations.
import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useAuth } from '../auth/useAuth'
import AppBrand from '../components/AppBrand'
import BackStack from '../components/BackStack'
import { db } from '../lib/firebase'

type McpPendingAction = {
  id: string
  kind: string
  summary: string
  status: string
  createdAt: Date | null
}

const toDate = (value: unknown): Date | null => {
  if( !value ) {
    return null
  }
  if( value instanceof Date ) {
    return value
  }
  if(
    typeof value === 'object'
    && value
    && 'toDate' in value
    && typeof ( value as { toDate?: () => Date } ).toDate === 'function'
  ) {
    return ( value as { toDate: () => Date } ).toDate()
  }
  return null
}

const formatActionTime = (value: Date | null): string => {
  if( !value ) {
    return 'Pending'
  }
  return value.toLocaleString()
}

function McpPage() {
  const { user } = useAuth()
  const [pendingActions, setPendingActions] = useState<McpPendingAction[]>( [] )
  const [isLoadingActions, setIsLoadingActions] = useState( true )
  const [actionError, setActionError] = useState<string | null>( null )
  const [activeActionId, setActiveActionId] = useState<string | null>( null )
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'generating' | 'ready'>( 'idle' )
  const [sessionToken, setSessionToken] = useState( '' )

  const mcpUrl = useMemo( () => {
    if( typeof window === 'undefined' ) {
      return '/mcp'
    }
    return `${window.location.origin}/mcp`
  }, [] )

  useEffect( () => {
    if( !user?.uid ) {
      setPendingActions( [] )
      setIsLoadingActions( false )
      return
    }
    setIsLoadingActions( true )
    const pendingQuery = query(
      collection( db, 'mcpPendingActions' ),
      where( 'userId', '==', user.uid ),
      where( 'status', '==', 'pending' ),
    )
    const unsubscribe = onSnapshot(
      pendingQuery,
      ( snapshot ) => {
        const nextActions = snapshot.docs
          .map( ( actionSnapshot ) => {
            const data = actionSnapshot.data()
            return {
              id: actionSnapshot.id,
              kind: String( data.kind ?? 'unknown' ),
              summary: String( data.summary ?? 'Pending MCP action' ),
              status: String( data.status ?? 'pending' ),
              createdAt: toDate( data.createdAt ),
            }
          } )
          .sort( ( left, right ) => ( right.createdAt?.getTime() ?? 0 ) - ( left.createdAt?.getTime() ?? 0 ) )
        setPendingActions( nextActions )
        setIsLoadingActions( false )
        setActionError( null )
      },
      ( err ) => {
        const message = err instanceof Error ? err.message : 'Unexpected error'
        setPendingActions( [] )
        setIsLoadingActions( false )
        setActionError( `Pending MCP actions failed to load: ${message}` )
      },
    )
    return () => {
      unsubscribe()
    }
  }, [ user?.uid ] )

  const generateSessionToken = async () => {
    if( !user ) {
      setActionError( 'Sign in before generating a MCP token.' )
      return
    }
    setTokenStatus( 'generating' )
    setActionError( null )
    try {
      const token = await user.getIdToken( true )
      setSessionToken( token )
      setTokenStatus( 'ready' )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setSessionToken( '' )
      setTokenStatus( 'idle' )
      setActionError( `MCP token generation failed: ${message}` )
    }
  }

  const updatePendingActionStatus = async (actionId: string, status: 'acknowledged' | 'dismissed') => {
    if( !user?.uid ) {
      setActionError( 'Sign in before updating a MCP action.' )
      return
    }
    setActiveActionId( actionId )
    setActionError( null )
    try {
      await updateDoc( doc( db, 'mcpPendingActions', actionId ), {
        status,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      } )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setActionError( `MCP action update failed: ${message}` )
    } finally {
      setActiveActionId( null )
    }
  }

  return (
    <div className="app-shell">
      <BackStack links={[]} />
      <header className="app-header">
        <AppBrand pageTitle="QT4 MCP" />
      </header>
      <main className="app-main">
        <section className="panel stack">
          <div className="panel-header">
            <h2>QT4 MCP</h2>
          </div>
          <p className="muted">Use this endpoint from a compatible chatbot that supports remote MCP servers with Bearer tokens.</p>
          <div className="mcp-connection-grid">
            <div className="mcp-code-card">
              <span className="mcp-code-card__label">Server URL</span>
              <code>{mcpUrl}</code>
            </div>
            <div className="mcp-code-card">
              <span className="mcp-code-card__label">Authorization header</span>
              <code>Authorization: Bearer &lt;QT4 session token&gt;</code>
            </div>
          </div>
          <div className="actions">
            <button
              type="button"
              onClick={generateSessionToken}
              disabled={tokenStatus === 'generating'}
            >
              {tokenStatus === 'generating' ? 'Generating token...' : 'Generate session token'}
            </button>
          </div>
          {sessionToken ? (
            <div className="mcp-token-panel">
              <p className="notice-warning">This token acts as your QT4 session for MCP clients. Do not share it outside the chatbot you trust.</p>
              <textarea readOnly value={sessionToken} aria-label="QT4 MCP session token" />
            </div>
          ) : null}
        </section>

        <section className="panel stack">
          <div className="panel-header">
            <h2>Pending MCP confirmations</h2>
          </div>
          {actionError ? <p className="error">{actionError}</p> : null}
          {isLoadingActions ? <p className="muted">Loading pending actions...</p> : null}
          {!isLoadingActions && pendingActions.length === 0 ? (
            <p className="muted">No pending MCP confirmations.</p>
          ) : null}
          {pendingActions.length > 0 ? (
            <div className="project-grid">
              {pendingActions.map( ( action ) => (
                <article className="project-card" key={action.id}>
                  <h3>{action.summary}</h3>
                  <p className="muted">Kind: {action.kind}</p>
                  <p className="muted">Created: {formatActionTime( action.createdAt )}</p>
                  <p className="notice-warning">This MVP records the request for review. Final execution stays in QT4.</p>
                  <div className="actions">
                    <button
                      type="button"
                      disabled={activeActionId === action.id}
                      onClick={() => updatePendingActionStatus( action.id, 'acknowledged' )}
                    >
                      {activeActionId === action.id ? 'Updating...' : 'Acknowledge'}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={activeActionId === action.id}
                      onClick={() => updatePendingActionStatus( action.id, 'dismissed' )}
                    >
                      Dismiss
                    </button>
                  </div>
                </article>
              ) )}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}

export default McpPage
