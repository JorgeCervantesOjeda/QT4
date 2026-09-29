// tools/verify-prod-function-env.mjs: Verifies production notification functions have email runtime configuration.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const productionProjectId = 'qualiteam-app'
export const productionRegion = 'us-central1'

export const notificationEmailServices = [
  'sendcommentnotification',
  'sendhourlynotificationdigest',
  'sendslowuiactiondigest',
]

export const emailEnvGroups = [
  {
    label: 'sender address',
    names: [ 'SMTP_FROM', 'MAIL_FROM_ADDRESS', 'MAIL_SMTP_USER', 'SMTP_USER', 'QUALITEAM_GMAIL_USER' ],
  },
  {
    label: 'SMTP host',
    names: [ 'SMTP_HOST', 'MAIL_SMTP_HOST', 'QUALITEAM_GMAIL_USER' ],
  },
  {
    label: 'SMTP user',
    names: [ 'SMTP_USER', 'MAIL_SMTP_USER', 'MAIL_FROM_ADDRESS', 'QUALITEAM_GMAIL_USER' ],
  },
  {
    label: 'OAuth client ID',
    names: [ 'SMTP_OAUTH_CLIENT_ID', 'MAIL_OAUTH_CLIENT_ID', 'QUALITEAM_GMAIL_CLIENT_ID' ],
  },
  {
    label: 'OAuth client secret',
    names: [ 'SMTP_OAUTH_CLIENT_SECRET', 'MAIL_OAUTH_CLIENT_SECRET', 'QUALITEAM_GMAIL_CLIENT_SECRET' ],
  },
  {
    label: 'OAuth refresh token',
    names: [ 'SMTP_OAUTH_REFRESH_TOKEN', 'MAIL_OAUTH_REFRESH_TOKEN', 'QUALITEAM_GMAIL_REFRESH_TOKEN' ],
  },
]

const runCapturedCommand = ( fileName, args ) => execFileSync(
  fileName,
  args,
  {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: [ 'ignore', 'pipe', 'pipe' ],
  },
)

export const extractEnvNamesFromRunService = ( serviceData ) => {
  const containers = serviceData?.spec?.template?.spec?.containers
  if( !Array.isArray( containers ) ) {
    return []
  }
  return containers
    .flatMap( ( container ) => Array.isArray( container.env ) ? container.env : [] )
    .map( ( entry ) => typeof entry.name === 'string' ? entry.name.trim() : '' )
    .filter( Boolean )
}

export const validateFunctionEmailEnv = ( serviceName, envNames, groups = emailEnvGroups ) => {
  const envNameSet = new Set( envNames )
  const missingGroups = groups
    .filter( ( group ) => !group.names.some( ( name ) => envNameSet.has( name ) ) )
    .map( ( group ) => group.label )

  return {
    serviceName,
    ok: missingGroups.length === 0,
    missingGroups,
  }
}

export const validateFunctionEmailEnvResults = ( results ) => {
  const failedResults = results.filter( ( result ) => !result.ok )
  if( failedResults.length === 0 ) {
    return {
      ok: true,
      message: `Production notification function email env verified for ${String( results.length )} services.`,
    }
  }

  return {
    ok: false,
    message: failedResults
      .map( ( result ) =>
        `${result.serviceName}: missing ${result.missingGroups.join( ', ' )}`,
      )
      .join( '\n' ),
  }
}

const describeCloudRunService = ( serviceName ) => {
  const serviceJsonText = runCapturedCommand(
    'gcloud',
    [
      'run',
      'services',
      'describe',
      serviceName,
      '--region',
      productionRegion,
      '--project',
      productionProjectId,
      '--format=json',
    ],
  )
  return JSON.parse( serviceJsonText )
}

const run = () => {
  const results = notificationEmailServices.map( ( serviceName ) => {
    const envNames = extractEnvNamesFromRunService( describeCloudRunService( serviceName ) )
    return validateFunctionEmailEnv( serviceName, envNames )
  } )
  const summary = validateFunctionEmailEnvResults( results )

  if( !summary.ok ) {
    throw new Error( summary.message )
  }
  console.log( summary.message )
}

if( import.meta.url === pathToFileURL( process.argv[1] ).href ) {
  try {
    run()
  } catch( err ) {
    const message = err instanceof Error ? err.message : 'Unknown production function env verification error.'
    console.error( message )
    process.exitCode = 1
  }
}
