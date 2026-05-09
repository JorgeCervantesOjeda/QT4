// tools/release-prod.mjs: Applies the next production version, validates the release, deploys it, and records the release commit and tag.
import {
  buildProdReleasePlan,
  createAnnotatedProdTag,
  createReleaseCommit,
  ensureCleanGitTree,
  ensureGitIdentityConfigured,
  formatProdReleasePlan,
  getVersionFileSnapshot,
  restoreVersionFileSnapshot,
  runStreamingCommand,
  writeRootVersionFiles,
} from './release-utils.mjs'

const deployValidatedRelease = () => {
  runStreamingCommand( 'npm', [ '--prefix', 'functions', 'ci' ] )
  runStreamingCommand( 'npm', [ 'run', 'test' ] )
  runStreamingCommand( 'npm', [ 'run', 'deploy:functions:prod' ] )
  runStreamingCommand( 'npm', [ 'run', 'deploy:prod' ] )
}

const run = () => {
  try {
    ensureCleanGitTree()
    ensureGitIdentityConfigured()

    const releasePlan = buildProdReleasePlan()
    console.log( formatProdReleasePlan( releasePlan ) )

    if( releasePlan.releaseImpact === 'none' ) {
      throw new Error( 'No deployable changes were found since the last production tag.' )
    }

    const versionFileSnapshot = getVersionFileSnapshot()

    try {
      writeRootVersionFiles( releasePlan.nextVersionText )
      deployValidatedRelease()
    } catch( err ) {
      restoreVersionFileSnapshot( versionFileSnapshot )
      throw err
    }

    createReleaseCommit( releasePlan.nextVersionText )
    createAnnotatedProdTag( releasePlan.nextVersionText )

    console.log( `Production release completed: ${releasePlan.nextVersionText}` )
  } catch( err ) {
    const message = err instanceof Error ? err.message : 'Unknown production release error.'
    console.error( message )
    process.exitCode = 1
  }
}

run()
