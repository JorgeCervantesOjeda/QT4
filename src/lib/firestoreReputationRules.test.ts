// src/lib/firestoreReputationRules.test.ts: Verifies server-only reputation writes and scoped reads.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import firestoreRules from '../../firestore.rules?raw'

let testEnv: RulesTestEnvironment
const describeWithFirestoreEmulator = import.meta.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip

const projectId = 'qt4-reputation-rules'
const memberId = 'member-1'
const outsiderId = 'outsider-1'

const seedData = async () => {
  await testEnv.withSecurityRulesDisabled( async ( context ) => {
    const firestore = context.firestore()
    await Promise.all( [
      setDoc( doc( firestore, 'userProfiles', memberId ), { isAdmin: false } ),
      setDoc( doc( firestore, 'userProfiles', outsiderId ), { isAdmin: false } ),
      setDoc( doc( firestore, 'projectMembers', `${projectId}_${memberId}` ), {
        projectId,
        userId: memberId,
        role: 'member',
      } ),
      setDoc( doc( firestore, 'reputationSummaries', `${projectId}_${memberId}` ), {
        projectId,
        userId: memberId,
        totalPoints: 4,
      } ),
      setDoc( doc( firestore, 'reputationEvents', 'event-1' ), {
        projectId,
        userId: memberId,
        points: 4,
      } ),
    ] )
  } )
}

describeWithFirestoreEmulator( 'firestore.rules reputation collections', () => {
  beforeAll( async () => {
    testEnv = await initializeTestEnvironment( {
      projectId,
      firestore: { rules: firestoreRules },
    } )
  }, 90000 )

  beforeEach( async () => {
    await testEnv.clearFirestore()
    await seedData()
  } )

  afterAll( async () => {
    await testEnv?.cleanup()
  } )

  it( 'allows a user to read their own summary and event history', async () => {
    const firestore = testEnv.authenticatedContext( memberId ).firestore()
    await assertSucceeds( getDoc( doc( firestore, 'reputationSummaries', `${projectId}_${memberId}` ) ) )
    await assertSucceeds( getDoc( doc( firestore, 'reputationEvents', 'event-1' ) ) )
  } )

  it( 'allows a project member to read the project summary', async () => {
    const firestore = testEnv.authenticatedContext( memberId ).firestore()
    await assertSucceeds( getDoc( doc( firestore, 'reputationSummaries', `${projectId}_${memberId}` ) ) )
  } )

  it( 'rejects client writes and outsider reads', async () => {
    const memberFirestore = testEnv.authenticatedContext( memberId ).firestore()
    const outsiderFirestore = testEnv.authenticatedContext( outsiderId ).firestore()
    await assertFails( setDoc( doc( memberFirestore, 'reputationSummaries', `${projectId}_${memberId}` ), {
      projectId,
      userId: memberId,
      totalPoints: 999,
    } ) )
    await assertFails( setDoc( doc( memberFirestore, 'reputationEvents', 'event-2' ), {
      projectId,
      userId: memberId,
      points: 999,
    } ) )
    await assertFails( getDoc( doc( outsiderFirestore, 'reputationSummaries', `${projectId}_${memberId}` ) ) )
    await assertFails( getDoc( doc( outsiderFirestore, 'reputationEvents', 'event-1' ) ) )
  } )
} )
