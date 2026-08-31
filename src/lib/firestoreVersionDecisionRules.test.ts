// src/lib/firestoreVersionDecisionRules.test.ts
// Verifies Firestore rules keep final version decisions behind backend authority.
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
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import firestoreRules from '../../firestore.rules?raw'

let testEnv: RulesTestEnvironment
const describeWithFirestoreEmulator = import.meta.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip

const projectId = 'qt4-version-decision-rules'
const userId = 'user-1'
const targetProjectId = 'target-project'
const docId = 'document-1'
const reviewVersionId = 'review-version-1'
const acceptedVersionId = 'accepted-version-1'
const derivedConfigurationId = 'target-project|origin-project|origin-doc|origin-version'

const reviewEvidence = {
  stats: {
    numThreads: 1,
    numOpenThreads: 0,
    numComments: 2,
    numThreadsWithTwoPlusComments: 1,
  },
  numThreads: 1,
  numOpenThreads: 0,
  numComments: 2,
  numThreadsWithTwoPlusComments: 1,
}

const buildVersion = (overrides: Record<string, unknown> = {}) => ( {
  projectId: targetProjectId,
  docId,
  number: 1,
  status: 'In Review',
  createdBy: userId,
  reviewerIds: ['reviewer-1'],
  reviewStartAt: Timestamp.fromMillis( 1000 ),
  reviewEndAt: Timestamp.fromMillis( 2000 ),
  reviewDurationDays: 1,
  hasFile: true,
  fileRefId: 'file-1',
  acceptedErrorReportId: null,
  previousVersionId: null,
  createdAt: Timestamp.fromMillis( 900 ),
  activityAt: Timestamp.fromMillis( 1000 ),
  updatedAt: Timestamp.fromMillis( 1000 ),
  updatedBy: userId,
  ...reviewEvidence,
  ...overrides,
} )

const seedVersionDecisionDocuments = async () => {
  await testEnv.withSecurityRulesDisabled( async ( context ) => {
    const firestore = context.firestore()
    await Promise.all( [
      setDoc( doc( firestore, 'userProfiles', userId ), { isAdmin: false } ),
      setDoc( doc( firestore, 'projects', targetProjectId ), {
        name: 'Target project',
        leaderId: userId,
        shortId: 1,
      } ),
      setDoc( doc( firestore, 'projectMembers', `${targetProjectId}_${userId}` ), {
        projectId: targetProjectId,
        userId,
        role: 'leader',
      } ),
      setDoc( doc( firestore, 'documents', docId ), {
        projectId: targetProjectId,
        type: 'document',
        title: 'Controlled document',
        createdBy: userId,
        authorId: userId,
        shortId: 7,
      } ),
      setDoc( doc( firestore, 'versions', reviewVersionId ), buildVersion() ),
      setDoc(
        doc( firestore, 'versions', acceptedVersionId ),
        buildVersion( {
          number: 100,
          status: 'Accepted',
          reviewerIds: [],
          reviewStartAt: null,
          reviewEndAt: null,
        } ),
      ),
      setDoc( doc( firestore, 'derivedConfigurations', derivedConfigurationId ), {
        key: derivedConfigurationId,
        projectId: targetProjectId,
        originProjectId: 'origin-project',
        originDocumentId: 'origin-doc',
        originVersionId: 'origin-version',
        activeChangeRequestVersionIds: ['change-request-version-1'],
        status: 'Open',
        generationStatus: 'open',
        updatedAt: Timestamp.fromMillis( 1000 ),
        updatedBy: userId,
      } ),
    ] )
  } )
}

describeWithFirestoreEmulator( 'firestore.rules version decisions', () => {
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
    await seedVersionDecisionDocuments()
  } )

  afterAll( async () => {
    if( testEnv ) {
      await testEnv.cleanup()
    }
  } )

  it( 'rejects direct client acceptance of a review version', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertFails(
      updateDoc( doc( firestore, 'versions', reviewVersionId ), {
        status: 'Accepted',
        number: 100,
        activityAt: Timestamp.fromMillis( 3000 ),
        updatedAt: Timestamp.fromMillis( 3000 ),
        updatedBy: userId,
      } ),
    )
  } )

  it( 'rejects direct client rejection of a review version', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertFails(
      updateDoc( doc( firestore, 'versions', reviewVersionId ), {
        status: 'Rejected',
        activityAt: Timestamp.fromMillis( 3000 ),
        updatedAt: Timestamp.fromMillis( 3000 ),
        updatedBy: userId,
      } ),
    )
  } )

  it( 'rejects direct client replacement of an accepted version', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertFails(
      updateDoc( doc( firestore, 'versions', acceptedVersionId ), {
        status: 'Replaced',
        activityAt: Timestamp.fromMillis( 3000 ),
        updatedAt: Timestamp.fromMillis( 3000 ),
        updatedBy: userId,
      } ),
    )
  } )

  it( 'allows normal client start-review transitions to keep working', async () => {
    await testEnv.withSecurityRulesDisabled( async ( context ) => {
      await setDoc(
        doc( context.firestore(), 'versions', 'creation-version-1' ),
        buildVersion( {
          number: 2,
          status: 'In Creation',
          reviewerIds: ['reviewer-1'],
          reviewStartAt: null,
          reviewEndAt: null,
        } ),
      )
    } )
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertSucceeds(
      updateDoc( doc( firestore, 'versions', 'creation-version-1' ), {
        status: 'In Review',
        reviewStartAt: Timestamp.fromMillis( 3000 ),
        reviewEndAt: Timestamp.fromMillis( 4000 ),
        activityAt: Timestamp.fromMillis( 3000 ),
        updatedAt: Timestamp.fromMillis( 3000 ),
        updatedBy: userId,
      } ),
    )
  } )

  it( 'rejects direct client acceptance of a derived configuration', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertFails(
      updateDoc( doc( firestore, 'derivedConfigurations', derivedConfigurationId ), {
        status: 'Accepted',
        generationStatus: 'accepted',
        acceptedDerivedDocumentId: 'derived-doc',
        acceptedDerivedVersionId: 'derived-version',
        updatedAt: Timestamp.fromMillis( 3000 ),
        updatedBy: userId,
      } ),
    )
  } )

  it( 'allows a client to record a generated derived configuration shell', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()

    await assertSucceeds(
      updateDoc( doc( firestore, 'derivedConfigurations', derivedConfigurationId ), {
        status: 'Generated',
        generationStatus: 'generated',
        derivedDocumentId: 'derived-doc',
        derivedVersionId: 'derived-version',
        createdAt: Timestamp.fromMillis( 3000 ),
        createdBy: userId,
        updatedAt: Timestamp.fromMillis( 3000 ),
        updatedBy: userId,
      } ),
    )
  } )
} )
