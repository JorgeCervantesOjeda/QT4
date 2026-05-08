const { onRequest } = require( "firebase-functions/v2/https" )
const { logger } = require( "firebase-functions" )
const admin = require( "firebase-admin" )
const nodemailer = require( "nodemailer" )
const crypto = require( "node:crypto" )

if( admin.apps.length === 0 ) {
  admin.initializeApp()
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MONITOR_SOURCES = new Set( [ "firestore", "storage", "auth", "ui", "network", "unknown" ] )
const MONITOR_CATEGORIES = new Set( [ "permission", "runtime", "network", "auth", "firebase", "unknown" ] )
const MONITOR_SEVERITIES = new Set( [ "low", "medium", "high" ] )
const MONITOR_SEVERITY_RANK = { low: 1, medium: 2, high: 3 }

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

const setCorsHeaders = (req, res, envNames = [ "NOTIFY_ALLOWED_ORIGINS" ] ) => {
  const origin = normalizeOriginValue( req.headers.origin )
  const configuredAllowList = envNames
    .flatMap( ( name ) => getEnv( name, "" ).split( "," ) )
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

const parseIntegerEnv = (name, fallback) => {
  const raw = Number( getEnv( name, "" ) )
  return Number.isFinite( raw ) && raw > 0 ? Math.floor( raw ) : fallback
}

const trimSingleLine = (value, maxLength = 200) =>
  String( value || "" ).replace( /\s+/g, " " ).trim().slice( 0, maxLength )

const trimMultiline = (value, maxLength = 2000) =>
  String( value || "" ).replace( /\r\n/g, "\n" ).trim().slice( 0, maxLength )

const normalizeMonitorRecipients = () => normalizeRecipientList(
  getEnv( "MONITOR_ALERT_TO", "" )
    .split( "," )
    .map( ( item ) => item.trim() )
    .filter( Boolean ),
  50,
)

const stableHash = (value) => crypto.createHash( "sha256" ).update( String( value || "" ) ).digest( "hex" )

const buildMonitorFingerprint = (payload) =>
  stableHash(
    [
      trimSingleLine( payload.source, 32 ),
      trimSingleLine( payload.category, 32 ),
      trimSingleLine( payload.code, 120 ),
      trimSingleLine( payload.messageNormalized, 500 ),
      trimSingleLine( payload.route, 240 ),
      trimSingleLine( payload.action, 120 ),
    ].join( "|" ),
  ).slice( 0, 24 )

const normalizeMonitorField = (value, maxLength) => trimSingleLine( value, maxLength )

const normalizeMonitorPayload = (body, decoded, req) => {
  const source = normalizeMonitorField( body.source, 32 )
  const category = normalizeMonitorField( body.category, 32 )
  const severity = normalizeMonitorField( body.severity, 16 )
  const messageNormalized = normalizeMonitorField( body.messageNormalized || body.messageRaw, 500 )
  const normalized = {
    fingerprint: normalizeMonitorField( body.fingerprint, 80 ),
    source: MONITOR_SOURCES.has( source ) ? source : "unknown",
    category: MONITOR_CATEGORIES.has( category ) ? category : "unknown",
    severity: MONITOR_SEVERITIES.has( severity ) ? severity : "medium",
    code: normalizeMonitorField( body.code, 120 ),
    name: normalizeMonitorField( body.name, 120 ),
    messageRaw: trimMultiline( body.messageRaw || "Unexpected error", 2000 ),
    messageNormalized,
    stack: trimMultiline( body.stack, 4000 ),
    route: normalizeMonitorField( body.route, 240 ),
    pageUrl: trimSingleLine( body.pageUrl, 1000 ),
    action: normalizeMonitorField( body.action, 120 ) || "unknown",
    actorId: normalizeMonitorField( body.actorId || decoded.uid, 128 ) || decoded.uid,
    actorEmail: normalizeMonitorField( body.actorEmail || decoded.email || "", 200 ),
    projectId: normalizeMonitorField( body.projectId, 128 ),
    docId: normalizeMonitorField( body.docId, 128 ),
    versionId: normalizeMonitorField( body.versionId, 128 ),
    threadId: normalizeMonitorField( body.threadId, 128 ),
    pageLabel: trimMultiline( body.pageLabel, 200 ),
    projectLabel: trimMultiline( body.projectLabel, 200 ),
    docLabel: trimMultiline( body.docLabel, 200 ),
    versionLabel: trimMultiline( body.versionLabel, 200 ),
    threadLabel: trimMultiline( body.threadLabel, 200 ),
    userAgent: trimSingleLine( body.userAgent || req.headers[ "user-agent" ] || "", 400 ),
    appBuild: normalizeMonitorField( body.appBuild, 120 ),
    clientTimestamp: normalizeMonitorField( body.clientTimestamp, 64 ),
  }
  if( !normalized.fingerprint ) {
    normalized.fingerprint = buildMonitorFingerprint( normalized )
  }
  return normalized
}

const shouldEmailMonitorEvent = (severity) => {
  const configuredMinimum = normalizeMonitorField( getEnv( "MONITOR_MIN_EMAIL_SEVERITY", "medium" ), 16 )
  const minimumSeverity = MONITOR_SEVERITIES.has( configuredMinimum ) ? configuredMinimum : "medium"
  return MONITOR_SEVERITY_RANK[severity] >= MONITOR_SEVERITY_RANK[minimumSeverity]
}

const buildMonitorConsoleUrl = (docId) => {
  const projectId = getEnv( "GCLOUD_PROJECT", getEnv( "GOOGLE_CLOUD_PROJECT", "" ) )
  if( !projectId || !docId ) {
    return ""
  }
  return `https://console.firebase.google.com/project/${projectId}/firestore/data/~2FmonitorEvents~2F${docId}`
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

const sendTextEmail = async ({ to, cc = [], subject, text }) => {
  const from = getEnvMany(
    [ "SMTP_FROM", "MAIL_FROM_ADDRESS", "MAIL_SMTP_USER", "SMTP_USER", "QUALITEAM_GMAIL_USER" ],
  )
  if( !from || !EMAIL_PATTERN.test( from ) ) {
    throw new Error( "SMTP_FROM is missing or invalid." )
  }
  const transporter = createTransport()
  return transporter.sendMail( {
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject,
    text,
  } )
}

exports.notifyEmail = onRequest( { cors: false, maxInstances: 5, invoker: "public" }, async (req, res) => {
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

    const info = await sendTextEmail( {
      to,
      cc,
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

exports.reportClientMonitorEvent = onRequest( { cors: false, maxInstances: 10, invoker: "public" }, async (req, res) => {
  setCorsHeaders( req, res, [ "MONITOR_ALLOWED_ORIGINS", "NOTIFY_ALLOWED_ORIGINS" ] )
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
    const payload = normalizeMonitorPayload( body, decoded, req )
    if( !payload.messageRaw || !payload.messageNormalized ) {
      res.status( 400 ).json( { error: "messageRaw or messageNormalized is required." } )
      return
    }

    const dedupeWindowMinutes = parseIntegerEnv( "MONITOR_DEDUPE_WINDOW_MINUTES", 15 )
    const dedupeWindowMs = dedupeWindowMinutes * 60 * 1000
    const dedupeBucket = Math.floor( Date.now() / dedupeWindowMs )
    const docId = `${payload.fingerprint}_${dedupeBucket}`
    const docRef = admin.firestore().collection( "monitorEvents" ).doc( docId )
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp()
    const recipients = normalizeMonitorRecipients()
    let shouldAttemptEmail = false
    let eventWasCreated = false

    await admin.firestore().runTransaction( async (transaction) => {
      const snapshot = await transaction.get( docRef )
      if( snapshot.exists ) {
        const data = snapshot.data() || {}
        shouldAttemptEmail = Boolean(
          recipients.length > 0
          && shouldEmailMonitorEvent( payload.severity )
          && data.emailStatus === "failed",
        )
        transaction.set( docRef, {
          severity: payload.severity,
          category: payload.category,
          source: payload.source,
          code: payload.code,
          name: payload.name,
          route: payload.route,
          action: payload.action,
          actorId: payload.actorId,
          actorEmail: payload.actorEmail,
          projectId: payload.projectId,
          docId: payload.docId,
          versionId: payload.versionId,
          threadId: payload.threadId,
          lastSeenAt: serverTimestamp,
          updatedAt: serverTimestamp,
          occurrenceCount: admin.firestore.FieldValue.increment( 1 ),
          lastPayload: payload,
          emailStatus: shouldAttemptEmail ? "retrying" : data.emailStatus || "skipped",
        }, { merge: true } )
        return
      }

      eventWasCreated = true
      shouldAttemptEmail = recipients.length > 0 && shouldEmailMonitorEvent( payload.severity )
      transaction.set( docRef, {
        fingerprint: payload.fingerprint,
        category: payload.category,
        severity: payload.severity,
        source: payload.source,
        code: payload.code,
        name: payload.name,
        messageRaw: payload.messageRaw,
        messageNormalized: payload.messageNormalized,
        route: payload.route,
        pageUrl: payload.pageUrl,
        action: payload.action,
        actorId: payload.actorId,
        actorEmail: payload.actorEmail,
        projectId: payload.projectId,
        docId: payload.docId,
        versionId: payload.versionId,
        threadId: payload.threadId,
        dedupeWindowMinutes,
        dedupeBucket,
        occurrenceCount: 1,
        firstSeenAt: serverTimestamp,
        lastSeenAt: serverTimestamp,
        createdAt: serverTimestamp,
        updatedAt: serverTimestamp,
        emailStatus: shouldAttemptEmail ? "pending" : "skipped",
        lastPayload: payload,
      } )
    } )

    if( shouldAttemptEmail ) {
      const consoleUrl = buildMonitorConsoleUrl( docId )
      const projectLine = payload.projectLabel || payload.projectId || "-"
      const documentLine = payload.docLabel || payload.docId || "-"
      const versionLine = payload.versionLabel || payload.versionId || "-"
      const threadLine = payload.threadLabel || payload.threadId || "-"
      const emailText = [
        `QT4 abnormal client error detected.`,
        ``,
        `Severity: ${payload.severity}`,
        `Category: ${payload.category}`,
        `Source: ${payload.source}`,
        `Action: ${payload.action}`,
        `Page: ${payload.pageLabel || payload.route || "(unknown)"}`,
        `Code: ${payload.code || "(none)"}`,
        `Actor: ${payload.actorId || "(unknown)"}`,
        `Actor email: ${payload.actorEmail || "(unknown)"}`,
        `Project: ${projectLine}`,
        `Document: ${documentLine}`,
        `Version: ${versionLine}`,
        `Issue: ${threadLine}`,
        `Fingerprint: ${payload.fingerprint}`,
        `Client timestamp: ${payload.clientTimestamp || "-"}`,
        `Build: ${payload.appBuild || "-"}`,
        ``,
        payload.route ? `Route: ${payload.route}` : "",
        payload.projectId ? `Project ID: ${payload.projectId}` : "",
        payload.docId ? `Document ID: ${payload.docId}` : "",
        payload.versionId ? `Version ID: ${payload.versionId}` : "",
        payload.threadId ? `Issue ID: ${payload.threadId}` : "",
        payload.route || payload.projectId || payload.docId || payload.versionId || payload.threadId ? `` : "",
        `Message:`,
        payload.messageRaw,
        payload.stack ? `\nStack:\n${payload.stack}` : "",
        payload.pageUrl ? `\nPage URL:\n${payload.pageUrl}` : "",
        consoleUrl ? `\nFirestore event:\n${consoleUrl}` : "",
      ].filter( Boolean ).join( "\n" )

      try {
        await sendTextEmail( {
          to: recipients,
          subject: `[QT4][${payload.severity.toUpperCase()}][${payload.category}] ${payload.action}`,
          text: emailText,
        } )
        await docRef.set( {
          emailStatus: "sent",
          emailedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastEmailError: "",
        }, { merge: true } )
      } catch( err ) {
        const message = err instanceof Error ? err.message : "Unexpected email error"
        logger.error( "reportClientMonitorEvent email failed", {
          fingerprint: payload.fingerprint,
          docId,
          message,
        } )
        await docRef.set( {
          emailStatus: "failed",
          lastEmailError: trimSingleLine( message, 500 ),
          lastEmailAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true } )
      }
    }

    logger.info( "reportClientMonitorEvent stored", {
      docId,
      fingerprint: payload.fingerprint,
      severity: payload.severity,
      category: payload.category,
      eventWasCreated,
      emailAttempted: shouldAttemptEmail,
    } )

    res.status( 200 ).json( {
      ok: true,
      docId,
      fingerprint: payload.fingerprint,
      created: eventWasCreated,
      emailAttempted: shouldAttemptEmail,
    } )
  } catch( err ) {
    const message = err instanceof Error ? err.message : "Unexpected error"
    logger.error( "reportClientMonitorEvent failed", { message } )
    res.status( 500 ).json( { error: "Internal server error", detail: message } )
  }
} )
