import type { ReactElement } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

type RequireAuthProps = {
  children: ReactElement
}

function RequireAuth( { children }: RequireAuthProps ) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if( loading ) {
    return (
      <div className="app-shell">
        <main className="app-main">
          <section className="panel">
            <h2>Loading session</h2>
            <p className="muted">Checking credentials...</p>
          </section>
        </main>
      </div>
    )
  }

  if( !user ) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children
}

export { RequireAuth }
