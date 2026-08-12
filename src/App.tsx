import { Component, Suspense, lazy, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import ErrorMonitorBridge from './components/ErrorMonitorBridge'
import { GiphyProvider } from './giphy/GiphyProvider'
import './App.css'

const DashboardPage = lazy( () => import( './pages/DashboardPage' ) )
const LoginPage = lazy( () => import( './pages/LoginPage' ) )
const ProjectDocumentsPage = lazy( () => import( './pages/ProjectDocumentsPage' ) )
const ProjectsPage = lazy( () => import( './pages/ProjectsPage' ) )
const RegisterPage = lazy( () => import( './pages/RegisterPage' ) )
const VersionsPage = lazy( () => import( './pages/VersionsPage' ) )
const AdminAuditPage = lazy( () => import( './pages/AdminAuditPage' ) )

const CHUNK_RECOVERY_KEY_PREFIX = 'qt4_chunk_recovery_'
const CHUNK_LOAD_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk \d+ failed/i,
]

const appFallback = (message: string, action?: ReactNode) => (
  <div className="app-shell">
    <main className="app-main">
      <section className="panel">
        <p className="muted">{message}</p>
        {action}
      </section>
    </main>
  </div>
)

const getChunkErrorMessage = (value: unknown): string => {
  if( typeof value === 'string' ) {
    return value
  }
  if( value instanceof Error ) {
    return `${value.name}: ${value.message}`
  }
  if( value && typeof value === 'object' && 'message' in value ) {
    return String( ( value as { message?: unknown } ).message ?? '' )
  }
  return ''
}

const isChunkLoadError = (value: unknown): boolean => {
  const message = getChunkErrorMessage( value )
  return CHUNK_LOAD_ERROR_PATTERNS.some( ( pattern ) => pattern.test( message ) )
}

const hashChunkMessage = (message: string): string => {
  let hash = 5381
  for( let index = 0; index < message.length; index += 1 ) {
    hash = ( ( hash << 5 ) + hash ) ^ message.charCodeAt( index )
  }
  return ( hash >>> 0 ).toString( 16 )
}

const scheduleChunkRecoveryReload = (error: unknown): boolean => {
  if( typeof window === 'undefined' ) {
    return false
  }
  const message = getChunkErrorMessage( error )
  const recoveryKey = `${CHUNK_RECOVERY_KEY_PREFIX}${hashChunkMessage( message )}`
  if( window.sessionStorage.getItem( recoveryKey ) ) {
    return false
  }
  window.sessionStorage.setItem( recoveryKey, '1' )
  window.requestAnimationFrame( () => {
    window.location.reload()
  } )
  return true
}

type ChunkLoadRecoveryBoundaryProps = {
  children: ReactNode
}

type ChunkLoadRecoveryBoundaryState = {
  hasError: boolean
  isRecovering: boolean
}

class ChunkLoadRecoveryBoundary extends Component<
  ChunkLoadRecoveryBoundaryProps,
  ChunkLoadRecoveryBoundaryState
> {
  state: ChunkLoadRecoveryBoundaryState = {
    hasError: false,
    isRecovering: false,
  }

  static getDerivedStateFromError(error: unknown): ChunkLoadRecoveryBoundaryState {
    return {
      hasError: true,
      isRecovering: isChunkLoadError( error ),
    }
  }

  componentDidCatch(error: unknown) {
    if( isChunkLoadError( error ) ) {
      const isRecovering = scheduleChunkRecoveryReload( error )
      this.setState( { isRecovering } )
    }
  }

  render() {
    if( !this.state.hasError ) {
      return this.props.children
    }
    if( this.state.isRecovering ) {
      return appFallback( 'Refreshing the app...' )
    }
    return appFallback(
      'The app could not load this page.',
      <button type="button" onClick={() => window.location.reload()}>
        Reload
      </button>,
    )
  }
}

function ChunkPreloadRecovery() {
  useEffect( () => {
    const handlePreloadError = (event: Event) => {
      const error = ( event as Event & { payload?: unknown } ).payload
      if( isChunkLoadError( error ) && scheduleChunkRecoveryReload( error ) ) {
        event.preventDefault()
      }
    }
    window.addEventListener( 'vite:preloadError', handlePreloadError )
    return () => {
      window.removeEventListener( 'vite:preloadError', handlePreloadError )
    }
  }, [] )

  return null
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorMonitorBridge />
        <GiphyProvider>
          <ChunkPreloadRecovery />
          <ChunkLoadRecoveryBoundary>
            <Suspense fallback={appFallback( 'Loading page...' )}>
              <Routes>
                <Route path="/" element={<Navigate to="/app" replace />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route
                  path="/app"
                  element={
                    <RequireAuth>
                      <DashboardPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/projects"
                  element={
                    <RequireAuth>
                      <ProjectsPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/projects/:projectId/documents"
                  element={
                    <RequireAuth>
                      <ProjectDocumentsPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/documents/:docId/versions"
                  element={
                    <RequireAuth>
                      <VersionsPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/admin/audit"
                  element={
                    <RequireAuth>
                      <AdminAuditPage />
                    </RequireAuth>
                  }
                />
                <Route path="*" element={<Navigate to="/login" replace />} />
              </Routes>
            </Suspense>
          </ChunkLoadRecoveryBoundary>
        </GiphyProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
