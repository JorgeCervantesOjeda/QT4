// src/pages/projectDocuments/changeRequestData.ts
// Loads cross-project change-request bases and creates change-request documents.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { FIRST_VERSION_NUMBER } from '../../domain/types'
import { logAudit } from '../../lib/audit'
import { db } from '../../lib/firebase'

type ChangeRequestBaseProject = {
  id: string
  name: string
  shortId: number | null
}

type ChangeRequestBaseVersion = {
  projectId: string
  docId: string
  versionId: string
  docTitle: string
  docShortId: number | null
  versionNumber: number
  status: string
}

type CreateChangeRequestParams = {
  projectId: string
  selectedBaseVersion: ChangeRequestBaseVersion
  title: string
  userEmail?: string | null
  userId: string
}

const loadChangeRequestBaseProjects = async (
  projectId: string,
  userId: string,
): Promise<ChangeRequestBaseProject[]> => {
  const membershipsSnapshot = await getDocs(
    query( collection( db, 'projectMembers' ), where( 'userId', '==', userId ) ),
  )
  const baseProjectIds = Array.from(
    new Set(
      membershipsSnapshot.docs
        .map( ( memberSnapshot ) => ( memberSnapshot.data().projectId as string | undefined ) ?? '' )
        .filter( ( membershipProjectId ) => membershipProjectId && membershipProjectId !== projectId ),
    ),
  )
  const loadedProjects = await Promise.all(
    baseProjectIds.map( async ( baseProjectId ) => {
      const baseProjectSnapshot = await getDoc( doc( db, 'projects', baseProjectId ) )
      if( !baseProjectSnapshot.exists() ) {
        return null
      }
      const baseProjectData = baseProjectSnapshot.data()
      return {
        id: baseProjectSnapshot.id,
        name: ( baseProjectData.name as string | undefined ) ?? 'Untitled project',
        shortId: Number.isFinite( baseProjectData.shortId ) ? Number( baseProjectData.shortId ) : null,
      }
    } ),
  )
  return loadedProjects
    .filter( Boolean )
    .sort( ( left, right ) =>
      `${left?.shortId ?? ''} ${left?.name ?? ''}`.localeCompare( `${right?.shortId ?? ''} ${right?.name ?? ''}` ),
    ) as ChangeRequestBaseProject[]
}

const loadAcceptedBaseVersions = async (baseProjectId: string): Promise<ChangeRequestBaseVersion[]> => {
  const [ documentsSnapshot, versionsSnapshot ] = await Promise.all( [
    getDocs( query( collection( db, 'documents' ), where( 'projectId', '==', baseProjectId ) ) ),
    getDocs( query( collection( db, 'versions' ), where( 'projectId', '==', baseProjectId ) ) ),
  ] )
  const baseDocumentsById = new Map<string, { title: string; shortId: number | null }>()
  documentsSnapshot.docs.forEach( ( documentSnapshot ) => {
    const documentData = documentSnapshot.data()
    const documentType = ( documentData.type as string | undefined ) ?? 'document'
    if( documentType !== 'document' ) {
      return
    }
    baseDocumentsById.set( documentSnapshot.id, {
      title: ( documentData.title as string | undefined ) ?? 'Untitled document',
      shortId: Number.isFinite( documentData.shortId ) ? Number( documentData.shortId ) : null,
    } )
  } )
  return versionsSnapshot.docs
    .map( ( versionSnapshot ) => {
      const versionData = versionSnapshot.data()
      const versionDocId = ( versionData.docId as string | undefined ) ?? ''
      const baseDocument = baseDocumentsById.get( versionDocId )
      if( !baseDocument || versionData.status !== 'Accepted' ) {
        return null
      }
      return {
        projectId: baseProjectId,
        docId: versionDocId,
        versionId: versionSnapshot.id,
        docTitle: baseDocument.title,
        docShortId: baseDocument.shortId,
        versionNumber: Number( versionData.number ?? FIRST_VERSION_NUMBER ),
        status: ( versionData.status as string | undefined ) ?? '',
      }
    } )
    .filter( Boolean )
    .sort( ( left, right ) => {
      const leftLabel = `${left?.docShortId ?? ''} ${left?.docTitle ?? ''} ${left?.versionNumber ?? 0}`
      const rightLabel = `${right?.docShortId ?? ''} ${right?.docTitle ?? ''} ${right?.versionNumber ?? 0}`
      return leftLabel.localeCompare( rightLabel )
    } ) as ChangeRequestBaseVersion[]
}

const createChangeRequestDocument = async (
  params: CreateChangeRequestParams,
): Promise<{ docId: string; versionId: string }> => {
  const { projectId, selectedBaseVersion, title, userEmail, userId } = params
  const counterRef = doc( db, 'counters', `documents_${projectId}` )
  const changeRequestRef = doc( collection( db, 'documents' ) )
  const versionRef = doc( collection( db, 'versions' ) )
  const versionCounterRef = doc( db, 'counters', `versions_${changeRequestRef.id}` )
  await runTransaction( db, async ( transaction ) => {
    const counterSnap = await transaction.get( counterRef )
    const nextNumberRaw = counterSnap.data()?.nextNumber
    const nextNumber = typeof nextNumberRaw === 'number' ? nextNumberRaw : 1
    transaction.set(
      counterRef,
      {
        nextNumber: nextNumber + 1,
        projectId,
      },
      { merge: true },
    )
    transaction.set( changeRequestRef, {
      projectId,
      title: title.trim(),
      type: 'changeRequest',
      baseProjectId: selectedBaseVersion.projectId,
      baseDocId: selectedBaseVersion.docId,
      baseVersionId: selectedBaseVersion.versionId,
      createdBy: userId,
      authorId: userId,
      updatedBy: userId,
      shortId: nextNumber,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } )
    transaction.set( versionRef, {
      projectId,
      docId: changeRequestRef.id,
      number: FIRST_VERSION_NUMBER,
      status: 'In Creation',
      createdBy: userId,
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
      createdAt: serverTimestamp(),
      activityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: userId,
    } )
    transaction.set(
      versionCounterRef,
      {
        nextNumber: FIRST_VERSION_NUMBER + 1,
        docId: changeRequestRef.id,
        projectId,
        previousVersionId: null,
      },
      { merge: true },
    )
  } )
  logAudit( {
    actorId: userId,
    actorEmail: userEmail ?? null,
    action: 'createChangeRequest',
    entityType: 'document',
    entityId: changeRequestRef.id,
    projectId,
    docId: changeRequestRef.id,
    versionId: versionRef.id,
    metadata: {
      baseProjectId: selectedBaseVersion.projectId,
      baseDocId: selectedBaseVersion.docId,
      baseVersionId: selectedBaseVersion.versionId,
    },
  } ).catch( ( err ) => {
    console.warn( 'Audit log failed (create change request):', err )
  } )
  return { docId: changeRequestRef.id, versionId: versionRef.id }
}

export {
  createChangeRequestDocument,
  loadAcceptedBaseVersions,
  loadChangeRequestBaseProjects,
}
export type {
  ChangeRequestBaseProject,
  ChangeRequestBaseVersion,
}
