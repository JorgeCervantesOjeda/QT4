// tools/verify-prod-function-env.test.mjs: Covers production notification function email env validation.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  emailEnvGroups,
  extractEnvNamesFromRunService,
  validateFunctionEmailEnv,
  validateFunctionEmailEnvResults,
} from './verify-prod-function-env.mjs'

const smtpEnvNames = [
  'SMTP_FROM',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_OAUTH_CLIENT_ID',
  'SMTP_OAUTH_CLIENT_SECRET',
  'SMTP_OAUTH_REFRESH_TOKEN',
]

test( 'validateFunctionEmailEnv accepts the SMTP env family used by notification functions', () => {
  const result = validateFunctionEmailEnv( 'sendcommentnotification', smtpEnvNames )

  assert.equal( result.ok, true )
  assert.deepEqual( result.missingGroups, [] )
} )

test( 'validateFunctionEmailEnv accepts legacy Gmail env as a complete fallback family', () => {
  const result = validateFunctionEmailEnv(
    'sendhourlynotificationdigest',
    [
      'QUALITEAM_GMAIL_USER',
      'QUALITEAM_GMAIL_CLIENT_ID',
      'QUALITEAM_GMAIL_CLIENT_SECRET',
      'QUALITEAM_GMAIL_REFRESH_TOKEN',
    ],
  )

  assert.equal( result.ok, true )
  assert.deepEqual( result.missingGroups, [] )
} )

test( 'validateFunctionEmailEnv reports missing groups without exposing values', () => {
  const result = validateFunctionEmailEnv(
    'sendslowuiactiondigest',
    [ 'SMTP_FROM', 'SMTP_HOST', 'SMTP_USER' ],
  )

  assert.equal( result.ok, false )
  assert.deepEqual( result.missingGroups, [
    'OAuth client ID',
    'OAuth client secret',
    'OAuth refresh token',
  ] )
} )

test( 'extractEnvNamesFromRunService returns only configured variable names', () => {
  const names = extractEnvNamesFromRunService( {
    spec: {
      template: {
        spec: {
          containers: [
            {
              env: [
                { name: 'SMTP_FROM', value: 'hidden@example.test' },
                { name: 'SMTP_HOST', value: 'smtp.example.test' },
                { name: '' },
                {},
              ],
            },
          ],
        },
      },
    },
  } )

  assert.deepEqual( names, [ 'SMTP_FROM', 'SMTP_HOST' ] )
} )

test( 'validateFunctionEmailEnvResults summarizes failed services', () => {
  const okResult = validateFunctionEmailEnv( 'sendcommentnotification', smtpEnvNames, emailEnvGroups )
  const failedResult = validateFunctionEmailEnv( 'sendhourlynotificationdigest', [], emailEnvGroups )
  const summary = validateFunctionEmailEnvResults( [ okResult, failedResult ] )

  assert.equal( summary.ok, false )
  assert.match( summary.message, /sendhourlynotificationdigest/ )
  assert.match( summary.message, /sender address/ )
} )
