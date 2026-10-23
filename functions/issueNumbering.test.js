// functions/issueNumbering.test.js: Legacy numbering unit contract linked to migration transactions and issue-ordering browser coverage.
const assert = require( 'node:assert/strict' )
const test = require( 'node:test' )
const { buildIssueNumberAssignments } = require( './issueNumbering' )

test( 'assigns missing numbers chronologically and preserves assigned numbers', () => {
  const records = [
    { id: 'new', issueNumber: 3, createdAtMillis: 3000 },
    { id: 'late', createdAtMillis: 2000 },
    { id: 'early', createdAtMillis: 1000 },
  ]
  assert.deepEqual( buildIssueNumberAssignments( records ), [
    { id: 'early', issueNumber: 1 }, { id: 'late', issueNumber: 2 },
  ] )
  assert.deepEqual( buildIssueNumberAssignments( records.map( ( record ) => ( {
    ...record, issueNumber: record.issueNumber || ( record.id === 'early' ? 1 : 2 ),
  } ) ) ), [] )
} )

test( 'rejects duplicates, chronology conflicts and missing creation dates', () => {
  assert.throws( () => buildIssueNumberAssignments( [
    { id: 'a', issueNumber: 1, createdAtMillis: 1000 },
    { id: 'b', issueNumber: 1, createdAtMillis: 2000 },
  ] ), /number/i )
  assert.throws( () => buildIssueNumberAssignments( [
    { id: 'a', issueNumber: 2, createdAtMillis: 1000 },
    { id: 'b', issueNumber: 1, createdAtMillis: 2000 },
  ] ), /chronolog/i )
  assert.throws( () => buildIssueNumberAssignments( [ { id: 'a' } ] ), /creation/i )
} )
