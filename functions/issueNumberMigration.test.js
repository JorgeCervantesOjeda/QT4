// functions/issueNumberMigration.test.js: Integration coverage linking numbering rules to migration writes and browser IDs.
const assert = require( 'node:assert/strict' )
const test = require( 'node:test' )
const { migrateVersionIssueNumbers } = require( './issueNumberMigration' )

test( 'audits without writes, applies only issueNumber, and is idempotent per version', async () => {
  const store = new Map( [
    [ 'old', { createdAt: '1970-01-01 00:00:01' } ],
    [ 'new', { createdAt: { toMillis: () => 2000 }, issueNumber: 2 } ],
  ] )
  const writes = []
  const db = {
    collection: ( name ) => ( { doc: ( id ) => ( { name, id } ),
      where: () => ( { name: 'thread-query' } ) } ),
    runTransaction: async ( callback ) => callback( {
      get: async ( ref ) => ref.name === 'versions'
        ? { exists: true, data: () => ( { numThreads: 2 } ) }
        : { docs: [ ...store ].map( ( [ id, data ] ) => ( { id, data: () => data } ) ) },
      update: ( ref, data ) => { writes.push( { ref, data } ); Object.assign( store.get( ref.id ), data ) },
    } ),
  }
  assert.equal( await migrateVersionIssueNumbers( { db, versionId: 'v1' } ), 1 )
  assert.equal( writes.length, 0 )
  assert.equal( await migrateVersionIssueNumbers( { db, versionId: 'v1', apply: true } ), 1 )
  assert.deepEqual( writes, [ { ref: { name: 'threads', id: 'old' }, data: { issueNumber: 1 } } ] )
  assert.equal( await migrateVersionIssueNumbers( { db, versionId: 'v1', apply: true } ), 0 )
} )
