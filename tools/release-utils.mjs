// tools/release-utils.mjs: Shared helpers for production release planning, version bumps, and production tags.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFilePath = fileURLToPath( import.meta.url )
const currentDirPath = path.dirname( currentFilePath )

export const rootDirPath = path.resolve( currentDirPath, '..' )
export const prodTagPrefix = 'prod/v'

const rootPackageJsonPath = path.join( rootDirPath, 'package.json' )
const rootPackageLockPath = path.join( rootDirPath, 'package-lock.json' )

const releaseImpactPriority = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
}

const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/
const prodTagPattern = /^prod\/v(\d+)\.(\d+)\.(\d+)$/
const explicitImpactPattern = /^Release-Impact:\s*(major|minor|patch|none)\s*$/im
const breakingChangePattern = /^BREAKING[ -]CHANGE:/im
const breakingSubjectPattern = /^[a-z]+(?:\([^)]+\))?!:/i
const minorSubjectPattern = /^feat(?:\([^)]+\))?:/i
const patchSubjectPattern = /^(fix|perf|refactor|revert)(?:\([^)]+\))?:/i
const noneSubjectPattern = /^(build|chore|ci|docs|release|style|test)(?:\([^)]+\))?:/i

const resolveExecutableName = ( fileName ) => {
  if( process.platform === 'win32' && fileName === 'npm' ) {
    return 'npm.cmd'
  }
  return fileName
}

const runCapturedCommand = ( fileName, args, options = {} ) => {
  return execFileSync(
    resolveExecutableName( fileName ),
    args,
    {
      cwd: rootDirPath,
      encoding: 'utf8',
      stdio: [ 'ignore', 'pipe', 'pipe' ],
      ...options,
    },
  )
}

export const runStreamingCommand = ( fileName, args, options = {} ) => {
  const executableName = resolveExecutableName( fileName )
  const shouldUseShell = process.platform === 'win32'
  const result = spawnSync(
    shouldUseShell ? fileName : executableName,
    args,
    {
      cwd: rootDirPath,
      stdio: 'inherit',
      shell: shouldUseShell,
      ...options,
    },
  )
  if( result.error ) {
    throw new Error(
      `Command failed (${fileName} ${args.join( ' ' )}): ${result.error.message}`,
    )
  }
  if( result.status !== 0 ) {
    throw new Error(
      `Command failed (${fileName} ${args.join( ' ' )}) with exit code ${String( result.status ?? 'unknown' )}.`,
    )
  }
}

const readJsonFile = ( filePath ) => JSON.parse( readFileSync( filePath, 'utf8' ) )

const writeJsonFile = ( filePath, value ) => {
  writeFileSync( filePath, `${JSON.stringify( value, null, 2 )}\n`, 'utf8' )
}

export const parseSemverVersion = ( versionText ) => {
  const versionMatch = versionPattern.exec( versionText.trim() )
  if( !versionMatch ) {
    throw new Error( `Invalid semantic version: ${versionText}` )
  }
  return {
    major: Number( versionMatch[1] ),
    minor: Number( versionMatch[2] ),
    patch: Number( versionMatch[3] ),
  }
}

const formatSemverVersion = ( versionData ) =>
  `${versionData.major}.${versionData.minor}.${versionData.patch}`

const compareSemverVersions = ( leftVersion, rightVersion ) => {
  if( leftVersion.major !== rightVersion.major ) {
    return leftVersion.major - rightVersion.major
  }
  if( leftVersion.minor !== rightVersion.minor ) {
    return leftVersion.minor - rightVersion.minor
  }
  return leftVersion.patch - rightVersion.patch
}

export const getCurrentPackageVersion = () => {
  const rootPackageJson = readJsonFile( rootPackageJsonPath )
  if( typeof rootPackageJson.version !== 'string' || rootPackageJson.version.trim().length === 0 ) {
    throw new Error( 'package.json is missing a valid version string.' )
  }
  return rootPackageJson.version.trim()
}

export const getVersionFileSnapshot = () => ( {
  packageJsonText: readFileSync( rootPackageJsonPath, 'utf8' ),
  packageLockText: readFileSync( rootPackageLockPath, 'utf8' ),
} )

export const restoreVersionFileSnapshot = ( snapshot ) => {
  writeFileSync( rootPackageJsonPath, snapshot.packageJsonText, 'utf8' )
  writeFileSync( rootPackageLockPath, snapshot.packageLockText, 'utf8' )
}

