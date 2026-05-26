// Live document and file metadata subscriptions used by the selected version file panel.
import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { doc, getDoc, getDocFromServer, onSnapshot } from 'firebase/firestore'
import { trackFirestoreListener } from '../../lib/diagnostics/firestoreListeners'
import { db } from '../../lib/firebase'
import { normalizeFileStorageProvider } from '../../lib/runtimeConfig'
import type { DocumentSummary, FileRefSummary, VersionSummary } from './types'
import { isPermissionDeniedError } from './utils'

type BaseDocumentSummary = {
  id: string
  title: string
  shortId: number | null
}

type VersionsErrorReporter = (
  error: unknown,
  action: string,
  source?: 'firestore' | 'storage' | 'auth' | 'ui' | 'network' | 'unknown',
) => void

type UseDocumentSubscriptionParams = {
  docId: string | undefined
  projectIdFromQuery: string
  setDocumentData: Dispatch<SetStateAction<DocumentSummary | null>>
  setVersions: Dispatch<SetStateAction<VersionSummary[]>>
  setBaseDocumentData: Dispatch<SetStateAction<BaseDocumentSummary | null>>
  setError: Dispatch<SetStateAction<string | null>>
}

function useDocumentSubscription( {
  docId,
  projectIdFromQuery,
  setDocumentData,
  setVersions,
  setBaseDocumentData,
  setError,
}: UseDocumentSubscriptionParams ) {
  useEffect( () => {
    if( !docId ) {
      return
    }
    const listener = trackFirestoreListener( {
      label: 'versions.document',
      projectId: projectIdFromQuery,
      documentId: docId,
      queryDescription: `documents/${docId}`,
    } )
    const unsubscribe = onSnapshot(
      doc( db, 'documents', docId ),
      ( snapshot ) => {
        listener.recordSnapshot( {
          exists: snapshot.exists(),
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
        } )
        if( !snapshot.exists() ) {
          setDocumentData( null )
          setVersions( [] )
          setError( 'Document not found.' )
          return
        }
        const data = snapshot.data()
        const loadedProjectId = ( data.projectId as string ) ?? projectIdFromQuery
        const loadedAuthorId = ( data.createdBy as string ) ?? ( data.authorId as string ) ?? ''
        const detectedShortId = Number.isFinite( data.shortId ) ? Number( data.shortId ) : null
        const nextBaseDocId = ( data.baseDocId as string | undefined ) ?? null
        const nextBaseVersionId = ( data.baseVersionId as string | undefined ) ?? null
        setDocumentData( {
          id: snapshot.id,
          projectId: loadedProjectId,
          title: ( data.title as string ) ?? 'Untitled document',
          createdBy: loadedAuthorId,
          authorId: ( data.authorId as string | undefined ) ?? loadedAuthorId,
          type: ( data.type as string | undefined ) ?? 'document',
          shortId: detectedShortId,
          baseDocId: nextBaseDocId,
          baseVersionId: nextBaseVersionId,
        } )
        if( ( data.type as string | undefined ) === 'errorReport' && ( !nextBaseDocId || !nextBaseVersionId ) ) {
          setVersions( [] )
          setBaseDocumentData( null )
          setError( 'Invalid error report data: baseDocId and baseVersionId are required.' )
          return
        }
        if( ( data.type as string | undefined ) === 'errorReport' && nextBaseDocId ) {
          void loadBaseDocumentSummary( nextBaseDocId, setBaseDocumentData )
        }
      },
      ( err ) => {
        listener.recordError( err )
        const message = err instanceof Error ? err.message : 'Unexpected error'
        setError( `Document failed to load: ${message}` )
      },
    )
    return () => {
      listener.dispose()
      unsubscribe()
    }
  }, [ docId, projectIdFromQuery, setBaseDocumentData, setDocumentData, setError, setVersions ] )
}

async function loadBaseDocumentSummary(
  baseDocId: string,
  setBaseDocumentData: Dispatch<SetStateAction<BaseDocumentSummary | null>>,
) {
  try {
    const baseDocSnapshot = await getDocFromServer( doc( db, 'documents', baseDocId ) )
    if( baseDocSnapshot.exists() ) {
      const baseDocData = baseDocSnapshot.data()
      setBaseDocumentData( {
        id: baseDocSnapshot.id,
        title: ( baseDocData?.title as string | undefined ) ?? 'Untitled document',
        shortId: Number.isFinite( baseDocData?.shortId ) ? Number( baseDocData?.shortId ) : null,
      } )
    }
  } catch {
    // Optional context only; the main document subscription remains valid.
  }
}

