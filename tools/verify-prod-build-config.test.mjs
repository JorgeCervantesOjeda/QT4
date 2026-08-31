// tools/verify-prod-build-config.test.mjs: Verifies production build guards against missing Firebase env injection.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  validateProductionBuildConfig,
  validateProductionFirebaseEnv,
} from './verify-prod-build-config.mjs'

const validEnv = {
  VITE_FIREBASE_API_KEY: 'AIzaSyDqWttd69qgjbcQkkrq0PNSb0JdcFiXDGI',
  VITE_FIREBASE_AUTH_DOMAIN: 'qualiteam-app.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'qualiteam-app',
  VITE_FIREBASE_STORAGE_BUCKET: 'qualiteam-app.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '117724374543',
  VITE_FIREBASE_APP_ID: '1:117724374543:web:49775e3e9e48bd98eee57a',
}

const withTempDist = ( bundleText, callback ) => {
  const tempDirPath = mkdtempSync( path.join( os.tmpdir(), 'qt4-prod-build-' ) )
  try {
    const assetsDirPath = path.join( tempDirPath, 'assets' )
    mkdirSync( assetsDirPath )
    writeFileSync(
      path.join( tempDirPath, 'index.html' ),
      '<script type="module" src="/assets/index-test.js"></script>',
      'utf8',
    )
    writeFileSync( path.join( assetsDirPath, 'index-test.js' ), bundleText, 'utf8' )
    callback( tempDirPath )
  } finally {
    rmSync( tempDirPath, { force: true, recursive: true } )
  }
}

test( 'validateProductionFirebaseEnv rejects missing required Firebase config', () => {
  assert.throws(
    () => validateProductionFirebaseEnv( { ...validEnv, VITE_FIREBASE_API_KEY: '' } ),
    /VITE_FIREBASE_API_KEY/,
  )
} )

test( 'validateProductionBuildConfig rejects bundles with undefined Firebase config', () => {
  withTempDist(
    'const firebaseConfig={apiKey:void 0,authDomain:void 0,projectId:void 0};',
    ( distDirPath ) => {
      assert.throws(
        () => validateProductionBuildConfig( { distDirPath, env: validEnv } ),
        /apiKey/,
      )
    },
  )
} )

test( 'validateProductionBuildConfig rejects bundles missing the expected Firebase API key', () => {
  withTempDist(
    'const firebaseConfig={apiKey:"AIzaSyOtherKeyValue123456789012345678",authDomain:"qualiteam-app.firebaseapp.com",projectId:"qualiteam-app"};',
    ( distDirPath ) => {
      assert.throws(
        () => validateProductionBuildConfig( { distDirPath, env: validEnv } ),
        /Firebase API key/,
      )
    },
  )
} )

test( 'validateProductionBuildConfig accepts bundles containing the expected production Firebase config', () => {
  withTempDist(
    `const firebaseConfig={apiKey:"${validEnv.VITE_FIREBASE_API_KEY}",authDomain:"${validEnv.VITE_FIREBASE_AUTH_DOMAIN}",projectId:"${validEnv.VITE_FIREBASE_PROJECT_ID}",storageBucket:"${validEnv.VITE_FIREBASE_STORAGE_BUCKET}",messagingSenderId:"${validEnv.VITE_FIREBASE_MESSAGING_SENDER_ID}",appId:"${validEnv.VITE_FIREBASE_APP_ID}"};`,
    ( distDirPath ) => {
      const result = validateProductionBuildConfig( { distDirPath, env: validEnv } )

      assert.equal( result.checkedJavaScriptFiles, 1 )
      assert.equal( result.projectId, 'qualiteam-app' )
    },
  )
} )
