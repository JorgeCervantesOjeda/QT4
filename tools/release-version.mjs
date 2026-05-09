// tools/release-version.mjs: Prints the production release plan derived from commits since the last production tag.
import { buildProdReleasePlan, formatProdReleasePlan } from './release-utils.mjs'

const run = () => {
  try {
    const releasePlan = buildProdReleasePlan()
    console.log( formatProdReleasePlan( releasePlan ) )
  } catch( err ) {
    const message = err instanceof Error ? err.message : 'Unknown release planning error.'
    console.error( message )
    process.exitCode = 1
  }
}

run()
