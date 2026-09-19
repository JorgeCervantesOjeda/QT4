// src/lib/firestoreReviewIssueRules.test.ts
// Verifies Firestore rules for review issue threads and comments.
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
  writeBatch,
} from 'firebase/firestore'
import firestoreRules from '../../firestore.rules?raw'

let testEnv: RulesTestEnvironment
const describeWithFirestoreEmulator = import.meta.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip

const projectId = 'qt4-review-issue-rules'
const userId = 'reviewer-1'
const docId = 'document-1'
const versionId = 'version-1'
const threadId = 'thread-1'
const commentId = 'comment-1'

const baseVersion = {
  projectId,
  docId,
  number: 1,
  status: 'In Review',
  createdBy: 'author-1',
  reviewerIds: [userId],
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
  updatedBy: 'author-1',
  stats: {
    numThreads: 0,
    numOpenThreads: 0,
    numComments: 0,
    numThreadsWithTwoPlusComments: 0,
  },
  numThreads: 0,
  numOpenThreads: 0,
  numComments: 0,
  numThreadsWithTwoPlusComments: 0,
}

const seedReviewDocuments = async () => {
  await testEnv.withSecurityRulesDisabled( async ( context ) => {
    const firestore = context.firestore()
    await Promise.all( [
      setDoc( doc( firestore, 'userProfiles', userId ), { isAdmin: false } ),
      setDoc( doc( firestore, 'projects', projectId ), {
        name: 'Review project',
        leaderId: 'leader-1',
        shortId: 1,
      } ),
      setDoc( doc( firestore, 'projectMembers', `${projectId}_${userId}` ), {
        projectId,
        userId,
        role: 'member',
      } ),
      setDoc( doc( firestore, 'documents', docId ), {
        projectId,
        title: 'Document',
        createdBy: 'author-1',
        authorId: 'author-1',
        status: 'In Review',
        createdAt: Timestamp.fromMillis( 800 ),
        updatedAt: Timestamp.fromMillis( 900 ),
      } ),
      setDoc( doc( firestore, 'versions', versionId ), baseVersion ),
    ] )
  } )
}

const writeInitialIssue = async (overrides: { versionPatch?: Record<string, unknown>; commentPatch?: Record<string, unknown> } = {}) => {
  const firestore = testEnv.authenticatedContext( userId ).firestore()
  const batch = writeBatch( firestore )
  const now = Timestamp.fromMillis( 1500 )
  batch.set( doc( firestore, 'threads', threadId ), {
    projectId,
    docId,
    versionId,
    status: 'open',
    title: 'Missing evidence',
    createdBy: userId,
    commentCount: 1,
    lastCommentAt: now,
    lastCommentBy: userId,
    createdAt: now,
    updatedAt: now,
    updatedBy: userId,
  } )
  batch.set( doc( firestore, 'comments', commentId ), {
    projectId,
    docId,
    versionId,
    threadId,
    body: 'Please add evidence.',
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    ...overrides.commentPatch,
  } )
  batch.update( doc( firestore, 'versions', versionId ), {
    stats: {
      numThreads: 1,
      numOpenThreads: 1,
      numComments: 1,
      numThreadsWithTwoPlusComments: 0,
    },
    numThreads: 1,
    numOpenThreads: 1,
    numComments: 1,
    numThreadsWithTwoPlusComments: 0,
    activityAt: now,
    updatedAt: now,
    updatedBy: userId,
    ...overrides.versionPatch,
  } )
  return batch.commit()
}

describeWithFirestoreEmulator( 'firestore.rules review issue creation', () => {
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
    await seedReviewDocuments()
  } )

  afterAll( async () => {
    if( testEnv ) {
      await testEnv.cleanup()
    }
  } )

  it( 'allows a reviewer to create a thread with its initial comment atomically', async () => {
    await assertSucceeds( writeInitialIssue() )
  } )

  it( 'rejects initial issue creation without the version comment counter increment', async () => {
    await assertFails( writeInitialIssue( {
      versionPatch: {
        stats: {
          numThreads: 1,
          numOpenThreads: 1,
          numComments: 0,
          numThreadsWithTwoPlusComments: 0,
        },
        numComments: 0,
      },
    } ) )
  } )

  it( 'rejects initial issue creation when the comment does not belong to the new thread creator', async () => {
    await assertFails( writeInitialIssue( {
      commentPatch: {
        createdBy: 'other-user',
      },
    } ) )
  } )
} )
