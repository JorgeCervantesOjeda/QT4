// functions/versionDecisionRules.js: Pure rules for version numbering and review evidence.
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

module.exports = {
  hasReviewEvidence,
  isIntegerVersionNumber,
  promotedNumberFor,
  versionNumber,
}
