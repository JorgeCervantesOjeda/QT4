// functions/monitorDetails.js
// Bounds structured monitor diagnostics before persistence and email delivery.
const MAX_OBJECT_KEYS = 40
const MAX_ARRAY_ITEMS = 20
const MAX_STRING_LENGTH = 500
const MAX_DEPTH = 3

const normalizeString = (value) => String( value || "" ).replace( /\s+/g, " " ).trim().slice( 0, MAX_STRING_LENGTH )

const normalizeMonitorDetails = (value, depth = 0) => {
  if( depth > MAX_DEPTH ) {
    return "[truncated]"
  }
  if( value === null || typeof value === "boolean" ) {
    return value
  }
  if( typeof value === "number" ) {
    return Number.isFinite( value ) ? value : null
  }
  if( typeof value === "string" ) {
    return normalizeString( value )
  }
  if( Array.isArray( value ) ) {
    return value.slice( 0, MAX_ARRAY_ITEMS ).map( (entry) => normalizeMonitorDetails( entry, depth + 1 ) )
  }
  if( typeof value !== "object" ) {
    return null
  }

  return Object.fromEntries(
    Object.entries( value )
      .slice( 0, MAX_OBJECT_KEYS )
      .map( ([key, entry]) => [ normalizeString( key ).slice( 0, 80 ), normalizeMonitorDetails( entry, depth + 1 ) ]),
  )
}

module.exports = {
  normalizeMonitorDetails,
}
