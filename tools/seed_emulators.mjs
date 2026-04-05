import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-qt4-e2e'
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST

if( !firestoreHost || !authHost ) {
  throw new Error( 'Firebase emulators are not running. FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are required.' )
}

const app = getApps().length > 0
  ? getApps()[0]
  : initializeApp( {
    projectId,
    storageBucket: `${projectId}.appspot.com`,
  } )

const auth = getAuth( app )
const db = getFirestore( app )
const storage = getStorage( app )

const clearFirestore = async () => {
  const response = await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
  if( !response.ok ) {
    throw new Error( `Failed to clear Firestore emulator: ${response.status} ${response.statusText}` )
  }
}

const clearAuth = async () => {
  const response = await fetch(
    `http://${authHost}/emulator/v1/projects/${projectId}/accounts`,
    { method: 'DELETE' },
  )
  if( !response.ok ) {
    throw new Error( `Failed to clear Auth emulator: ${response.status} ${response.statusText}` )
  }
}

const clearStorage = async () => {
  try {
    await storage.bucket().deleteFiles( { force: true } )
  } catch {
    // ignore missing bucket state
  }
}

const users = [
  {
    uid: 'user-member-1',
    email: 'member@example.com',
    password: 'password123',
    displayName: 'Member User',
    isAdmin: false,
  },
  {
    uid: 'user-admin-1',
    email: 'admin@example.com',
    password: 'password123',
    displayName: 'Admin User',
    isAdmin: true,
  },
  {
    uid: 'user-reviewer-1',
    email: 'reviewer@example.com',
    password: 'password123',
    displayName: 'Reviewer User',
    isAdmin: false,
  },
]

const REVIEW_FLOW_PROJECT_ID = 'project-e2e-review-flow'
const REVIEW_FLOW_DOCUMENT_ID = 'document-e2e-review-flow'
const REVIEW_FLOW_VERSION_ID = 'version-e2e-review-flow'
const REVIEW_FLOW_FILE_REF_ID = 'file-ref-e2e-review-flow'

const REVIEW_GUARD_PROJECT_ID = 'project-e2e-review-guard'
const REVIEW_GUARD_DOCUMENT_ID = 'document-e2e-review-guard'
const REVIEW_GUARD_VERSION_ID = 'version-e2e-review-guard'
const REVIEW_GUARD_FILE_REF_ID = 'file-ref-e2e-review-guard'
const REVIEW_GUARD_THREAD_ID = 'thread-e2e-review-guard'
const REVIEW_GUARD_THREAD_2_ID = 'thread-e2e-review-guard-2'
const REVIEW_GUARD_COMMENT_1_ID = 'comment-e2e-review-guard-1'
const REVIEW_GUARD_COMMENT_2_ID = 'comment-e2e-review-guard-2'
const REVIEW_GUARD_COMMENT_3_ID = 'comment-e2e-review-guard-3'

const REVIEW_GRACE_PROJECT_ID = 'project-e2e-review-grace'
const REVIEW_GRACE_DOCUMENT_ID = 'document-e2e-review-grace'
const REVIEW_GRACE_VERSION_ID = 'version-e2e-review-grace'
const REVIEW_GRACE_FILE_REF_ID = 'file-ref-e2e-review-grace'
const REVIEW_GRACE_THREAD_ID = 'thread-e2e-review-grace'
const REVIEW_GRACE_COMMENT_1_ID = 'comment-e2e-review-grace-1'
const REVIEW_GRACE_COMMENT_2_ID = 'comment-e2e-review-grace-2'

const UI_NOTIFY_PROJECT_ID = 'project-e2e-ui-notify'
const UI_NOTIFY_DOCUMENT_ID = 'document-e2e-ui-notify'
const UI_NOTIFY_VERSION_ID = 'version-e2e-ui-notify'
const UI_NOTIFY_FILE_REF_ID = 'file-ref-e2e-ui-notify'

const ERROR_REPORT_BASE_PROJECT_ID = 'project-e2e-error-report-base'
const ERROR_REPORT_BASE_DOCUMENT_ID = 'document-e2e-error-report-base'
const ERROR_REPORT_BASE_VERSION_ID = 'version-e2e-error-report-base'
const ERROR_REPORT_BASE_FILE_REF_ID = 'file-ref-e2e-error-report-base'

