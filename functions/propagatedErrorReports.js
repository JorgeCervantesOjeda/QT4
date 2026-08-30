// functions/propagatedErrorReports.js: Propagates accepted error reports to accepted derived variants.
const PROPAGATED_REPORT_ID_PREFIX = "propagatedErrorReport"

const normalizeString = (value) => String( value || "" ).trim()

const didAcceptVersion = (beforeData, afterData) =>
  beforeData?.status !== "Accepted" && afterData?.status === "Accepted"

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
    return { created: false, skipped: true }
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
      createdBy: acceptedVersion.updatedBy || acceptedVersion.createdBy || sourceReport.createdBy || "",
      authorId: acceptedVersion.updatedBy || acceptedVersion.createdBy || sourceReport.createdBy || "",
      updatedBy: acceptedVersion.updatedBy || acceptedVersion.createdBy || sourceReport.createdBy || "",
      shortId: nextNumber,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    } )
    transaction.set( propagatedVersionRef, {
      projectId: targetProjectId,
      docId: propagatedDocId,
      number: 1,
      status: "In Creation",
      createdBy: acceptedVersion.updatedBy || acceptedVersion.createdBy || sourceReport.createdBy || "",
      reviewerIds: [],
      reviewStartAt: null,
      reviewEndAt: null,
      hasFile: false,
      fileRefId: null,
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
      updatedBy: acceptedVersion.updatedBy || acceptedVersion.createdBy || sourceReport.createdBy || "",
    } )
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
}) => {
  if( !didAcceptVersion( beforeData, afterData ) ) {
    return { createdCount: 0, skippedCount: 0 }
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
    return { createdCount: 0, skippedCount: 1 }
  }
  const sourceReport = sourceReportSnapshot.data() || {}
  if( sourceReport.type !== "errorReport" || !sourceReport.baseDocId || !sourceReport.baseVersionId ) {
    return { createdCount: 0, skippedCount: 0 }
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
  logger.info( "propagatedErrorReport complete", {
    versionId,
    sourceReportId: sourceReportSnapshot.id,
    createdCount,
    skippedCount,
  } )
  return { createdCount, skippedCount }
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
  didAcceptVersion,
  propagatedReportIdFor,
  propagateAcceptedErrorReport,
}
