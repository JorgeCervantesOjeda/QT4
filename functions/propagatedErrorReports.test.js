// functions/propagatedErrorReports.test.js: Verifies accepted error-report propagation and duplicate prevention.
const assert = require( "node:assert/strict" )
const test = require( "node:test" )

const {
  createRetryPropagatedErrorReportsHandler,
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

const createFakeDb = ({ existingPropagatedReport = false, sourceStorageProvider = "files-api" } = {}) => {
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
      if( collectionName === "files" && id === "source-file" ) {
        return createSnapshot( id, {
          fileKey: "qt4/origin-project/source-report/source-version/source.pdf",
          fileName: "source.pdf",
          contentType: "application/pdf",
          sizeBytes: 2048,
          isPermanent: true,
          expireAfterDays: null,
          storageProvider: sourceStorageProvider,
          projectId: "origin-project",
          docId: "source-report",
          versionId: "source-version",
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
          if( ref.path === "files/source-file" ) {
            return db.getDocument( "files", "source-file" )
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

const createAdmin = (db, storage = null) => {
  const admin = {
    firestore: () => db,
  }
  admin.firestore.FieldValue = {
    serverTimestamp: () => "server-timestamp",
  }
  if( storage ) {
    admin.storage = () => storage
  }
  return admin
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
  const admin = createAdmin( db )
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
      hasFile: true,
      fileRefId: "source-file",
    },
    afterRef: { path: "versions/source-version" },
  } )

  assert.deepEqual( result, {
    createdCount: 1,
    skippedCount: 0,
    failedCount: 0,
    failures: [],
  } )
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
  const propagatedVersionWrite = db.writes.find( (write) => write.ref.path === "versions/versions-generated" )
  assert.equal( propagatedVersionWrite.data.hasFile, true )
  assert.equal( propagatedVersionWrite.data.fileRefId, "files-generated" )
  assert.equal(
    db.writes.some( (write) =>
      write.ref.path === "files/files-generated"
      && write.data.fileKey === "qt4/origin-project/source-report/source-version/source.pdf"
      && write.data.projectId === "target-project"
      && write.data.docId === "propagatedErrorReport_target-project_source-report_source-version"
      && write.data.versionId === "versions-generated",
    ),
    true,
  )
} )

test( "propagateAcceptedErrorReport copies Firebase Storage files into the propagated report path", async () => {
  const db = createFakeDb( { sourceStorageProvider: "firebase-storage" } )
  const copyCalls = []
  const storage = {
    bucket: () => ( {
      file: (fileKey) => ( {
        copy: async (targetFileKey) => {
          copyCalls.push( { fileKey, targetFileKey } )
        },
      } ),
    } ),
  }
  const result = await propagateAcceptedErrorReport( {
    admin: createAdmin( db, storage ),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    versionId: "source-version",
    beforeData: { status: "In Review" },
    afterData: {
      projectId: "origin-project",
      docId: "source-report",
      status: "Accepted",
      createdBy: "author-1",
      updatedBy: "approver-1",
      hasFile: true,
      fileRefId: "source-file",
    },
    afterRef: { path: "versions/source-version" },
  } )

  assert.deepEqual( result, {
    createdCount: 1,
    skippedCount: 0,
    failedCount: 0,
    failures: [],
  } )
  assert.deepEqual( copyCalls, [
    {
      fileKey: "qt4/origin-project/source-report/source-version/source.pdf",
      targetFileKey:
        "qt4/target-project/propagatedErrorReport_target-project_source-report_source-version/versions-generated/source.pdf",
    },
  ] )
  assert.equal(
    db.writes.some( (write) =>
      write.ref.path === "files/files-generated"
      && write.data.fileKey
        === "qt4/target-project/propagatedErrorReport_target-project_source-report_source-version/versions-generated/source.pdf",
    ),
    true,
  )
} )

test( "propagateAcceptedErrorReport skips propagated reports when Firebase Storage copy fails", async () => {
  const db = createFakeDb( { sourceStorageProvider: "firebase-storage" } )
  const warnCalls = []
  const storage = {
    bucket: () => ( {
      file: () => ( {
        copy: async () => {
          throw new Error( "copy failed" )
        },
      } ),
    } ),
  }
  const result = await propagateAcceptedErrorReport( {
    admin: createAdmin( db, storage ),
    logger: {
      info: () => {},
      warn: (message, metadata) => warnCalls.push( { message, metadata } ),
      error: () => {},
    },
    versionId: "source-version",
    beforeData: { status: "In Review" },
    afterData: {
      projectId: "origin-project",
      docId: "source-report",
      status: "Accepted",
      createdBy: "author-1",
      updatedBy: "approver-1",
      hasFile: true,
      fileRefId: "source-file",
    },
    afterRef: { path: "versions/source-version" },
  } )

  assert.deepEqual( result, {
    createdCount: 0,
    skippedCount: 0,
    failedCount: 1,
    failures: [
      {
        reason: "storage_copy_failed",
        targetProjectId: "target-project",
        targetDocId: "derived-document",
        targetVersionId: "derived-version",
        sourceFileRefId: "source-file",
      },
    ],
  } )
  assert.equal( db.writes.length, 0 )
  assert.equal(
    warnCalls.some( (call) =>
      call.message === "propagatedErrorReport skipped"
      && call.metadata.reason === "storage_copy_failed",
    ),
    true,
  )
} )

test( "propagateAcceptedErrorReport skips an already-created propagated report", async () => {
  const db = createFakeDb( { existingPropagatedReport: true } )
  const result = await propagateAcceptedErrorReport( {
    admin: createAdmin( db ),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    versionId: "source-version",
    beforeData: { status: "In Review" },
    afterData: {
      projectId: "origin-project",
      docId: "source-report",
      status: "Accepted",
      createdBy: "author-1",
      hasFile: true,
      fileRefId: "source-file",
    },
    afterRef: { path: "versions/source-version" },
  } )

  assert.deepEqual( result, {
    createdCount: 0,
    skippedCount: 1,
    failedCount: 0,
    failures: [],
  } )
  assert.equal( db.writes.length, 0 )
} )

test( "retry propagated error reports returns propagation failures to the client", async () => {
  const fallbackDb = createFakeDb( { sourceStorageProvider: "firebase-storage" } )
  const db = createFakeDb( { sourceStorageProvider: "firebase-storage" } )
  db.getDocument = async (collectionName, id) => {
    if( collectionName === "versions" && id === "source-version" ) {
      return createSnapshot( id, {
        projectId: "origin-project",
        docId: "source-report",
        status: "Accepted",
        createdBy: "author-1",
        updatedBy: "approver-1",
        hasFile: true,
        fileRefId: "source-file",
      } )
    }
    if( collectionName === "projectMembers" && id === "origin-project_author-1" ) {
      return createSnapshot( id, { role: "member" } )
    }
    return fallbackDb.getDocument( collectionName, id )
  }
  const storage = {
    bucket: () => ( {
      file: () => ( {
        copy: async () => {
          throw new Error( "copy failed" )
        },
      } ),
    } ),
  }
  const responsePayloads = []
  const handler = createRetryPropagatedErrorReportsHandler( {
    admin: createAdmin( db, storage ),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    verifyBearerToken: async () => ( { uid: "author-1", email: "author@example.com" } ),
    setCorsHeaders: () => undefined,
  } )

  await handler(
    {
      method: "POST",
      body: {
        projectId: "origin-project",
        docId: "source-report",
        versionId: "source-version",
      },
    },
    {
      status: (code) => ( {
        json: (payload) => responsePayloads.push( { code, payload } ),
        send: (payload) => responsePayloads.push( { code, payload } ),
      } ),
    },
  )

  assert.equal( responsePayloads[0].code, 200 )
  assert.equal( responsePayloads[0].payload.failedCount, 1 )
  assert.equal( responsePayloads[0].payload.failures[0].reason, "storage_copy_failed" )
} )
