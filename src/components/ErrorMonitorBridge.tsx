import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { installGlobalErrorMonitoring, setErrorMonitorContext } from '../lib/errorMonitor'

function ErrorMonitorBridge() {
  const location = useLocation()
  const { user } = useAuth()

  useEffect( () => {
    installGlobalErrorMonitoring()
  }, [] )

  useEffect( () => {
    const route = `${location.pathname}${location.search}${location.hash}`
    setErrorMonitorContext( {
      route,
      pageUrl: window.location.href,
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