const ERROR_REPORT_UNLOCK_PROJECT_ID = 'project-e2e-error-report-unlock'
const ERROR_REPORT_UNLOCK_DOCUMENT_ID = 'document-e2e-error-report-unlock'
const ERROR_REPORT_UNLOCK_VERSION_ID = 'version-e2e-error-report-unlock'
const ERROR_REPORT_UNLOCK_FILE_REF_ID = 'file-ref-e2e-error-report-unlock'
const ERROR_REPORT_UNLOCK_REPORT_DOCUMENT_ID = 'document-e2e-error-report-linked'
const ERROR_REPORT_UNLOCK_REPORT_VERSION_ID = 'version-e2e-error-report-linked'
const ERROR_REPORT_UNLOCK_REPORT_FILE_REF_ID = 'file-ref-e2e-error-report-linked'
const ERROR_REPORT_TRANSITION_PROJECT_ID = 'project-e2e-error-report-transition'
const ERROR_REPORT_TRANSITION_DOCUMENT_ID = 'document-e2e-error-report-transition'
const ERROR_REPORT_TRANSITION_VERSION_ID = 'version-e2e-error-report-transition'
const ERROR_REPORT_TRANSITION_FILE_REF_ID = 'file-ref-e2e-error-report-transition'
const ERROR_REPORT_TRANSITION_REPORT_DOCUMENT_ID = 'document-e2e-error-report-transition-linked'
const ERROR_REPORT_TRANSITION_REPORT_VERSION_ID = 'version-e2e-error-report-transition-linked'
const ERROR_REPORT_TRANSITION_REPORT_FILE_REF_ID = 'file-ref-e2e-error-report-transition-linked'
const MODEL_UPDATE_PROJECT_ID = 'project-e2e-model-update'
const MODEL_UPDATE_DOCUMENT_ID = 'document-e2e-model-update'
const MODEL_UPDATE_VERSION_ID = 'version-e2e-model-update'
const REPAIR_PROJECT_ID = 'project-e2e-repair'
const REPAIR_DOCUMENT_ID = 'document-e2e-repair'
const REPAIR_VERSION_ID = 'version-e2e-repair'

const setProjectMember = (batch, projectId, userId, role, email, timestamp) => {
  batch.set( db.doc( `projectMembers/${projectId}_${userId}` ), {
    projectId,
    userId,
    role,
    email,
    createdAt: timestamp,
    updatedAt: timestamp,
  } )
}

const setVersionFileRef = (
  batch,
  {
    fileRefId,
    fileKey,
    fileName,
    projectId,
    docId,
    versionId,
    createdBy,
    timestamp,
  },
) => {
  batch.set( db.doc( `fileRefs/${fileRefId}` ), {
    fileKey,
    fileName,
    contentType: 'application/pdf',
    sizeBytes: 2048,
    isPermanent: true,
    expireAfterDays: null,
    storageProvider: 'firebase-storage',
    createdBy,
    projectId,
    docId,
    versionId,
    createdAt: timestamp,
    updatedAt: timestamp,
  } )
}

const seedUsers = async () => {
  for( const user of users ) {
    await auth.createUser( {
      uid: user.uid,
      email: user.email,
      password: user.password,
      displayName: user.displayName,
      emailVerified: true,
    } )
    await auth.setCustomUserClaims( user.uid, { admin: user.isAdmin } )
  }
}

