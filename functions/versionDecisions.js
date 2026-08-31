// functions/versionDecisions.js: Applies accepted/rejected version decisions with transactional side effects.
const DECISIONS = new Set( [ "accept", "reject" ] )

const ACCEPTED_DERIVED_DOCUMENT_MESSAGE =
  "This derived line already has an accepted derived document. Create an error report to request more changes."
const DERIVED_GENERATION_IN_PROGRESS_MESSAGE =
  "A derived variant is being generated for this line. Wait until generation finishes before accepting more changes."
const STALE_DERIVED_DOCUMENT_MESSAGE =
  "This derived variant no longer matches the active accepted change requests. Create a new derived variant before accepting."

class VersionDecisionError extends Error {
  constructor(message, statusCode = 400) {
    super( message )
    this.name = "VersionDecisionError"
    this.statusCode = statusCode
  }
}

const normalizeString = (value) => String( value || "" ).trim()

const normalizeStringArray = (value) =>
  Array.isArray( value ) ? value.filter( (item) => typeof item === "string" && item.trim() ) : []

const normalizeVersionDecisionRequest = (body) => {
  const decision = normalizeString( body?.decision )
  if( !DECISIONS.has( decision ) ) {
    throw new VersionDecisionError( "Unsupported version decision." )
  }
  const request = {
    decision,
    projectId: normalizeString( body?.projectId ),
    docId: normalizeString( body?.docId ),
    versionId: normalizeString( body?.versionId ),
  }
  if( !request.projectId || !request.docId || !request.versionId ) {
    throw new VersionDecisionError( "projectId, docId and versionId are required." )
  }
  return request
}

const buildDerivationLineKey = ({
  variantProjectId,
  originProjectId,
  originDocumentId,
  originVersionId,
}) => [
  variantProjectId,
  originProjectId,
  originDocumentId,
  originVersionId,
].join( "|" )

const versionNumber = (versionData) => {
  const value = Number( versionData?.number )
  return Number.isFinite( value ) ? value : 0
}

const isIntegerVersionNumber = (value) => Number.isInteger( Number( value ) )

const numOfVersionStat = (versionData, fieldName) => {
  const statsValue = versionData?.stats?.[fieldName]
  if( typeof statsValue === "number" ) {
    return statsValue
  }
  const rootValue = versionData?.[fieldName]
  return typeof rootValue === "number" ? rootValue : 0
}

const hasReviewEvidence = (versionData) =>
  versionData?.hasFile === true
  && numOfVersionStat( versionData, "numThreads" ) > 0
  && numOfVersionStat( versionData, "numThreadsWithTwoPlusComments" ) > 0
  && numOfVersionStat( versionData, "numOpenThreads" ) === 0

const promotedNumberFor = (number) => ( Math.floor( number / 100 ) + 1 ) * 100

const areStringSetsEqual = (left, right) => {
  if( left.length !== right.length ) {
    return false
  }
  const rightValues = new Set( right )
  return left.every( (item) => rightValues.has( item ) )
}

const createRefs = (db, request) => ( {
  documentRef: db.collection( "documents" ).doc( request.docId ),
  versionRef: db.collection( "versions" ).doc( request.versionId ),
  memberRef: db.collection( "projectMembers" ).doc( `${request.projectId}_${request.uid}` ),
  profileRef: db.collection( "userProfiles" ).doc( request.uid ),
  counterRef: db.collection( "counters" ).doc( `versions_${request.docId}` ),
  versionsQuery: db
    .collection( "versions" )
    .where( "projectId", "==", request.projectId )
    .where( "docId", "==", request.docId ),
} )

const assertActorCanDecide = ({ uid, versionData, memberData, profileData }) => {
  const role = normalizeString( memberData?.role )
  const isAdmin = profileData?.isAdmin === true
  const isLeader = role === "leader"
  const isMember = role === "leader" || role === "member"
  const isAuthor = normalizeString( versionData?.createdBy ) === uid
  if( !isAdmin && !isMember ) {
    throw new VersionDecisionError( "Project membership is required.", 403 )
  }
  if( !isAdmin && !isLeader && !isAuthor ) {
    throw new VersionDecisionError( "Only the version author, project leader or admin can decide this version.", 403 )
  }
}

