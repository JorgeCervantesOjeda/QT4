// tools/bootstrap-prod-tag.mjs: Creates the first production tag from a known deployed commit so future releases can diff against it.
import { createBootstrapProdTag, ensureGitRefExists } from './release-utils.mjs'

const parseCliOptions = () => {
  const cliArgs = process.argv.slice( 2 )
  let gitRef = 'HEAD'
  let dryRun = false
  let hasExplicitGitRef = false

  for( let argIndex = 0; argIndex < cliArgs.length; argIndex += 1 ) {
    const currentArg = cliArgs[argIndex]
    if(
      currentArg === '--dry-run'
      || currentArg === '--preview'
      || currentArg === 'dry-run'
      || currentArg === 'preview'
    ) {
      dryRun = true
      continue
    }
    if( currentArg === '--ref' ) {
      const nextArg = cliArgs[argIndex + 1]
      if( !nextArg ) {
        throw new Error( 'Missing value for --ref.' )
      }
      gitRef = nextArg
      hasExplicitGitRef = true
      argIndex += 1
      continue
    }
    if( currentArg.startsWith( '--' ) ) {
      throw new Error( `Unknown argument: ${currentArg}` )
    }
    if( hasExplicitGitRef ) {
      throw new Error( `Unexpected positional argument: ${currentArg}` )
    }
    gitRef = currentArg
    hasExplicitGitRef = true
  }

  return { gitRef, dryRun }
}

const run = () => {
  try {
    const cliOptions = parseCliOptions()
    ensureGitRefExists( cliOptions.gitRef )
    const bootstrapResult = createBootstrapProdTag( cliOptions.gitRef, { dryRun: cliOptions.dryRun } )

    if( bootstrapResult.created ) {
      console.log(
        `Created ${bootstrapResult.prodTagName} at ${bootstrapResult.gitRef} for version ${bootstrapResult.releaseVersionText}.`,
      )
      return
    }

    console.log(
      `Dry run: would create ${bootstrapResult.prodTagName} at ${bootstrapResult.gitRef} for version ${bootstrapResult.releaseVersionText}.`,
    )
  } catch( err ) {
    const message = err instanceof Error ? err.message : 'Unknown bootstrap error.'
    console.error( message )
    process.exitCode = 1
  }
}

run()
