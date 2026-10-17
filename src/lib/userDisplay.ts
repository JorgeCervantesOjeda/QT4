// src/lib/userDisplay.ts: Resolves safe user labels without exposing Firebase identifiers.
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from './firebase'

export type UserDisplayInfo = {
  displayName?: string | null
  email?: string | null
}

const DIRECTORY_QUERY_LIMIT = 10

const chunkValues = <T,>(values: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for( let index = 0; index < values.length; index += size ) {
    chunks.push( values.slice( index, index + size ) )
  }
  return chunks
}

const loadUserDisplayDirectory = async (
  userIds: string[],
): Promise<Record<string, UserDisplayInfo>> => {
  const uniqueUserIds = Array.from( new Set( userIds.filter( Boolean ) ) )
  if( uniqueUserIds.length === 0 ) {
    return {}
  }
  const directory: Record<string, UserDisplayInfo> = {}
  try {
    const snapshots = await Promise.all(
      chunkValues( uniqueUserIds, DIRECTORY_QUERY_LIMIT ).map( (chunk) => getDocs( query(
        collection( db, 'userDirectory' ),
        where( 'userId', 'in', chunk ),
      ) ) ),
    )
    snapshots.forEach( (snapshot) => {
      snapshot.docs.forEach( (directoryDoc) => {
        const data = directoryDoc.data()
        const userId = typeof data.userId === 'string' ? data.userId : ''
        if( !userId ) {
          return
        }
        directory[userId] = {
          displayName: typeof data.displayName === 'string' ? data.displayName : null,
          email: typeof data.email === 'string' ? data.email : null,
        }
      } )
    } )
  } catch( error ) {
    console.warn( 'User display directory could not be loaded.', {
      action: 'userDisplay.loadDirectory',
      cause: error instanceof Error ? error.message : String( error ),
      fallback: 'show_generic_user_label',
      impact: 'The screen remains usable without exposing internal user identifiers.',
    } )
  }
  return directory
}

const resolveUserDisplayLabel = (
  userId: string,
  directory: Record<string, UserDisplayInfo>,
  currentUser?: { uid?: string | null; displayName?: string | null; email?: string | null } | null,
): string => {
  if( currentUser?.uid && userId === currentUser.uid ) {
    return 'You'
  }
  const entry = directory[userId]
  const displayName = entry?.displayName?.trim() ?? ''
  const email = entry?.email?.trim() ?? ''
  if( displayName ) {
    return displayName
  }
  if( email ) {
    return email
  }
  return 'Project member'
}

export { loadUserDisplayDirectory, resolveUserDisplayLabel }
