// tools/reputation_functions_emulator.mjs: Exercises deployed reputation triggers against the local emulators.

import assert from 'node:assert/strict'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-qt4-e2e'
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST
if( !firestoreHost ) {
  throw new Error( 'Firestore emulator is required for reputation integration tests.' )
}

const app = getApps().length > 0
  ? getApps()[0]
  : initializeApp( { projectId } )
const db = getFirestore( app )

const sleep = (milliseconds) => new Promise( (resolve) => setTimeout( resolve, milliseconds ) )

const waitForDocument = async (path, predicate, label, timeout = 30000) => {
  const deadline = Date.now() + timeout
  while( Date.now() < deadline ) {
    const snapshot = await db.doc( path ).get()
    if( snapshot.exists && predicate( snapshot.data() ) ) {
      return snapshot.data()
    }
    await sleep( 250 )
  }
  const snapshot = await db.doc( path ).get()
  throw new Error( `Timed out waiting for ${label}: ${JSON.stringify(snapshot.data() ?? null)}` )
}

const readDocument = async (path) => (await db.doc( path ).get()).data() ?? null

const projectIdForTest = 'project-e2e-reputation'
const memberId = 'user-member-1'
const reviewerId = 'user-reviewer-1'
const memberSummaryPath = `reputationSummaries/${projectIdForTest}_${memberId}`
const reviewerSummaryPath = `reputationSummaries/${projectIdForTest}_${reviewerId}`

await db.doc( 'threads/reputation-thread-1' ).set( {
  projectId: projectIdForTest,
  createdBy: memberId,
  title: 'Integration thread',
  docId: 'reputation-document-1',
  versionId: 'reputation-version-1',
} )
await waitForDocument( memberSummaryPath, (data) => data.totalPoints === 1 && data.threadCount === 1, 'thread reputation' )
assert.equal( ( await readDocument( 'reputationEvents/threadCreated:reputation-thread-1' ) ).sequenceNumber, 1 )
assert.equal( ( await readDocument( `reputationSequenceCounters/${projectIdForTest}_${memberId}_reviewParticipation` ) ).sequenceNumber, 1 )

await db.doc( 'documents/reputation-document-1' ).set( {
  projectId: projectIdForTest,
  type: 'document',
  title: 'Integration document',
} )
await db.doc( 'versions/reputation-version-1' ).set( {
  projectId: projectIdForTest,
  docId: 'reputation-document-1',
  createdBy: memberId,
  reviewerIds: [ reviewerId ],
  status: 'In Review',
  number: 1,
} )

await db.doc( 'comments/reputation-comment-1' ).set( {
  projectId: projectIdForTest,
  createdBy: memberId,
  threadId: 'reputation-thread-1',
  docId: 'reputation-document-1',
  versionId: 'reputation-version-1',
  body: 'Integration comment',
} )
await waitForDocument( memberSummaryPath, (data) => data.totalPoints === 2 && data.commentCount === 1, 'comment reputation' )
assert.equal( ( await readDocument( 'reputationEvents/commentCreated:reputation-comment-1' ) ).sequenceNumber, 2 )

await db.doc( 'comments/reputation-comment-1' ).set( {
  projectId: projectIdForTest,
  createdBy: memberId,
  threadId: 'reputation-thread-1',
  docId: 'reputation-document-1',
  versionId: 'reputation-version-1',
  body: 'Integration comment',
} )
await sleep( 750 )
assert.equal( ( await readDocument( memberSummaryPath ) ).totalPoints, 2 )

await db.doc( 'commentReactions/reputation-reaction-1' ).set( {
  projectId: projectIdForTest,
  commentId: 'reputation-comment-1',
  userId: reviewerId,
  reaction: 'good',
} )
await waitForDocument( memberSummaryPath, (data) => data.totalPoints === 3 && data.goodReactionCount === 1, 'good reaction reputation' )
assert.equal( ( await readDocument( 'reputationEvents/reactionGood:reputation-reaction-1' ) ).points, 1 )

await db.doc( 'commentReactions/reputation-reaction-1' ).update( { reaction: 'regular' } )
await waitForDocument( memberSummaryPath, (data) => data.totalPoints === 2 && data.goodReactionCount === 0, 'reaction reversal' )
assert.equal( ( await readDocument( 'reputationEvents/reactionGood:reputation-reaction-1' ) ).active, false )

await db.doc( 'versions/reputation-version-1' ).update( {
  status: 'Accepted',
} )

await waitForDocument( reviewerSummaryPath, (data) => data.totalPoints === -1 && data.completedReviewCount === 0, 'reviewer reputation' )
await waitForDocument( memberSummaryPath, (data) => data.totalPoints === 3 && data.acceptedVersionCount === 1, 'accepted version reputation' )

assert.equal( ( await readDocument( 'reputationEvents/reviewAbsence:reputation-version-1:user-reviewer-1' ) ).points, -1 )
assert.equal( ( await readDocument( 'reputationEvents/acceptedVersion:reputation-version-1' ) ).points, 1 )
assert.equal( ( await readDocument( 'reputationEvents/acceptedVersion:reputation-version-1' ) ).sequenceNumber, 1 )
// Links the server isolation unit contract to the two-project browser system checks.
for( let indexOfThread = 1; indexOfThread <= 3; indexOfThread += 1 ) {
  await db.doc( `threads/second-reputation-thread-${indexOfThread}` ).set( {
    projectId: 'project-e2e-second', createdBy: memberId,
    title: 'Second project contribution', docId: 'second-document',
    versionId: `second-version-${indexOfThread}`,
  } )
}
const secondSummary = await waitForDocument(
  `reputationSummaries/project-e2e-second_${memberId}`,
  (data) => data.threadCount === 3,
  'second project independent points and badges',
)
assert.equal( secondSummary.totalPoints, 2 + 1 / 3 )
assert.ok( secondSummary.badgeIds.includes( 'issue-spotter' ) )
const firstSummary = await readDocument( memberSummaryPath )
assert.equal( firstSummary.totalPoints, 3 )
assert.equal( firstSummary.threadCount, 1 )
assert.equal( firstSummary.badgeIds.includes( 'issue-spotter' ), false )
assert.equal( ( await readDocument( `reputationSequenceCounters/${projectIdForTest}_${memberId}_reviewParticipation` ) ).sequenceNumber, 2 )
assert.equal( ( await readDocument( `reputationSequenceCounters/project-e2e-second_${memberId}_reviewParticipation` ) ).sequenceNumber, 3 )
console.log( 'Reputation Functions emulator integration passed.' )
