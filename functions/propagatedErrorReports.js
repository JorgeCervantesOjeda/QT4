// functions/propagatedErrorReports.js: Propagates accepted error reports to accepted derived variants.
const { preparePropagatedFile } = require( "./propagatedFileCopies" )

const PROPAGATED_REPORT_ID_PREFIX = "propagatedErrorReport"

const normalizeString = (value) => String( value || "" ).trim()

const didAcceptVersion = (beforeData, afterData) =>
  beforeData?.status !== "Accepted" && afterData?.status === "Accepted"

const emptyPropagationResult = () => ( {
  createdCount: 0,
  skippedCount: 0,
  failedCount: 0,
  failures: [],
} )

const propagationFailure = (reason, metadata = {}) => ( {
  created: false,
  skipped: false,
  failed: true,
  failure: {
    reason,
    ...metadata,
  },
} )

const propagatedReportIdFor = ({
  targetProjectId,
  sourceErrorReportDocumentId,
  sourceErrorReportVersionId,
}) => [
  PROPAGATED_REPORT_ID_PREFIX,
  targetProjectId,
  sourceErrorReportDocumentId,
  sourceErrorReportVersionId,
].join( "_" )

const queryAcceptedDerivedConfigurations = async (db, reportDocument, acceptedVersion) => db
  .collection( "derivedConfigurations" )
  .where( "originProjectId", "==", acceptedVersion.projectId )
  .where( "originDocumentId", "==", reportDocument.baseDocId )
  .where( "originVersionId", "==", reportDocument.baseVersionId )
  .where( "status", "==", "Accepted" )
  .get()

const createPropagatedReportForConfiguration = async ({
  admin,
  db,
  logger,
  sourceReportSnapshot,
  acceptedVersionSnapshot,
  configurationSnapshot,
}) => {
  const sourceReport = sourceReportSnapshot.data() || {}
  const acceptedVersion = acceptedVersionSnapshot.data() || {}
  const configuration = configurationSnapshot.data() || {}
  const targetProjectId = normalizeString( configuration.projectId )
  const targetDocId = normalizeString( configuration.acceptedDerivedDocumentId )
  const targetVersionId = normalizeString( configuration.acceptedDerivedVersionId )
  if( !targetProjectId || !targetDocId || !targetVersionId ) {
    logger.warn( "propagatedErrorReport skipped", {
      reason: "invalid_configuration",
      configurationId: configurationSnapshot.id,
    } )
    return propagationFailure( "invalid_configuration", {
      configurationId: configurationSnapshot.id,
    } )
  }

  const propagatedDocId = propagatedReportIdFor( {
    targetProjectId,
    sourceErrorReportDocumentId: sourceReportSnapshot.id,
    sourceErrorReportVersionId: acceptedVersionSnapshot.id,
  } )
  const propagatedDocRef = db.collection( "documents" ).doc( propagatedDocId )
  const propagatedVersionRef = db.collection( "versions" ).doc()
  const counterRef = db.collection( "counters" ).doc( `documents_${targetProjectId}` )
  const versionCounterRef = db.collection( "counters" ).doc( `versions_${propagatedDocId}` )
  const actorId = acceptedVersion.updatedBy || acceptedVersion.createdBy || sourceReport.createdBy || ""
  const existingReportBeforeFileCopySnapshot = await propagatedDocRef.get()
  if( existingReportBeforeFileCopySnapshot.exists ) {
    return { created: false, skipped: true }
  }
  const propagatedFile = await preparePropagatedFile( {
    admin,
    db,
    logger,
    acceptedVersion: { ...acceptedVersion, id: acceptedVersionSnapshot.id },
    targetProjectId,
    propagatedDocId,
    propagatedVersionId: propagatedVersionRef.id,
    actorId,
  } )
  if( !propagatedFile.ok ) {
    return propagationFailure( propagatedFile.failure.reason, {
      targetProjectId,
      targetDocId,
      targetVersionId,
      ...propagatedFile.failure,
    } )
  }

  let created = false
  await db.runTransaction( async (transaction) => {
    const [ existingReportSnapshot, counterSnapshot ] = await Promise.all( [
      transaction.get( propagatedDocRef ),
      transaction.get( counterRef ),
    ] )
    if( existingReportSnapshot.exists ) {
      return
    }
    const nextNumberRaw = counterSnapshot.data()?.nextNumber
    const nextNumber = typeof nextNumberRaw === "number" ? nextNumberRaw : 1
    transaction.set( counterRef, {
      nextNumber: nextNumber + 1,
      projectId: targetProjectId,
    }, { merge: true } )
    transaction.set( propagatedDocRef, {
      projectId: targetProjectId,
      title: `Propagated error report - ${sourceReport.title || sourceReportSnapshot.id}`,
      type: "errorReport",
      baseProjectId: targetProjectId,
      baseDocId: targetDocId,
      baseVersionId: targetVersionId,
      sourceErrorReportDocumentId: sourceReportSnapshot.id,
      sourceErrorReportVersionId: acceptedVersionSnapshot.id,
      sourceBaseProjectId: acceptedVersion.projectId,
      sourceBaseDocumentId: sourceReport.baseDocId,
      sourceBaseVersionId: sourceReport.baseVersionId,
      derivedConfigurationId: configurationSnapshot.id,
      createdBy: actorId,
      authorId: actorId,
      updatedBy: actorId,
      shortId: nextNumber,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    } )
    transaction.set( propagatedVersionRef, {
      projectId: targetProjectId,
      docId: propagatedDocId,
      number: 1,
      status: "In Creation",
      createdBy: actorId,
      reviewerIds: [],
      reviewStartAt: null,
      reviewEndAt: null,
      hasFile: true,
      fileRefId: propagatedFile.id,
      stats: {
        numThreads: 0,
        numOpenThreads: 0,
        numComments: 0,
        numThreadsWithTwoPlusComments: 0,
      },
      numThreads: 0,
      numOpenThreads: 0,
      numComments: 0,
      numThreadsWithTwoPlusComments: 0,
      acceptedErrorReportId: null,
      previousVersionId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      activityAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: actorId,
    } )
    transaction.set( propagatedFile.ref, propagatedFile.data )
    transaction.set( versionCounterRef, {
      nextNumber: 2,
      docId: propagatedDocId,
      projectId: targetProjectId,
      previousVersionId: null,
    }, { merge: true } )
    created = true
  } )
  return { created, skipped: !created }
}

