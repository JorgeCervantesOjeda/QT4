const { onRequest } = require( "firebase-functions/v2/https" )
const { logger } = require( "firebase-functions" )
const admin = require( "firebase-admin" )
const nodemailer = require( "nodemailer" )

if( admin.apps.length === 0 ) {
  admin.initializeApp()
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const getEnv = (name, fallback = "" ) => {
  const value = process.env[name]
  if( typeof value !== "string" ) {
    return fallback
  }
  return value.trim()
}

const getEnvMany = (names, fallback = "" ) => {
  for( const name of names ) {
    const value = getEnv( name, "" )
    if( value ) {
      return value
    }
  }
  return fallback
}

const parseBoolean = (value, fallback) => {
  const normalized = String( value ).trim().toLowerCase()
  if( normalized === "true" ) {
    return true
  }
  if( normalized === "false" ) {
    return false
  }
  return fallback
}

const normalizeRecipientList = (value, maxItems = 50) => {
  if( !Array.isArray( value ) ) {
    return []
  }
  const normalized = value
    .map( ( item ) => ( typeof item === "string" ? item.trim().toLowerCase() : "" ) )
    .filter( ( email ) => email.length > 0 && EMAIL_PATTERN.test( email ) )
  return [ ...new Set( normalized ) ].slice( 0, maxItems )
}

const normalizeOriginValue = (value) => String( value || "" ).trim().replace( /\/+$/, "" )

const isLocalDevOrigin = (origin) => {
  if( !origin ) {
    return false
  }
  try {
    const parsed = new URL( origin )
    const hostname = parsed.hostname.toLowerCase()
    const isLoopbackHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:"
    return isLoopbackHost && isHttp
  } catch {
    return false
  }
}

const setCorsHeaders = (req, res) => {
  const origin = normalizeOriginValue( req.headers.origin )
  const configuredAllowList = getEnv( "NOTIFY_ALLOWED_ORIGINS", "" )
    .split( "," )
    .map( normalizeOriginValue )
    .filter( Boolean )
  const allowAll = configuredAllowList.includes( "*" )
  const allowList = [ ...new Set( configuredAllowList ) ]

  if( allowAll || configuredAllowList.length === 0 ) {
    res.set( "Access-Control-Allow-Origin", "*" )
  } else if( origin && ( allowList.includes( origin ) || isLocalDevOrigin( origin ) ) ) {
    res.set( "Access-Control-Allow-Origin", origin )
    res.set( "Vary", "Origin" )
  }
  res.set( "Access-Control-Allow-Methods", "POST, OPTIONS" )
  res.set( "Access-Control-Allow-Headers", "Authorization, Content-Type" )
  res.set( "Access-Control-Max-Age", "3600" )
}

const verifyBearerToken = async (req) => {
  const authHeader = typeof req.headers.authorization === "string"
    ? req.headers.authorization
    : ""
  const bearerPrefix = "Bearer "
  if( !authHeader.startsWith( bearerPrefix ) ) {
    return null
  }
  const token = authHeader.slice( bearerPrefix.length ).trim()
  if( !token ) {
    return null
  }
  return admin.auth().verifyIdToken( token )
}

const createTransport = () => {
  const hasLegacyGmailEnv = Boolean(
    getEnvMany( [
      "QUALITEAM_GMAIL_USER",
      "QUALITEAM_GMAIL_CLIENT_ID",
      "QUALITEAM_GMAIL_CLIENT_SECRET",
      "QUALITEAM_GMAIL_REFRESH_TOKEN",
    ] ),
  )
  const host = getEnvMany(
    [ "SMTP_HOST", "MAIL_SMTP_HOST" ],
    hasLegacyGmailEnv ? "smtp.gmail.com" : "",
  )
  const portRaw = getEnvMany(
    [ "SMTP_PORT", "MAIL_SMTP_PORT" ],
    hasLegacyGmailEnv ? "587" : "587",
  )
  const secureRaw = getEnv( "SMTP_SECURE", "" )
  const user = getEnvMany(
    [ "SMTP_USER", "MAIL_SMTP_USER", "MAIL_FROM_ADDRESS", "QUALITEAM_GMAIL_USER" ],
  )
  const oauthClientId = getEnvMany(
    [ "SMTP_OAUTH_CLIENT_ID", "MAIL_OAUTH_CLIENT_ID", "QUALITEAM_GMAIL_CLIENT_ID" ],
  )
  const oauthClientSecret = getEnvMany(
    [ "SMTP_OAUTH_CLIENT_SECRET", "MAIL_OAUTH_CLIENT_SECRET", "QUALITEAM_GMAIL_CLIENT_SECRET" ],
  )
  const oauthRefreshToken = getEnvMany(
    [ "SMTP_OAUTH_REFRESH_TOKEN", "MAIL_OAUTH_REFRESH_TOKEN", "QUALITEAM_GMAIL_REFRESH_TOKEN" ],
  )

  const port = Number( portRaw )
  if( !host || !user ) {
    throw new Error( "SMTP configuration is incomplete (SMTP_HOST/SMTP_USER)." )
  }
  if( !Number.isFinite( port ) || port <= 0 ) {
    throw new Error( "SMTP_PORT must be a valid positive number." )
  }
  const secure = parseBoolean( secureRaw, port === 465 )
  const hasOauth = Boolean( oauthClientId && oauthClientSecret && oauthRefreshToken )
  if( !hasOauth ) {
    throw new Error(
      "OAuth2 credentials are required (SMTP_OAUTH_* or MAIL_OAUTH_* or QUALITEAM_GMAIL_*).",
    )
  }

  return nodemailer.createTransport( {
    host,
    port,
    secure,
    auth: {
      type: "OAuth2",
      user,
      clientId: oauthClientId,
      clientSecret: oauthClientSecret,
      refreshToken: oauthRefreshToken,
    },
  } )
}

exports.notifyEmail = onRequest( { cors: false, maxInstances: 5 }, async (req, res) => {
  setCorsHeaders( req, res )
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
      res.status( 401 ).json( { error: "Invalid or expired Firebase session token" } )
      return
    }

    const body = req.body && typeof req.body === "object" ? req.body : {}
    const to = normalizeRecipientList( body.to, 50 )
    const cc = normalizeRecipientList( body.cc, 50 ).filter( (email) => !to.includes( email ) )
    const subject = typeof body.subject === "string" ? body.subject.trim() : ""
    const text = typeof body.text === "string" ? body.text.trim() : ""
    const from = getEnvMany(
      [ "SMTP_FROM", "MAIL_FROM_ADDRESS", "MAIL_SMTP_USER", "SMTP_USER", "QUALITEAM_GMAIL_USER" ],
    )

    if( to.length === 0 ) {
      res.status( 400 ).json( { error: "At least one valid recipient is required in 'to'." } )
      return
    }
    if( !subject ) {
      res.status( 400 ).json( { error: "Subject is required." } )
      return
    }
    if( !text ) {
      res.status( 400 ).json( { error: "Text body is required." } )
      return
    }
    if( !from || !EMAIL_PATTERN.test( from ) ) {
      res.status( 500 ).json( { error: "SMTP_FROM is missing or invalid." } )
      return
    }

    const transporter = createTransport()
    const info = await transporter.sendMail( {
      from,
      to,
      cc: cc.length > 0 ? cc : undefined,
      subject,
      text,
    } )

    logger.info( "notifyEmail sent", {
      uid: decoded.uid,
      toCount: to.length,
      ccCount: cc.length,
      messageId: info.messageId || "",
    } )

    res.status( 200 ).json( {
      ok: true,
      messageId: info.messageId || null,
      accepted: Array.isArray( info.accepted ) ? info.accepted : [],
      rejected: Array.isArray( info.rejected ) ? info.rejected : [],
    } )
  } catch( err ) {
    const message = err instanceof Error ? err.message : "Unexpected error"
    logger.error( "notifyEmail failed", { message } )
    res.status( 500 ).json( { error: "Internal server error", detail: message } )
  }
} )
