import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { useAuth } from '../auth/useAuth'
import { db } from '../lib/firebase'

const NOTEBOOKLM_HELP_URL = 'https://notebooklm.google.com/notebook/a602cd8e-4c62-4baa-b559-53ae95facaef'

type AppBrandProps = {
  pageTitle: string
}

function AppBrand( { pageTitle }: AppBrandProps ) {
  const { user } = useAuth()
  const [profileName, setProfileName] = useState<string>( '' )
  const displayName = user?.displayName ?? ''
  const sessionLabel = displayName || profileName

  useEffect( () => {
    let isActive = true
    const loadProfile = async () => {
      if( !user?.uid ) {
        setProfileName( '' )
        return
      }
      try {
        const snapshot = await getDoc( doc( db, 'userProfiles', user.uid ) )
        if( !isActive ) {
          return
        }
        const name = ( snapshot.data()?.displayName as string | undefined ) ?? ''
        setProfileName( name )
      } catch {
        if( isActive ) {
          setProfileName( '' )
        }
      }
    }
    void loadProfile()
    return () => {
      isActive = false
    }
  }, [ user?.uid ] )

  return (
    <div className="brand-block brand-banner">
      <div>
        <p className="app-eyebrow">Metropolitan Autonomous University</p>
        <h1>
          <a href="http://www.cua.uam.mx" target="_blank" rel="noreferrer" className="brand-title-link">
            QualiTeam <span className="brand-version">4.0</span>
          </a>
        </h1>
        <p className="brand-page-title">{pageTitle}</p>
        <div className="brand-support-row">
          <a
            href={NOTEBOOKLM_HELP_URL}
            target="_blank"
            rel="noreferrer"
            className="brand-session-button brand-help-button"
            aria-label="Open the QualiTeam help assistant"
          >
            Help
          </a>
          <p className="brand-support-copy">
            Ask questions about how to use QualiTeam.
          </p>
        </div>
        {sessionLabel ? (
          <div className="brand-session-row">
            <p className="brand-session">
              Signed in as {sessionLabel}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default AppBrand

