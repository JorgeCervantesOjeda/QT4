// functions/propagatedFileCopies.js: Prepares file metadata and storage copies for propagated reports.
const normalizeString = (value) => String( value || "" ).trim()

const normalizeStorageProvider = (value) =>
  value === "firebase-storage" ? "firebase-storage" : "files-api"

const sanitizeFileSegment = (value) => normalizeString( value )
  .replace( /[\\/#?]/g, "-" )
  .replace( /\s+/g, " " )
  .trim() || "unknown"

const sanitizeFileName = (value) => {
  const normalized = normalizeString( value )
    .replace( /[\\/#?]/g, "-" )
    .replace( /\s+/g, " " )
    .trim()
  return normalized || "file.bin"
}

const buildPropagatedFileKey = ({
  targetProjectId,
  propagatedDocId,
  propagatedVersionId,
  fileName,
}) => [
  "qt4",
  sanitizeFileSegment( targetProjectId ),
  sanitizeFileSegment( propagatedDocId ),
  sanitizeFileSegment( propagatedVersionId ),
  sanitizeFileName( fileName ),
].join( "/" )

const preparePropagatedFile = async ({
  admin,
  db,
  logger,
  acceptedVersion,
  targetProjectId,
  propagatedDocId,
  propagatedVersionId,
  actorId,
}) => {
  const sourceFileRefId = normalizeString( acceptedVersion.fileRefId )
  if( acceptedVersion.hasFile !== true || !sourceFileRefId ) {
    logger.warn( "propagatedErrorReport skipped", {
      reason: "missing_source_file_ref",
      sourceVersionId: acceptedVersion.id,
    } )
    return {
      ok: false,
      failure: { reason: "missing_source_file_ref" },
    }
  }
  const sourceFileSnapshot = await db.collection( "files" ).doc( sourceFileRefId ).get()
  if( !sourceFileSnapshot.exists ) {
    logger.warn( "propagatedErrorReport skipped", {
      reason: "missing_source_file_metadata",
      sourceFileRefId,
    } )
    return {
      ok: false,
      failure: { reason: "missing_source_file_metadata", sourceFileRefId },
    }
  }
  const sourceFile = sourceFileSnapshot.data() || {}
  const sourceFileKey = normalizeString( sourceFile.fileKey )
  if( !sourceFileKey ) {
    logger.warn( "propagatedErrorReport skipped", {
      reason: "missing_source_file_key",
      sourceFileRefId,
    } )
    return {
      ok: false,
      failure: { reason: "missing_source_file_key", sourceFileRefId },
    }
  }
  const fileName = sanitizeFileName( sourceFile.fileName || sourceFileKey.split( "/" ).pop() )
  const storageProvider = normalizeStorageProvider( sourceFile.storageProvider )
  const propagatedFileRef = db.collection( "files" ).doc()
  const propagatedFileKey = storageProvider === "firebase-storage"
    ? buildPropagatedFileKey( {
      targetProjectId,
      propagatedDocId,
      propagatedVersionId,
      fileName,
    } )
    : sourceFileKey
  if( storageProvider === "firebase-storage" ) {
    if( typeof admin.storage !== "function" ) {
      logger.warn( "propagatedErrorReport skipped", {
        reason: "storage_copy_unavailable",
        sourceFileRefId,
      } )
      return {
        ok: false,
        failure: { reason: "storage_copy_unavailable", sourceFileRefId },
      }
    }
    try {
      await admin.storage().bucket().file( sourceFileKey ).copy( propagatedFileKey )
    } catch( err ) {
      logger.warn( "propagatedErrorReport skipped", {
        reason: "storage_copy_failed",
        sourceFileRefId,
        sourceFileKey,
        propagatedFileKey,
        impact: "propagated_report_not_created",
        error: err instanceof Error ? err.message : String( err ),
      } )
      return {
        ok: false,
        failure: { reason: "storage_copy_failed", sourceFileRefId },
      }
    }
  }
  return {
    ok: true,
    id: propagatedFileRef.id,
    ref: propagatedFileRef,
    data: {
      fileKey: propagatedFileKey,
      fileName,
      contentType: sourceFile.contentType || "application/octet-stream",
      sizeBytes: Number( sourceFile.sizeBytes || 0 ),
      isPermanent: Boolean( sourceFile.isPermanent ),
      expireAfterDays: typeof sourceFile.expireAfterDays === "number"
        ? Number( sourceFile.expireAfterDays )
        : null,
      storageProvider,
      projectId: targetProjectId,
      docId: propagatedDocId,
      versionId: propagatedVersionId,
      sourceFileRefId,
      sourceFileKey,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: actorId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: actorId,
    },
  }
}

module.exports = {
  buildPropagatedFileKey,
  preparePropagatedFile,
}
