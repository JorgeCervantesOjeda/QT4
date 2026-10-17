// src/pages/ProjectContributionPage.tsx: Shows the contribution ranking for one project only.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import AppBrand from '../components/AppBrand'
import BackStack from '../components/BackStack'
import ContributionStatus from '../components/reputation/ContributionStatus'
import ProjectLeaderboard from '../components/reputation/ProjectLeaderboard'
import { useAuth } from '../auth/useAuth'
import { formatProjectDisplayLabel, loadProjectDisplayInfo, type ProjectDisplayInfo } from '../lib/projectDisplay'
import { loadProjectReputation } from '../lib/reputationData'
import type { ReputationSummary } from '../lib/reputation'

function ProjectContributionPage() {
  const { user } = useAuth()
  const { projectId } = useParams<{ projectId: string }>()
  const [summaries, setSummaries] = useState<ReputationSummary[]>( [] )
  const [projectDisplayInfo, setProjectDisplayInfo] = useState<Record<string, ProjectDisplayInfo>>( {} )
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>( projectId ? 'loading' : 'error' )
  const [errorMessage, setErrorMessage] = useState( projectId ? '' : 'A project is required to view its contribution ranking.' )

  useEffect( () => {
    let active = true
    if( !projectId ) {
      return () => {
        active = false
      }
    }
    void Promise.all( [
      loadProjectReputation( projectId ),
      loadProjectDisplayInfo( [ projectId ] ),
    ] ).then( ( [ nextSummaries, nextProjectDisplayInfo ] ) => {
      if( !active ) return
      setSummaries( nextSummaries )
      setProjectDisplayInfo( nextProjectDisplayInfo )
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
  }, [ projectId ] )

  const resolveUserLabel = (userId: string) => {
    if( userId === user?.uid ) return 'You'
    return `Member ···${userId.slice( -4 )}`
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <AppBrand pageTitle="Project Contributions" />
        <div className="context-nav-label">
          <span className="document-title-prefix">Project</span>
          <span className="document-title-text">{formatProjectDisplayLabel( projectId ?? '', projectDisplayInfo[projectId ?? ''] )}</span>
        </div>
        <BackStack links={[ { label: 'Project Documents', to: projectId ? `/projects/${projectId}/documents` : '/projects' }, { label: 'Projects', to: '/projects' } ]} />
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
