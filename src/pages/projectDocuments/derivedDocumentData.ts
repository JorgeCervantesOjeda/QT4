// src/pages/projectDocuments/derivedDocumentData.ts
// Creates derived-document shells from the active cross-project change-request configuration.
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { FIRST_VERSION_NUMBER } from '../../domain/types'
import { logAudit } from '../../lib/audit'
import {
  ACCEPTED_DERIVED_DOCUMENT_MESSAGE,
  DERIVED_GENERATION_IN_PROGRESS_MESSAGE,
  buildDerivationLineKey,
  type ActiveConfigurationLine,
} from '../../lib/documentDerivation'
import { db } from '../../lib/firebase'

type CreateDerivedDocumentParams = {
  line: ActiveConfigurationLine
  title: string
  userEmail?: string | null
  userId: string
}

const createDerivedDocument = async (
  params: CreateDerivedDocumentParams,
): Promise<{ docId: string; versionId: string }> => {
  const { line, title, userEmail, userId } = params
  const counterRef = doc( db, 'counters', `documents_${line.variantProjectId}` )
  const documentRef = doc( collection( db, 'documents' ) )
  const versionRef = doc( collection( db, 'versions' ) )
  const versionCounterRef = doc( db, 'counters', `versions_${documentRef.id}` )
  const lineKey = buildDerivationLineKey( line )
  const derivedConfigurationRef = doc( db, 'derivedConfigurations', lineKey )
  await runTransaction( db, async ( transaction ) => {
    const [ counterSnap, derivedConfigurationSnap ] = await Promise.all( [
      transaction.get( counterRef ),
      transaction.get( derivedConfigurationRef ),
    ] )
    const derivedConfiguration = derivedConfigurationSnap.data?.() ?? {}
    if( derivedConfiguration.status === 'Accepted' ) {
      throw new Error( ACCEPTED_DERIVED_DOCUMENT_MESSAGE )
    }
    if( derivedConfiguration.generationStatus === 'generating' ) {
      throw new Error( DERIVED_GENERATION_IN_PROGRESS_MESSAGE )
    }
    const nextNumberRaw = counterSnap.data()?.nextNumber
    const nextNumber = typeof nextNumberRaw === 'number' ? nextNumberRaw : 1
    transaction.set(
      counterRef,
      {
        nextNumber: nextNumber + 1,
        projectId: line.variantProjectId,
      },
      { merge: true },
    )
    transaction.set( documentRef, {
      projectId: line.variantProjectId,
      title: title.trim(),
      type: 'derivedDocument',
      originProjectId: line.originProjectId,
      originDocumentId: line.originDocumentId,
      originVersionId: line.originVersionId,
      incorporatedChangeRequestVersionIds: line.changeRequestVersionIds,
      createdBy: userId,
      authorId: userId,
      updatedBy: userId,
      shortId: nextNumber,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } )
    transaction.set( versionRef, {
      projectId: line.variantProjectId,
      docId: documentRef.id,
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
        docId: documentRef.id,
        projectId: line.variantProjectId,
        previousVersionId: null,
      },
      { merge: true },
    )
    transaction.set(
      derivedConfigurationRef,
      {
        key: lineKey,
        projectId: line.variantProjectId,
        originProjectId: line.originProjectId,
        originDocumentId: line.originDocumentId,
        originVersionId: line.originVersionId,
        activeChangeRequestVersionIds: line.changeRequestVersionIds,
        derivedDocumentId: documentRef.id,
        derivedVersionId: versionRef.id,
        status: 'Generated',
        generationStatus: 'generated',
        createdBy: userId,
        updatedBy: userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
  } )
  logAudit( {
    actorId: userId,
    actorEmail: userEmail ?? null,
    action: 'createDerivedDocument',
    entityType: 'document',
    entityId: documentRef.id,
    projectId: line.variantProjectId,
    docId: documentRef.id,
    versionId: versionRef.id,
    metadata: {
      originProjectId: line.originProjectId,
      originDocumentId: line.originDocumentId,
      originVersionId: line.originVersionId,
      incorporatedChangeRequestVersionIds: line.changeRequestVersionIds,
    },
  } ).catch( ( err ) => {
    console.warn( 'Audit log failed (create derived document):', err )
  } )
  return { docId: documentRef.id, versionId: versionRef.id }
}

export { createDerivedDocument }
export type { CreateDerivedDocumentParams }