const assertVersionIsDecidable = ({ documentData, versionData, request }) => {
  if( documentData?.projectId !== request.projectId ) {
    throw new VersionDecisionError( "Document does not belong to the requested project.", 400 )
  }
  if( versionData?.projectId !== request.projectId || versionData?.docId !== request.docId ) {
    throw new VersionDecisionError( "Version does not belong to the requested document.", 400 )
  }
  if( versionData.status !== "In Review" && versionData.status !== "Reviewed" ) {
    throw new VersionDecisionError( "Only versions in review or reviewed grace can be accepted or rejected.", 409 )
  }
  if( !hasReviewEvidence( versionData ) ) {
    throw new VersionDecisionError( "Version review evidence is incomplete.", 409 )
  }
}

const assertLatestVersion = ({ versionsSnapshot, request, versionData }) => {
  const higherVersion = ( versionsSnapshot.docs || [] ).find( (snapshot) =>
    snapshot.id !== request.versionId
    && versionNumber( snapshot.data() || {} ) > versionNumber( versionData ),
  )
  if( higherVersion ) {
    throw new VersionDecisionError( "Only the latest version can be decided.", 409 )
  }
}

const acceptedVersionSnapshots = ({ versionsSnapshot, request }) =>
  ( versionsSnapshot.docs || [] ).filter( (snapshot) => {
    const data = snapshot.data() || {}
    return snapshot.id !== request.versionId
      && data.status === "Accepted"
      && isIntegerVersionNumber( data.number )
  } )

const validateAndStageChangeRequestAccept = async ({
  db,
  transaction,
  request,
  documentData,
  versionId,
  timestamp,
}) => {
  const baseProjectId = normalizeString( documentData.baseProjectId )
  const baseDocId = normalizeString( documentData.baseDocId )
  const baseVersionId = normalizeString( documentData.baseVersionId )
  if( !baseProjectId || !baseDocId || !baseVersionId ) {
    throw new VersionDecisionError(
      "Invalid change request data: baseProjectId, baseDocId and baseVersionId are required.",
      409,
    )
  }
  const configId = buildDerivationLineKey( {
    variantProjectId: request.projectId,
    originProjectId: baseProjectId,
    originDocumentId: baseDocId,
    originVersionId: baseVersionId,
  } )
  const configRef = db.collection( "derivedConfigurations" ).doc( configId )
  const configSnapshot = await transaction.get( configRef )
  const configData = configSnapshot.exists ? configSnapshot.data() || {} : {}
  if( configData.status === "Accepted" ) {
    throw new VersionDecisionError( ACCEPTED_DERIVED_DOCUMENT_MESSAGE, 409 )
  }
  if( configData.generationStatus === "generating" ) {
    throw new VersionDecisionError( DERIVED_GENERATION_IN_PROGRESS_MESSAGE, 409 )
  }
  const activeChangeRequestVersionIds = [
    ...new Set( [
      ...normalizeStringArray( configData.activeChangeRequestVersionIds ),
      versionId,
    ] ),
  ].sort()
  transaction.set( configRef, {
    key: configId,
    projectId: request.projectId,
    originProjectId: baseProjectId,
    originDocumentId: baseDocId,
    originVersionId: baseVersionId,
    activeChangeRequestVersionIds,
    status: "Open",
    generationStatus: "open",
    updatedAt: timestamp,
    updatedBy: request.uid,
  }, { merge: true } )
}

