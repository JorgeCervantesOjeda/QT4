// functions/issueNumbering.js: Plans permanent legacy issue numbers without renumbering existing identities.
const buildIssueNumberAssignments = ( records ) => {
  const orderedRecords = [ ...records ].sort( ( left, right ) =>
    left.createdAtMillis - right.createdAtMillis
      || ( left.issueNumber && right.issueNumber ? left.issueNumber - right.issueNumber : left.id.localeCompare( right.id ) ) )
  const usedNumbers = new Set()
  for( const record of orderedRecords ) {
    if( !Number.isFinite( record.createdAtMillis ) ) {
      throw new Error( `Issue ${record.id} has no verified creation date.` )
    }
    if( record.issueNumber !== undefined ) {
      if( !Number.isSafeInteger( record.issueNumber ) || record.issueNumber < 1 || usedNumbers.has( record.issueNumber ) ) {
        throw new Error( `Issue ${record.id} has an invalid or duplicate number.` )
      }
      usedNumbers.add( record.issueNumber )
    }
  }
  const assignments = []
  let nextNumber = 1
  let previousNumber = 0
  for( const record of orderedRecords ) {
    let issueNumber = record.issueNumber
    if( issueNumber === undefined ) {
      while( usedNumbers.has( nextNumber ) ) nextNumber += 1
      issueNumber = nextNumber
      usedNumbers.add( issueNumber )
      assignments.push( { id: record.id, issueNumber } )
    }
    if( issueNumber <= previousNumber ) {
      throw new Error( `Issue ${record.id} has a numbering chronology conflict.` )
    }
    previousNumber = issueNumber
  }
  return assignments
}

const formatIssueLabel = ( issue ) => {
  const title = issue?.title || 'Untitled issue'
  return Number.isSafeInteger( issue?.issueNumber ) && issue.issueNumber > 0
    ? `#${issue.issueNumber} - ${title}` : title
}

module.exports = { buildIssueNumberAssignments, formatIssueLabel }