const propagateAcceptedErrorReport = async ({
  admin,
  logger,
  versionId,
  beforeData,
  afterData,
  afterRef,
  ignoreDecisionMarker = false,
}) => {
  if( !didAcceptVersion( beforeData, afterData ) ) {
    return emptyPropagationResult()
  }
  if( afterData?.propagatedErrorReportsHandledByDecision === true && !ignoreDecisionMarker ) {
    logger.info( "propagatedErrorReport skipped", {
      reason: "handled_by_version_decision",
      versionId,
      impact: "duplicate_trigger_prevented",
    } )
    return emptyPropagationResult()
  }
  const db = admin.firestore()
  const acceptedVersionSnapshot = {
    id: versionId,
    data: () => afterData,
    ref: afterRef,
  }
  const sourceReportSnapshot = await db.collection( "documents" ).doc( afterData.docId ).get()
  if( !sourceReportSnapshot.exists ) {
    logger.warn( "propagatedErrorReport skipped", { reason: "missing_source_report", versionId } )
    return {
      ...emptyPropagationResult(),
      failedCount: 1,
      failures: [ { reason: "missing_source_report" } ],
    }
  }
  const sourceReport = sourceReportSnapshot.data() || {}
  if( sourceReport.type !== "errorReport" || !sourceReport.baseDocId || !sourceReport.baseVersionId ) {
    return emptyPropagationResult()
  }
  const configurationsSnapshot = await queryAcceptedDerivedConfigurations( db, sourceReport, afterData )
  const results = await Promise.all(
    ( configurationsSnapshot.docs || [] ).map( (configurationSnapshot) =>
      createPropagatedReportForConfiguration( {
        admin,
        db,
        logger,
        sourceReportSnapshot,
        acceptedVersionSnapshot,
        configurationSnapshot,
      } ),
    ),
  )
  const createdCount = results.filter( (result) => result.created ).length
  const skippedCount = results.filter( (result) => result.skipped ).length
  const failures = results
    .filter( (result) => result.failed && result.failure )
    .map( (result) => result.failure )
  const failedCount = failures.length
  logger.info( "propagatedErrorReport complete", {
    versionId,
    sourceReportId: sourceReportSnapshot.id,
    createdCount,
    skippedCount,
    failedCount,
  } )
  return { createdCount, skippedCount, failedCount, failures }
}

class PropagatedErrorReportsError extends Error {
  constructor(message, statusCode = 400) {
    super( message )
    this.name = "PropagatedErrorReportsError"
    this.statusCode = statusCode
  }
}

