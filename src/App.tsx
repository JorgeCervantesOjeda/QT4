import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import ProjectDocumentsPage from './pages/ProjectDocumentsPage'
import ProjectsPage from './pages/ProjectsPage'
import RegisterPage from './pages/RegisterPage'
import VersionsPage from './pages/VersionsPage'
import AdminAuditPage from './pages/AdminAuditPage'
import { GiphyProvider } from './giphy/GiphyProvider'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <GiphyProvider>
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
        </GiphyProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
