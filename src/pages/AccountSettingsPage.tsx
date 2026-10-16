// src/pages/AccountSettingsPage.tsx: Lets signed-in users manage account notification preferences.
import { useEffect, useState } from 'react'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import AppBrand from '../components/AppBrand'
import BackStack from '../components/BackStack'
import { db } from '../lib/firebase'
import {
  buildNotificationPreferencesUpdate,
  resolveNotificationPreferences,
  type NotificationPreferences,
} from '../lib/notificationPreferences'

type SaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error'

function AccountSettingsPage() {
  const { user } = useAuth()
  const userId = user?.uid ?? ''
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    () => resolveNotificationPreferences( undefined ),
  )
  const [persistedPreferences, setPersistedPreferences] = useState<NotificationPreferences>(
    () => resolveNotificationPreferences( undefined ),
  )
  const [status, setStatus] = useState<SaveStatus>( 'loading' )
  const [errorMessage, setErrorMessage] = useState( '' )

  useEffect( () => {
    let isActive = true
    const loadPreferences = async () => {
      if( !userId ) {
        setStatus( 'error' )
        setErrorMessage( 'Sign in before editing account settings.' )
        return
      }
      setStatus( 'loading' )
      setErrorMessage( '' )
      try {
        const snapshot = await getDoc( doc( db, 'userProfiles', userId ) )
        if( !isActive ) {
          return
        }
        const nextPreferences = resolveNotificationPreferences(
          snapshot.data()?.notificationPreferences,
        )
        setPreferences( nextPreferences )
        setPersistedPreferences( nextPreferences )
        setStatus( 'idle' )
      } catch( err ) {
        if( !isActive ) {
          return
        }
        const message = err instanceof Error ? err.message : 'Unexpected error'
        setStatus( 'error' )
        setErrorMessage( `Notification preferences could not be loaded: ${message}` )
      }
    }
    void loadPreferences()
    return () => {
      isActive = false
    }
  }, [ userId ] )

  const savePreferences = async (nextPreferences: NotificationPreferences) => {
    if( !userId ) {
      setStatus( 'error' )
      setErrorMessage( 'Sign in before editing account settings.' )
      return
    }
    const previousPreferences = persistedPreferences
    setPreferences( nextPreferences )
    setStatus( 'saving' )
    setErrorMessage( '' )
    try {
      await updateDoc(
        doc( db, 'userProfiles', userId ),
        buildNotificationPreferencesUpdate( nextPreferences ),
      )
      setPersistedPreferences( nextPreferences )
      setStatus( 'saved' )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setPreferences( previousPreferences )
      setStatus( 'error' )
      setErrorMessage( `Notification preferences could not be saved: ${message}` )
    }
  }

  const updatePreference = (
    key: keyof NotificationPreferences,
    value: boolean,
  ) => {
    void savePreferences( {
      ...preferences,
      [key]: value,
    } )
  }

  const isLoading = status === 'loading'
  const isSaving = status === 'saving'

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <AppBrand pageTitle="Account Settings" />
        </div>
        <BackStack links={[ { label: 'Dashboard', to: '/app' } ]} />
      </header>

      <main className="app-main">
        <section className="panel account-settings-panel">
          <div className="panel-header">
            <h2>Notification preferences</h2>
          </div>
          <p className="muted">User: {user?.email ?? 'No email'}</p>
          <div className="stack">
            <label className="field field--checkbox">
              <input
                type="checkbox"
                checked={preferences.commentEmailEnabled}
                disabled={isLoading || isSaving}
                onChange={( event ) =>
                  updatePreference( 'commentEmailEnabled', event.target.checked )}
              />
              <span>Email me for each related comment</span>
            </label>
            <label className="field field--checkbox">
              <input
                type="checkbox"
                checked={preferences.hourlyActivityDigestEnabled}
                disabled={isLoading || isSaving}
                onChange={( event ) =>
                  updatePreference( 'hourlyActivityDigestEnabled', event.target.checked )}
              />
              <span>Email me an hourly activity summary</span>
            </label>
          </div>
          {isLoading ? <p className="muted">Loading notification preferences...</p> : null}
          {isSaving ? <p className="muted">Saving notification preferences...</p> : null}
          {status === 'saved' ? <p className="notice-success">Notification preferences saved.</p> : null}
          {errorMessage ? <p className="error">{errorMessage}</p> : null}
        </section>
        <section className="panel stack">
          <div className="panel-header">
            <div>
              <h2>Contributions</h2>
              <p className="muted">Review your project-scoped points, badges, and contribution history.</p>
            </div>
          </div>
          <Link className="link" to="/account/contributions">Open my contributions</Link>
        </section>
      </main>
    </div>
  )
}

export default AccountSettingsPage

