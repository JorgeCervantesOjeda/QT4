import { Suspense, lazy, type ComponentType } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import ErrorMonitorBridge from './components/ErrorMonitorBridge'
import { GiphyProvider } from './giphy/GiphyProvider'
import { loadRouteWithChunkRetry } from './lib/routeChunkRetry'
import './App.css'

const lazyRoute = <TModule extends { default: ComponentType }>(loader: () => Promise<TModule>) =>
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