const validateAndStageDerivedDocumentAccept = async ({
  db,
  transaction,
  request,
  documentData,
  versionId,
  timestamp,
}) => {
  const originProjectId = normalizeString( documentData.originProjectId )
  const originDocumentId = normalizeString( documentData.originDocumentId )
  const originVersionId = normalizeString( documentData.originVersionId )
  if( !originProjectId || !originDocumentId || !originVersionId ) {
    throw new VersionDecisionError(
      "Invalid derived document data: originProjectId, originDocumentId and originVersionId are required.",
      409,
    )
  }
  const configId = buildDerivationLineKey( {
    variantProjectId: request.projectId,
    originProjectId,
    originDocumentId,
    originVersionId,
  } )
  const configRef = db.collection( "derivedConfigurations" ).doc( configId )
  const configSnapshot = await transaction.get( configRef )
  const configData = configSnapshot.exists ? configSnapshot.data() || {} : {}
  const activeChangeRequestVersionIds = normalizeStringArray( configData.activeChangeRequestVersionIds )
  const incorporatedChangeRequestVersionIds = normalizeStringArray(
    documentData.incorporatedChangeRequestVersionIds,
  )
  if( !areStringSetsEqual( activeChangeRequestVersionIds, incorporatedChangeRequestVersionIds ) ) {
    throw new VersionDecisionError( STALE_DERIVED_DOCUMENT_MESSAGE, 409 )
  }
  transaction.set( configRef, {
    status: "Accepted",
    generationStatus: "accepted",
    acceptedDerivedDocumentId: request.docId,
    acceptedDerivedVersionId: versionId,
    updatedAt: timestamp,
    updatedBy: request.uid,
  }, { merge: true } )
  for( const changeRequestVersionId of incorporatedChangeRequestVersionIds ) {
    const changeRequestVersionRef = db.collection( "versions" ).doc( changeRequestVersionId )
    const changeRequestVersionSnapshot = await transaction.get( changeRequestVersionRef )
    if( !changeRequestVersionSnapshot.exists ) {
      throw new VersionDecisionError( "An incorporated change request version was not found.", 409 )
    }
    const changeRequestVersionData = changeRequestVersionSnapshot.data() || {}
    if( changeRequestVersionData.status === "Accepted" ) {
      transaction.update( changeRequestVersionRef, {
        status: "Replaced",
        activityAt: timestamp,
        updatedAt: timestamp,
        updatedBy: request.uid,
      } )
    }
  }
}

const stageAuditLog = ({ db, transaction, request, email, decision, timestamp }) => {
  const auditRef = db.collection( "auditLogs" ).doc()
  transaction.set( auditRef, {
    actorId: request.uid,
    actorEmail: email || null,
    action: decision === "accept" ? "acceptVersion" : "rejectVersion",
    entityType: "version",
    entityId: request.versionId,
    projectId: request.projectId,
    docId: request.docId,
    versionId: request.versionId,
    createdAt: timestamp,
  } )
}

