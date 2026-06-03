import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock( 'firebase/firestore', () => import( '../test/e2e/fakes/firestore' ) )
vi.mock( './firebase', async () => {
  const firestore = await import( '../test/e2e/fakes/firestore' )
  return {
    db: firestore.db,
  }
} )
vi.mock( './audit', () => ( {
  logAudit: vi.fn( async () => undefined ),
} ) )
vi.mock( './errorMonitor', () => ( {
  reportAbnormalError: vi.fn( async () => true ),
} ) )

import { buildDashboardTasks, refreshDashboard } from './dashboard'
import * as firestoreModule from 'firebase/firestore'
import { logAudit } from './audit'
import { reportAbnormalError } from './errorMonitor'
import { FakeTimestamp, getCollectionDocs, getDocData, resetState, setDocData } from '../test/e2e/fakes/state'

const timestamp = (value: string) => FakeTimestamp.fromDate( new Date( value ) )

const seedProject = (projectId: string, name: string, userId: string) => {
  const createdAt = timestamp( '2026-04-01T12:00:00.000Z' )
  setDocData( `projects/${projectId}`, {
    name,
    leaderId: userId,
    isActive: true,
    shortId: Number( projectId.replace( /\D/g, '' ).slice( -3 ) || '1' ),
    createdAt,
    updatedAt: createdAt,
  } )
  setDocData( `projectMembers/${projectId}_${userId}`, {
    projectId,
    userId,
    role: 'leader',
    email: `${userId}@example.com`,
    createdAt,
    updatedAt: createdAt,
  } )
}

