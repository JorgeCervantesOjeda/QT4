import { Suspense, lazy, type ComponentType } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import ErrorMonitorBridge from './components/ErrorMonitorBridge'
import { GiphyProvider } from './giphy/GiphyProvider'
import './App.css'

type RouteModule = {
  default: ComponentType
}

type RouteReloadOptions = {
  route?: string
  buildId?: string
  storage?: Storage
  reload?: () => void
}

const CHUNK_RELOAD_STORAGE_PREFIX = 'qt4:chunk-reload'
const CHUNK_LOAD_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module',
  'loading chunk',
  'chunkloaderror',
  'importing a module script failed',
]

const getErrorMessage = (error: unknown): string => {
  if( error instanceof Error ) {
    return error.message
  }
  if( error && typeof error === 'object' && 'message' in error ) {
    return String( ( error as { message?: unknown } ).message ?? '' )
  }
  return String( error ?? '' )
}

const isChunkLoadError = (error: unknown): boolean => {
  const message = getErrorMessage( error ).toLowerCase()
  return CHUNK_LOAD_ERROR_PATTERNS.some( ( pattern ) => message.includes( pattern ) )
}

const getRouteReloadKey = (route: string, buildId: string): string =>
  `${CHUNK_RELOAD_STORAGE_PREFIX}:${buildId}:${route}`

export const loadRouteWithChunkRetry = async <TModule extends RouteModule>(
  loader: () => Promise<TModule>,
  options: RouteReloadOptions = {},
): Promise<TModule> => {
  try {
    return await loader()
  } catch( error ) {
    if( typeof window === 'undefined' || !isChunkLoadError( error ) ) {
      throw error
    }

    const route = options.route ?? `${window.location.pathname}${window.location.search}${window.location.hash}`
    const buildId = options.buildId ?? ( import.meta.env.VITE_APP_BUILD ?? import.meta.env.MODE )
    const storage = options.storage ?? window.sessionStorage
    const reloadKey = getRouteReloadKey( route, buildId )

    if( storage.getItem( reloadKey ) === '1' ) {
      throw error
    }

    storage.setItem( reloadKey, '1' )
    const reload = options.reload ?? window.location.reload.bind( window.location )
    reload()
    return new Promise<TModule>( () => undefined )
  }
}

const lazyRoute = <TModule extends RouteModule>(loader: () => Promise<TModule>) =>
  lazy( () => loadRouteWithChunkRetry( loader ) )

const DashboardPage = lazyRoute( () => import( './pages/DashboardPage' ) )
const LoginPage = lazyRoute( () => import( './pages/LoginPage' ) )
const ProjectDocumentsPage = lazyRoute( () => import( './pages/ProjectDocumentsPage' ) )
const ProjectsPage = lazyRoute( () => import( './pages/ProjectsPage' ) )
const RegisterPage = lazyRoute( () => import( './pages/RegisterPage' ) )
const VersionsPage = lazyRoute( () => import( './pages/VersionsPage' ) )
const AdminAuditPage = lazyRoute( () => import( './pages/AdminAuditPage' ) )

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorMonitorBridge />
        <GiphyProvider>
          <Suspense fallback={<div className="app-shell"><main className="app-main"><section className="panel"><p className="muted">Loading page...</p></section></main></div>}>
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
        </GiphyProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
