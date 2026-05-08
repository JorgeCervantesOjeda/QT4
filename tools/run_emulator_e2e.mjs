import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const repoRoot = process.cwd()
const toolsDir = path.join( repoRoot, 'tools' )

const getJavaMajorVersion = ( javaHome ) => {
  const javaPath = path.join( javaHome, 'bin', 'java.exe' )
  const result = spawnSync(
    javaPath,
    ['-version'],
    { encoding: 'utf8' },
  )
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const match = output.match( /version "(\d+)/ )
  return match ? Number.parseInt( match[1], 10 ) : -1
}

const findJavaHome = () => {
  const explicit = process.env.QT4_JAVA_HOME
  const localCandidates = readdirSync( toolsDir, { withFileTypes: true } )
    .filter( ( entry ) => entry.isDirectory() && entry.name.startsWith( 'jdk-21' ) )
    .map( ( entry ) => path.join( toolsDir, entry.name ) )
    .filter( ( candidate ) => existsSync( path.join( candidate, 'bin', 'java.exe' ) ) )
  const envJavaHome = process.env.JAVA_HOME
  const candidates = [
    explicit,
    ...localCandidates,
    envJavaHome,
  ].filter( ( candidate, index, array ) => {
    return Boolean( candidate )
      && existsSync( path.join( candidate, 'bin', 'java.exe' ) )
      && array.indexOf( candidate ) === index
  } )

  for( const candidate of candidates ) {
    if( getJavaMajorVersion( candidate ) >= 21 ) {
      return candidate
    }
  }

  return null
}

const javaHome = findJavaHome()

if( !javaHome ) {
  console.error(
    'JDK 21 is required for Firebase emulators. Set QT4_JAVA_HOME or extract a local JDK under tools/jdk-21*.',
  )
  process.exit( 1 )
}

const command = 'npx firebase-tools emulators:exec --project demo-qt4-e2e --only auth,firestore,storage "node tools/seed_emulators.mjs && playwright test -c playwright.config.ts"'

const child = spawn( command, {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    JAVA_HOME: javaHome,
    PATH: `${path.join( javaHome, 'bin' )}${path.delimiter}${process.env.PATH ?? ''}`,
  },
} )

child.on( 'exit', ( code, signal ) => {
  if( signal ) {
    process.kill( process.pid, signal )
    return
  }
  process.exit( code ?? 1 )
} )
