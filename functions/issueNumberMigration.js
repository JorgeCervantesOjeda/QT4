// functions/issueNumberMigration.js: Transactionally backfills issue numbers while preserving timestamps and version counters.
const { buildIssueNumberAssignments } = require( './issueNumbering' )

const migrateVersionIssueNumbers = async ( { db, versionId, apply = false } ) => {
  let countOfAssignedIssues = 0
  let hasMore = true
  while( hasMore ) {
    const result = await db.runTransaction( async ( transaction ) => {
      const versionRef = db.collection( 'versions' ).doc( versionId )
      const query = db.collection( 'threads' ).where( 'versionId', '==', versionId )
      const [ versionSnapshot, threadSnapshot ] = await Promise.all( [
        transaction.get( versionRef ), transaction.get( query ),
      ] )
      if( !versionSnapshot.exists ) throw new Error( `Version ${versionId} does not exist.` )
      const version = versionSnapshot.data()
      const countOfIssues = version.stats?.numThreads ?? version.numThreads ?? 0
      if( countOfIssues !== threadSnapshot.docs.length ) {
        throw new Error( `Version ${versionId} has a thread counter mismatch; no numbers were changed.` )
      }
      const records = threadSnapshot.docs.map( ( snapshot ) => {
        const data = snapshot.data()
        const creationDate = data.createdAt ?? snapshot.createTime
        const creationText = typeof creationDate === 'string' ? creationDate.trim().replace( ' ', 'T' ) : ''
        // Legacy SQL timestamps have no offset; UTC preserves their relative creation order deterministically.
        const creationTextWithZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test( creationText ) ? creationText : `${creationText}Z`
        return { id: snapshot.id, issueNumber: data.issueNumber,
          createdAtMillis: creationText ? Date.parse( creationTextWithZone ) : creationDate?.toMillis?.() }
      } )
      const assignments = buildIssueNumberAssignments( records )
      const pendingAssignments = apply ? assignments.slice( 0, 400 ) : assignments
      if( apply ) {
        for( const assignment of pendingAssignments ) {
          transaction.update( db.collection( 'threads' ).doc( assignment.id ), { issueNumber: assignment.issueNumber } )
        }
      }
      return { countOfAssignments: pendingAssignments.length,
        hasMore: apply && assignments.length > pendingAssignments.length }
    } )
    countOfAssignedIssues += result.countOfAssignments
    hasMore = result.hasMore
  }
  return countOfAssignedIssues
}

module.exports = { migrateVersionIssueNumbers }
