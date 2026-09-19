// Runs the real Firebase Storage E2E gate with an interactive password prompt.
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const repoRoot = process.cwd()
const defaultEmail = 'jorge.cervantes.ojeda@gmail.com'

const readPassword = async () => {
  const input = process.stdin
  const output = process.stdout
  if( !input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function' ) {
    throw new Error(
      'Interactive password input is unavailable. Set QT4_E2E_PASSWORD in the environment instead.',
    )
  }

  return new Promise( (resolve, reject) => {
    const previousRawMode = input.isRaw
    const characters = []
    let finished = false

    const finish = (error, value = '') => {
      if( finished ) {
        return
      }
      finished = true
      input.setRawMode( Boolean( previousRawMode ) )
      input.pause()
      input.removeListener( 'data', onData )
      input.removeListener( 'error', onError )
      output.write( '\n' )
      if( error ) {
        reject( error )
        return
      }
      resolve( value )
    }

    const onError = (error) => finish( error )
    const onData = (chunk) => {
      for( const character of String( chunk ) ) {
        if( finished ) {
          break
        }
        if( character === '\u0003' ) {
          finish( new Error( 'Firebase Storage E2E cancelled.' ) )
        } else if( character === '\r' || character === '\n' ) {
          finish( null, characters.join( '' ) )
        } else if( character === '\u0008' || character === '\u007f' ) {
          characters.pop()
        } else {
          characters.push( character )
        }
      }
    }

    output.write( 'Firebase E2E password (input hidden): ' )
    input.setEncoding( 'utf8' )
    input.setRawMode( true )
    input.resume()
    input.on( 'data', onData )
    input.on( 'error', onError )
  } )
}

const run = ( command, args, env ) => {
  const result = spawnSync( command, args, {
    cwd: repoRoot,
    env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  } )
  if( result.error ) {
    throw result.error
  }
  return result.status ?? 1
}

const main = async () => {
  const env = {
    ...process.env,
    QT4_E2E_EMAIL: process.env.QT4_E2E_EMAIL?.trim() || defaultEmail,
  }

  if( !env.QT4_E2E_PASSWORD ) {
    env.QT4_E2E_PASSWORD = await readPassword()
  }
  if( !env.QT4_E2E_PASSWORD ) {
    throw new Error( 'A non-empty Firebase E2E password is required.' )
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const playwrightCommand = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'playwright.cmd' : 'playwright',
  )

  const buildStatus = run( npmCommand, ['run', 'build:prod'], env )
  if( buildStatus !== 0 ) {
    process.exitCode = buildStatus
    return
  }

  process.exitCode = run(
    playwrightCommand,
    ['test', '-c', 'playwright.firebase-storage.config.ts'],
    env,
  )
}

main().catch( (error) => {
  console.error( error instanceof Error ? error.message : error )
  process.exitCode = 1
} )
