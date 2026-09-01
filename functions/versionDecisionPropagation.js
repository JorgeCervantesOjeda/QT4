// functions/versionDecisionPropagation.js: Appends error-report propagation results to accept decisions.
const failedPropagationResultFor = (reason) => ( {
  createdCount: 0,
  skippedCount: 0,
  failedCount: 1,
  failures: [ { reason } ],
} )

const appendPropagatedErrorReportsToDecisionResult = async ({
  admin,
  logger,
  request,
  result,
  propagationContext,
  propagateAcceptedErrorReport,
}) => {
  if( !propagationContext ) {
    return result
  }
  const response = { ...result }
  try {
    response.propagatedErrorReports = await propagateAcceptedErrorReport( {
      admin,
      logger,
      versionId: request.versionId,
      beforeData: propagationContext.beforeData,
      afterData: propagationContext.afterData,
      afterRef: propagationContext.afterRef,
      ignoreDecisionMarker: true,
    } )
  } catch( err ) {
    const message = err instanceof Error ? err.message : String( err )
    logger.error( "versionDecision propagatedErrorReports failed", {
      projectId: request.projectId,
      docId: request.docId,
      versionId: request.versionId,
      message,
      impact: "accepted_version_returned_with_retry_prompt",
    } )
    response.propagatedErrorReports = failedPropagationResultFor( "propagation_exception" )
  }
  return response
}

module.exports = {
  appendPropagatedErrorReportsToDecisionResult,
}
