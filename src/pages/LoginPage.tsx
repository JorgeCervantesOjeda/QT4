import { useMemo, useState, type FormEvent } from 'react'
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth'
import { Link, useLocation, useNavigate, type Location } from 'react-router-dom'
import AppBrand from '../components/AppBrand'
import ErrorChecklistModal from '../components/ErrorChecklistModal'
import { useErrorChecklistModal } from '../hooks/useErrorChecklistModal'
import { auth } from '../lib/firebase'

type LocationState = {
  from?: Location
}

function LoginPage() {
  const [email, setEmail] = useState( '' )
  const [password, setPassword] = useState( '' )
  const [isBusy, setIsBusy] = useState( false )
  const [resetNotice, setResetNotice] = useState<string | null>( null )
  const { error, errorChecklist, openError, clearError } = useErrorChecklistModal()

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
      await signInWithEmailAndPassword( auth, normalizedEmail, password )
      setPassword( '' )
      navigate( nextPath, { replace: true } )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
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
    if( !email.trim() ) {
      openError( 'Enter your email to request a password reset.', [
        { label: '(email is provided)', ok: false },
      ] )
      return
    }
    clearError()
    setResetNotice( null )
    setIsBusy( true )
    try {
      const targetEmail = email.trim()

      await sendPasswordResetEmail( auth, targetEmail )

      setResetNotice( `Password reset email sent to ${targetEmail}. Check your inbox.` )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      console.error( 'Password reset request failed:', err )
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
            <ErrorChecklistModal error={error} checklist={errorChecklist} onClose={clearError} />
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
