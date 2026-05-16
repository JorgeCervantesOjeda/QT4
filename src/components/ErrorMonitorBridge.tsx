import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { installGlobalErrorMonitoring, setErrorMonitorContext } from '../lib/errorMonitor'
import { getRouteDiagnosticContext } from '../lib/diagnostics/routeContext'

function ErrorMonitorBridge() {
  const location = useLocation()
  const { user } = useAuth()

  useEffect( () => {
    installGlobalErrorMonitoring()
  }, [] )

  useEffect( () => {
    const routeContext = getRouteDiagnosticContext()

    setErrorMonitorContext( {
      route: routeContext.route,
      pageUrl: routeContext.pageUrl,
      projectId: routeContext.urlProjectId,
      docId: routeContext.urlDocumentId,
      versionId: routeContext.urlVersionId,
      threadId: routeContext.urlThreadId,
      focus: routeContext.urlFocus,
    } )
    }, [ location.pathname, location.search, location.hash ] )
  
  useEffect( () => {
    setErrorMonitorContext( {
      userId: user?.uid ?? '',
      userEmail: user?.email ?? '',
    } )
  }, [ user?.uid, user?.email ] )

  return null
}

export default ErrorMonitorBridge
