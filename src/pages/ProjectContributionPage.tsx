// src/pages/ProjectContributionPage.tsx: Shows the contribution ranking for one project only.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import AppBrand from '../components/AppBrand'
import BackStack from '../components/BackStack'
import ContributionStatus from '../components/reputation/ContributionStatus'
import ProjectLeaderboard from '../components/reputation/ProjectLeaderboard'
import { useAuth } from '../auth/useAuth'
import { formatProjectDisplayLabel, resolveProjectReference, type ProjectDisplayInfo } from '../lib/projectDisplay'
import { loadProjectReputation } from '../lib/reputationData'
import { loadUserDisplayDirectory, resolveUserDisplayLabel, type UserDisplayInfo } from '../lib/userDisplay'
import type { ReputationSummary } from '../lib/reputation'

function ProjectContributionPage() {
  const { user } = useAuth()
  const { projectId: projectReference } = useParams<{ projectId: string }>()
  const [resolvedProjectId, setResolvedProjectId] = useState( '' )
  const [summaries, setSummaries] = useState<ReputationSummary[]>( [] )
  const [projectDisplayInfo, setProjectDisplayInfo] = useState<Record<string, ProjectDisplayInfo>>( {} )
  const [userDisplayDirectory, setUserDisplayDirectory] = useState<Record<string, UserDisplayInfo>>( {} )
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>( projectReference ? 'loading' : 'error' )
  const [errorMessage, setErrorMessage] = useState( projectReference ? '' : 'A project is required to view its contribution ranking.' )

  useEffect( () => {
    let active = true
    if( !projectReference ) {
      return () => {
        active = false
      }
    }
    void resolveProjectReference( projectReference ).then( async (resolvedProject) => {
      if( !resolvedProject ) {
        throw new Error( 'Project could not be found.' )
      }
      const nextSummaries = await loadProjectReputation( resolvedProject.projectId )
      const nextUserDisplayDirectory = await loadUserDisplayDirectory( nextSummaries.map( (summary) => summary.userId ) )
      if( !active ) return
      setSummaries( nextSummaries )
      setUserDisplayDirectory( nextUserDisplayDirectory )
      setResolvedProjectId( resolvedProject.projectId )
      setProjectDisplayInfo( { [resolvedProject.projectId]: resolvedProject.displayInfo } )
      setStatus( nextSummaries.length > 0 ? 'ready' : 'empty' )
    } ).catch( (err) => {
      if( !active ) return
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setErrorMessage( `Project contribution data could not be loaded: ${message}` )
      setStatus( 'error' )
    } )
    return () => {
      active = false
    }
  }, [ projectReference ] )

  const resolveUserLabel = (userId: string) => {
    return resolveUserDisplayLabel( userId, userDisplayDirectory, user )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <AppBrand pageTitle="Project Contributions" />
        <div className="context-nav-label">
          <span className="document-title-prefix">Project</span>
          <span className="document-title-text">{formatProjectDisplayLabel( resolvedProjectId || projectReference || '', projectDisplayInfo[resolvedProjectId] )}</span>
        </div>
        <BackStack mode="return-only" links={[]} />
      </header>
      <main className="app-main">
        <section className="panel stack">
          <div className="panel-header">
            <div>
              <h2>Contribution ranking</h2>
              <p className="muted">Only this project is included. There is no global ranking.</p>
            </div>
          </div>
          {status === 'loading' ? <ContributionStatus status="loading" /> : null}
          {status === 'error' ? <ContributionStatus status="error" message={errorMessage} /> : null}
          {status === 'empty' ? <ContributionStatus status="empty" message="No contributions recorded for this project yet." /> : null}
          {status === 'ready' ? (
            <ProjectLeaderboard
              summaries={summaries}
              currentUserId={user?.uid ?? ''}
              resolveUserLabel={resolveUserLabel}
            />
          ) : null}
        </section>
      </main>
    </div>
  )
}

export default ProjectContributionPage