type UseSelectedFileMetadataParams = {
  selectedVersion: VersionSummary | null
  projectId: string
  docId: string | undefined
  localFileRefByIdRef: MutableRefObject<Map<string, FileRefSummary>>
  reportVersionsErrorRef: MutableRefObject<VersionsErrorReporter>
  setSelectedFileRef: Dispatch<SetStateAction<FileRefSummary | null>>
  setFileMetadataNotice: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
}

function useSelectedFileMetadata( {
  selectedVersion,
  projectId,
  docId,
  localFileRefByIdRef,
  reportVersionsErrorRef,
  setSelectedFileRef,
  setFileMetadataNotice,
  setError,
}: UseSelectedFileMetadataParams ) {
  useEffect( () => {
    let isActive = true
    const fileRefId = selectedVersion?.fileRefId ?? null
    if( !fileRefId ) {
      setSelectedFileRef( null )
      setFileMetadataNotice( null )
      return () => {
        isActive = false
      }
    }
    const localFileRef = localFileRefByIdRef.current.get( fileRefId )
    if( localFileRef ) {
      setSelectedFileRef( localFileRef )
      setFileMetadataNotice( null )
      return () => {
        isActive = false
      }
    }
    void loadSelectedFileMetadata( {
      selectedVersion,
      fileRefId,
      projectId,
      docId,
      isActive: () => isActive,
      reportVersionsErrorRef,
      setSelectedFileRef,
      setFileMetadataNotice,
      setError,
    } )
    return () => {
      isActive = false
    }
  }, [
    selectedVersion?.fileRefId,
    selectedVersion,
    projectId,
    docId,
    localFileRefByIdRef,
    reportVersionsErrorRef,
    setSelectedFileRef,
    setFileMetadataNotice,
    setError,
  ] )
}

type LoadSelectedFileMetadataParams = {
  selectedVersion: VersionSummary | null
  fileRefId: string
  projectId: string
  docId: string | undefined
  isActive: () => boolean
  reportVersionsErrorRef: MutableRefObject<VersionsErrorReporter>
  setSelectedFileRef: Dispatch<SetStateAction<FileRefSummary | null>>
  setFileMetadataNotice: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
}

async function loadSelectedFileMetadata( {
  selectedVersion,
  fileRefId,
  projectId,
  docId,
  isActive,
  reportVersionsErrorRef,
  setSelectedFileRef,
  setFileMetadataNotice,
  setError,
}: LoadSelectedFileMetadataParams ) {
  try {
    const snapshot = await getDoc( doc( db, 'files', fileRefId ) )
    if( !snapshot.exists() ) {
      if( isActive() ) {
        setSelectedFileRef( null )
        setFileMetadataNotice( 'The linked file metadata no longer exists. Upload or replace the file to restore access.' )
      }
      return
    }
    const data = snapshot.data()
    if( isActive() ) {
      setSelectedFileRef( {
        id: snapshot.id,
        fileKey: ( data.fileKey as string ) ?? '',
        fileName: ( data.fileName as string ) ?? '',
        contentType: ( data.contentType as string | undefined ) ?? 'application/octet-stream',
        sizeBytes: Number( data.sizeBytes ?? 0 ),
        isPermanent: Boolean( data.isPermanent ),
        expireAfterDays: typeof data.expireAfterDays === 'number' ? Number( data.expireAfterDays ) : null,
        storageProvider: normalizeFileStorageProvider( data.storageProvider ),
        createdBy: ( data.createdBy as string ) ?? '',
        projectId: ( data.projectId as string ) ?? '',
        docId: ( data.docId as string ) ?? '',
        versionId: ( data.versionId as string ) ?? '',
      } )
      setFileMetadataNotice( null )
    }
  } catch( err ) {
    if( !isActive() ) {
      return
    }
    if( isPermissionDeniedError( err ) ) {
      console.warn( 'File metadata read denied', {
        versionId: selectedVersion?.id ?? null,
        fileRefId,
        projectId: projectId || null,
        docId: docId ?? null,
        hasFile: selectedVersion?.hasFile ?? false,
      } )
      reportVersionsErrorRef.current( err, 'versions.loadFileMetadata', 'firestore' )
      setSelectedFileRef( null )
      setFileMetadataNotice( 'You do not have permission to read linked file metadata for this version.' )
      return
    }
    setFileMetadataNotice( null )
    const message = err instanceof Error ? err.message : 'Unexpected error'
    reportVersionsErrorRef.current( err, 'versions.loadFileMetadata', 'firestore' )
    setError( `File metadata failed to load: ${message}` )
  }
}

export { useDocumentSubscription, useSelectedFileMetadata }