const decideVersion = async ({ admin, logger, uid, email = "", body }) => {
  const request = {
    ...normalizeVersionDecisionRequest( body ),
    uid: normalizeString( uid ),
  }
  if( !request.uid ) {
    throw new VersionDecisionError( "User session is required.", 401 )
  }
  const db = admin.firestore()
  const timestamp = admin.firestore.FieldValue.serverTimestamp()
  const result = await db.runTransaction( async (transaction) => {
    const refs = createRefs( db, request )
    const [
      documentSnapshot,
      versionSnapshot,
      memberSnapshot,
      profileSnapshot,
      versionsSnapshot,
    ] = await Promise.all( [
      transaction.get( refs.documentRef ),
      transaction.get( refs.versionRef ),
      transaction.get( refs.memberRef ),
      transaction.get( refs.profileRef ),
      transaction.get( refs.versionsQuery ),
    ] )
    if( !documentSnapshot.exists ) {
      throw new VersionDecisionError( "Document not found.", 404 )
    }
    if( !versionSnapshot.exists ) {
      throw new VersionDecisionError( "Version not found.", 404 )
    }
    const documentData = documentSnapshot.data() || {}
    const versionData = versionSnapshot.data() || {}
    const memberData = memberSnapshot.exists ? memberSnapshot.data() || {} : {}
    const profileData = profileSnapshot.exists ? profileSnapshot.data() || {} : {}

    assertActorCanDecide( { uid: request.uid, versionData, memberData, profileData } )
    assertVersionIsDecidable( { documentData, versionData, request } )
    assertLatestVersion( { versionsSnapshot, request, versionData } )

    const previousAcceptedSnapshots = acceptedVersionSnapshots( { versionsSnapshot, request } )
    const nextStatus = request.decision === "accept" ? "Accepted" : "Rejected"
    const promotedNumber = request.decision === "accept"
      ? promotedNumberFor( versionNumber( versionData ) )
      : null

    transaction.update( refs.versionRef, {
      status: nextStatus,
      ...( promotedNumber ? { number: promotedNumber } : {} ),
      activityAt: timestamp,
      updatedAt: timestamp,
      updatedBy: request.uid,
    } )

    if( request.decision === "accept" ) {
      transaction.set( refs.counterRef, {
        nextNumber: promotedNumber + 1,
        docId: request.docId,
        projectId: request.projectId,
        previousVersionId: request.versionId,
      }, { merge: true } )

      if( documentData.type === "changeRequest" ) {
        await validateAndStageChangeRequestAccept( {
          db,
          transaction,
          request,
          documentData,
          versionId: request.versionId,
          timestamp,
        } )
      }
      if( documentData.type === "derivedDocument" ) {
        await validateAndStageDerivedDocumentAccept( {
          db,
          transaction,
          request,
          documentData,
          versionId: request.versionId,
          timestamp,
        } )
      }
    }

    previousAcceptedSnapshots.forEach( (snapshot) => {
      transaction.update( db.collection( "versions" ).doc( snapshot.id ), {
        status: "Replaced",
        activityAt: timestamp,
        updatedAt: timestamp,
        updatedBy: request.uid,
      } )
    } )
    stageAuditLog( {
      db,
      transaction,
      request,
      email,
      decision: request.decision,
      timestamp,
    } )
    return {
      ok: true,
      decision: request.decision,
      docId: request.docId,
      projectId: request.projectId,
      versionId: request.versionId,
      promotedNumber,
      replacedVersionIds: previousAcceptedSnapshots.map( (snapshot) => snapshot.id ),
    }
  } )
  logger.info( "versionDecision applied", {
    uid: request.uid,
    projectId: request.projectId,
    docId: request.docId,
    versionId: request.versionId,
    decision: request.decision,
    replacedCount: result.replacedVersionIds.length,
  } )
  return result
}

const createVersionDecisionHandler = ({ admin, logger, verifyBearerToken, setCorsHeaders }) => async (req, res) => {
  setCorsHeaders( req, res, [ "VERSION_DECISION_ALLOWED_ORIGINS", "NOTIFY_ALLOWED_ORIGINS" ] )
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
    const result = await decideVersion( {
      admin,
      logger,
      uid: decoded.uid,
      email: decoded.email || "",
      body: req.body && typeof req.body === "object" ? req.body : {},
    } )
    res.status( 200 ).json( result )
  } catch( err ) {
    const statusCode = err instanceof VersionDecisionError ? err.statusCode : 500
    const message = err instanceof Error ? err.message : "Unexpected error"
    logger.warn( "versionDecision failed", {
      statusCode,
      message,
    } )
    res.status( statusCode ).json( {
      error: statusCode === 500 ? "Internal server error" : message,
    } )
  }
}

module.exports = {
  ACCEPTED_DERIVED_DOCUMENT_MESSAGE,
  DERIVED_GENERATION_IN_PROGRESS_MESSAGE,
  STALE_DERIVED_DOCUMENT_MESSAGE,
  VersionDecisionError,
  createVersionDecisionHandler,
  decideVersion,
  normalizeVersionDecisionRequest,
}