const normalizeRetryPropagationRequest = (body) => {
  const request = {
    projectId: normalizeString( body?.projectId ),
    docId: normalizeString( body?.docId ),
    versionId: normalizeString( body?.versionId ),
  }
  if( !request.projectId || !request.docId || !request.versionId ) {
    throw new PropagatedErrorReportsError( "projectId, docId and versionId are required." )
  }
  return request
}

const retryAcceptedErrorReportPropagation = async ({
  admin,
  logger,
  uid,
  body,
}) => {
  const request = normalizeRetryPropagationRequest( body )
  const userId = normalizeString( uid )
  if( !userId ) {
    throw new PropagatedErrorReportsError( "User session is required.", 401 )
  }
  const db = admin.firestore()
  const versionRef = db.collection( "versions" ).doc( request.versionId )
  const [
    versionSnapshot,
    memberSnapshot,
    profileSnapshot,
  ] = await Promise.all( [
    versionRef.get(),
    db.collection( "projectMembers" ).doc( `${request.projectId}_${userId}` ).get(),
    db.collection( "userProfiles" ).doc( userId ).get(),
  ] )
  if( !versionSnapshot.exists ) {
    throw new PropagatedErrorReportsError( "Version not found.", 404 )
  }
  const versionData = versionSnapshot.data() || {}
  if( versionData.projectId !== request.projectId || versionData.docId !== request.docId ) {
    throw new PropagatedErrorReportsError( "Version does not belong to the requested document.", 400 )
  }
  if( versionData.status !== "Accepted" ) {
    throw new PropagatedErrorReportsError( "Only accepted error report versions can retry propagation.", 409 )
  }
  const role = normalizeString( memberSnapshot.exists ? memberSnapshot.data()?.role : "" )
  const isAdmin = profileSnapshot.exists && profileSnapshot.data()?.isAdmin === true
  const canRetry = isAdmin || role === "leader" || normalizeString( versionData.createdBy ) === userId
  if( !canRetry ) {
    throw new PropagatedErrorReportsError( "Only the version author, project leader or admin can retry propagation.", 403 )
  }
  const result = await propagateAcceptedErrorReport( {
    admin,
    logger,
    versionId: request.versionId,
    beforeData: { status: "Propagation Retry" },
    afterData: versionData,
    afterRef: versionRef,
    ignoreDecisionMarker: true,
  } )
  return {
    ok: true,
    projectId: request.projectId,
    docId: request.docId,
    versionId: request.versionId,
    ...result,
  }
}

const createRetryPropagatedErrorReportsHandler = ({
  admin,
  logger,
  verifyBearerToken,
  setCorsHeaders,
}) => async (req, res) => {
  setCorsHeaders( req, res, [ "PROPAGATED_ERROR_REPORTS_ALLOWED_ORIGINS", "NOTIFY_ALLOWED_ORIGINS" ] )
  if( req.method === "OPTIONS" ) {
    res.status( 204 ).send( "" )
    return
  }
  if( req.method !== "POST" ) {
    res.status( 405 ).json( { error: "Method not allowed" } )
    return
  }
  try {
    const decoded = await verifyBearerToken( req )
    if( !decoded ) {
      res.status( 401 ).json( { error: "User session is required." } )
      return
    }
    const result = await retryAcceptedErrorReportPropagation( {
      admin,
      logger,
      uid: decoded.uid,
      body: req.body && typeof req.body === "object" ? req.body : {},
    } )
    res.status( 200 ).json( result )
  } catch( err ) {
    const statusCode = err instanceof PropagatedErrorReportsError ? err.statusCode : 500
    const message = err instanceof Error ? err.message : "Unexpected error"
    logger.warn( "retryPropagatedErrorReports failed", { statusCode, message } )
    res.status( statusCode ).json( {
      error: statusCode === 500 ? "Internal server error" : message,
    } )
  }
}

const createPropagateAcceptedErrorReportHandler = ({ admin, logger }) => async (event) => {
  const beforeData = event.data?.before?.data?.() || {}
  const afterData = event.data?.after?.data?.() || {}
  const versionId = event.params?.versionId || event.data?.after?.id || ""
  return propagateAcceptedErrorReport( {
    admin,
    logger,
    versionId,
    beforeData,
    afterData,
    afterRef: event.data?.after?.ref,
  } )
}

module.exports = {
  PROPAGATED_REPORT_ID_PREFIX,
  createPropagateAcceptedErrorReportHandler,
  createRetryPropagatedErrorReportsHandler,
  didAcceptVersion,
  propagatedReportIdFor,
  propagateAcceptedErrorReport,
  retryAcceptedErrorReportPropagation,
}
