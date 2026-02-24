import { useState, type FormEvent } from 'react'
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { Link, useNavigate } from 'react-router-dom'
import AppBrand from '../components/AppBrand'
import ErrorChecklistModal from '../components/ErrorChecklistModal'
import { useErrorChecklistModal } from '../hooks/useErrorChecklistModal'
import { logAudit } from '../lib/audit'
import { auth, db } from '../lib/firebase'

function RegisterPage() {
  const [email, setEmail] = useState( '' )
  const [password, setPassword] = useState( '' )
  const [displayName, setDisplayName] = useState( '' )
  const [isBusy, setIsBusy] = useState( false )
  const { error, errorChecklist, openError, clearError } = useErrorChecklistModal()

  const navigate = useNavigate()

  const handleSubmit = async ( event: FormEvent<HTMLFormElement> ) => {
    event.preventDefault()
    clearError()
    setIsBusy( true )
    try {
      const result = await createUserWithEmailAndPassword( auth, email, password )
      if( displayName.trim() ) {
        await updateProfile( result.user, { displayName: displayName.trim() } )
      }
      const authEmail = ( result.user.email ?? email.trim() ).trim()
      const authEmailLower = authEmail.toLowerCase()
      await setDoc(
        doc( db, 'userProfiles', result.user.uid ),
        {
          email: result.user.email,
          displayName: displayName.trim() || null,
          isAdmin: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
      if( authEmail ) {
        await setDoc(
          doc( db, 'userDirectory', authEmail ),
          {
            userId: result.user.uid,
            email: authEmail,
            emailKey: authEmail,
            emailLower: authEmailLower,
            displayName: displayName.trim() || null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        )
      }
      await logAudit( {
        actorId: result.user.uid,
        actorEmail: result.user.email ?? null,
        action: 'registerUser',
        entityType: 'userProfile',
        entityId: result.user.uid,
        metadata: {
          email: authEmail,
        },
      } )
      setPassword( '' )
      navigate( '/app', { replace: true } )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      openError( message, [
        { label: '(email is provided)', ok: email.trim().length > 0 },
        { label: '(password length >= 6)', ok: password.length >= 6 },
        { label: '(email is not already in use)', ok: false },
      ] )
    } finally {
      setIsBusy( false )
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <AppBrand pageTitle="Register" />
        </div>
      </header>

      <main className="app-main">
        <form className="panel form" onSubmit={handleSubmit}>
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
            <span>Name visible</span>
            <input
              type="text"
              name="displayName"
              value={displayName}
              onChange={( event ) => setDisplayName( event.target.value )}
              autoComplete="name"
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
              autoComplete="new-password"
              minLength={6}
            />
          </label>

          {error ? (
            <ErrorChecklistModal error={error} checklist={errorChecklist} onClose={clearError} />
          ) : null}

          <div className="actions">
            <button type="submit" disabled={isBusy}>
              Create account
            </button>
            <Link className="link" to="/login">
              I already have an account
            </Link>
          </div>
        </form>
      </main>
    </div>
  )
}

export default RegisterPage
