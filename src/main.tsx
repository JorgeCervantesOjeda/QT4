import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { logClientDiagnostic } from './lib/diagnostics/clientDiagnostics'
import { getRouteDiagnosticContext } from './lib/diagnostics/routeContext'

logClientDiagnostic( 'app.loaded', getRouteDiagnosticContext() )

window.addEventListener( 'online', () => {
  logClientDiagnostic( 'browser.online', getRouteDiagnosticContext() )
} )

window.addEventListener( 'offline', () => {
  logClientDiagnostic( 'browser.offline', getRouteDiagnosticContext() )
} )

document.addEventListener( 'visibilitychange', () => {
  logClientDiagnostic( 'browser.visibilitychange', getRouteDiagnosticContext() )
} )

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
