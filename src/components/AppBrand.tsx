// src/components/AppBrand.tsx: Renders the app banner, help entrypoint, session label, and About dialog trigger.
import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { useAuth } from '../auth/useAuth'
import { db } from '../lib/firebase'
import { APP_METADATA } from '../lib/appMetadata'
import AboutDialog from './AboutDialog'

type AppBrandProps = {
  pageTitle: string
}

function AppBrand( { pageTitle }: AppBrandProps ) {
  const { user } = useAuth()
  const [profileName, setProfileName] = useState<string>( '' )
  const [isAboutOpen, setIsAboutOpen] = useState( false )
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
    <>
      <div className="brand-block brand-banner">
        <div className="brand-banner__content">
          <p className="app-eyebrow">{APP_METADATA.institutionName}</p>
          <h1>
            <a
              href={APP_METADATA.institutionSiteUrl}
              target="_blank"
              rel="noreferrer"
              className="brand-title-link"
            >
              {APP_METADATA.productName} <span className="brand-version">{APP_METADATA.marketingVersion}</span>
            </a>
          </h1>
          <p className="brand-page-title">{pageTitle}</p>
          <div className="brand-support-row">
            <a
              href={APP_METADATA.helpAssistantUrl}
              target="_blank"
              rel="noreferrer"
              className="brand-session-button brand-help-button"
              aria-label="Open the QualiTeam help assistant"
            >
              Help
            </a>
            <button
              type="button"
              className="brand-session-button brand-help-button"
              aria-haspopup="dialog"
              onClick={() => setIsAboutOpen( true )}
            >
              About
            </button>
            <p className="brand-support-copy">
              {APP_METADATA.supportCopy}
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
        <div className="brand-banner__logo" aria-hidden="true">
          <img src="/uam-logo.jpg" alt="" />
        </div>
      </div>
      {isAboutOpen ? <AboutDialog onClose={() => setIsAboutOpen( false )} /> : null}
    </>
  )
}

export default AppBrand