const seedFirestore = async () => {
  const createdAt = Timestamp.fromDate( new Date( '2026-04-01T12:00:00.000Z' ) )
  const auditAt = Timestamp.fromDate( new Date( '2026-04-02T09:00:00.000Z' ) )
  const reviewStartAt = Timestamp.fromDate( new Date( '2026-04-03T09:00:00.000Z' ) )
  const reviewEndAt = Timestamp.fromDate( new Date( '2026-04-10T09:00:00.000Z' ) )
  const guardCommentAt = Timestamp.fromDate( new Date( '2026-04-03T10:00:00.000Z' ) )
  const guardResolvedAt = Timestamp.fromDate( new Date( '2026-04-03T10:30:00.000Z' ) )
  const guardFollowUpAt = Timestamp.fromDate( new Date( '2026-04-03T11:00:00.000Z' ) )
  const now = Date.now()
  const graceReviewEndAt = Timestamp.fromDate( new Date( now - ( 15 * 60 * 1000 ) ) )
  const graceCommentAt = Timestamp.fromDate( new Date( now - ( 12 * 60 * 1000 ) ) )
  const graceResolvedAt = Timestamp.fromDate( new Date( now - ( 5 * 60 * 1000 ) ) )
  const acceptedAt = Timestamp.fromDate( new Date( '2026-04-02T14:00:00.000Z' ) )
  const linkedAcceptedAt = Timestamp.fromDate( new Date( '2026-04-03T08:30:00.000Z' ) )
  const batch = db.batch()

  for( const user of users ) {
    batch.set( db.doc( `userProfiles/${user.uid}` ), {
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      createdAt,
      updatedAt: createdAt,
    } )
    batch.set( db.doc( `userDirectory/${user.email}` ), {
      userId: user.uid,
      email: user.email,
      emailKey: user.email,
      emailLower: user.email.toLowerCase(),
      displayName: user.displayName,
      createdAt,
      updatedAt: createdAt,
    } )
  }

  batch.set( db.doc( 'systemConfig/runtime' ), {
    fileStorageProvider: 'firebase-storage',
    emailProvider: 'files-api',
    updatedAt: createdAt,
    updatedBy: 'user-admin-1',
  } )

  batch.set( db.doc( 'auditLogs/seed-log-1' ), {
    actorId: 'user-admin-1',
    actorEmail: 'admin@example.com',
    action: 'seedAudit',
    entityType: 'system',
    entityId: 'seed-1',
    createdAt: auditAt,
    metadata: {
      note: 'Seeded admin audit event',
    },
  } )

  batch.set( db.doc( 'counters/projects' ), {
    nextNumber: 207,
    lastProjectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
  } )

  batch.set( db.doc( 'projects/project-e2e-review-flow' ), {
    name: 'Seeded Review Flow Project',
    leaderId: 'user-member-1',
    isActive: true,
    shortId: 201,
    createdAt,
    updatedAt: createdAt,
  } )
  setProjectMember( batch, REVIEW_FLOW_PROJECT_ID, 'user-member-1', 'leader', 'member@example.com', createdAt )
  setProjectMember( batch, REVIEW_FLOW_PROJECT_ID, 'user-reviewer-1', 'member', 'reviewer@example.com', createdAt )
  batch.set( db.doc( `counters/documents_${REVIEW_FLOW_PROJECT_ID}` ), {
    nextNumber: 302,
    projectId: REVIEW_FLOW_PROJECT_ID,
  } )
  batch.set( db.doc( `documents/${REVIEW_FLOW_DOCUMENT_ID}` ), {
    projectId: REVIEW_FLOW_PROJECT_ID,
    title: 'Seeded Review Flow Document',
    type: 'document',
    createdBy: 'user-member-1',
    authorId: 'user-member-1',
    updatedBy: 'user-member-1',
    shortId: 301,
    createdAt,
    updatedAt: createdAt,
  } )
  batch.set( db.doc( `versions/${REVIEW_FLOW_VERSION_ID}` ), {
    projectId: REVIEW_FLOW_PROJECT_ID,
    docId: REVIEW_FLOW_DOCUMENT_ID,
    number: 1,
    status: 'In Review',
    createdBy: 'user-member-1',
    reviewerIds: [ 'user-reviewer-1' ],
    reviewStartAt,
    reviewEndAt,
    hasFile: true,
    fileRefId: REVIEW_FLOW_FILE_REF_ID,
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
    acceptedErrorReportId: null,
    previousVersionId: null,
    createdAt,
    activityAt: reviewStartAt,
    updatedAt: reviewStartAt,
    updatedBy: 'user-member-1',
  } )
  batch.set( db.doc( `counters/versions_${REVIEW_FLOW_DOCUMENT_ID}` ), {
    nextNumber: 2,
    docId: REVIEW_FLOW_DOCUMENT_ID,
    projectId: REVIEW_FLOW_PROJECT_ID,
    previousVersionId: REVIEW_FLOW_VERSION_ID,
  } )
  setVersionFileRef( batch, {
    fileRefId: REVIEW_FLOW_FILE_REF_ID,
    fileKey: 'seeded/review-flow.pdf',
    fileName: 'review-flow.pdf',
    projectId: REVIEW_FLOW_PROJECT_ID,
    docId: REVIEW_FLOW_DOCUMENT_ID,
    versionId: REVIEW_FLOW_VERSION_ID,
    createdBy: 'user-member-1',
    timestamp: createdAt,
  } )

  batch.set( db.doc( `projects/${REVIEW_GUARD_PROJECT_ID}` ), {
    name: 'Seeded Review Guard Project',
    leaderId: 'user-member-1',
    isActive: true,
    shortId: 202,
    createdAt,
    updatedAt: createdAt,
  } )
  setProjectMember( batch, REVIEW_GUARD_PROJECT_ID, 'user-member-1', 'leader', 'member@example.com', createdAt )
  setProjectMember( batch, REVIEW_GUARD_PROJECT_ID, 'user-reviewer-1', 'member', 'reviewer@example.com', createdAt )
  batch.set( db.doc( `counters/documents_${REVIEW_GUARD_PROJECT_ID}` ), {
    nextNumber: 402,
    projectId: REVIEW_GUARD_PROJECT_ID,
  } )
  batch.set( db.doc( `documents/${REVIEW_GUARD_DOCUMENT_ID}` ), {
    projectId: REVIEW_GUARD_PROJECT_ID,
    title: 'Seeded Review Guard Document',
    type: 'document',
    createdBy: 'user-member-1',
    authorId: 'user-member-1',
    updatedBy: 'user-member-1',
    shortId: 401,
    createdAt,
    updatedAt: createdAt,
  } )
  batch.set( db.doc( `versions/${REVIEW_GUARD_VERSION_ID}` ), {
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    number: 1,
    status: 'In Review',
    createdBy: 'user-member-1',
    reviewerIds: [ 'user-reviewer-1' ],
    reviewStartAt,
    reviewEndAt,
    hasFile: true,
    fileRefId: REVIEW_GUARD_FILE_REF_ID,
    stats: {
      numThreads: 2,
      numOpenThreads: 1,
      numComments: 3,
      numThreadsWithTwoPlusComments: 1,
    },
    numThreads: 2,
    numOpenThreads: 1,
    numComments: 3,
    numThreadsWithTwoPlusComments: 1,
    acceptedErrorReportId: null,
    previousVersionId: null,
    createdAt,
    activityAt: guardFollowUpAt,
    updatedAt: guardFollowUpAt,
    updatedBy: 'user-member-1',
  } )
  batch.set( db.doc( `counters/versions_${REVIEW_GUARD_DOCUMENT_ID}` ), {
    nextNumber: 2,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    projectId: REVIEW_GUARD_PROJECT_ID,
    previousVersionId: REVIEW_GUARD_VERSION_ID,
  } )
  setVersionFileRef( batch, {
    fileRefId: REVIEW_GUARD_FILE_REF_ID,
    fileKey: 'seeded/review-guard.pdf',
    fileName: 'review-guard.pdf',
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    versionId: REVIEW_GUARD_VERSION_ID,
    createdBy: 'user-member-1',
    timestamp: createdAt,
  } )
  batch.set( db.doc( `threads/${REVIEW_GUARD_THREAD_ID}` ), {
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    versionId: REVIEW_GUARD_VERSION_ID,
    status: 'closed',
    title: 'Seeded resolved issue',
    createdBy: 'user-reviewer-1',
    commentCount: 2,
    lastCommentAt: guardResolvedAt,
    lastCommentBy: 'user-member-1',
    createdAt: reviewStartAt,
    updatedAt: guardResolvedAt,
    updatedBy: 'user-member-1',
    closedBy: 'user-member-1',
    closedAt: guardResolvedAt,
  } )
  batch.set( db.doc( `comments/${REVIEW_GUARD_COMMENT_1_ID}` ), {
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    versionId: REVIEW_GUARD_VERSION_ID,
    threadId: REVIEW_GUARD_THREAD_ID,
    body: 'Reviewer seeded comment',
    createdBy: 'user-reviewer-1',
    createdAt: guardCommentAt,
    updatedAt: guardCommentAt,
  } )
  batch.set( db.doc( `comments/${REVIEW_GUARD_COMMENT_2_ID}` ), {
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    versionId: REVIEW_GUARD_VERSION_ID,
    threadId: REVIEW_GUARD_THREAD_ID,
    body: 'Author seeded resolution comment',
    createdBy: 'user-member-1',
    createdAt: guardResolvedAt,
    updatedAt: guardResolvedAt,
  } )
  batch.set( db.doc( `threads/${REVIEW_GUARD_THREAD_2_ID}` ), {
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    versionId: REVIEW_GUARD_VERSION_ID,
    status: 'open',
    title: 'Seeded follow-up issue',
    createdBy: 'user-member-1',
    commentCount: 1,
    lastCommentAt: guardFollowUpAt,
    lastCommentBy: 'user-member-1',
    createdAt: guardFollowUpAt,
    updatedAt: guardFollowUpAt,
    updatedBy: 'user-member-1',
  } )
  batch.set( db.doc( `comments/${REVIEW_GUARD_COMMENT_3_ID}` ), {
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    versionId: REVIEW_GUARD_VERSION_ID,
    threadId: REVIEW_GUARD_THREAD_2_ID,
    body: 'Author seeded follow-up comment',
    createdBy: 'user-member-1',
    createdAt: guardFollowUpAt,
    updatedAt: guardFollowUpAt,
  } )

  batch.set( db.doc( `projects/${REVIEW_GRACE_PROJECT_ID}` ), {
    name: 'Seeded Review Grace Project',
    leaderId: 'user-member-1',
    isActive: true,
    shortId: 203,
    createdAt,
    updatedAt: createdAt,
  } )
  setProjectMember( batch, REVIEW_GRACE_PROJECT_ID, 'user-member-1', 'leader', 'member@example.com', createdAt )
  setProjectMember( batch, REVIEW_GRACE_PROJECT_ID, 'user-reviewer-1', 'member', 'reviewer@example.com', createdAt )
  batch.set( db.doc( `counters/documents_${REVIEW_GRACE_PROJECT_ID}` ), {
    nextNumber: 502,
    projectId: REVIEW_GRACE_PROJECT_ID,
  } )
  batch.set( db.doc( `documents/${REVIEW_GRACE_DOCUMENT_ID}` ), {
    projectId: REVIEW_GRACE_PROJECT_ID,
    title: 'Seeded Review Grace Document',
    type: 'document',
    createdBy: 'user-member-1',
    authorId: 'user-member-1',
    updatedBy: 'user-member-1',
    shortId: 501,
    createdAt,
    updatedAt: createdAt,
  } )
  batch.set( db.doc( `versions/${REVIEW_GRACE_VERSION_ID}` ), {
    projectId: REVIEW_GRACE_PROJECT_ID,
    docId: REVIEW_GRACE_DOCUMENT_ID,
    number: 1,
    status: 'In Review',
    createdBy: 'user-member-1',
    reviewerIds: [ 'user-reviewer-1' ],
    reviewStartAt,
    reviewEndAt: graceReviewEndAt,
    hasFile: true,
    fileRefId: REVIEW_GRACE_FILE_REF_ID,
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
    acceptedErrorReportId: null,
    previousVersionId: null,
    createdAt,
    activityAt: graceResolvedAt,
    updatedAt: graceResolvedAt,
    updatedBy: 'user-member-1',
  } )
  batch.set( db.doc( `counters/versions_${REVIEW_GRACE_DOCUMENT_ID}` ), {
    nextNumber: 2,
    docId: REVIEW_GRACE_DOCUMENT_ID,
    projectId: REVIEW_GRACE_PROJECT_ID,
    previousVersionId: REVIEW_GRACE_VERSION_ID,
  } )
  setVersionFileRef( batch, {
    fileRefId: REVIEW_GRACE_FILE_REF_ID,
    fileKey: 'seeded/review-grace.pdf',
    fileName: 'review-grace.pdf',
    projectId: REVIEW_GRACE_PROJECT_ID,
    docId: REVIEW_GRACE_DOCUMENT_ID,
    versionId: REVIEW_GRACE_VERSION_ID,
    createdBy: 'user-member-1',
    timestamp: createdAt,
  } )
  batch.set( db.doc( `threads/${REVIEW_GRACE_THREAD_ID}` ), {
    projectId: REVIEW_GRACE_PROJECT_ID,
    docId: REVIEW_GRACE_DOCUMENT_ID,
    versionId: REVIEW_GRACE_VERSION_ID,
    status: 'closed',
    title: 'Seeded grace issue',
    createdBy: 'user-reviewer-1',
    commentCount: 2,
    lastCommentAt: graceResolvedAt,
    lastCommentBy: 'user-member-1',
    createdAt: graceCommentAt,
    updatedAt: graceResolvedAt,
    updatedBy: 'user-member-1',
    closedBy: 'user-member-1',
    closedAt: graceResolvedAt,
  } )
  batch.set( db.doc( `comments/${REVIEW_GRACE_COMMENT_1_ID}` ), {
    projectId: REVIEW_GRACE_PROJECT_ID,
    docId: REVIEW_GRACE_DOCUMENT_ID,
    versionId: REVIEW_GRACE_VERSION_ID,
    threadId: REVIEW_GRACE_THREAD_ID,
    body: 'Reviewer keeps the grace window open.',
    createdBy: 'user-reviewer-1',
    createdAt: graceCommentAt,
    updatedAt: graceCommentAt,
  } )
  batch.set( db.doc( `comments/${REVIEW_GRACE_COMMENT_2_ID}` ), {
    projectId: REVIEW_GRACE_PROJECT_ID,
    docId: REVIEW_GRACE_DOCUMENT_ID,
    versionId: REVIEW_GRACE_VERSION_ID,
    threadId: REVIEW_GRACE_THREAD_ID,
    body: 'Author resolved this issue during grace.',
    createdBy: 'user-member-1',
    createdAt: graceResolvedAt,
    updatedAt: graceResolvedAt,
  } )

  batch.set( db.doc( `projects/${UI_NOTIFY_PROJECT_ID}` ), {
    name: 'Seeded UI Notify Project',
    leaderId: 'user-member-1',
    isActive: true,
    shortId: 206,
    createdAt,
    updatedAt: createdAt,
  } )
  setProjectMember( batch, UI_NOTIFY_PROJECT_ID, 'user-member-1', 'leader', 'member@example.com', createdAt )
  setProjectMember( batch, UI_NOTIFY_PROJECT_ID, 'user-reviewer-1', 'member', 'reviewer@example.com', createdAt )
  batch.set( db.doc( `counters/documents_${UI_NOTIFY_PROJECT_ID}` ), {
    nextNumber: 802,
    projectId: UI_NOTIFY_PROJECT_ID,
  } )
  batch.set( db.doc( `documents/${UI_NOTIFY_DOCUMENT_ID}` ), {
    projectId: UI_NOTIFY_PROJECT_ID,
    title: 'Seeded UI Notify Document',
    type: 'document',
    createdBy: 'user-member-1',
    authorId: 'user-member-1',
    updatedBy: 'user-member-1',
    shortId: 801,
    createdAt,
    updatedAt: createdAt,
  } )
  batch.set( db.doc( `versions/${UI_NOTIFY_VERSION_ID}` ), {
    projectId: UI_NOTIFY_PROJECT_ID,
    docId: UI_NOTIFY_DOCUMENT_ID,
    number: 1,
    status: 'In Review',
    createdBy: 'user-member-1',
    reviewerIds: [ 'user-reviewer-1' ],
    reviewStartAt,
    reviewEndAt,
    hasFile: true,
    fileRefId: UI_NOTIFY_FILE_REF_ID,
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
    acceptedErrorReportId: null,
    previousVersionId: null,
    createdAt,
    activityAt: reviewStartAt,
    updatedAt: reviewStartAt,
    updatedBy: 'user-member-1',
  } )
  batch.set( db.doc( `counters/versions_${UI_NOTIFY_DOCUMENT_ID}` ), {
    nextNumber: 2,
    docId: UI_NOTIFY_DOCUMENT_ID,
    projectId: UI_NOTIFY_PROJECT_ID,
    previousVersionId: UI_NOTIFY_VERSION_ID,
  } )
  setVersionFileRef( batch, {
    fileRefId: UI_NOTIFY_FILE_REF_ID,
    fileKey: 'seeded/ui-notify.pdf',
    fileName: 'ui-notify.pdf',
    projectId: UI_NOTIFY_PROJECT_ID,
    docId: UI_NOTIFY_DOCUMENT_ID,
    versionId: UI_NOTIFY_VERSION_ID,
    createdBy: 'user-member-1',
    timestamp: createdAt,
  } )

  batch.set( db.doc( `projects/${ERROR_REPORT_BASE_PROJECT_ID}` ), {
    name: 'Seeded Error Report Base Project',
    leaderId: 'user-member-1',
    isActive: true,
    shortId: 204,
    createdAt,
    updatedAt: createdAt,
  } )
  setProjectMember( batch, ERROR_REPORT_BASE_PROJECT_ID, 'user-member-1', 'leader', 'member@example.com', createdAt )
  setProjectMember( batch, ERROR_REPORT_BASE_PROJECT_ID, 'user-reviewer-1', 'member', 'reviewer@example.com', createdAt )
  batch.set( db.doc( `counters/documents_${ERROR_REPORT_BASE_PROJECT_ID}` ), {
    nextNumber: 602,
    projectId: ERROR_REPORT_BASE_PROJECT_ID,
  } )
  batch.set( db.doc( `documents/${ERROR_REPORT_BASE_DOCUMENT_ID}` ), {
    projectId: ERROR_REPORT_BASE_PROJECT_ID,
    title: 'Seeded Error Report Base Document',
    type: 'document',
    createdBy: 'user-member-1',
    authorId: 'user-member-1',
    updatedBy: 'user-member-1',
    shortId: 601,
    createdAt,
    updatedAt: acceptedAt,
  } )
  batch.set( db.doc( `versions/${ERROR_REPORT_BASE_VERSION_ID}` ), {
    projectId: ERROR_REPORT_BASE_PROJECT_ID,
    docId: ERROR_REPORT_BASE_DOCUMENT_ID,
    number: 1,
    status: 'Accepted',
    createdBy: 'user-member-1',
    reviewerIds: [ 'user-reviewer-1' ],
    reviewStartAt,
    reviewEndAt,
    hasFile: true,
    fileRefId: ERROR_REPORT_BASE_FILE_REF_ID,
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
    acceptedErrorReportId: null,
    previousVersionId: null,
    createdAt,
    activityAt: acceptedAt,
    updatedAt: acceptedAt,
    updatedBy: 'user-member-1',
  } )
  batch.set( db.doc( `counters/versions_${ERROR_REPORT_BASE_DOCUMENT_ID}` ), {
    nextNumber: 2,
    docId: ERROR_REPORT_BASE_DOCUMENT_ID,
    projectId: ERROR_REPORT_BASE_PROJECT_ID,
    previousVersionId: ERROR_REPORT_BASE_VERSION_ID,
  } )
  setVersionFileRef( batch, {
    fileRefId: ERROR_REPORT_BASE_FILE_REF_ID,
    fileKey: 'seeded/error-report-base.pdf',
    fileName: 'error-report-base.pdf',
    projectId: ERROR_REPORT_BASE_PROJECT_ID,
    docId: ERROR_REPORT_BASE_DOCUMENT_ID,
    versionId: ERROR_REPORT_BASE_VERSION_ID,
    createdBy: 'user-member-1',
    timestamp: createdAt,
  } )

  batch.set( db.doc( `projects/${ERROR_REPORT_UNLOCK_PROJECT_ID}` ), {
    name: 'Seeded Error Report Unlock Project',
    leaderId: 'user-member-1',
    isActive: true,
    shortId: 205,
    createdAt,
    updatedAt: createdAt,
  } )
  setProjectMember( batch, ERROR_REPORT_UNLOCK_PROJECT_ID, 'user-member-1', 'leader', 'member@example.com', createdAt )
  setProjectMember( batch, ERROR_REPORT_UNLOCK_PROJECT_ID, 'user-reviewer-1', 'member', 'reviewer@example.com', createdAt )
  batch.set( db.doc( `counters/documents_${ERROR_REPORT_UNLOCK_PROJECT_ID}` ), {
    nextNumber: 703,
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
  } )
  batch.set( db.doc( `documents/${ERROR_REPORT_UNLOCK_DOCUMENT_ID}` ), {
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    title: 'Seeded Error Report Unlock Document',
    type: 'document',
    createdBy: 'user-member-1',
    authorId: 'user-member-1',
    updatedBy: 'user-member-1',
    shortId: 701,
    createdAt,
    updatedAt: acceptedAt,
  } )
  batch.set( db.doc( `versions/${ERROR_REPORT_UNLOCK_VERSION_ID}` ), {
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    docId: ERROR_REPORT_UNLOCK_DOCUMENT_ID,
    number: 1,
    status: 'Accepted',
    createdBy: 'user-member-1',
    reviewerIds: [ 'user-reviewer-1' ],
    reviewStartAt,
    reviewEndAt,
    hasFile: true,
    fileRefId: ERROR_REPORT_UNLOCK_FILE_REF_ID,
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
    acceptedErrorReportId: null,
    previousVersionId: null,
    createdAt,
    activityAt: acceptedAt,
    updatedAt: acceptedAt,
    updatedBy: 'user-member-1',
  } )
  batch.set( db.doc( `counters/versions_${ERROR_REPORT_UNLOCK_DOCUMENT_ID}` ), {
    nextNumber: 2,
    docId: ERROR_REPORT_UNLOCK_DOCUMENT_ID,
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    previousVersionId: ERROR_REPORT_UNLOCK_VERSION_ID,
  } )
  setVersionFileRef( batch, {
    fileRefId: ERROR_REPORT_UNLOCK_FILE_REF_ID,
    fileKey: 'seeded/error-report-unlock.pdf',
    fileName: 'error-report-unlock.pdf',
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    docId: ERROR_REPORT_UNLOCK_DOCUMENT_ID,
    versionId: ERROR_REPORT_UNLOCK_VERSION_ID,
    createdBy: 'user-member-1',
    timestamp: createdAt,
  } )
  batch.set( db.doc( `documents/${ERROR_REPORT_UNLOCK_REPORT_DOCUMENT_ID}` ), {
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    title: 'Accepted linked error report',
    type: 'errorReport',
    baseDocId: ERROR_REPORT_UNLOCK_DOCUMENT_ID,
    baseVersionId: ERROR_REPORT_UNLOCK_VERSION_ID,
    createdBy: 'user-member-1',
    authorId: 'user-member-1',
    updatedBy: 'user-member-1',
    shortId: 702,
    createdAt,
    updatedAt: linkedAcceptedAt,
  } )
  batch.set( db.doc( `versions/${ERROR_REPORT_UNLOCK_REPORT_VERSION_ID}` ), {
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    docId: ERROR_REPORT_UNLOCK_REPORT_DOCUMENT_ID,
    number: 1,
    status: 'Accepted',
    createdBy: 'user-member-1',
    reviewerIds: [ 'user-reviewer-1' ],
    reviewStartAt,
    reviewEndAt,
    hasFile: true,
    fileRefId: ERROR_REPORT_UNLOCK_REPORT_FILE_REF_ID,
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
    acceptedErrorReportId: null,
    previousVersionId: null,
    createdAt,
    activityAt: linkedAcceptedAt,
    updatedAt: linkedAcceptedAt,
    updatedBy: 'user-member-1',
  } )
  batch.set( db.doc( `counters/versions_${ERROR_REPORT_UNLOCK_REPORT_DOCUMENT_ID}` ), {
    nextNumber: 2,
    docId: ERROR_REPORT_UNLOCK_REPORT_DOCUMENT_ID,
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    previousVersionId: ERROR_REPORT_UNLOCK_REPORT_VERSION_ID,
  } )
  setVersionFileRef( batch, {
    fileRefId: ERROR_REPORT_UNLOCK_REPORT_FILE_REF_ID,
    fileKey: 'seeded/error-report-linked.pdf',
    fileName: 'error-report-linked.pdf',
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    docId: ERROR_REPORT_UNLOCK_REPORT_DOCUMENT_ID,
    versionId: ERROR_REPORT_UNLOCK_REPORT_VERSION_ID,
    createdBy: 'user-member-1',
    timestamp: createdAt,
  } )

  batch.set( db.doc( `projects/${ERROR_REPORT_TRANSITION_PROJECT_ID}` ), {
    name: 'Seeded Error Report Transition Project',
    leaderId: 'user-member-1',
    isActive: true,
    shortId: 206,
    createdAt,
    updatedAt: createdAt,
  } )
  setProjectMember( batch, ERROR_REPORT_TRANSITION_PROJECT_ID, 'user-member-1', 'leader', 'member@example.com', createdAt )
  setProjectMember( batch, ERROR_REPORT_TRANSITION_PROJECT_ID, 'user-reviewer-1', 'member', 'reviewer@example.com', createdAt )
  batch.set( db.doc( `counters/documents_${ERROR_REPORT_TRANSITION_PROJECT_ID}` ), {
    nextNumber: 713,
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
  } )
  batch.set( db.doc( `documents/${ERROR_REPORT_TRANSITION_DOCUMENT_ID}` ), {
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    title: 'Seeded Error Report Transition Document',
    type: 'document',
    createdBy: 'user-member-1',
    authorId: 'user-member-1',
    updatedBy: 'user-member-1',
    shortId: 711,
    createdAt,
    updatedAt: acceptedAt,
  } )
  batch.set( db.doc( `versions/${ERROR_REPORT_TRANSITION_VERSION_ID}` ), {
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    docId: ERROR_REPORT_TRANSITION_DOCUMENT_ID,
    number: 1,
    status: 'Accepted',
    createdBy: 'user-member-1',
    reviewerIds: [ 'user-reviewer-1' ],
    reviewStartAt,
    reviewEndAt,
    hasFile: true,
    fileRefId: ERROR_REPORT_TRANSITION_FILE_REF_ID,
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
    acceptedErrorReportId: null,
    previousVersionId: null,
    createdAt,
    activityAt: acceptedAt,
    updatedAt: acceptedAt,
    updatedBy: 'user-member-1',
  } )
  batch.set( db.doc( `counters/versions_${ERROR_REPORT_TRANSITION_DOCUMENT_ID}` ), {
    nextNumber: 2,
    docId: ERROR_REPORT_TRANSITION_DOCUMENT_ID,
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    previousVersionId: ERROR_REPORT_TRANSITION_VERSION_ID,
  } )
  setVersionFileRef( batch, {
    fileRefId: ERROR_REPORT_TRANSITION_FILE_REF_ID,
    fileKey: 'seeded/error-report-transition.pdf',
    fileName: 'error-report-transition.pdf',
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    docId: ERROR_REPORT_TRANSITION_DOCUMENT_ID,
    versionId: ERROR_REPORT_TRANSITION_VERSION_ID,
    createdBy: 'user-member-1',
    timestamp: createdAt,
  } )
  batch.set( db.doc( `documents/${ERROR_REPORT_TRANSITION_REPORT_DOCUMENT_ID}` ), {
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    title: 'Accepted transition error report',
    type: 'errorReport',
    baseDocId: ERROR_REPORT_TRANSITION_DOCUMENT_ID,
    baseVersionId: ERROR_REPORT_TRANSITION_VERSION_ID,
    createdBy: 'user-member-1',
    authorId: 'user-member-1',
    updatedBy: 'user-member-1',
    shortId: 712,
    createdAt,
    updatedAt: linkedAcceptedAt,
  } )
  batch.set( db.doc( `versions/${ERROR_REPORT_TRANSITION_REPORT_VERSION_ID}` ), {
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    docId: ERROR_REPORT_TRANSITION_REPORT_DOCUMENT_ID,
    number: 1,
    status: 'Accepted',
    createdBy: 'user-member-1',
    reviewerIds: [ 'user-reviewer-1' ],
    reviewStartAt,
    reviewEndAt,
    hasFile: true,
    fileRefId: ERROR_REPORT_TRANSITION_REPORT_FILE_REF_ID,
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
    acceptedErrorReportId: null,
    previousVersionId: null,
    createdAt,
    activityAt: linkedAcceptedAt,
    updatedAt: linkedAcceptedAt,
    updatedBy: 'user-member-1',
  } )
  batch.set( db.doc( `counters/versions_${ERROR_REPORT_TRANSITION_REPORT_DOCUMENT_ID}` ), {
    nextNumber: 2,
    docId: ERROR_REPORT_TRANSITION_REPORT_DOCUMENT_ID,
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    previousVersionId: ERROR_REPORT_TRANSITION_REPORT_VERSION_ID,
  } )
  setVersionFileRef( batch, {
    fileRefId: ERROR_REPORT_TRANSITION_REPORT_FILE_REF_ID,
    fileKey: 'seeded/error-report-transition-linked.pdf',
    fileName: 'error-report-transition-linked.pdf',
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    docId: ERROR_REPORT_TRANSITION_REPORT_DOCUMENT_ID,
    versionId: ERROR_REPORT_TRANSITION_REPORT_VERSION_ID,
    createdBy: 'user-member-1',
    timestamp: createdAt,
  } )

  batch.set( db.doc( `projects/${MODEL_UPDATE_PROJECT_ID}` ), {
    name: 'Seeded Model Update Project',
    leaderId: 'user-admin-1',
    isActive: true,
    createdAt,
    updatedAt: createdAt,
  } )
  batch.set( db.doc( `documents/${MODEL_UPDATE_DOCUMENT_ID}` ), {
    projectId: MODEL_UPDATE_PROJECT_ID,
    title: 'Seeded Model Update Document',
    type: 'document',
    createdBy: 'user-admin-1',
    authorId: 'user-admin-1',
    updatedBy: 'user-admin-1',
    createdAt,
    updatedAt: createdAt,
  } )
  batch.set( db.doc( `versions/${MODEL_UPDATE_VERSION_ID}` ), {
    projectId: MODEL_UPDATE_PROJECT_ID,
    docId: MODEL_UPDATE_DOCUMENT_ID,
    number: 1,
    status: 'In Creation',
    createdBy: 'user-admin-1',
    reviewerIds: [],
    reviewStartAt: null,
    reviewEndAt: null,
    hasFile: false,
    fileRefId: null,
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
    acceptedErrorReportId: null,
    previousVersionId: null,
    createdAt,
    activityAt: createdAt,
    updatedAt: createdAt,
    updatedBy: 'user-admin-1',
  } )

  batch.set( db.doc( `projects/${REPAIR_PROJECT_ID}` ), {
    name: 'Seeded Repair Project',
    leaderId: 'user-admin-1',
    isActive: true,
    shortId: 901,
    createdAt,
    updatedAt: createdAt,
  } )
  batch.set( db.doc( `documents/${REPAIR_DOCUMENT_ID}` ), {
    projectId: REPAIR_PROJECT_ID,
    title: 'Seeded Repair Document',
    type: 'document',
    createdBy: 'user-admin-1',
    authorId: 'user-admin-1',
    updatedBy: 'user-admin-1',
    shortId: 902,
    updatedAt: createdAt,
  } )
  batch.set( db.doc( `versions/${REPAIR_VERSION_ID}` ), {
    projectId: REPAIR_PROJECT_ID,
    docId: REPAIR_DOCUMENT_ID,
    number: 1,
    status: 'In Review',
    createdBy: 'user-admin-1',
    reviewerIds: [],
    reviewStartAt,
    hasFile: false,
    fileRefId: null,
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
    acceptedErrorReportId: null,
    previousVersionId: null,
    updatedAt: createdAt,
    updatedBy: 'user-admin-1',
  } )

  await batch.commit()
}

await clearFirestore()
await clearAuth()
await clearStorage()
await seedUsers()
await seedFirestore()

console.log( 'Firebase emulators seeded for QT4 E2E.' )