describe( 'lib/dashboard', () => {
  beforeEach( () => {
    vi.clearAllMocks()
    resetState()
    vi.useFakeTimers()
    vi.setSystemTime( new Date( '2026-04-03T10:45:00.000Z' ) )
  } )

  afterEach( () => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  } )

  it( 'builds authoring, reply, and accepted report tasks for the author/leader', async () => {
    seedProject( 'project-dashboard-authoring', 'Dashboard Authoring Project', 'user-member-1' )
    setDocData( 'documents/document-dashboard-authoring', {
      projectId: 'project-dashboard-authoring',
      title: 'Authoring Draft',
      type: 'document',
      createdBy: 'user-member-1',
      authorId: 'user-member-1',
      shortId: 801,
      createdAt: timestamp( '2026-04-03T08:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T08:00:00.000Z' ),
    } )
    setDocData( 'versions/version-dashboard-authoring', {
      projectId: 'project-dashboard-authoring',
      docId: 'document-dashboard-authoring',
      number: 1,
      status: 'In Creation',
      createdBy: 'user-member-1',
      reviewerIds: [],
      hasFile: false,
      createdAt: timestamp( '2026-04-03T08:05:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T08:05:00.000Z' ),
    } )

    seedProject( 'project-dashboard-reply', 'Dashboard Reply Project', 'user-member-1' )
    setDocData( 'projectMembers/project-dashboard-reply_user-reviewer-1', {
      projectId: 'project-dashboard-reply',
      userId: 'user-reviewer-1',
      role: 'member',
      email: 'reviewer@example.com',
      createdAt: timestamp( '2026-04-01T12:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-01T12:00:00.000Z' ),
    } )
    setDocData( 'documents/document-dashboard-reply', {
      projectId: 'project-dashboard-reply',
      title: 'Reply Needed Document',
      type: 'document',
      createdBy: 'user-member-1',
      authorId: 'user-member-1',
      shortId: 802,
      createdAt: timestamp( '2026-04-03T08:15:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T08:15:00.000Z' ),
    } )
    setDocData( 'versions/version-dashboard-reply', {
      projectId: 'project-dashboard-reply',
      docId: 'document-dashboard-reply',
      number: 1,
      status: 'In Review',
      createdBy: 'user-member-1',
      reviewerIds: [ 'user-reviewer-1' ],
      hasFile: true,
      reviewStartAt: timestamp( '2026-04-03T08:20:00.000Z' ),
      reviewEndAt: timestamp( '2026-04-04T08:20:00.000Z' ),
      createdAt: timestamp( '2026-04-03T08:20:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T10:30:00.000Z' ),
    } )
    setDocData( 'threads/thread-dashboard-reply', {
      projectId: 'project-dashboard-reply',
      docId: 'document-dashboard-reply',
      versionId: 'version-dashboard-reply',
      status: 'open',
      title: 'Thread waiting for the author',
      createdBy: 'user-reviewer-1',
      commentCount: 2,
      createdAt: timestamp( '2026-04-03T09:45:00.000Z' ),
      lastCommentAt: timestamp( '2026-04-03T10:30:00.000Z' ),
      lastCommentBy: 'user-reviewer-1',
    } )
    setDocData( 'comments/comment-dashboard-reply-1', {
      projectId: 'project-dashboard-reply',
      docId: 'document-dashboard-reply',
      versionId: 'version-dashboard-reply',
      threadId: 'thread-dashboard-reply',
      body: 'Author replied first.',
      createdBy: 'user-member-1',
      createdAt: timestamp( '2026-04-03T10:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T10:00:00.000Z' ),
    } )
    setDocData( 'comments/comment-dashboard-reply-2', {
      projectId: 'project-dashboard-reply',
      docId: 'document-dashboard-reply',
      versionId: 'version-dashboard-reply',
      threadId: 'thread-dashboard-reply',
      body: 'Reviewer needs a follow-up.',
      createdBy: 'user-reviewer-1',
      createdAt: timestamp( '2026-04-03T10:30:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T10:30:00.000Z' ),
    } )

    const tasks = await buildDashboardTasks( 'user-member-1' )

    expect( tasks ).toEqual(
      expect.arrayContaining( [
        expect.objectContaining( {
          id: 'authoring-version-dashboard-authoring',
          type: 'authoring',
          title: '801 - Authoring Draft',
          visualState: 'inCreation',
        } ),
        expect.objectContaining( {
          id: 'reply-thread-dashboard-reply',
          type: 'reply',
          title: '802 - Reply Needed Document',
          lifecycleState: 'active',
        } ),
        expect.objectContaining( {
          id: 'accepted-report-version-e2e-error-report-unlock',
          type: 'acceptedReport',
          title: '701 - Seeded Error Report Unlock Document',
          visualState: 'accepted',
        } ),
      ] ),
    )
  } )

  it( 'marks reviewer tasks in grace when the first review comment is still actionable after expiry', async () => {
    seedProject( 'project-dashboard-reviewer', 'Dashboard Reviewer Project', 'user-member-1' )
    setDocData( 'projectMembers/project-dashboard-reviewer_user-reviewer-1', {
      projectId: 'project-dashboard-reviewer',
      userId: 'user-reviewer-1',
      role: 'member',
      email: 'reviewer@example.com',
      createdAt: timestamp( '2026-04-01T12:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-01T12:00:00.000Z' ),
    } )
    setDocData( 'documents/document-dashboard-reviewer', {
      projectId: 'project-dashboard-reviewer',
      title: 'Reviewer Grace Document',
      type: 'document',
      createdBy: 'user-member-1',
      authorId: 'user-member-1',
      shortId: 803,
      createdAt: timestamp( '2026-04-03T08:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T08:00:00.000Z' ),
    } )
    setDocData( 'versions/version-dashboard-reviewer', {
      projectId: 'project-dashboard-reviewer',
      docId: 'document-dashboard-reviewer',
      number: 1,
      status: 'In Review',
      createdBy: 'user-member-1',
      reviewerIds: [ 'user-reviewer-1' ],
      hasFile: true,
      reviewStartAt: timestamp( '2026-04-03T08:00:00.000Z' ),
      reviewEndAt: timestamp( '2026-04-03T10:35:00.000Z' ),
      createdAt: timestamp( '2026-04-03T08:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T10:40:00.000Z' ),
    } )
    setDocData( 'threads/thread-dashboard-reviewer', {
      projectId: 'project-dashboard-reviewer',
      docId: 'document-dashboard-reviewer',
      versionId: 'version-dashboard-reviewer',
      status: 'open',
      title: 'Reviewer first comment still allowed',
      createdBy: 'user-member-1',
      commentCount: 1,
      createdAt: timestamp( '2026-04-03T10:40:00.000Z' ),
      lastCommentAt: timestamp( '2026-04-03T10:40:00.000Z' ),
      lastCommentBy: 'user-member-1',
    } )

    const tasks = await buildDashboardTasks( 'user-reviewer-1', { types: [ 'reviewer' ] } )

    expect( tasks ).toEqual(
      expect.arrayContaining( [
        expect.objectContaining( {
          id: 'reviewer-version-dashboard-reviewer',
          type: 'reviewer',
          title: '803 - Reviewer Grace Document',
          lifecycleState: 'active',
          reviewPeriodState: 'grace',
          visualState: 'reviewGrace',
        } ),
      ] ),
    )
  } )

  it( 'refreshes one dashboard section without deleting previously stored tasks from other sections', async () => {
    seedProject( 'project-dashboard-refresh', 'Dashboard Refresh Project', 'user-member-1' )
    setDocData( 'documents/document-dashboard-refresh', {
      projectId: 'project-dashboard-refresh',
      title: 'Refresh Draft',
      type: 'document',
      createdBy: 'user-member-1',
      authorId: 'user-member-1',
      shortId: 804,
      createdAt: timestamp( '2026-04-03T09:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T09:00:00.000Z' ),
    } )
    setDocData( 'versions/version-dashboard-refresh', {
      projectId: 'project-dashboard-refresh',
      docId: 'document-dashboard-refresh',
      number: 1,
      status: 'In Creation',
      createdBy: 'user-member-1',
      reviewerIds: [],
      hasFile: false,
      createdAt: timestamp( '2026-04-03T09:05:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T09:05:00.000Z' ),
    } )

    setDocData( 'dashboard/user-member-1', {
      userId: 'user-member-1',
      storageVersion: 2,
      taskCount: 1,
      taskCountsByType: {
        authoring: 0,
        reply: 1,
        reviewer: 0,
        acceptedReport: 0,
      },
      expiredTaskCount: 0,
      updatedAt: timestamp( '2026-04-03T09:10:00.000Z' ),
      updatedBy: 'user-member-1',
    } )
    setDocData( 'dashboard/user-member-1/tasks/reply-existing-task', {
      id: 'reply-existing-task',
      type: 'reply',
      title: 'Stored reply task',
      detail: 'Existing task from another section',
      projectId: 'project-dashboard-refresh',
      link: '/documents/document-dashboard-refresh/versions?focus=comments',
      createdAt: timestamp( '2026-04-03T09:10:00.000Z' ),
    } )

    const tasks = await refreshDashboard( 'user-member-1', { types: [ 'authoring' ] } )
    const storedTaskIds = getCollectionDocs( 'dashboard/user-member-1/tasks' ).map( (entry) => entry.id ).sort()
    const dashboardDoc = getDocData( 'dashboard/user-member-1' )

    expect( tasks.map( ( task ) => task.id ).sort() ).toEqual( [
      'authoring-version-dashboard-refresh',
      'reply-existing-task',
    ] )
    expect( storedTaskIds ).toEqual( [
      'authoring-version-dashboard-refresh',
      'reply-existing-task',
    ] )
    expect( dashboardDoc ).toEqual( expect.objectContaining( {
      taskCount: 2,
      expiredTaskCount: 0,
      taskCountsByType: {
        authoring: 1,
        reply: 1,
        reviewer: 0,
        acceptedReport: 0,
      },
      updatedBy: 'user-member-1',
    } ) )
  } )

  it( 'builds expired reviewer and reply tasks after the review and grace windows close', async () => {
    seedProject( 'project-dashboard-expired', 'Dashboard Expired Project', 'user-member-1' )
    setDocData( 'projectMembers/project-dashboard-expired_user-reviewer-1', {
      projectId: 'project-dashboard-expired',
      userId: 'user-reviewer-1',
      role: 'member',
      email: 'reviewer@example.com',
      createdAt: timestamp( '2026-04-01T12:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-01T12:00:00.000Z' ),
    } )
    setDocData( 'documents/document-dashboard-expired-reviewer', {
      projectId: 'project-dashboard-expired',
      title: 'Expired Reviewer Document',
      type: 'document',
      createdBy: 'user-member-1',
      authorId: 'user-member-1',
      shortId: 805,
      createdAt: timestamp( '2026-04-03T07:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T07:00:00.000Z' ),
    } )
    setDocData( 'versions/version-dashboard-expired-reviewer', {
      projectId: 'project-dashboard-expired',
      docId: 'document-dashboard-expired-reviewer',
      number: 1,
      status: 'In Review',
      createdBy: 'user-member-1',
      reviewerIds: [ 'user-reviewer-1' ],
      hasFile: true,
      reviewStartAt: timestamp( '2026-04-03T07:00:00.000Z' ),
      reviewEndAt: timestamp( '2026-04-03T08:00:00.000Z' ),
      createdAt: timestamp( '2026-04-03T07:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T08:00:00.000Z' ),
    } )

    setDocData( 'documents/document-dashboard-expired-reply', {
      projectId: 'project-dashboard-expired',
      title: 'Expired Reply Document',
      type: 'document',
      createdBy: 'user-member-1',
      authorId: 'user-member-1',
      shortId: 806,
      createdAt: timestamp( '2026-04-03T07:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T07:00:00.000Z' ),
    } )
    setDocData( 'versions/version-dashboard-expired-reply', {
      projectId: 'project-dashboard-expired',
      docId: 'document-dashboard-expired-reply',
      number: 1,
      status: 'In Review',
      createdBy: 'user-member-1',
      reviewerIds: [ 'user-reviewer-1' ],
      hasFile: true,
      reviewStartAt: timestamp( '2026-04-03T07:00:00.000Z' ),
      reviewEndAt: timestamp( '2026-04-03T08:00:00.000Z' ),
      createdAt: timestamp( '2026-04-03T07:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T08:00:00.000Z' ),
    } )
    setDocData( 'threads/thread-dashboard-expired-reply', {
      projectId: 'project-dashboard-expired',
      docId: 'document-dashboard-expired-reply',
      versionId: 'version-dashboard-expired-reply',
      status: 'open',
      title: 'Expired reply thread',
      createdBy: 'user-reviewer-1',
      commentCount: 2,
      createdAt: timestamp( '2026-04-03T07:30:00.000Z' ),
      lastCommentAt: timestamp( '2026-04-03T08:10:00.000Z' ),
      lastCommentBy: 'user-reviewer-1',
    } )
    setDocData( 'comments/comment-dashboard-expired-reply-1', {
      projectId: 'project-dashboard-expired',
      docId: 'document-dashboard-expired-reply',
      versionId: 'version-dashboard-expired-reply',
      threadId: 'thread-dashboard-expired-reply',
      body: 'Author commented during review.',
      createdBy: 'user-member-1',
      createdAt: timestamp( '2026-04-03T07:50:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T07:50:00.000Z' ),
    } )
    setDocData( 'comments/comment-dashboard-expired-reply-2', {
      projectId: 'project-dashboard-expired',
      docId: 'document-dashboard-expired-reply',
      versionId: 'version-dashboard-expired-reply',
      threadId: 'thread-dashboard-expired-reply',
      body: 'Reviewer requested another change after expiry.',
      createdBy: 'user-reviewer-1',
      createdAt: timestamp( '2026-04-03T08:10:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T08:10:00.000Z' ),
    } )

    const reviewerTasks = await buildDashboardTasks( 'user-reviewer-1', { types: [ 'reviewer' ] } )
    const authorTasks = await buildDashboardTasks( 'user-member-1', { types: [ 'reply' ] } )

    expect( reviewerTasks ).toEqual(
      expect.arrayContaining( [
        expect.objectContaining( {
          id: 'reviewer-version-dashboard-expired-reviewer',
          type: 'reviewer',
          title: '805 - Expired Reviewer Document',
          lifecycleState: 'expired',
          visualState: 'reviewExpired',
        } ),
      ] ),
    )
    expect( authorTasks ).toEqual(
      expect.arrayContaining( [
        expect.objectContaining( {
          id: 'reply-thread-dashboard-expired-reply',
          type: 'reply',
          title: '806 - Expired Reply Document',
          lifecycleState: 'expired',
          visualState: 'reviewExpired',
        } ),
      ] ),
    )
  } )

  it( 'keeps non-reply tasks when comment access fails during reply detection', async () => {
    seedProject( 'project-dashboard-permission', 'Dashboard Permission Project', 'user-member-1' )
    setDocData( 'projectMembers/project-dashboard-permission_user-reviewer-1', {
      projectId: 'project-dashboard-permission',
      userId: 'user-reviewer-1',
      role: 'member',
      email: 'reviewer@example.com',
      createdAt: timestamp( '2026-04-01T12:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-01T12:00:00.000Z' ),
    } )
    setDocData( 'documents/document-dashboard-permission-authoring', {
      projectId: 'project-dashboard-permission',
      title: 'Permission Authoring Document',
      type: 'document',
      createdBy: 'user-member-1',
      authorId: 'user-member-1',
      shortId: 807,
      createdAt: timestamp( '2026-04-03T09:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T09:00:00.000Z' ),
    } )
    setDocData( 'versions/version-dashboard-permission-authoring', {
      projectId: 'project-dashboard-permission',
      docId: 'document-dashboard-permission-authoring',
      number: 1,
      status: 'In Creation',
      createdBy: 'user-member-1',
      reviewerIds: [],
      hasFile: false,
      createdAt: timestamp( '2026-04-03T09:05:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T09:05:00.000Z' ),
    } )
    setDocData( 'documents/document-dashboard-permission-reply', {
      projectId: 'project-dashboard-permission',
      title: 'Permission Reply Document',
      type: 'document',
      createdBy: 'user-member-1',
      authorId: 'user-member-1',
      shortId: 808,
      createdAt: timestamp( '2026-04-03T09:15:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T09:15:00.000Z' ),
    } )
    setDocData( 'versions/version-dashboard-permission-reply', {
      projectId: 'project-dashboard-permission',
      docId: 'document-dashboard-permission-reply',
      number: 1,
      status: 'In Review',
      createdBy: 'user-member-1',
      reviewerIds: [ 'user-reviewer-1' ],
      hasFile: true,
      reviewStartAt: timestamp( '2026-04-03T09:20:00.000Z' ),
      reviewEndAt: timestamp( '2026-04-04T09:20:00.000Z' ),
      createdAt: timestamp( '2026-04-03T09:20:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T09:20:00.000Z' ),
    } )

    const originalGetDocs = firestoreModule.getDocs
    vi.spyOn( firestoreModule, 'getDocs' ).mockImplementation( async ( target ) => {
      if( 'path' in target && target.path === 'comments' ) {
        throw new Error( 'Missing or insufficient permissions.' )
      }
      return originalGetDocs( target )
    } )

    const tasks = await buildDashboardTasks( 'user-member-1', { types: [ 'authoring', 'reply' ] } )

    expect( tasks ).toEqual( [
      expect.objectContaining( {
        id: 'authoring-version-dashboard-permission-authoring',
        type: 'authoring',
        title: '807 - Permission Authoring Document',
      } ),
    ] )
    expect( reportAbnormalError ).toHaveBeenCalledWith( expect.objectContaining( {
      action: 'dashboard.loadUserComments',
      source: 'firestore',
    } ) )
  } )

  it( 'completes dashboard refresh even when audit logging fails', async () => {
    seedProject( 'project-dashboard-audit-failure', 'Dashboard Audit Failure Project', 'user-member-1' )
    setDocData( 'documents/document-dashboard-audit-failure', {
      projectId: 'project-dashboard-audit-failure',
      title: 'Audit Failure Draft',
      type: 'document',
      createdBy: 'user-member-1',
      authorId: 'user-member-1',
      shortId: 809,
      createdAt: timestamp( '2026-04-03T09:00:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T09:00:00.000Z' ),
    } )
    setDocData( 'versions/version-dashboard-audit-failure', {
      projectId: 'project-dashboard-audit-failure',
      docId: 'document-dashboard-audit-failure',
      number: 1,
      status: 'In Creation',
      createdBy: 'user-member-1',
      reviewerIds: [],
      hasFile: false,
      createdAt: timestamp( '2026-04-03T09:05:00.000Z' ),
      updatedAt: timestamp( '2026-04-03T09:05:00.000Z' ),
    } )
    vi.mocked( logAudit ).mockRejectedValueOnce( new Error( 'Audit service unavailable.' ) )

    const tasks = await refreshDashboard( 'user-member-1', { types: [ 'authoring' ] } )
    const storedTaskIds = getCollectionDocs( 'dashboard/user-member-1/tasks' ).map( (entry) => entry.id )
    const dashboardDoc = getDocData( 'dashboard/user-member-1' )

    expect( tasks ).toEqual( [
      expect.objectContaining( {
        id: 'authoring-version-dashboard-audit-failure',
        type: 'authoring',
      } ),
    ] )
    expect( storedTaskIds ).toEqual( [ 'authoring-version-dashboard-audit-failure' ] )
    expect( dashboardDoc ).toEqual( expect.objectContaining( {
      taskCount: 1,
      updatedBy: 'user-member-1',
    } ) )
  } )
} )
