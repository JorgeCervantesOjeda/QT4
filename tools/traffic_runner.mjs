import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { chromium, expect } from '@playwright/test'

const repoRoot = process.cwd()
const configuredBaseUrl = process.env.QT4_TRAFFIC_BASE_URL ?? ''
const trafficDocumentId = process.env.QT4_TRAFFIC_DOCUMENT_ID ?? 'document-traffic-review'
let baseUrl = configuredBaseUrl || 'http://127.0.0.1:4174'

const defaultProfiles = {
  smoke: {
    virtualUsers: 1,
    durationMs: 30_000,
    writeEvery: 3,
    staggerMs: 400,
  },
  baseline: {
    virtualUsers: 3,
    durationMs: 90_000,
    writeEvery: 2,
    staggerMs: 300,
  },
  stress: {
    virtualUsers: 6,
    durationMs: 180_000,
    writeEvery: 2,
    staggerMs: 200,
  },
}

const sleep = ( ms ) => new Promise( ( resolve ) => {
  setTimeout( resolve, ms )
} )

const parseArgs = () => {
  const args = process.argv.slice( 2 )
  const options = {
    profile: 'smoke',
    virtualUsers: null,
    durationMs: null,
  }

  for( let index = 0; index < args.length; index += 1 ) {
    const current = args[index]
    if( current === '--profile' && args[index + 1] ) {
      options.profile = args[index + 1]
      index += 1
      continue
    }
    if( current === '--users' && args[index + 1] ) {
      options.virtualUsers = Number.parseInt( args[index + 1], 10 )
      index += 1
      continue
    }
    if( current === '--duration-ms' && args[index + 1] ) {
      options.durationMs = Number.parseInt( args[index + 1], 10 )
      index += 1
    }
  }

  if( !( options.profile in defaultProfiles ) ) {
    throw new Error( `Unsupported traffic profile "${options.profile}". Use smoke, baseline, or stress.` )
  }

  const baseProfile = defaultProfiles[options.profile]
  return {
    profileName: options.profile,
    virtualUsers: Number.isFinite( options.virtualUsers ) && options.virtualUsers > 0
      ? options.virtualUsers
      : baseProfile.virtualUsers,
    durationMs: Number.isFinite( options.durationMs ) && options.durationMs > 0
      ? options.durationMs
      : baseProfile.durationMs,
    writeEvery: baseProfile.writeEvery,
    staggerMs: baseProfile.staggerMs,
  }
}

const waitForHttpReady = async ( url, timeoutMs = 120_000 ) => {
  const startedAt = Date.now()
  while( Date.now() - startedAt < timeoutMs ) {
    try {
      const response = await fetch( url )
      if( response.ok ) {
        return
      }
    } catch {
      // keep retrying until timeout
    }
    await sleep( 1000 )
  }
  throw new Error( `Timed out waiting for ${url}` )
}

const findAvailablePort = async ( preferredPort ) => {
  const listenOnce = ( port ) => new Promise( ( resolve, reject ) => {
    const server = net.createServer()
    server.unref()
    server.once( 'error', reject )
    server.listen( port, '127.0.0.1', () => {
      const address = server.address()
      server.close( () => {
        if( typeof address === 'object' && address?.port ) {
          resolve( address.port )
          return
        }
        resolve( port )
      } )
    } )
  } )

  try {
    return await listenOnce( preferredPort )
  } catch {
    return await listenOnce( 0 )
  }
}

const startViteServer = async () => {
  const preferredUrl = configuredBaseUrl || 'http://127.0.0.1:4174'
  const parsedPreferredUrl = new URL( preferredUrl )
  const port = await findAvailablePort( Number.parseInt( parsedPreferredUrl.port || '4174', 10 ) )
  baseUrl = `${parsedPreferredUrl.protocol}//${parsedPreferredUrl.hostname}:${port}`
  const child = spawn(
    `npm run dev:emulator -- --host 127.0.0.1 --port ${port}`,
    {
      cwd: repoRoot,
      shell: true,
      stdio: 'inherit',
      env: process.env,
    },
  )

  await waitForHttpReady( `${baseUrl}/login` )
  return child
}

