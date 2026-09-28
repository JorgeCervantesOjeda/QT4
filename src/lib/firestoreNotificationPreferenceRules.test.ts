// src/lib/firestoreNotificationPreferenceRules.test.ts: Verifies Firestore rules for notification preferences and internal notification documents.
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import firestoreRules from '../../firestore.rules?raw'

let testEnv: RulesTestEnvironment
const describeWithFirestoreEmulator = import.meta.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip

const projectId = 'qt4-notification-preferences-rules'
const userId = 'user-1'

const seedUserProfile = async () => {
  await testEnv.withSecurityRulesDisabled( async ( context ) => {
    await setDoc( doc( context.firestore(), 'userProfiles', userId ), {
      email: 'member@example.com',
      displayName: 'Member User',
      isAdmin: false,
      notificationPreferences: {
        commentEmailEnabled: true,
        hourlyActivityDigestEnabled: false,
      },
    } )
  } )
}

describeWithFirestoreEmulator( 'firestore.rules notification preferences', () => {
  beforeAll( async () => {
    testEnv = await initializeTestEnvironment( {
      projectId,
      firestore: {
        rules: firestoreRules,
      },
    } )
  }, 90000 )

  beforeEach( async () => {
    await testEnv.clearFirestore()
    await seedUserProfile()
  } )

  afterAll( async () => {
    if( testEnv ) {
      await testEnv.cleanup()
    }
  } )

  it( 'allows users to update their own boolean notification preferences', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertSucceeds( updateDoc( doc( firestore, 'userProfiles', userId ), {
      notificationPreferences: {
        commentEmailEnabled: false,
        hourlyActivityDigestEnabled: true,
      },
    } ) )
  } )

  it( 'rejects non-boolean notification preference values', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertFails( updateDoc( doc( firestore, 'userProfiles', userId ), {
      notificationPreferences: {
        commentEmailEnabled: 'false',
        hourlyActivityDigestEnabled: true,
      },
    } ) )
  } )

  it( 'rejects self-updates that change admin status', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertFails( updateDoc( doc( firestore, 'userProfiles', userId ), {
      isAdmin: true,
    } ) )
  } )

  it( 'prevents clients from writing internal notification events and digests', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertFails( setDoc( doc( firestore, 'notificationEvents', 'event-1' ), {
      userId,
    } ) )
    await assertFails( setDoc( doc( firestore, 'notificationDigests', 'digest-1' ), {
      userId,
    } ) )
  } )
} )

