// Document title edit modal state and Firestore update flow.
import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { logAudit } from '../../lib/audit'
import { db } from '../../lib/firebase'
import type { DocumentSummary } from './types'

type UseDocumentTitleEditingParams = {
  docId: string | undefined
  projectId: string
  documentData: DocumentSummary | null
  userId: string
  userEmail?: string | null
  canEditDocumentTitle: boolean
  setDocumentData: Dispatch<SetStateAction<DocumentSummary | null>>
  setIsBusy: Dispatch<SetStateAction<boolean>>
  setSuccessEmailRecipients: Dispatch<SetStateAction<{ to: string[]; cc: string[] } | null>>
  setSuccessMessage: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
}

function useDocumentTitleEditing( {
  docId,
  projectId,
  documentData,
  userId,
  userEmail,
  canEditDocumentTitle,
  setDocumentData,
  setIsBusy,
  setSuccessEmailRecipients,
  setSuccessMessage,
  setError,
}: UseDocumentTitleEditingParams ) {
  const [isDocumentTitleModalOpen, setIsDocumentTitleModalOpen] = useState( false )
  const [documentTitleDraft, setDocumentTitleDraft] = useState( '' )
  const [documentTitleError, setDocumentTitleError] = useState<string | null>( null )

  const requestDocumentTitleEdit = useCallback( () => {
    if( !documentData ) {
      return
    }
    setDocumentTitleDraft( documentData.title )
    setDocumentTitleError( null )
    setIsDocumentTitleModalOpen( true )
  }, [ documentData ] )

  const closeDocumentTitleModal = useCallback( () => {
    setIsDocumentTitleModalOpen( false )
    setDocumentTitleError( null )
  }, [] )

  const handleSaveDocumentTitle = useCallback( async () => {
    if( !docId || !documentData || !userId ) {
      setDocumentTitleError( 'Sign in and select a document before editing the title.' )
      return
    }
    if( !canEditDocumentTitle ) {
      setDocumentTitleError( 'Only the author, project leader, or admin can edit the document title.' )
      return
    }
    const trimmedTitle = documentTitleDraft.trim()
    if( trimmedTitle.length === 0 ) {
      setDocumentTitleError( 'Document title cannot be empty.' )
      return
    }
    if( trimmedTitle === documentData.title ) {
      setIsDocumentTitleModalOpen( false )
      setDocumentTitleError( null )
      return
    }
    setDocumentTitleError( null )
    setError( null )
    setSuccessMessage( null )
    setIsBusy( true )
    try {
      await updateDoc( doc( db, 'documents', docId ), {
        title: trimmedTitle,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      } )
      setDocumentData( ( previous ) => previous ? { ...previous, title: trimmedTitle } : previous )
      setIsDocumentTitleModalOpen( false )
      setSuccessEmailRecipients( null )
      setSuccessMessage( 'Document title updated successfully.' )
      void logAudit( {
        actorId: userId,
        actorEmail: userEmail ?? null,
        action: 'updateDocumentTitle',
        entityType: 'document',
        entityId: docId,
        projectId,
        docId,
        metadata: {
          title: trimmedTitle,
        },
      } ).catch( ( err ) => {
        console.warn( 'Audit log failed (update document title):', err )
      } )
    } catch( err ) {
      const message = err instanceof Error ? err.message : 'Unexpected error'
      setDocumentTitleError( message )
    } finally {
      setIsBusy( false )
    }
  }, [
    docId,
    documentData,
    userId,
    canEditDocumentTitle,
    documentTitleDraft,
    userEmail,
    projectId,
    setDocumentData,
    setError,
    setIsBusy,
    setSuccessEmailRecipients,
    setSuccessMessage,
  ] )

  return {
    isDocumentTitleModalOpen,
    documentTitleDraft,
    documentTitleError,
    setDocumentTitleDraft,
    requestDocumentTitleEdit,
    closeDocumentTitleModal,
    handleSaveDocumentTitle,
  }
}

export default useDocumentTitleEditing
