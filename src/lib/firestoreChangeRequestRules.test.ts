// src/lib/firestoreChangeRequestRules.test.ts
// Verifies Firestore rules for cross-project change-request document creation.
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
} from 'firebase/firestore'
import firestoreRules from '../../firestore.rules?raw'

let testEnv: RulesTestEnvironment
const describeWithFirestoreEmulator = import.meta.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip

const projectId = 'qt4-change-request-rules'
const userId = 'user-1'
const targetProjectId = 'project-target'
const baseProjectId = 'project-base'
const baseDocId = 'base-document-1'
const baseVersionId = 'base-version-1'
const targetBaseDocId = 'target-base-document-1'
const targetBaseVersionId = 'target-base-version-1'

const seedRuleDocuments = async () => {
  await testEnv.withSecurityRulesDisabled( async ( context ) => {
    const firestore = context.firestore()
    await Promise.all( [
      setDoc( doc( firestore, 'userProfiles', userId ), { isAdmin: false } ),
      setDoc( doc( firestore, 'projects', targetProjectId ), {
        name: 'Target project',
        leaderId: userId,
        shortId: 1,
      } ),
      setDoc( doc( firestore, 'projects', baseProjectId ), {
        name: 'Base project',
        leaderId: userId,
        shortId: 2,
      } ),
      setDoc( doc( firestore, 'projectMembers', `${targetProjectId}_${userId}` ), {
        projectId: targetProjectId,
        userId,
        role: 'leader',
      } ),
      setDoc( doc( firestore, 'projectMembers', `${baseProjectId}_${userId}` ), {
        projectId: baseProjectId,
        userId,
        role: 'member',
      } ),
      setDoc( doc( firestore, 'documents', baseDocId ), {
        projectId: baseProjectId,
        type: 'document',
        title: 'Shared requirements',
        createdBy: userId,
        authorId: userId,
        shortId: 7,
      } ),
      setDoc( doc( firestore, 'versions', baseVersionId ), {
        projectId: baseProjectId,
        docId: baseDocId,
        number: 100,
        status: 'Accepted',
        createdBy: userId,
        reviewerIds: [],
      } ),
      setDoc( doc( firestore, 'documents', targetBaseDocId ), {
        projectId: targetProjectId,
        type: 'document',
        title: 'Target requirements',
        createdBy: userId,
        authorId: userId,
        shortId: 8,
      } ),
      setDoc( doc( firestore, 'versions', targetBaseVersionId ), {
        projectId: targetProjectId,
        docId: targetBaseDocId,
        number: 100,
        status: 'Accepted',
        createdBy: userId,
        reviewerIds: [],
      } ),
    ] )
  } )
}

const buildChangeRequestDocument = (value: {
  baseProjectId: string
  baseDocId: string
  baseVersionId: string
}) => ( {
  projectId: targetProjectId,
  type: 'changeRequest',
  title: 'Client variation',
  baseProjectId: value.baseProjectId,
  baseDocId: value.baseDocId,
  baseVersionId: value.baseVersionId,
  createdBy: userId,
  authorId: userId,
  updatedBy: userId,
  shortId: 31,
} )

const buildDerivedDocument = () => ( {
  projectId: targetProjectId,
  type: 'derivedDocument',
  title: 'Derived variant',
  originProjectId: baseProjectId,
  originDocumentId: baseDocId,
  originVersionId: baseVersionId,
  incorporatedChangeRequestVersionIds: ['change-request-version-1'],
  createdBy: userId,
  authorId: userId,
  updatedBy: userId,
  shortId: 32,
} )

describeWithFirestoreEmulator( 'firestore.rules change-request documents', () => {
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
    await seedRuleDocuments()
  } )

  afterAll( async () => {
    if( testEnv ) {
      await testEnv.cleanup()
    }
  } )

  it( 'allows a project member to create a change request from another project accepted base', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertSucceeds(
      setDoc(
        doc( firestore, 'documents', 'change-request-allowed' ),
        buildChangeRequestDocument( {
          baseProjectId,
          baseDocId,
          baseVersionId,
        } ),
      ),
    )
  } )

  it( 'rejects a change request that uses a same-project accepted base', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertFails(
      setDoc(
        doc( firestore, 'documents', 'change-request-denied' ),
        buildChangeRequestDocument( {
          baseProjectId: targetProjectId,
          baseDocId: targetBaseDocId,
          baseVersionId: targetBaseVersionId,
        } ),
      ),
    )
  } )

  it( 'rejects a change request when the creator is not a base project member', async () => {
    await testEnv.withSecurityRulesDisabled( async ( context ) => {
      await setDoc( doc( context.firestore(), 'projectMembers', `${baseProjectId}_${userId}` ), {
        projectId: baseProjectId,
        userId,
        role: 'removed',
      } )
    } )
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertFails(
      setDoc(
        doc( firestore, 'documents', 'change-request-base-membership-denied' ),
        buildChangeRequestDocument( {
          baseProjectId,
          baseDocId,
          baseVersionId,
        } ),
      ),
    )
  } )

  it( 'allows creating a derived document from an accepted external origin version', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertSucceeds(
      setDoc(
        doc( firestore, 'documents', 'derived-document-allowed' ),
        buildDerivedDocument(),
      ),
    )
  } )
} )
