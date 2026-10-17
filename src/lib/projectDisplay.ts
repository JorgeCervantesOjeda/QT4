// src/lib/projectDisplay.ts: Loads human-readable project labels without exposing internal document IDs.
import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

export type ProjectDisplayInfo = {
  name: string
  shortId: number | null
}

const emptyProjectDisplayInfo: ProjectDisplayInfo = { name: '', shortId: null }

const normalizeProjectDisplayInfo = (data: Record<string, unknown> | undefined): ProjectDisplayInfo => {
  const name = typeof data?.name === 'string' ? data.name.trim() : ''
  const numericShortId = typeof data?.shortId === 'number' ? data.shortId : Number( data?.shortId )
  return {
    name,
    shortId: Number.isFinite( numericShortId ) ? numericShortId : null,
  }
}

const formatProjectDisplayLabel = (
  projectId: string,
  info?: ProjectDisplayInfo,
): string => {
  if( projectId === 'all-projects' ) {
    return 'All projects'
  }
  if( info?.name ) {
    return info.name
  }
  if( info?.shortId !== null && info?.shortId !== undefined ) {
    return `Project ${info.shortId}`
  }
  return 'Project'
}

const loadProjectDisplayInfo = async (
  projectIds: string[],
): Promise<Record<string, ProjectDisplayInfo>> => {
  const uniqueProjectIds = Array.from( new Set( projectIds.filter( Boolean ) ) )
  const entries = await Promise.all( uniqueProjectIds.map( async (projectId) => {
    try {
      const snapshot = await getDoc( doc( db, 'projects', projectId ) )
      if( !snapshot.exists() ) {
        console.warn( 'Project label could not be loaded because the project does not exist.', {
          action: 'projectDisplay.loadLabel',
          cause: 'project_not_found',
          fallback: 'show_generic_project_label',
          impact: 'The contribution view remains usable without the project name.',
          projectId,
        } )
        return [ projectId, emptyProjectDisplayInfo ] as const
      }
      return [ projectId, normalizeProjectDisplayInfo( snapshot.data() as Record<string, unknown> ) ] as const
    } catch( error ) {
      console.warn( 'Project label could not be loaded.', {
        action: 'projectDisplay.loadLabel',
        cause: error instanceof Error ? error.message : String( error ),
        fallback: 'show_generic_project_label',
        impact: 'The contribution view remains usable without the project name.',
        projectId,
      } )
      return [ projectId, emptyProjectDisplayInfo ] as const
    }
  } ) )
  return entries.reduce<Record<string, ProjectDisplayInfo>>( (labels, [ projectId, info ]) => {
    labels[projectId] = info
    return labels
  }, {} )
}

export { formatProjectDisplayLabel, loadProjectDisplayInfo }
