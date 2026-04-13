type FakeUserRecord = {
  uid: string
  email: string
  password: string
  displayName: string
  isAdmin: boolean
}

type FakeStoredFile = {
  fileName: string
  contentType: string
  sizeBytes: number
}

type FakeFirestoreDoc = Record<string, unknown>

const SERVER_TIMESTAMP_SENTINEL = '__qt4_fake_server_timestamp__'
const DELETE_FIELD_SENTINEL = '__qt4_fake_delete_field__'

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

class FakeTimestamp {
  private readonly value: Date

  constructor( value: Date ) {
    this.value = new Date( value.getTime() )
  }

  static fromDate( value: Date ) {
    return new FakeTimestamp( value )
  }

  static now() {
    return new FakeTimestamp( new Date() )
  }

  toDate() {
    return new Date( this.value.getTime() )
  }

  toMillis() {
    return this.value.getTime()
  }
}

type FakeState = {
  currentUserId: string | null
  nextGeneratedId: number
  usersById: Record<string, FakeUserRecord>
  usersByEmail: Record<string, FakeUserRecord>
  firestore: Map<string, FakeFirestoreDoc>
  storage: Map<string, FakeStoredFile>
}

type SerializedValue =
  | null
  | string
  | number
  | boolean
  | SerializedValue[]
  | { __type: 'timestamp'; iso: string }
  | { [key: string]: SerializedValue }

type SerializedState = {
  currentUserId: string | null
  nextGeneratedId: number
  usersById: Record<string, FakeUserRecord>
  usersByEmail: Record<string, FakeUserRecord>
  firestore: Array<[string, SerializedValue]>
  storage: Array<[string, FakeStoredFile]>
}

const deepClone = <T,>(value: T): T => {
  if( value instanceof FakeTimestamp ) {
    return FakeTimestamp.fromDate( value.toDate() ) as T
  }
  if( value instanceof Date ) {
    return new Date( value.getTime() ) as T
  }
  if( Array.isArray( value ) ) {
    return value.map( ( item ) => deepClone( item ) ) as T
  }
  if( value && typeof value === 'object' ) {
    return Object.fromEntries(
      Object.entries( value as Record<string, unknown> ).map( ( [ key, entryValue ] ) => [ key, deepClone( entryValue ) ] ),
    ) as T
  }
  return value
}

const withDoc = (
  docs: Map<string, FakeFirestoreDoc>,
  path: string,
  data: FakeFirestoreDoc,
) => {
  docs.set( path, deepClone( data ) )
}

const addProjectMember = (
  firestore: Map<string, FakeFirestoreDoc>,
  {
    projectId,
    userId,
    role,
    email,
    timestamp,
  }: {
    projectId: string
    userId: string
    role: 'leader' | 'member'
    email: string
    timestamp: FakeTimestamp
  },
) => {
  withDoc( firestore, `projectMembers/${projectId}_${userId}`, {
    projectId,
    userId,
    role,
    email,
    createdAt: timestamp,
    updatedAt: timestamp,
  } )
}

