// src/lib/firestoreReviewIssueRules.test.ts
// Verifies Firestore rules for review issue threads and comments.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
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
const commentReactionId = `${commentId}_${userId}`

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
        latestVersionId: versionId,
        status: 'In Review',
        createdAt: Timestamp.fromMillis( 800 ),
        updatedAt: Timestamp.fromMillis( 900 ),
      } ),
      setDoc( doc( firestore, 'versions', versionId ), baseVersion ),
    ] )
  } )
}

const writeInitialIssue = async (overrides: { versionPatch?: Record<string, unknown>; commentPatch?: Record<string, unknown>; threadPatch?: Record<string, unknown> } = {}) => {
  const firestore = testEnv.authenticatedContext( userId ).firestore()
  const batch = writeBatch( firestore )
  const now = Timestamp.fromMillis( 1500 )
  batch.set( doc( firestore, 'threads', threadId ), {
    issueNumber: 1,
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
    ...overrides.threadPatch,
  } )
  batch.set( doc( firestore, 'comments', commentId ), {
    projectId,
    docId,
    versionId,
    threadId,
    body: 'Please add evidence.',
    createdBy: userId,
    isInitialIssueComment: true,
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

  // Integration contract linked to reviewIssueActions and issue-ordering.spec.ts.
  it( 'rejects a nonconsecutive or fractional issue number', async () => {
    await assertFails( writeInitialIssue( { threadPatch: { issueNumber: 2 } } ) )
    await assertFails( writeInitialIssue( { threadPatch: { issueNumber: 1.5 } } ) )
  } )

  it( 'keeps the issue number immutable during title changes', async () => {
    await writeInitialIssue()
    const firestore = testEnv.authenticatedContext( userId ).firestore()
    await assertFails( updateDoc( doc( firestore, 'threads', threadId ), {
      issueNumber: 2, title: 'Updated title', updatedBy: userId,
    } ) )
  } )

  it( 'allocates consecutive numbers transactionally and restarts per version', async () => {
    const firestore = testEnv.authenticatedContext( userId ).firestore()
    const createNumberedIssue = ( suffix: string, targetVersionId = versionId ) => runTransaction( firestore, async ( transaction ) => {
      const versionRef = doc( firestore, 'versions', targetVersionId )
      const snapshot = await transaction.get( versionRef )
      const stats = snapshot.data()!.stats
      const issueNumber = stats.numThreads + 1
      const timestamp = Timestamp.now()
      const threadRef = doc( firestore, 'threads', `concurrent-${suffix}` )
      transaction.set( threadRef, {
        projectId, docId, versionId: targetVersionId, issueNumber,
        title: `Issue ${suffix}`, status: 'open', createdBy: userId, commentCount: 1,
        lastCommentAt: timestamp, lastCommentBy: userId,
        createdAt: timestamp, updatedAt: timestamp, updatedBy: userId,
      } )
      transaction.set( doc( firestore, 'comments', `initial-${suffix}` ), {
        projectId, docId, versionId: targetVersionId, threadId: threadRef.id,
        body: 'Initial comment', createdBy: userId, isInitialIssueComment: true,
        createdAt: timestamp, updatedAt: timestamp,
      } )
      transaction.update( versionRef, {
        stats: { ...stats, numThreads: issueNumber, numOpenThreads: stats.numOpenThreads + 1, numComments: stats.numComments + 1 },
        numThreads: issueNumber, numOpenThreads: stats.numOpenThreads + 1, numComments: stats.numComments + 1,
        numThreadsWithTwoPlusComments: stats.numThreadsWithTwoPlusComments,
        updatedAt: timestamp, activityAt: timestamp, updatedBy: userId,
      } )
      return issueNumber
    } )
    const numbers = [ await createNumberedIssue( 'a' ), await createNumberedIssue( 'b' ) ]
    expect( numbers.sort() ).toEqual( [ 1, 2 ] )
    await testEnv.withSecurityRulesDisabled( async ( context ) => {
      await setDoc( doc( context.firestore(), 'versions', 'version-2' ), baseVersion )
    } )
    expect( await createNumberedIssue( 'other-version', 'version-2' ) ).toBe( 1 )
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

  it( 'rejects the initial-comment marker on a later comment in an existing issue', async () => {
    await writeInitialIssue()

    const firestore = testEnv.authenticatedContext( userId ).firestore()
    const batch = writeBatch( firestore )
    const now = Timestamp.fromMillis( 1600 )
    batch.set( doc( firestore, 'comments', 'comment-2' ), {
      projectId,
      docId,
      versionId,
      threadId,
      body: 'A later comment.',
      createdBy: userId,
      isInitialIssueComment: true,
      createdAt: now,
      updatedAt: now,
    } )
    batch.update( doc( firestore, 'threads', threadId ), {
      commentCount: 2,
      lastCommentAt: now,
      lastCommentBy: userId,
      updatedAt: now,
      updatedBy: userId,
    } )
    batch.update( doc( firestore, 'versions', versionId ), {
      stats: {
        numThreads: 1,
        numOpenThreads: 1,
        numComments: 2,
        numThreadsWithTwoPlusComments: 1,
      },
      numComments: 2,
      numThreadsWithTwoPlusComments: 1,
      activityAt: now,
      updatedAt: now,
      updatedBy: userId,
    } )

    await assertFails( batch.commit() )
  } )

  it( 'allows the issue creator to update the generated issue title without changing its status', async () => {
    await writeInitialIssue()

    const firestore = testEnv.authenticatedContext( userId ).firestore()
    await assertSucceeds( updateDoc( doc( firestore, 'threads', threadId ), {
      title: 'AI-generated summary',
      updatedAt: Timestamp.fromMillis( 1600 ),
      updatedBy: userId,
    } ) )
  } )

  it( 'rejects generated issue title updates from contributors who did not create the issue', async () => {
    await writeInitialIssue()

    const firestore = testEnv.authenticatedContext( 'author-1' ).firestore()
    await assertFails( updateDoc( doc( firestore, 'threads', threadId ), {
      title: 'Author-provided summary',
      updatedAt: Timestamp.fromMillis( 1600 ),
      updatedBy: 'author-1',
    } ) )
  } )

  it( 'allows a reviewer to react to a review comment with a deterministic document id', async () => {
    await writeInitialIssue()

    const firestore = testEnv.authenticatedContext( userId ).firestore()
    await assertSucceeds( setDoc( doc( firestore, 'commentReactions', commentReactionId ), {
      projectId,
      docId,
      versionId,
      threadId,
      commentId,
      userId,
      reaction: 'good',
      createdAt: Timestamp.fromMillis( 1700 ),
      updatedAt: Timestamp.fromMillis( 1700 ),
    } ) )
  } )

  it( 'rejects comment reactions that impersonate another user', async () => {
    await writeInitialIssue()

    const firestore = testEnv.authenticatedContext( userId ).firestore()
    await assertFails( setDoc( doc( firestore, 'commentReactions', `${commentId}_other-user` ), {
      projectId,
      docId,
      versionId,
      threadId,
      commentId,
      userId: 'other-user',
      reaction: 'good',
      createdAt: Timestamp.fromMillis( 1700 ),
      updatedAt: Timestamp.fromMillis( 1700 ),
    } ) )
  } )

  it( 'allows users to update their own comment reaction', async () => {
    await writeInitialIssue()
    await testEnv.withSecurityRulesDisabled( async ( context ) => {
      const firestore = context.firestore()
      await setDoc( doc( firestore, 'commentReactions', commentReactionId ), {
        projectId,
        docId,
        versionId,
        threadId,
        commentId,
        userId,
        reaction: 'good',
        createdAt: Timestamp.fromMillis( 1700 ),
        updatedAt: Timestamp.fromMillis( 1700 ),
      } )
    } )

    const firestore = testEnv.authenticatedContext( userId ).firestore()
    await assertSucceeds( updateDoc( doc( firestore, 'commentReactions', commentReactionId ), {
      reaction: 'bad',
      updatedAt: Timestamp.fromMillis( 1800 ),
    } ) )
  } )
} )
