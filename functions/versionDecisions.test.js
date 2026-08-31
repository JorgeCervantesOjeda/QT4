// functions/versionDecisions.test.js: Verifies transactional version decisions and derived-line side effects.
const assert = require( "node:assert/strict" )
const test = require( "node:test" )

const {
  decideVersion,
  normalizeVersionDecisionRequest,
} = require( "./versionDecisions" )

const createSnapshot = (id, data, exists = true) => ( {
  id,
  exists,
  data: () => data,
  ref: { path: `mock/${id}` },
} )

const pathFor = (collectionName, id) => `${collectionName}/${id}`

const createDocRef = (db, collectionName, id) => ( {
  id,
  path: pathFor( collectionName, id ),
  get: async () => db.getDocument( collectionName, id ),
} )

const createCollectionRef = (db, collectionName) => ( {
  doc(id = `${collectionName}-generated-${db.generatedIds.length + 1}`) {
    db.generatedIds.push( id )
    return createDocRef( db, collectionName, id )
  },
  where(field, op, value) {
    return createQueryRef( db, collectionName, [ { field, op, value } ] )
  },
} )

const createQueryRef = (db, collectionName, filters) => ( {
  collectionName,
  filters,
  where(field, op, value) {
    return createQueryRef( db, collectionName, [ ...filters, { field, op, value } ] )
  },
  async get() {
    return db.getQuery( collectionName, filters )
  },
} )

const createFakeDb = (docsByPath) => {
  const writes = []
  const generatedIds = []
  const db = {
    writes,
    generatedIds,
    collection(collectionName) {
      return createCollectionRef( db, collectionName )
    },
    async getDocument(collectionName, id) {
      const data = docsByPath[pathFor( collectionName, id )]
      return createSnapshot( id, data, Boolean( data ) )
    },
    async getQuery(collectionName, filters) {
      return {
        docs: Object.entries( docsByPath )
          .filter( ([ path ]) => path.startsWith( `${collectionName}/` ) )
          .filter( ([ path ]) => path.slice( collectionName.length + 1 ).indexOf( "/" ) === -1 )
          .map( ([ path, data ] ) => createSnapshot( path.slice( collectionName.length + 1 ), data ) )
          .filter( (snapshot) => filters.every( (filter) => (
            filter.op === "==" && snapshot.data()[filter.field] === filter.value
          ) ) ),
      }
    },
    async runTransaction(callback) {
      return callback( {
        get: async (ref) => {
          if( ref.collectionName ) {
            return db.getQuery( ref.collectionName, ref.filters )
          }
          const [ collectionName, id ] = ref.path.split( "/" )
          return db.getDocument( collectionName, id )
        },
        set: (ref, data, options) => {
          writes.push( { type: "set", ref, data, options } )
        },
        update: (ref, data) => {
          writes.push( { type: "update", ref, data } )
        },
      } )
    },
  }
  return db
}

const adminFor = (db) => {
  const admin = {
    firestore: () => db,
  }
  admin.firestore.FieldValue = {
    serverTimestamp: () => "server-timestamp",
  }
  return admin
}

const readyReviewVersion = {
  projectId: "target-project",
  docId: "doc-1",
  number: 1,
  status: "In Review",
  createdBy: "author-1",
  hasFile: true,
  reviewerIds: [ "reviewer-1" ],
  stats: {
    numThreads: 1,
    numOpenThreads: 0,
    numComments: 2,
    numThreadsWithTwoPlusComments: 1,
  },
}

test( "normalizes only supported version decisions", () => {
  assert.deepEqual(
    normalizeVersionDecisionRequest( {
      decision: "accept",
      projectId: " target-project ",
      docId: " doc-1 ",
      versionId: " version-1 ",
    } ),
    {
      decision: "accept",
      projectId: "target-project",
      docId: "doc-1",
      versionId: "version-1",
    },
  )
  assert.throws(
    () => normalizeVersionDecisionRequest( { decision: "approve", projectId: "p", docId: "d", versionId: "v" } ),
    /Unsupported version decision/u,
  )
} )

test( "accepting a version replaces every other accepted version for the document", async () => {
  const db = createFakeDb( {
    "documents/doc-1": {
      projectId: "target-project",
      type: "document",
      createdBy: "author-1",
    },
    "versions/version-1": {
      ...readyReviewVersion,
      number: 201,
    },
    "versions/accepted-100": {
      ...readyReviewVersion,
      number: 100,
      status: "Accepted",
      createdBy: "other-author-1",
    },
    "versions/accepted-200": {
      ...readyReviewVersion,
      number: 200,
      status: "Accepted",
      createdBy: "other-author-2",
    },
    "projectMembers/target-project_author-1": {
      projectId: "target-project",
      userId: "author-1",
      role: "member",
    },
  } )

  const result = await decideVersion( {
    admin: adminFor( db ),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    uid: "author-1",
    email: "author@example.com",
    body: {
      decision: "accept",
      projectId: "target-project",
      docId: "doc-1",
      versionId: "version-1",
    },
  } )

  assert.equal( result.ok, true )
  assert.equal( result.promotedNumber, 300 )
  assert.deepEqual(
    db.writes
      .filter( (write) => write.type === "update" && write.data.status === "Replaced" )
      .map( (write) => write.ref.path )
      .sort(),
    [ "versions/accepted-100", "versions/accepted-200" ],
  )
} )

test( "accepting a derived document replaces incorporated accepted change requests", async () => {
  const db = createFakeDb( {
    "documents/derived-doc": {
      projectId: "target-project",
      type: "derivedDocument",
      createdBy: "author-1",
      originProjectId: "origin-project",
      originDocumentId: "origin-doc",
      originVersionId: "origin-version",
      incorporatedChangeRequestVersionIds: [ "change-request-version-1" ],
    },
    "versions/derived-version": {
      ...readyReviewVersion,
      docId: "derived-doc",
    },
    "versions/change-request-version-1": {
      ...readyReviewVersion,
      docId: "change-request-doc",
      status: "Accepted",
      number: 100,
    },
    "derivedConfigurations/target-project|origin-project|origin-doc|origin-version": {
      projectId: "target-project",
      originProjectId: "origin-project",
      originDocumentId: "origin-doc",
      originVersionId: "origin-version",
      status: "Generated",
      generationStatus: "generated",
      activeChangeRequestVersionIds: [ "change-request-version-1" ],
    },
    "projectMembers/target-project_author-1": {
      projectId: "target-project",
      userId: "author-1",
      role: "member",
    },
  } )

  await decideVersion( {
    admin: adminFor( db ),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    uid: "author-1",
    email: "author@example.com",
    body: {
      decision: "accept",
      projectId: "target-project",
      docId: "derived-doc",
      versionId: "derived-version",
    },
  } )

  assert.equal(
    db.writes.some( (write) =>
      write.type === "set"
      && write.ref.path === "derivedConfigurations/target-project|origin-project|origin-doc|origin-version"
      && write.data.status === "Accepted"
      && write.data.acceptedDerivedDocumentId === "derived-doc"
      && write.data.acceptedDerivedVersionId === "derived-version",
    ),
    true,
  )
  assert.equal(
    db.writes.some( (write) =>
      write.type === "update"
      && write.ref.path === "versions/change-request-version-1"
      && write.data.status === "Replaced",
    ),
    true,
  )
} )
