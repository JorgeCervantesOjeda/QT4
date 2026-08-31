// src/lib/firestoreSlowUiActionRules.test.ts: Verifies Firestore rules for slow UI action telemetry.
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  setDoc,
  Timestamp,
} from 'firebase/firestore'
import firestoreRules from '../../firestore.rules?raw'

let testEnv: RulesTestEnvironment
const describeWithFirestoreEmulator = import.meta.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip

const projectId = 'qt4-slow-ui-action-rules'
const userId = 'user-1'
const adminId = 'admin-1'

const buildSlowUiAction = (overrides: Record<string, unknown> = {}) => ( {
  action: 'review.explainIssue',
  page: 'Document Versions',
  route: '/projects/project-1/documents/doc-1/versions',
  hasModal: false,
  userId,
  projectId: 'project-1',
  docId: 'doc-1',
  versionId: 'version-1',
  threadId: 'thread-1',
  durationMs: 1200,
  thresholdMs: 1000,
  startedAt: Timestamp.fromMillis( 1000 ),
  endedAt: Timestamp.fromMillis( 2200 ),
  createdAt: Timestamp.fromMillis( 2300 ),
  reportedAt: null,
  ...overrides,
} )

describeWithFirestoreEmulator( 'firestore.rules slow UI actions', () => {
  beforeAll( async () => {
    testEnv = await initializeTestEnvironment( {
      projectId,
      firestore: {
        rules: firestoreRules,
      },
    } )
  }, 30000 )

  beforeEach( async () => {
    await testEnv.clearFirestore()
    await testEnv.withSecurityRulesDisabled( async ( context ) => {
      await Promise.all( [
        setDoc( doc( context.firestore(), 'userProfiles', userId ), { isAdmin: false } ),
        setDoc( doc( context.firestore(), 'userProfiles', adminId ), { isAdmin: true } ),
      ] )
    } )
  } )

  afterAll( async () => {
    if( testEnv ) {
      await testEnv.cleanup()
    }
  } )

  it( 'allows a signed-in user to create their own slow non-modal action event', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertSucceeds(
      setDoc( doc( firestore, 'slowUiActions', 'event-allowed' ), buildSlowUiAction() ),
    )
  } )

  it( 'rejects events for a different user', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertFails(
      setDoc(
        doc( firestore, 'slowUiActions', 'event-denied' ),
        buildSlowUiAction( { userId: 'other-user' } ),
      ),
    )
  } )

  it( 'rejects events with unapproved sensitive fields', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertFails(
      setDoc(
        doc( firestore, 'slowUiActions', 'event-body-denied' ),
        buildSlowUiAction( { commentBody: 'private comment text' } ),
      ),
    )
  } )

  it( 'keeps normal users from reading telemetry documents', async () => {
    await testEnv.withSecurityRulesDisabled( async ( context ) => {
      await setDoc( doc( context.firestore(), 'slowUiActions', 'event-private' ), buildSlowUiAction() )
    } )
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertFails(
      getDoc( doc( firestore, 'slowUiActions', 'event-private' ) ),
    )
  } )

  it( 'allows admins to read telemetry documents', async () => {
    await testEnv.withSecurityRulesDisabled( async ( context ) => {
      await setDoc( doc( context.firestore(), 'slowUiActions', 'event-admin-readable' ), buildSlowUiAction() )
    } )
    const firestore = testEnv.authenticatedContext( adminId ).firestore()

    await assertSucceeds(
      getDoc( doc( firestore, 'slowUiActions', 'event-admin-readable' ) ),
    )
  } )
} )
