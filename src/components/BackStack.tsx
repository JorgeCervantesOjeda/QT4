import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../auth/useAuth'

type BackLink = {
  label: string
  to: string
}

type BackStackProps = {
  links: BackLink[]
  mode?: 'standard' | 'return-only'
}

function BackStack( { links, mode = 'standard' }: BackStackProps ) {
  const { signOutUser } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [isLoggingOut, setIsLoggingOut] = useState( false )
  const normalizedPath = location.pathname.replace( /\/+$/, '' ) || '/'
  const isDashboardRoute = normalizedPath === '/app' || normalizedPath === '/'

  const handleLogout = async () => {
    if( isLoggingOut ) {
      return
    }
    setIsLoggingOut( true )
    try {
      await signOutUser()
    } finally {
      setIsLoggingOut( false )
    }
  }

  if( mode === 'return-only' ) {
    return (
      <nav className="back-stack" aria-label="Back navigation">
        <button type="button" className="back-link back-link--button" onClick={() => navigate( -1 )}>
          Return
        </button>
      </nav>
    )
  }

  return (
    <nav className="back-stack" aria-label="Back navigation">
      <button
        type="button"
        className="back-link back-link--button"
        onClick={() => void handleLogout()}
        disabled={isLoggingOut}
      >
        {isLoggingOut ? 'Logging out...' : 'Log out'}
      </button>
      {!isDashboardRoute ? (
        <Link className="link back-link" to="/app">
          Dashboard
        </Link>
      ) : null}
      {links.map( ( link ) => (
        <Link key={link.to} className="link back-link" to={link.to}>
          {link.label}
        </Link>
      ) )}
    </nav>
  )
}

export default BackStack
