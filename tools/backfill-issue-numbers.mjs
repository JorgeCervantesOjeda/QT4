// tools/backfill-issue-numbers.mjs: Audits or applies permanent per-version issue numbers using the active gcloud identity.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const requireFunctions = createRequire( new URL( '../functions/package.json', import.meta.url ) )
const { Firestore } = requireFunctions( '@google-cloud/firestore' )
const { OAuth2Client } = requireFunctions( 'google-auth-library' )
const { migrateVersionIssueNumbers } = requireFunctions( './issueNumberMigration' )

export async function runIssueNumberBackfill( args ) {
  const indexOfProjectFlag = args.indexOf( '--project' )
  const projectId = indexOfProjectFlag >= 0 ? args[indexOfProjectFlag + 1] : ''
  if( !projectId || !/^[a-z][a-z0-9-]+$/.test( projectId ) ) {
    throw new Error( 'Specify --project <Firebase project ID>; use --apply only after reviewing the audit.' )
  }
  const apply = args.includes( '--apply' )
  const authClient = new OAuth2Client()
  authClient.setCredentials( {
    access_token: execFileSync( 'gcloud', [ 'auth', 'print-access-token' ], {
      encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true,
      stdio: [ 'ignore', 'pipe', 'pipe' ],
    } ).trim(), expiry_date: Date.now() + 3500 * 1000,
  } )
  const db = new Firestore( { projectId, authClient } )
  try {
    const threads = await db.collection( 'threads' ).get()
    const countOfNaiveDates = threads.docs.filter( ( snapshot ) => {
      const value = snapshot.data().createdAt
      return typeof value === 'string' && !/(?:Z|[+-]\d{2}:\d{2})$/i.test( value.trim() )
    } ).length
    if( countOfNaiveDates ) {
      console.warn( JSON.stringify( { countOfNaiveDates,
        cause: 'Legacy creation timestamps do not include their original time zone.',
        fallback: 'Interpret these timestamps as UTC consistently with the UI.',
        impact: 'The sequence follows stored creation dates; the original time zone is not verified.' } ) )
    }
    const versionIds = [ ...new Set( threads.docs.map( ( snapshot ) => snapshot.data().versionId ) ) ]
    if( versionIds.some( ( versionId ) => typeof versionId !== 'string' || !versionId ) ) {
      throw new Error( 'An issue has no versionId; no migration was started.' )
    }
    // Audit every version before the first write so data conflicts stop the migration early.
    let countOfPendingIssues = 0
    for( let indexOfVersion = 0; indexOfVersion < versionIds.length; indexOfVersion += 8 ) {
      const counts = await Promise.all( versionIds.slice( indexOfVersion, indexOfVersion + 8 )
        .map( ( versionId ) => migrateVersionIssueNumbers( { db, versionId } ) ) )
      countOfPendingIssues += counts.reduce( ( total, count ) => total + count, 0 )
    }
    console.log( JSON.stringify( { projectId, mode: 'audit', countOfVersions: versionIds.length, countOfPendingIssues } ) )
    if( apply ) {
      let countOfAssignedIssues = 0
      for( let indexOfVersion = 0; indexOfVersion < versionIds.length; indexOfVersion += 8 ) {
        const counts = await Promise.all( versionIds.slice( indexOfVersion, indexOfVersion + 8 )
          .map( ( versionId ) => migrateVersionIssueNumbers( { db, versionId, apply: true } ) ) )
        countOfAssignedIssues += counts.reduce( ( total, count ) => total + count, 0 )
      }
      console.log( JSON.stringify( { projectId, mode: 'applied', countOfAssignedIssues } ) )
    }
  } finally {
    await db.terminate()
  }
}

if( process.argv[1] && pathToFileURL( process.argv[1] ).href === import.meta.url ) {
  runIssueNumberBackfill( process.argv.slice( 2 ) ).catch( ( error ) => {
    console.error( error.message )
    process.exitCode = 1
  } )
}
