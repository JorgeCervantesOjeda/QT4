// tools/verify-prod-build-config.mjs: Fails production deployment when Firebase config was not injected into the built bundle.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const currentFilePath = fileURLToPath( import.meta.url )
const rootDirPath = path.resolve( path.dirname( currentFilePath ), '..' )

const requiredFirebaseEnvNames = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

const firebaseApiKeyPattern = /^AIza[0-9A-Za-z_-]{20,}$/u

const maskValue = ( value ) => {
  const text = String( value || '' )
  if( text.length <= 10 ) {
    return `<len:${text.length}>`
  }
  return `${text.slice( 0, 6 )}...${text.slice( -4 )}<len:${text.length}>`
}

export const validateProductionFirebaseEnv = ( env ) => {
  const config = Object.fromEntries(
    requiredFirebaseEnvNames.map( ( envName ) => [ envName, String( env[envName] || '' ).trim() ] ),
  )
  const missingNames = requiredFirebaseEnvNames.filter( ( envName ) => !config[envName] )
  if( missingNames.length > 0 ) {
    throw new Error(
      `Production Firebase environment is incomplete. Missing: ${missingNames.join( ', ' )}.`,
    )
  }
  if( !firebaseApiKeyPattern.test( config.VITE_FIREBASE_API_KEY ) ) {
    throw new Error(
      `Production Firebase API key has an invalid shape: ${maskValue( config.VITE_FIREBASE_API_KEY )}.`,
    )
  }
  return config
}

const listJavaScriptFiles = ( dirPath ) => {
  if( !existsSync( dirPath ) ) {
    return []
  }
  return readdirSync( dirPath )
    .flatMap( ( entryName ) => {
      const entryPath = path.join( dirPath, entryName )
      if( statSync( entryPath ).isDirectory() ) {
        return listJavaScriptFiles( entryPath )
      }
      return entryName.endsWith( '.js' ) ? [ entryPath ] : []
    } )
}

const readBundleText = ( distDirPath ) => {
  const indexHtmlPath = path.join( distDirPath, 'index.html' )
  if( !existsSync( indexHtmlPath ) ) {
    throw new Error( `Production build output is missing ${indexHtmlPath}.` )
  }
  const javaScriptFiles = listJavaScriptFiles( distDirPath )
  if( javaScriptFiles.length === 0 ) {
    throw new Error( `Production build output contains no JavaScript files in ${distDirPath}.` )
  }
  return {
    bundleText: javaScriptFiles.map( ( filePath ) => readFileSync( filePath, 'utf8' ) ).join( '\n' ),
    javaScriptFiles,
  }
}

const assertNoUndefinedFirebaseConfig = ( bundleText ) => {
  const undefinedConfigMatches = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
  ].filter( ( propertyName ) => {
    const propertyPattern = new RegExp( `\\b${propertyName}\\s*:\\s*(?:void\\s+0|undefined)`, 'u' )
    return propertyPattern.test( bundleText )
  } )

  if( undefinedConfigMatches.length > 0 ) {
    throw new Error(
      `Production build has undefined Firebase config properties: ${undefinedConfigMatches.join( ', ' )}.`,
    )
  }
}

const assertBundleContainsExpectedConfig = ( bundleText, config ) => {
  if( !bundleText.includes( config.VITE_FIREBASE_API_KEY ) ) {
    throw new Error(
      `Production build does not contain the expected Firebase API key ${maskValue( config.VITE_FIREBASE_API_KEY )}.`,
    )
  }
  const missingLiteralNames = requiredFirebaseEnvNames
    .filter( ( envName ) => envName !== 'VITE_FIREBASE_API_KEY' )
    .filter( ( envName ) => !bundleText.includes( config[envName] ) )

  if( missingLiteralNames.length > 0 ) {
    throw new Error(
      `Production build is missing Firebase config literals: ${missingLiteralNames.join( ', ' )}.`,
    )
  }
}

export const validateProductionBuildConfig = ( options = {} ) => {
  const distDirPath = options.distDirPath ?? path.join( rootDirPath, 'dist' )
  const config = validateProductionFirebaseEnv( options.env ?? loadEnv( 'production', rootDirPath, '' ) )
  const { bundleText, javaScriptFiles } = readBundleText( distDirPath )

  assertNoUndefinedFirebaseConfig( bundleText )
  assertBundleContainsExpectedConfig( bundleText, config )

  return {
    checkedJavaScriptFiles: javaScriptFiles.length,
    projectId: config.VITE_FIREBASE_PROJECT_ID,
  }
}

const run = () => {
  try {
    const result = validateProductionBuildConfig()
    console.log(
      `Production build Firebase config verified for ${result.projectId} across ${result.checkedJavaScriptFiles} JavaScript file(s).`,
    )
  } catch( err ) {
    const message = err instanceof Error ? err.message : 'Unknown production build config verification error.'
    console.error( message )
    process.exitCode = 1
  }
}

if( process.argv[1] === currentFilePath ) {
  run()
}