export const writeRootVersionFiles = ( nextVersionText ) => {
  parseSemverVersion( nextVersionText )
  const rootPackageJson = readJsonFile( rootPackageJsonPath )
  rootPackageJson.version = nextVersionText
  writeJsonFile( rootPackageJsonPath, rootPackageJson )

  const rootPackageLock = readJsonFile( rootPackageLockPath )
  rootPackageLock.version = nextVersionText
  if(
    !rootPackageLock.packages
    || typeof rootPackageLock.packages !== 'object'
    || !rootPackageLock.packages['']
    || typeof rootPackageLock.packages[''] !== 'object'
  ) {
    throw new Error( 'package-lock.json does not contain packages[""] metadata.' )
  }
  rootPackageLock.packages[''].version = nextVersionText
  writeJsonFile( rootPackageLockPath, rootPackageLock )
}

export const ensureCleanGitTree = () => {
  const gitStatusText = runCapturedCommand( 'git', [ 'status', '--porcelain' ] )
  if( gitStatusText.trim().length > 0 ) {
    throw new Error( 'Release flow requires a clean git working tree.' )
  }
}

export const ensureGitIdentityConfigured = () => {
  const gitUserName = runCapturedCommand( 'git', [ 'config', '--get', 'user.name' ] ).trim()
  const gitUserEmail = runCapturedCommand( 'git', [ 'config', '--get', 'user.email' ] ).trim()
  if( !gitUserName || !gitUserEmail ) {
    throw new Error( 'git user.name and user.email must be configured before running a release.' )
  }
}

const getProdTagInfos = () => {
  const prodTagLines = runCapturedCommand( 'git', [ 'tag', '--list', `${prodTagPrefix}*` ] )
    .split( /\r?\n/u )
    .map( ( line ) => line.trim() )
    .filter( Boolean )

  return prodTagLines
    .map( ( tagName ) => {
      const tagMatch = prodTagPattern.exec( tagName )
      if( !tagMatch ) {
        return null
      }
      return {
        tagName,
        version: {
          major: Number( tagMatch[1] ),
          minor: Number( tagMatch[2] ),
          patch: Number( tagMatch[3] ),
        },
      }
    } )
    .filter( Boolean )
    .sort( ( leftTag, rightTag ) => compareSemverVersions( rightTag.version, leftTag.version ) )
}

export const getLatestProdReleaseInfo = () => {
  const prodTagInfos = getProdTagInfos()
  if( prodTagInfos.length === 0 ) {
    throw new Error(
      'No production tag was found. Bootstrap the first one with: npm run release:bootstrap:prod -- <deployed-commit>.',
    )
  }
  return {
    ...prodTagInfos[0],
    versionText: formatSemverVersion( prodTagInfos[0].version ),
  }
}

export const readVersionAtGitRef = ( gitRef ) => {
  const packageJsonAtRef = JSON.parse( runCapturedCommand( 'git', [ 'show', `${gitRef}:package.json` ] ) )
  if( typeof packageJsonAtRef.version !== 'string' || packageJsonAtRef.version.trim().length === 0 ) {
    throw new Error( `package.json at ${gitRef} does not contain a valid version.` )
  }
  return packageJsonAtRef.version.trim()
}

export const ensureGitRefExists = ( gitRef ) => {
  runCapturedCommand( 'git', [ 'rev-parse', '--verify', gitRef ] )
}

export const getCommitEntriesSinceRef = ( baseGitRef ) => {
  const rawGitLog = runCapturedCommand(
    'git',
    [ 'log', '--format=%H%x1f%s%x1f%b%x1e', `${baseGitRef}..HEAD` ],
  )
  return rawGitLog
    .split( '\u001e' )
    .map( ( entryText ) => entryText.trim() )
    .filter( Boolean )
    .map( ( entryText ) => {
      const [ commitHash = '', subjectText = '', bodyText = '' ] = entryText.split( '\u001f' )
      return {
        commitHash: commitHash.trim(),
        subjectText: subjectText.trim(),
        bodyText: bodyText.trim(),
      }
    } )
}

export const classifyCommitReleaseImpact = ( commitEntry ) => {
  const subjectText = commitEntry.subjectText
  const bodyText = commitEntry.bodyText
  const explicitImpactMatch = explicitImpactPattern.exec( bodyText )

  if( explicitImpactMatch ) {
    return {
      impact: explicitImpactMatch[1].toLowerCase(),
      reason: `explicit Release-Impact trailer (${explicitImpactMatch[1].toLowerCase()})`,
      usedFallback: false,
    }
  }
  if( /^Merge\b/u.test( subjectText ) ) {
    return {
      impact: 'none',
      reason: 'merge commit ignored for version bumping',
      usedFallback: false,
    }
  }
  if( breakingChangePattern.test( bodyText ) || breakingSubjectPattern.test( subjectText ) ) {
    return {
      impact: 'major',
      reason: 'breaking change marker found',
      usedFallback: false,
    }
  }
  if( minorSubjectPattern.test( subjectText ) ) {
    return {
      impact: 'minor',
      reason: 'conventional feat commit',
      usedFallback: false,
    }
  }
  if( patchSubjectPattern.test( subjectText ) ) {
    return {
      impact: 'patch',
      reason: 'conventional patch-level commit',
      usedFallback: false,
    }
  }
  if( noneSubjectPattern.test( subjectText ) ) {
    return {
      impact: 'none',
      reason: 'non-release conventional commit type',
      usedFallback: false,
    }
  }
  return {
    impact: 'patch',
    reason: 'fallback classification: unrecognized commit type treated as patch',
    usedFallback: true,
  }
}

