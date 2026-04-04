import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { browserLocalPersistence, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword } from 'firebase/auth'
import { Link, useLocation, useNavigate, type Location } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import AppBrand from '../components/AppBrand'
import ErrorChecklistModal from '../components/ErrorChecklistModal'
import { useErrorChecklistModal } from '../hooks/useErrorChecklistModal'
import { reportAbnormalError } from '../lib/errorMonitor'
import { auth } from '../lib/firebase'

type LocationState = {
  from?: Location
}

const isLikelyEmail = (value: string) => /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test( value )

function LoginPage() {
  const [email, setEmail] = useState( '' )
  const [password, setPassword] = useState( '' )
  const [isBusy, setIsBusy] = useState( false )
  const [resetNotice, setResetNotice] = useState<string | null>( null )
  const { error, errorChecklist, openError, clearError } = useErrorChecklistModal()

  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null
  const inactivityNotice = useMemo( () => {
    const params = new URLSearchParams( location.search )
    return params.get( 'reason' ) === 'inactive'
      ? 'Session expired due to inactivity. Please log in again.'
      : null
  }, [ location.search ] )

  const nextPath = useMemo( () => {
    if( !state?.from ) {
      return '/app'
    }
    const pathname = state.from.pathname ?? ''
    const search = state.from.search ?? ''
    const hash = state.from.hash ?? ''
    return `${pathname}${search}${hash}` || '/app'
  }, [ state ] )

  useEffect( () => {
    if( loading || !user ) {
      return
    }
    navigate( nextPath, { replace: true } )
  }, [ loading, user, navigate, nextPath ] )

  const handleSubmit = async ( event: FormEvent<HTMLFormElement> ) => {
    event.preventDefault()
    const normalizedEmail = email.trim()
    if( !normalizedEmail ) {
      openError( 'Enter your email before logging in.', [
        { label: '(email is provided)', ok: false },
        { label: '(password is provided)', ok: password.trim().length > 0 },
      ] )
      return
    }
    clearError()
    setResetNotice( null )
    setIsBusy( true )
    try {
      await setPersistence( auth, browserLocalPersistence )
      await signInWithEmailAndPassword( auth, normalizedEmail, password )
      setPassword( '' )
      navigate( nextPath, { replace: true } )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      void reportAbnormalError( {
        error: err,
        source: 'auth',
        action: 'login.signIn',
      } )
      openError( message, [
        { label: '(email is provided)', ok: email.trim().length > 0 },
        { label: '(password is provided)', ok: password.trim().length > 0 },
        { label: '(credentials match an existing account)', ok: false },
      ] )
    } finally {
      setIsBusy( false )
    }
  }

  const handlePasswordReset = async () => {
    const targetEmail = email.trim()
    if( !targetEmail ) {
      openError( 'Enter your email to request a password reset.', [
        { label: '(email is provided)', ok: false },
      ] )
      return
    }
    if( !isLikelyEmail( targetEmail ) ) {
      openError( 'Enter a valid email address before requesting a password reset.', [
        { label: '(email is provided)', ok: true },
        { label: '(email format is valid)', ok: false },
      ] )
      return
    }
    clearError()
    setResetNotice( null )
    setIsBusy( true )
    try {
      await sendPasswordResetEmail( auth, targetEmail )

      setResetNotice( `Password reset email sent to ${targetEmail}. Check your inbox.` )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      console.error( 'Password reset request failed:', err )
      void reportAbnormalError( {
        error: err,
        source: 'auth',
        action: 'login.passwordReset',
      } )
      openError( message, [
        { label: '(email is provided)', ok: email.trim().length > 0 },
        { label: '(email belongs to a registered account)', ok: false },
      ] )
    } finally {
      setIsBusy( false )
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <AppBrand pageTitle="Log in" />
        </div>
      </header>

      <main className="app-main">
        <form className="panel form form--auth" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              required
              value={email}
              onChange={( event ) => setEmail( event.target.value )}
              autoComplete="email"
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              required
              value={password}
              onChange={( event ) => setPassword( event.target.value )}
              autoComplete="current-password"
              minLength={6}
            />
          </label>

          {error ? (
            <ErrorChecklistModal
              error={error}
              checklist={errorChecklist}
              onClose={clearError}
              reportContext={{
                pageLabel: 'Log in',
              }}
            />
          ) : null}
          {inactivityNotice ? <p className="notice-success">{inactivityNotice}</p> : null}
          {resetNotice ? <p className="notice-success">{resetNotice}</p> : null}

          <div className="actions">
            <button type="submit" disabled={isBusy}>
              Log in
            </button>
            <button type="button" className="ghost" onClick={() => void handlePasswordReset()} disabled={isBusy}>
              Reset password
            </button>
            <Link className="link" to="/register">
              Create account
            </Link>
          </div>
        </form>
      </main>
    </div>
  )
}

export default LoginPage
