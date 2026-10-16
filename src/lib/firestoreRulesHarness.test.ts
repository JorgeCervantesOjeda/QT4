// src/lib/firestoreRulesHarness.test.ts: Verifies the Firestore rules test client can initialize.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import firestoreRules from '../../firestore.rules?raw'

let testEnv: RulesTestEnvironment
const describeWithFirestoreEmulator = import.meta.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip

describeWithFirestoreEmulator( 'Firestore rules test harness', () => {
  beforeAll( async () => {
    testEnv = await initializeTestEnvironment( {
      projectId: 'qt4-rules-harness',
      firestore: { rules: firestoreRules },
    } )
  }, 90000 )

  afterAll( async () => {
    await testEnv?.cleanup()
  } )

  it( 'creates a Firestore client for an authenticated rules context', () => {
    const firestore = testEnv.authenticatedContext( 'harness-user' ).firestore()
    expect( firestore ).toBeDefined()
  } )
} )