const stopChild = async ( child ) => {
  if( !child || child.killed ) {
    return
  }
  await new Promise( ( resolve ) => {
    child.once( 'exit', () => resolve() )
    child.kill()
  } )
}

const createSummary = ( profile ) => ( {
  profile,
  startedAt: new Date().toISOString(),
  baseUrl,
  documentId: trafficDocumentId,
  metrics: {},
  totalFailures: 0,
  totalIterations: 0,
} )

const getMetricBucket = ( summary, flowName ) => {
  if( !summary.metrics[flowName] ) {
    summary.metrics[flowName] = {
      successes: 0,
      failures: 0,
      durationsMs: [],
      samples: [],
    }
  }
  return summary.metrics[flowName]
}

const recordMetric = ( summary, flowName, durationMs, error = null ) => {
  const bucket = getMetricBucket( summary, flowName )
  if( error ) {
    bucket.failures += 1
    summary.totalFailures += 1
    if( bucket.samples.length < 5 ) {
      bucket.samples.push( String( error.message ?? error ) )
    }
    return
  }
  bucket.successes += 1
  bucket.durationsMs.push( durationMs )
}

const measure = async ( summary, flowName, callback ) => {
  const startedAt = performance.now()
  try {
    await callback()
    recordMetric( summary, flowName, performance.now() - startedAt )
  } catch( error ) {
    recordMetric( summary, flowName, performance.now() - startedAt, error )
    throw error
  }
}

const dismissSuccessModalIfPresent = async ( page, message ) => {
  const modalText = page.getByRole( 'dialog' ).getByText( message ).first()
  try {
    await expect( modalText ).toBeVisible( { timeout: 4_000 } )
    await page.getByRole( 'button', { name: 'OK' } ).click()
    await expect( modalText ).toBeHidden( { timeout: 4_000 } )
  } catch {
    // some load paths complete without the success modal being the stable surface
  }
}

const login = async ( page, email ) => {
  await page.goto( `${baseUrl}/login` )
  await page.getByLabel( 'Email' ).fill( email )
  await page.getByLabel( 'Password' ).fill( 'password123' )
  await page.getByRole( 'button', { name: 'Log in' } ).click()
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible( { timeout: 15_000 } )
}

const openDashboard = async ( page ) => {
  await page.goto( `${baseUrl}/app` )
  await expect( page.getByText( 'Dashboard' ) ).toBeVisible( { timeout: 15_000 } )
}

const openVersions = async ( page ) => {
  await page.goto( `${baseUrl}/documents/${trafficDocumentId}/versions` )
  await expect( page.getByText( 'Document Versions' ) ).toBeVisible( { timeout: 15_000 } )
  await expect( page.getByRole( 'heading', { name: 'Versions' } ) ).toBeVisible( { timeout: 15_000 } )
  await expect( page.getByText( 'Seeded traffic issue' ).first() ).toBeVisible( { timeout: 15_000 } )
}

const addCommentToSeededIssue = async ( page, workerId, iteration ) => {
  const commentBody = `Traffic comment ${workerId}-${iteration}-${Date.now()}`
  await page.getByText( 'Seeded traffic issue' ).first().click()
  await expect( page.locator( '.selected-thread-title' ) ).toContainText( 'Seeded traffic issue', { timeout: 15_000 } )
  await page.getByPlaceholder( 'Write a comment' ).fill( commentBody )
  await page.getByRole( 'button', { name: 'Add comment' } ).click()
  await dismissSuccessModalIfPresent( page, 'The comment was added successfully.' )
  await expect( page.getByText( commentBody ) ).toBeVisible( { timeout: 15_000 } )
}

const quantile = ( values, percentile ) => {
  if( values.length === 0 ) {
    return 0
  }
  const sorted = [ ...values ].sort( ( left, right ) => left - right )
  const index = Math.min(
    sorted.length - 1,
    Math.max( 0, Math.ceil( percentile * sorted.length ) - 1 ),
  )
  return sorted[index]
}

