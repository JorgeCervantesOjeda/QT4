// functions/propagatedErrorReports.test.js: Verifies accepted error-report propagation and duplicate prevention.
const assert = require( "node:assert/strict" )
const test = require( "node:test" )

const {
  didAcceptVersion,
  propagatedReportIdFor,
  propagateAcceptedErrorReport,
} = require( "./propagatedErrorReports" )

const createSnapshot = (id, data, exists = true) => ( {
  id,
  exists,
  data: () => data,
  ref: { path: `mock/${id}` },
} )

const createCollectionRef = (db, collectionName) => ( {
  doc(id) {
    const docId = id || `${collectionName}-generated`
    return {
      id: docId,
      path: `${collectionName}/${docId}`,
      get: async () => db.getDocument( collectionName, docId ),
    }
  },
  where(field, op, value) {
    db.queries.push( { collectionName, field, op, value } )
    return this
  },
  get: async () => db.getQuery( collectionName ),
} )

const createFakeDb = ({ existingPropagatedReport = false } = {}) => {
  const writes = []
  const queries = []
  const db = {
    writes,
    queries,
    collection(collectionName) {
      return createCollectionRef( db, collectionName )
    },
    async getDocument(collectionName, id) {
      if( collectionName === "documents" && id === "source-report" ) {
        return createSnapshot( id, {
          projectId: "origin-project",
          title: "Accepted defect",
          type: "errorReport",
          baseDocId: "origin-document",
          baseVersionId: "origin-version",
          createdBy: "author-1",
        } )
      }
      if( collectionName === "documents" && id.startsWith( "propagatedErrorReport_" ) ) {
        return createSnapshot( id, {}, existingPropagatedReport )
      }
      return createSnapshot( id, {}, false )
    },
    async getQuery(collectionName) {
      if( collectionName === "derivedConfigurations" ) {
        return {
          docs: [
            createSnapshot( "target-project|origin-project|origin-document|origin-version", {
              projectId: "target-project",
              status: "Accepted",
              acceptedDerivedDocumentId: "derived-document",
              acceptedDerivedVersionId: "derived-version",
            } ),
          ],
        }
      }
      return { docs: [] }
    },
    async runTransaction(callback) {
      await callback( {
        get: async (ref) => {
          if( ref.path?.startsWith( "documents/propagatedErrorReport_" ) ) {
            return createSnapshot( ref.id, {}, existingPropagatedReport )
          }
          if( ref.path === "counters/documents_target-project" ) {
            return createSnapshot( ref.id, { nextNumber: 12 } )
          }
          return createSnapshot( ref.id, {}, false )
        },
        set: (ref, data, options) => {
          writes.push( { ref, data, options } )
        },
      } )
    },
  }
  return db
}

test( "didAcceptVersion only matches a new Accepted transition", () => {
  assert.equal( didAcceptVersion( { status: "In Review" }, { status: "Accepted" } ), true )
  assert.equal( didAcceptVersion( { status: "Accepted" }, { status: "Accepted" } ), false )
  assert.equal( didAcceptVersion( { status: "In Review" }, { status: "Rejected" } ), false )
} )

test( "propagatedReportIdFor is deterministic for a target and source accepted report", () => {
  assert.equal(
    propagatedReportIdFor( {
      targetProjectId: "target-project",
      sourceErrorReportDocumentId: "source-report",
      sourceErrorReportVersionId: "source-version",
    } ),
    "propagatedErrorReport_target-project_source-report_source-version",
  )
} )

test( "propagateAcceptedErrorReport creates one propagated report for an accepted derived variant", async () => {
  const db = createFakeDb()
  const admin = {
    firestore: () => db,
  }
  admin.firestore.FieldValue = {
    serverTimestamp: () => "server-timestamp",
  }
  const result = await propagateAcceptedErrorReport( {
    admin,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    versionId: "source-version",
    beforeData: { status: "In Review" },
    afterData: {
      projectId: "origin-project",
      docId: "source-report",
      status: "Accepted",
      createdBy: "author-1",
      updatedBy: "approver-1",
    },
    afterRef: { path: "versions/source-version" },
  } )

  assert.deepEqual( result, { createdCount: 1, skippedCount: 0 } )
  assert.equal(
    db.queries.filter( (query) => query.collectionName === "derivedConfigurations" ).length,
    4,
  )
  assert.equal(
    db.writes.some( (write) =>
      write.ref.path === "documents/propagatedErrorReport_target-project_source-report_source-version"
      && write.data.type === "errorReport"
      && write.data.baseDocId === "derived-document"
      && write.data.baseVersionId === "derived-version",
    ),
    true,
  )
} )

test( "propagateAcceptedErrorReport skips an already-created propagated report", async () => {
  const db = createFakeDb( { existingPropagatedReport: true } )
  const admin = {
    firestore: () => db,
  }
  admin.firestore.FieldValue = {
    serverTimestamp: () => "server-timestamp",
  }
  const result = await propagateAcceptedErrorReport( {
    admin,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    versionId: "source-version",
    beforeData: { status: "In Review" },
    afterData: {
      projectId: "origin-project",
      docId: "source-report",
      status: "Accepted",
      createdBy: "author-1",
    },
    afterRef: { path: "versions/source-version" },
  } )

  assert.deepEqual( result, { createdCount: 0, skippedCount: 1 } )
  assert.equal( db.writes.length, 0 )
} )