export const bumpVersionText = ( baseVersionText, releaseImpact ) => {
  const baseVersion = parseSemverVersion( baseVersionText )
  if( releaseImpact === 'none' ) {
    return formatSemverVersion( baseVersion )
  }
  if( releaseImpact === 'patch' ) {
    return formatSemverVersion( {
      major: baseVersion.major,
      minor: baseVersion.minor,
      patch: baseVersion.patch + 1,
    } )
  }
  if( releaseImpact === 'minor' ) {
    return formatSemverVersion( {
      major: baseVersion.major,
      minor: baseVersion.minor + 1,
      patch: 0,
    } )
  }
  return formatSemverVersion( {
    major: baseVersion.major + 1,
    minor: 0,
    patch: 0,
  } )
}

export const buildProdReleasePlan = () => {
  const latestProdRelease = getLatestProdReleaseInfo()
  const commitEntries = getCommitEntriesSinceRef( latestProdRelease.tagName )
  const classifiedCommits = commitEntries.map( ( commitEntry ) => ( {
    ...commitEntry,
    ...classifyCommitReleaseImpact( commitEntry ),
  } ) )

  const releaseImpact = classifiedCommits.reduce(
    ( highestImpact, commitEntry ) =>
      releaseImpactPriority[commitEntry.impact] > releaseImpactPriority[highestImpact]
        ? commitEntry.impact
        : highestImpact,
    'none',
  )

  return {
    latestProdRelease,
    currentPackageVersion: getCurrentPackageVersion(),
    commitEntries: classifiedCommits,
    releaseImpact,
    nextVersionText: bumpVersionText( latestProdRelease.versionText, releaseImpact ),
    usedFallbackClassification: classifiedCommits.some( ( commitEntry ) => commitEntry.usedFallback ),
  }
}

export const formatProdReleasePlan = ( releasePlan ) => {
  const planLines = [
    `Base production tag: ${releasePlan.latestProdRelease.tagName}`,
    `Base production version: ${releasePlan.latestProdRelease.versionText}`,
    `Current package version: ${releasePlan.currentPackageVersion}`,
    `Commits since production: ${String( releasePlan.commitEntries.length )}`,
    `Resolved release impact: ${releasePlan.releaseImpact}`,
    `Next version: ${releasePlan.nextVersionText}`,
  ]

  if( releasePlan.commitEntries.length === 0 ) {
    planLines.push( 'Commit classification: no commits since the last production tag.' )
    return planLines.join( '\n' )
  }

  planLines.push( 'Commit classification:' )
  for( const commitEntry of releasePlan.commitEntries ) {
    const shortCommitHash = commitEntry.commitHash.slice( 0, 7 )
    planLines.push(
      `- [${commitEntry.impact}] ${shortCommitHash} ${commitEntry.subjectText} (${commitEntry.reason})`,
    )
  }

  if( releasePlan.usedFallbackClassification ) {
    planLines.push(
      'Fallback note: at least one commit was treated as patch because its subject did not match the supported conventional patterns.',
    )
  }

  return planLines.join( '\n' )
}

export const createReleaseCommit = ( nextVersionText ) => {
  runStreamingCommand( 'git', [ 'add', 'package.json', 'package-lock.json' ] )
  runStreamingCommand( 'git', [ 'commit', '-m', `release: v${nextVersionText}` ] )
}

export const createAnnotatedProdTag = ( nextVersionText ) => {
  runStreamingCommand(
    'git',
    [ 'tag', '-a', `${prodTagPrefix}${nextVersionText}`, '-m', `Production release v${nextVersionText}` ],
  )
}

export const createBootstrapProdTag = ( gitRef, options = {} ) => {
  const releaseVersionText = readVersionAtGitRef( gitRef )
  const prodTagName = `${prodTagPrefix}${releaseVersionText}`
  const existingTagNames = new Set( getProdTagInfos().map( ( tagInfo ) => tagInfo.tagName ) )

  if( existingTagNames.has( prodTagName ) ) {
    throw new Error( `Production tag ${prodTagName} already exists.` )
  }

  if( options.dryRun ) {
    return {
      gitRef,
      prodTagName,
      releaseVersionText,
      created: false,
    }
  }

  runStreamingCommand(
    'git',
    [ 'tag', '-a', prodTagName, gitRef, '-m', `Production bootstrap v${releaseVersionText}` ],
  )
  return {
    gitRef,
    prodTagName,
    releaseVersionText,
    created: true,
  }
}