const addFileRef = (
  firestore: Map<string, FakeFirestoreDoc>,
  {
    fileRefId,
    fileKey,
    fileName,
    projectId,
    docId,
    versionId,
    createdBy,
    timestamp,
  }: {
    fileRefId: string
    fileKey: string
    fileName: string
    projectId: string
    docId: string
    versionId: string
    createdBy: string
    timestamp: FakeTimestamp
  },
) => {
  withDoc( firestore, `fileRefs/${fileRefId}`, {
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

const createSeedState = (): FakeState => {
  const memberUser: FakeUserRecord = {
    uid: 'user-member-1',
    email: 'member@example.com',
    password: 'password123',
    displayName: 'Member User',
    isAdmin: false,
  }
  const adminUser: FakeUserRecord = {
    uid: 'user-admin-1',
    email: 'admin@example.com',
    password: 'password123',
    displayName: 'Admin User',
    isAdmin: true,
  }
  const reviewerUser: FakeUserRecord = {
    uid: 'user-reviewer-1',
    email: 'reviewer@example.com',
    password: 'password123',
    displayName: 'Reviewer User',
    isAdmin: false,
  }

  const firestore = new Map<string, FakeFirestoreDoc>()
  const users = [ memberUser, adminUser, reviewerUser ]
  const createdAt = FakeTimestamp.fromDate( new Date( '2026-04-01T12:00:00.000Z' ) )
  const reviewStartAt = FakeTimestamp.fromDate( new Date( '2026-04-03T09:00:00.000Z' ) )
  const reviewEndAt = FakeTimestamp.fromDate( new Date( '2026-04-10T09:00:00.000Z' ) )
  const guardCommentAt = FakeTimestamp.fromDate( new Date( '2026-04-03T10:00:00.000Z' ) )
  const guardResolvedAt = FakeTimestamp.fromDate( new Date( '2026-04-03T10:30:00.000Z' ) )
  const guardFollowUpAt = FakeTimestamp.fromDate( new Date( '2026-04-03T11:00:00.000Z' ) )
  const now = Date.now()
  const graceReviewEndAt = FakeTimestamp.fromDate( new Date( now - ( 15 * 60 * 1000 ) ) )
  const graceCommentAt = FakeTimestamp.fromDate( new Date( now - ( 12 * 60 * 1000 ) ) )
  const graceResolvedAt = FakeTimestamp.fromDate( new Date( now - ( 5 * 60 * 1000 ) ) )
  const acceptedAt = FakeTimestamp.fromDate( new Date( '2026-04-02T14:00:00.000Z' ) )
  const linkedAcceptedAt = FakeTimestamp.fromDate( new Date( '2026-04-03T08:30:00.000Z' ) )

  users.forEach( ( user ) => {
    withDoc( firestore, `userProfiles/${user.uid}`, {
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      createdAt,
      updatedAt: createdAt,
    } )
    withDoc( firestore, `userDirectory/${user.email}`, {
      userId: user.uid,
      email: user.email,
      emailKey: user.email,
      emailLower: user.email.toLowerCase(),
      displayName: user.displayName,
      createdAt,
      updatedAt: createdAt,
    } )
  } )

  withDoc( firestore, 'systemConfig/runtime', {
    fileStorageProvider: 'firebase-storage',
    emailProvider: 'files-api',
    updatedAt: createdAt,
    updatedBy: adminUser.uid,
  } )

  withDoc( firestore, 'auditLogs/seed-log-1', {
    actorId: adminUser.uid,
    actorEmail: adminUser.email,
    action: 'seedAudit',
    entityType: 'system',
    entityId: 'seed-1',
    createdAt: FakeTimestamp.fromDate( new Date( '2026-04-02T09:00:00.000Z' ) ),
    metadata: {
      note: 'Seeded admin audit event',
    },
  } )

  withDoc( firestore, 'counters/projects', {
    nextNumber: 207,
    lastProjectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
  } )

  withDoc( firestore, `projects/${REVIEW_FLOW_PROJECT_ID}`, {
    name: 'Seeded Review Flow Project',
    leaderId: memberUser.uid,
    isActive: true,
    shortId: 201,
    createdAt,
    updatedAt: createdAt,
  } )
  addProjectMember( firestore, {
    projectId: REVIEW_FLOW_PROJECT_ID,
    userId: memberUser.uid,
    role: 'leader',
    email: memberUser.email,
    timestamp: createdAt,
  } )
  addProjectMember( firestore, {
    projectId: REVIEW_FLOW_PROJECT_ID,
    userId: reviewerUser.uid,
    role: 'member',
    email: reviewerUser.email,
    timestamp: createdAt,
  } )
  withDoc( firestore, `counters/documents_${REVIEW_FLOW_PROJECT_ID}`, {
    nextNumber: 302,
    projectId: REVIEW_FLOW_PROJECT_ID,
  } )
  withDoc( firestore, `documents/${REVIEW_FLOW_DOCUMENT_ID}`, {
    projectId: REVIEW_FLOW_PROJECT_ID,
    title: 'Seeded Review Flow Document',
    type: 'document',
    createdBy: memberUser.uid,
    authorId: memberUser.uid,
    updatedBy: memberUser.uid,
    shortId: 301,
    createdAt,
    updatedAt: createdAt,
  } )
  withDoc( firestore, `versions/${REVIEW_FLOW_VERSION_ID}`, {
    projectId: REVIEW_FLOW_PROJECT_ID,
    docId: REVIEW_FLOW_DOCUMENT_ID,
    number: 1,
    status: 'In Review',
    createdBy: memberUser.uid,
    reviewerIds: [ reviewerUser.uid ],
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
    updatedBy: memberUser.uid,
  } )
  withDoc( firestore, `counters/versions_${REVIEW_FLOW_DOCUMENT_ID}`, {
    nextNumber: 2,
    docId: REVIEW_FLOW_DOCUMENT_ID,
    projectId: REVIEW_FLOW_PROJECT_ID,
    previousVersionId: REVIEW_FLOW_VERSION_ID,
  } )
  addFileRef( firestore, {
    fileRefId: REVIEW_FLOW_FILE_REF_ID,
    fileKey: 'seeded/review-flow.pdf',
    fileName: 'review-flow.pdf',
    projectId: REVIEW_FLOW_PROJECT_ID,
    docId: REVIEW_FLOW_DOCUMENT_ID,
    versionId: REVIEW_FLOW_VERSION_ID,
    createdBy: memberUser.uid,
    timestamp: createdAt,
  } )

  withDoc( firestore, `projects/${REVIEW_GUARD_PROJECT_ID}`, {
    name: 'Seeded Review Guard Project',
    leaderId: memberUser.uid,
    isActive: true,
    shortId: 202,
    createdAt,
    updatedAt: createdAt,
  } )
  addProjectMember( firestore, {
    projectId: REVIEW_GUARD_PROJECT_ID,
    userId: memberUser.uid,
    role: 'leader',
    email: memberUser.email,
    timestamp: createdAt,
  } )
  addProjectMember( firestore, {
    projectId: REVIEW_GUARD_PROJECT_ID,
    userId: reviewerUser.uid,
    role: 'member',
    email: reviewerUser.email,
    timestamp: createdAt,
  } )
  withDoc( firestore, `counters/documents_${REVIEW_GUARD_PROJECT_ID}`, {
    nextNumber: 402,
    projectId: REVIEW_GUARD_PROJECT_ID,
  } )
  withDoc( firestore, `documents/${REVIEW_GUARD_DOCUMENT_ID}`, {
    projectId: REVIEW_GUARD_PROJECT_ID,
    title: 'Seeded Review Guard Document',
    type: 'document',
    createdBy: memberUser.uid,
    authorId: memberUser.uid,
    updatedBy: memberUser.uid,
    shortId: 401,
    createdAt,
    updatedAt: createdAt,
  } )
  withDoc( firestore, `versions/${REVIEW_GUARD_VERSION_ID}`, {
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    number: 1,
    status: 'In Review',
    createdBy: memberUser.uid,
    reviewerIds: [ reviewerUser.uid ],
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
    updatedBy: memberUser.uid,
  } )
  withDoc( firestore, `counters/versions_${REVIEW_GUARD_DOCUMENT_ID}`, {
    nextNumber: 2,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    projectId: REVIEW_GUARD_PROJECT_ID,
    previousVersionId: REVIEW_GUARD_VERSION_ID,
  } )
  addFileRef( firestore, {
    fileRefId: REVIEW_GUARD_FILE_REF_ID,
    fileKey: 'seeded/review-guard.pdf',
    fileName: 'review-guard.pdf',
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    versionId: REVIEW_GUARD_VERSION_ID,
    createdBy: memberUser.uid,
    timestamp: createdAt,
  } )
  withDoc( firestore, `threads/${REVIEW_GUARD_THREAD_ID}`, {
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    versionId: REVIEW_GUARD_VERSION_ID,
    status: 'closed',
    title: 'Seeded resolved issue',
    createdBy: reviewerUser.uid,
    commentCount: 2,
    lastCommentAt: guardResolvedAt,
    lastCommentBy: memberUser.uid,
    createdAt: reviewStartAt,
    updatedAt: guardResolvedAt,
    updatedBy: memberUser.uid,
    closedBy: memberUser.uid,
    closedAt: guardResolvedAt,
  } )
  withDoc( firestore, `comments/${REVIEW_GUARD_COMMENT_1_ID}`, {
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    versionId: REVIEW_GUARD_VERSION_ID,
    threadId: REVIEW_GUARD_THREAD_ID,
    body: 'Reviewer seeded comment',
    createdBy: reviewerUser.uid,
    createdAt: guardCommentAt,
    updatedAt: guardCommentAt,
  } )
  withDoc( firestore, `comments/${REVIEW_GUARD_COMMENT_2_ID}`, {
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    versionId: REVIEW_GUARD_VERSION_ID,
    threadId: REVIEW_GUARD_THREAD_ID,
    body: 'Author seeded resolution comment',
    createdBy: memberUser.uid,
    createdAt: guardResolvedAt,
    updatedAt: guardResolvedAt,
  } )
  withDoc( firestore, `threads/${REVIEW_GUARD_THREAD_2_ID}`, {
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    versionId: REVIEW_GUARD_VERSION_ID,
    status: 'open',
    title: 'Seeded follow-up issue',
    createdBy: memberUser.uid,
    commentCount: 1,
    lastCommentAt: guardFollowUpAt,
    lastCommentBy: memberUser.uid,
    createdAt: guardFollowUpAt,
    updatedAt: guardFollowUpAt,
    updatedBy: memberUser.uid,
  } )
  withDoc( firestore, `comments/${REVIEW_GUARD_COMMENT_3_ID}`, {
    projectId: REVIEW_GUARD_PROJECT_ID,
    docId: REVIEW_GUARD_DOCUMENT_ID,
    versionId: REVIEW_GUARD_VERSION_ID,
    threadId: REVIEW_GUARD_THREAD_2_ID,
    body: 'Author seeded follow-up comment',
    createdBy: memberUser.uid,
    createdAt: guardFollowUpAt,
    updatedAt: guardFollowUpAt,
  } )

  withDoc( firestore, `projects/${REVIEW_GRACE_PROJECT_ID}`, {
    name: 'Seeded Review Grace Project',
    leaderId: memberUser.uid,
    isActive: true,
    shortId: 203,
    createdAt,
    updatedAt: createdAt,
  } )
  addProjectMember( firestore, {
    projectId: REVIEW_GRACE_PROJECT_ID,
    userId: memberUser.uid,
    role: 'leader',
    email: memberUser.email,
    timestamp: createdAt,
  } )
  addProjectMember( firestore, {
    projectId: REVIEW_GRACE_PROJECT_ID,
    userId: reviewerUser.uid,
    role: 'member',
    email: reviewerUser.email,
    timestamp: createdAt,
  } )
  withDoc( firestore, `counters/documents_${REVIEW_GRACE_PROJECT_ID}`, {
    nextNumber: 502,
    projectId: REVIEW_GRACE_PROJECT_ID,
  } )
  withDoc( firestore, `documents/${REVIEW_GRACE_DOCUMENT_ID}`, {
    projectId: REVIEW_GRACE_PROJECT_ID,
    title: 'Seeded Review Grace Document',
    type: 'document',
    createdBy: memberUser.uid,
    authorId: memberUser.uid,
    updatedBy: memberUser.uid,
    shortId: 501,
    createdAt,
    updatedAt: createdAt,
  } )
  withDoc( firestore, `versions/${REVIEW_GRACE_VERSION_ID}`, {
    projectId: REVIEW_GRACE_PROJECT_ID,
    docId: REVIEW_GRACE_DOCUMENT_ID,
    number: 1,
    status: 'In Review',
    createdBy: memberUser.uid,
    reviewerIds: [ reviewerUser.uid ],
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
    updatedBy: memberUser.uid,
  } )
  withDoc( firestore, `counters/versions_${REVIEW_GRACE_DOCUMENT_ID}`, {
    nextNumber: 2,
    docId: REVIEW_GRACE_DOCUMENT_ID,
    projectId: REVIEW_GRACE_PROJECT_ID,
    previousVersionId: REVIEW_GRACE_VERSION_ID,
  } )
  addFileRef( firestore, {
    fileRefId: REVIEW_GRACE_FILE_REF_ID,
    fileKey: 'seeded/review-grace.pdf',
    fileName: 'review-grace.pdf',
    projectId: REVIEW_GRACE_PROJECT_ID,
    docId: REVIEW_GRACE_DOCUMENT_ID,
    versionId: REVIEW_GRACE_VERSION_ID,
    createdBy: memberUser.uid,
    timestamp: createdAt,
  } )
  withDoc( firestore, `threads/${REVIEW_GRACE_THREAD_ID}`, {
    projectId: REVIEW_GRACE_PROJECT_ID,
    docId: REVIEW_GRACE_DOCUMENT_ID,
    versionId: REVIEW_GRACE_VERSION_ID,
    status: 'closed',
    title: 'Seeded grace issue',
    createdBy: reviewerUser.uid,
    commentCount: 2,
    lastCommentAt: graceResolvedAt,
    lastCommentBy: memberUser.uid,
    createdAt: graceCommentAt,
    updatedAt: graceResolvedAt,
    updatedBy: memberUser.uid,
    closedBy: memberUser.uid,
    closedAt: graceResolvedAt,
  } )
  withDoc( firestore, `comments/${REVIEW_GRACE_COMMENT_1_ID}`, {
    projectId: REVIEW_GRACE_PROJECT_ID,
    docId: REVIEW_GRACE_DOCUMENT_ID,
    versionId: REVIEW_GRACE_VERSION_ID,
    threadId: REVIEW_GRACE_THREAD_ID,
    body: 'Reviewer keeps the grace window open.',
    createdBy: reviewerUser.uid,
    createdAt: graceCommentAt,
    updatedAt: graceCommentAt,
  } )
  withDoc( firestore, `comments/${REVIEW_GRACE_COMMENT_2_ID}`, {
    projectId: REVIEW_GRACE_PROJECT_ID,
    docId: REVIEW_GRACE_DOCUMENT_ID,
    versionId: REVIEW_GRACE_VERSION_ID,
    threadId: REVIEW_GRACE_THREAD_ID,
    body: 'Author resolved this issue during grace.',
    createdBy: memberUser.uid,
    createdAt: graceResolvedAt,
    updatedAt: graceResolvedAt,
  } )

  withDoc( firestore, `projects/${ERROR_REPORT_BASE_PROJECT_ID}`, {
    name: 'Seeded Error Report Base Project',
    leaderId: memberUser.uid,
    isActive: true,
    shortId: 204,
    createdAt,
    updatedAt: createdAt,
  } )
  addProjectMember( firestore, {
    projectId: ERROR_REPORT_BASE_PROJECT_ID,
    userId: memberUser.uid,
    role: 'leader',
    email: memberUser.email,
    timestamp: createdAt,
  } )
  addProjectMember( firestore, {
    projectId: ERROR_REPORT_BASE_PROJECT_ID,
    userId: reviewerUser.uid,
    role: 'member',
    email: reviewerUser.email,
    timestamp: createdAt,
  } )
  withDoc( firestore, `counters/documents_${ERROR_REPORT_BASE_PROJECT_ID}`, {
    nextNumber: 602,
    projectId: ERROR_REPORT_BASE_PROJECT_ID,
  } )
  withDoc( firestore, `documents/${ERROR_REPORT_BASE_DOCUMENT_ID}`, {
    projectId: ERROR_REPORT_BASE_PROJECT_ID,
    title: 'Seeded Error Report Base Document',
    type: 'document',
    createdBy: memberUser.uid,
    authorId: memberUser.uid,
    updatedBy: memberUser.uid,
    shortId: 601,
    createdAt,
    updatedAt: acceptedAt,
  } )
  withDoc( firestore, `versions/${ERROR_REPORT_BASE_VERSION_ID}`, {
    projectId: ERROR_REPORT_BASE_PROJECT_ID,
    docId: ERROR_REPORT_BASE_DOCUMENT_ID,
    number: 1,
    status: 'Accepted',
    createdBy: memberUser.uid,
    reviewerIds: [ reviewerUser.uid ],
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
    updatedBy: memberUser.uid,
  } )
  withDoc( firestore, `counters/versions_${ERROR_REPORT_BASE_DOCUMENT_ID}`, {
    nextNumber: 2,
    docId: ERROR_REPORT_BASE_DOCUMENT_ID,
    projectId: ERROR_REPORT_BASE_PROJECT_ID,
    previousVersionId: ERROR_REPORT_BASE_VERSION_ID,
  } )
  addFileRef( firestore, {
    fileRefId: ERROR_REPORT_BASE_FILE_REF_ID,
    fileKey: 'seeded/error-report-base.pdf',
    fileName: 'error-report-base.pdf',
    projectId: ERROR_REPORT_BASE_PROJECT_ID,
    docId: ERROR_REPORT_BASE_DOCUMENT_ID,
    versionId: ERROR_REPORT_BASE_VERSION_ID,
    createdBy: memberUser.uid,
    timestamp: createdAt,
  } )

  withDoc( firestore, `projects/${ERROR_REPORT_UNLOCK_PROJECT_ID}`, {
    name: 'Seeded Error Report Unlock Project',
    leaderId: memberUser.uid,
    isActive: true,
    shortId: 205,
    createdAt,
    updatedAt: createdAt,
  } )
  addProjectMember( firestore, {
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    userId: memberUser.uid,
    role: 'leader',
    email: memberUser.email,
    timestamp: createdAt,
  } )
  addProjectMember( firestore, {
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    userId: reviewerUser.uid,
    role: 'member',
    email: reviewerUser.email,
    timestamp: createdAt,
  } )
  withDoc( firestore, `counters/documents_${ERROR_REPORT_UNLOCK_PROJECT_ID}`, {
    nextNumber: 703,
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
  } )
  withDoc( firestore, `documents/${ERROR_REPORT_UNLOCK_DOCUMENT_ID}`, {
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    title: 'Seeded Error Report Unlock Document',
    type: 'document',
    createdBy: memberUser.uid,
    authorId: memberUser.uid,
    updatedBy: memberUser.uid,
    shortId: 701,
    createdAt,
    updatedAt: acceptedAt,
  } )
  withDoc( firestore, `versions/${ERROR_REPORT_UNLOCK_VERSION_ID}`, {
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    docId: ERROR_REPORT_UNLOCK_DOCUMENT_ID,
    number: 1,
    status: 'Accepted',
    createdBy: memberUser.uid,
    reviewerIds: [ reviewerUser.uid ],
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
    updatedBy: memberUser.uid,
  } )
  withDoc( firestore, `counters/versions_${ERROR_REPORT_UNLOCK_DOCUMENT_ID}`, {
    nextNumber: 2,
    docId: ERROR_REPORT_UNLOCK_DOCUMENT_ID,
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    previousVersionId: ERROR_REPORT_UNLOCK_VERSION_ID,
  } )
  addFileRef( firestore, {
    fileRefId: ERROR_REPORT_UNLOCK_FILE_REF_ID,
    fileKey: 'seeded/error-report-unlock.pdf',
    fileName: 'error-report-unlock.pdf',
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    docId: ERROR_REPORT_UNLOCK_DOCUMENT_ID,
    versionId: ERROR_REPORT_UNLOCK_VERSION_ID,
    createdBy: memberUser.uid,
    timestamp: createdAt,
  } )
  withDoc( firestore, `documents/${ERROR_REPORT_UNLOCK_REPORT_DOCUMENT_ID}`, {
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    title: 'Accepted linked error report',
    type: 'errorReport',
    baseDocId: ERROR_REPORT_UNLOCK_DOCUMENT_ID,
    baseVersionId: ERROR_REPORT_UNLOCK_VERSION_ID,
    createdBy: memberUser.uid,
    authorId: memberUser.uid,
    updatedBy: memberUser.uid,
    shortId: 702,
    createdAt,
    updatedAt: linkedAcceptedAt,
  } )
  withDoc( firestore, `versions/${ERROR_REPORT_UNLOCK_REPORT_VERSION_ID}`, {
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    docId: ERROR_REPORT_UNLOCK_REPORT_DOCUMENT_ID,
    number: 1,
    status: 'Accepted',
    createdBy: memberUser.uid,
    reviewerIds: [ reviewerUser.uid ],
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
    updatedBy: memberUser.uid,
  } )
  withDoc( firestore, `counters/versions_${ERROR_REPORT_UNLOCK_REPORT_DOCUMENT_ID}`, {
    nextNumber: 2,
    docId: ERROR_REPORT_UNLOCK_REPORT_DOCUMENT_ID,
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    previousVersionId: ERROR_REPORT_UNLOCK_REPORT_VERSION_ID,
  } )
  addFileRef( firestore, {
    fileRefId: ERROR_REPORT_UNLOCK_REPORT_FILE_REF_ID,
    fileKey: 'seeded/error-report-linked.pdf',
    fileName: 'error-report-linked.pdf',
    projectId: ERROR_REPORT_UNLOCK_PROJECT_ID,
    docId: ERROR_REPORT_UNLOCK_REPORT_DOCUMENT_ID,
    versionId: ERROR_REPORT_UNLOCK_REPORT_VERSION_ID,
    createdBy: memberUser.uid,
    timestamp: createdAt,
  } )

  withDoc( firestore, `projects/${ERROR_REPORT_TRANSITION_PROJECT_ID}`, {
    name: 'Seeded Error Report Transition Project',
    leaderId: memberUser.uid,
    isActive: true,
    shortId: 206,
    createdAt,
    updatedAt: createdAt,
  } )
  addProjectMember( firestore, {
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    userId: memberUser.uid,
    role: 'leader',
    email: memberUser.email,
    timestamp: createdAt,
  } )
  addProjectMember( firestore, {
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    userId: reviewerUser.uid,
    role: 'member',
    email: reviewerUser.email,
    timestamp: createdAt,
  } )
  withDoc( firestore, `counters/documents_${ERROR_REPORT_TRANSITION_PROJECT_ID}`, {
    nextNumber: 713,
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
  } )
  withDoc( firestore, `documents/${ERROR_REPORT_TRANSITION_DOCUMENT_ID}`, {
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    title: 'Seeded Error Report Transition Document',
    type: 'document',
    createdBy: memberUser.uid,
    authorId: memberUser.uid,
    updatedBy: memberUser.uid,
    shortId: 711,
    createdAt,
    updatedAt: acceptedAt,
  } )
  withDoc( firestore, `versions/${ERROR_REPORT_TRANSITION_VERSION_ID}`, {
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    docId: ERROR_REPORT_TRANSITION_DOCUMENT_ID,
    number: 1,
    status: 'Accepted',
    createdBy: memberUser.uid,
    reviewerIds: [ reviewerUser.uid ],
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
    updatedBy: memberUser.uid,
  } )
  withDoc( firestore, `counters/versions_${ERROR_REPORT_TRANSITION_DOCUMENT_ID}`, {
    nextNumber: 2,
    docId: ERROR_REPORT_TRANSITION_DOCUMENT_ID,
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    previousVersionId: ERROR_REPORT_TRANSITION_VERSION_ID,
  } )
  addFileRef( firestore, {
    fileRefId: ERROR_REPORT_TRANSITION_FILE_REF_ID,
    fileKey: 'seeded/error-report-transition.pdf',
    fileName: 'error-report-transition.pdf',
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    docId: ERROR_REPORT_TRANSITION_DOCUMENT_ID,
    versionId: ERROR_REPORT_TRANSITION_VERSION_ID,
    createdBy: memberUser.uid,
    timestamp: createdAt,
  } )
  withDoc( firestore, `documents/${ERROR_REPORT_TRANSITION_REPORT_DOCUMENT_ID}`, {
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    title: 'Accepted transition error report',
    type: 'errorReport',
    baseDocId: ERROR_REPORT_TRANSITION_DOCUMENT_ID,
    baseVersionId: ERROR_REPORT_TRANSITION_VERSION_ID,
    createdBy: memberUser.uid,
    authorId: memberUser.uid,
    updatedBy: memberUser.uid,
    shortId: 712,
    createdAt,
    updatedAt: linkedAcceptedAt,
  } )
  withDoc( firestore, `versions/${ERROR_REPORT_TRANSITION_REPORT_VERSION_ID}`, {
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    docId: ERROR_REPORT_TRANSITION_REPORT_DOCUMENT_ID,
    number: 1,
    status: 'Accepted',
    createdBy: memberUser.uid,
    reviewerIds: [ reviewerUser.uid ],
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
    updatedBy: memberUser.uid,
  } )
  withDoc( firestore, `counters/versions_${ERROR_REPORT_TRANSITION_REPORT_DOCUMENT_ID}`, {
    nextNumber: 2,
    docId: ERROR_REPORT_TRANSITION_REPORT_DOCUMENT_ID,
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    previousVersionId: ERROR_REPORT_TRANSITION_REPORT_VERSION_ID,
  } )
  addFileRef( firestore, {
    fileRefId: ERROR_REPORT_TRANSITION_REPORT_FILE_REF_ID,
    fileKey: 'seeded/error-report-transition-linked.pdf',
    fileName: 'error-report-transition-linked.pdf',
    projectId: ERROR_REPORT_TRANSITION_PROJECT_ID,
    docId: ERROR_REPORT_TRANSITION_REPORT_DOCUMENT_ID,
    versionId: ERROR_REPORT_TRANSITION_REPORT_VERSION_ID,
    createdBy: memberUser.uid,
    timestamp: createdAt,
  } )

  withDoc( firestore, `projects/${MODEL_UPDATE_PROJECT_ID}`, {
    name: 'Seeded Model Update Project',
    leaderId: adminUser.uid,
    isActive: true,
    createdAt,
    updatedAt: createdAt,
  } )
  withDoc( firestore, `documents/${MODEL_UPDATE_DOCUMENT_ID}`, {
    projectId: MODEL_UPDATE_PROJECT_ID,
    title: 'Seeded Model Update Document',
    type: 'document',
    createdBy: adminUser.uid,
    authorId: adminUser.uid,
    updatedBy: adminUser.uid,
    createdAt,
    updatedAt: createdAt,
  } )
  withDoc( firestore, `versions/${MODEL_UPDATE_VERSION_ID}`, {
    projectId: MODEL_UPDATE_PROJECT_ID,
    docId: MODEL_UPDATE_DOCUMENT_ID,
    number: 1,
    status: 'In Creation',
    createdBy: adminUser.uid,
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
    updatedBy: adminUser.uid,
  } )

  withDoc( firestore, `projects/${REPAIR_PROJECT_ID}`, {
    name: 'Seeded Repair Project',
    leaderId: adminUser.uid,
    isActive: true,
    shortId: 901,
    createdAt,
    updatedAt: createdAt,
  } )
  withDoc( firestore, `documents/${REPAIR_DOCUMENT_ID}`, {
    projectId: REPAIR_PROJECT_ID,
    title: 'Seeded Repair Document',
    type: 'document',
    createdBy: adminUser.uid,
    authorId: adminUser.uid,
    updatedBy: adminUser.uid,
    shortId: 902,
    updatedAt: createdAt,
  } )
  withDoc( firestore, `versions/${REPAIR_VERSION_ID}`, {
    projectId: REPAIR_PROJECT_ID,
    docId: REPAIR_DOCUMENT_ID,
    number: 1,
    status: 'In Review',
    createdBy: adminUser.uid,
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
    updatedBy: adminUser.uid,
  } )

  return {
    currentUserId: readPersistedCurrentUserId(),
    nextGeneratedId: 1,
    usersById: Object.fromEntries( users.map( ( user ) => [ user.uid, deepClone( user ) ] ) ),
    usersByEmail: Object.fromEntries( users.map( ( user ) => [ user.email.toLowerCase(), deepClone( user ) ] ) ),
    firestore,
    storage: new Map<string, FakeStoredFile>(),
  }
}

const globalStateKey = '__qt4FakeFirebaseState'
const currentUserStorageKey = 'qt4_fake_current_user_id'
const stateStorageKey = 'qt4_fake_firebase_state_v1'

const readPersistedCurrentUserId = (): string | null => {
  try {
    return window.localStorage.getItem( currentUserStorageKey )
  } catch {
    return null
  }
}

const persistCurrentUserId = (userId: string | null) => {
  try {
    if( userId ) {
      window.localStorage.setItem( currentUserStorageKey, userId )
      return
    }
    window.localStorage.removeItem( currentUserStorageKey )
  } catch {
    // ignore storage errors
  }
}

const getGlobalStateHolder = (): Window & typeof globalThis & {
  [globalStateKey]?: FakeState
} => window as Window & typeof globalThis & { [globalStateKey]?: FakeState }

const serializeValue = (value: unknown): SerializedValue => {
  if( value instanceof FakeTimestamp ) {
    return {
      __type: 'timestamp',
      iso: value.toDate().toISOString(),
    }
  }
  if( value instanceof Date ) {
    return {
      __type: 'timestamp',
      iso: value.toISOString(),
    }
  }
  if( Array.isArray( value ) ) {
    return value.map( ( item ) => serializeValue( item ) )
  }
  if( value && typeof value === 'object' ) {
    return Object.fromEntries(
      Object.entries( value as Record<string, unknown> ).map( ( [ key, entryValue ] ) => [ key, serializeValue( entryValue ) ] ),
    ) as SerializedValue
  }
  if( value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ) {
    return value
  }
  return null
}

const deserializeValue = (value: SerializedValue): unknown => {
  if( Array.isArray( value ) ) {
    return value.map( ( item ) => deserializeValue( item ) )
  }
  if( value && typeof value === 'object' ) {
    if( '__type' in value && value.__type === 'timestamp' ) {
      const timestampValue = value as { __type: 'timestamp'; iso: string }
      return FakeTimestamp.fromDate( new Date( timestampValue.iso ) )
    }
    return Object.fromEntries(
      Object.entries( value ).map( ( [ key, entryValue ] ) => [ key, deserializeValue( entryValue as SerializedValue ) ] ),
    )
  }
  return value
}

const persistState = () => {
  try {
    const holder = getGlobalStateHolder()
    const state = holder[globalStateKey]
    if( !state ) {
      return
    }
    const serialized: SerializedState = {
      currentUserId: state.currentUserId,
      nextGeneratedId: state.nextGeneratedId,
      usersById: deepClone( state.usersById ),
      usersByEmail: deepClone( state.usersByEmail ),
      firestore: Array.from( state.firestore.entries() ).map( ( [ path, data ] ) => [ path, serializeValue( data ) ] ),
      storage: Array.from( state.storage.entries() ).map( ( [ path, data ] ) => [ path, deepClone( data ) ] ),
    }
    window.localStorage.setItem( stateStorageKey, JSON.stringify( serialized ) )
  } catch {
    // ignore storage errors
  }
}

const loadPersistedState = (): FakeState | null => {
  try {
    const raw = window.localStorage.getItem( stateStorageKey )
    if( !raw ) {
      return null
    }
    const parsed = JSON.parse( raw ) as SerializedState
    return {
      currentUserId: parsed.currentUserId ?? null,
      nextGeneratedId: typeof parsed.nextGeneratedId === 'number' ? parsed.nextGeneratedId : 1,
      usersById: deepClone( parsed.usersById ?? {} ),
      usersByEmail: deepClone( parsed.usersByEmail ?? {} ),
      firestore: new Map(
        ( parsed.firestore ?? [] ).map( ( [ path, data ] ) => [ path, deserializeValue( data as SerializedValue ) as FakeFirestoreDoc ] ),
      ),
      storage: new Map(
        ( parsed.storage ?? [] ).map( ( [ path, data ] ) => [ path, deepClone( data ) ] ),
      ),
    }
  } catch {
    return null
  }
}

const getState = (): FakeState => {
  const holder = getGlobalStateHolder()
  if( !holder[globalStateKey] ) {
    holder[globalStateKey] = loadPersistedState() ?? createSeedState()
    persistState()
  }
  return holder[globalStateKey] as FakeState
}

const syncStateFromStorage = () => {
  const persistedState = loadPersistedState()
  if( !persistedState ) {
    return
  }
  const holder = getGlobalStateHolder()
  holder[globalStateKey] = persistedState
}

const resetState = () => {
  try {
    window.localStorage.removeItem( currentUserStorageKey )
    window.localStorage.removeItem( stateStorageKey )
  } catch {
    // ignore storage errors
  }
  const holder = getGlobalStateHolder()
  holder[globalStateKey] = createSeedState()
  persistState()
}

const generateId = (prefix: string): string => {
  const state = getState()
  const id = `${prefix}-${state.nextGeneratedId}`
  state.nextGeneratedId += 1
  persistState()
  return id
}

const getCurrentUserRecord = (): FakeUserRecord | null => {
  const state = getState()
  const currentUserId = state.currentUserId
  return currentUserId ? state.usersById[currentUserId] ?? null : null
}

const replaceSentinels = (value: unknown): unknown => {
  if( value === SERVER_TIMESTAMP_SENTINEL ) {
    return FakeTimestamp.now()
  }
  if( Array.isArray( value ) ) {
    return value.map( ( item ) => replaceSentinels( item ) )
  }
  if( value && typeof value === 'object' && !( value instanceof FakeTimestamp ) && !( value instanceof Date ) ) {
    return Object.fromEntries(
      Object.entries( value as Record<string, unknown> ).map( ( [ key, entryValue ] ) => [ key, replaceSentinels( entryValue ) ] ),
    )
  }
  return value
}

const mergeDocs = (
  currentValue: FakeFirestoreDoc,
  nextValue: FakeFirestoreDoc,
): FakeFirestoreDoc => {
  const merged = deepClone( currentValue )
  Object.entries( nextValue ).forEach( ( [ key, value ] ) => {
    if( value === DELETE_FIELD_SENTINEL ) {
      delete merged[key]
      return
    }
    merged[key] = deepClone( replaceSentinels( value ) )
  } )
  return merged
}

const setDocData = (path: string, data: FakeFirestoreDoc, merge: boolean = false) => {
  const state = getState()
  const current = state.firestore.get( path ) ?? {}
  const normalizedData = deepClone( replaceSentinels( data ) as FakeFirestoreDoc )
  state.firestore.set( path, merge ? mergeDocs( current, normalizedData ) : normalizedData )
  persistState()
}

const updateDocData = (path: string, data: FakeFirestoreDoc) => {
  const state = getState()
  const current = state.firestore.get( path )
  if( !current ) {
    throw new Error( `Document not found: ${path}` )
  }
  state.firestore.set( path, mergeDocs( current, data ) )
  persistState()
}

const deleteDocData = (path: string) => {
  getState().firestore.delete( path )
  persistState()
}

const getDocData = (path: string): FakeFirestoreDoc | null => {
  const data = getState().firestore.get( path )
  return data ? deepClone( data ) : null
}

const getCollectionDocs = (collectionPath: string): Array<{ path: string; id: string; data: FakeFirestoreDoc }> => {
  const targetSegments = collectionPath.split( '/' )
  const targetLength = targetSegments.length + 1
  return Array.from( getState().firestore.entries() )
    .filter( ( [ path ] ) => {
      const segments = path.split( '/' )
      if( segments.length !== targetLength ) {
        return false
      }
      return targetSegments.every( ( segment, index ) => segments[index] === segment )
    } )
    .map( ( [ path, data ] ) => ( {
      path,
      id: path.split( '/' ).at( -1 ) ?? '',
      data: deepClone( data ),
    } ) )
}

const readComparable = (value: unknown): unknown => {
  if( value instanceof FakeTimestamp ) {
    return value.toMillis()
  }
  if( value instanceof Date ) {
    return value.getTime()
  }
  return value
}

export {
  DELETE_FIELD_SENTINEL,
  FakeTimestamp,
  SERVER_TIMESTAMP_SENTINEL,
  stateStorageKey,
  deepClone,
  deleteDocData,
  generateId,
  getCollectionDocs,
  getCurrentUserRecord,
  getDocData,
  getState,
  mergeDocs,
  persistState,
  persistCurrentUserId,
  readComparable,
  resetState,
  setDocData,
  syncStateFromStorage,
  updateDocData,
}