const buildConsoleSummary = ( summary, elapsedMs ) => {
  const lines = [
    `Traffic profile: ${summary.profile.profileName}`,
    `Virtual users: ${summary.profile.virtualUsers}`,
    `Duration (ms): ${elapsedMs}`,
    `Iterations: ${summary.totalIterations}`,
    `Failures: ${summary.totalFailures}`,
  ]

  Object.entries( summary.metrics ).forEach( ( [ flowName, metric ] ) => {
    const total = metric.successes + metric.failures
    const avg = metric.durationsMs.length > 0
      ? metric.durationsMs.reduce( ( sum, value ) => sum + value, 0 ) / metric.durationsMs.length
      : 0
    lines.push(
      `${flowName}: total=${total} ok=${metric.successes} fail=${metric.failures} avgMs=${avg.toFixed( 1 )} p50Ms=${quantile( metric.durationsMs, 0.5 ).toFixed( 1 )} p95Ms=${quantile( metric.durationsMs, 0.95 ).toFixed( 1 )}`,
    )
    if( metric.samples.length > 0 ) {
      lines.push( `${flowName} sample errors: ${metric.samples.join( ' | ' )}` )
    }
  } )

  return lines.join( '\n' )
}

const persistSummary = ( summary, elapsedMs ) => {
  const outputDir = path.join( repoRoot, 'test-results', 'traffic' )
  mkdirSync( outputDir, { recursive: true } )
  const payload = {
    ...summary,
    finishedAt: new Date().toISOString(),
    elapsedMs,
  }
  const latestPath = path.join( outputDir, `latest-${summary.profile.profileName}.json` )
  const timestampedPath = path.join(
    outputDir,
    `${new Date().toISOString().replaceAll( ':', '-' )}-${summary.profile.profileName}.json`,
  )
  const body = JSON.stringify( payload, null, 2 )
  writeFileSync( latestPath, body, 'utf8' )
  writeFileSync( timestampedPath, body, 'utf8' )
}

const runWorker = async ( browser, workerId, profile, summary, endAt ) => {
  await sleep( workerId * profile.staggerMs )

  const context = await browser.newContext()
  const page = await context.newPage()
  const email = workerId % 2 === 0 ? 'reviewer@example.com' : 'member@example.com'

  try {
    try {
      await measure( summary, 'login', async () => {
        await login( page, email )
      } )
    } catch {
      return
    }

    let iteration = 0
    while( Date.now() < endAt ) {
      try {
        await measure( summary, 'dashboard', async () => {
          await openDashboard( page )
        } )
      } catch {
        continue
      }

      try {
        await measure( summary, 'versions', async () => {
          await openVersions( page )
        } )
      } catch {
        continue
      }

      if( iteration % profile.writeEvery === 0 ) {
        try {
          await measure( summary, 'comment-thread', async () => {
            await addCommentToSeededIssue( page, workerId, iteration )
          } )
        } catch {
          try {
            await openVersions( page )
          } catch {
            // keep moving even if recovery fails
          }
        }
      }

      summary.totalIterations += 1
      iteration += 1
    }
  } finally {
    await context.close()
  }
}

const main = async () => {
  const profile = parseArgs()
  const summary = createSummary( profile )
  const startedAt = Date.now()
  let viteServer = null
  let browser = null

  try {
    viteServer = await startViteServer()
    summary.baseUrl = baseUrl
    browser = await chromium.launch( { headless: true } )
    const endAt = Date.now() + profile.durationMs

    await Promise.all(
      Array.from( { length: profile.virtualUsers }, ( _, workerId ) =>
        runWorker( browser, workerId, profile, summary, endAt ),
      ),
    )

    const elapsedMs = Date.now() - startedAt
    console.log( buildConsoleSummary( summary, elapsedMs ) )
    persistSummary( summary, elapsedMs )

    if( summary.totalFailures > 0 ) {
      process.exitCode = 1
    }
  } finally {
    if( browser ) {
      await browser.close()
    }
    if( viteServer ) {
      await stopChild( viteServer )
    }
  }
}

await main()
