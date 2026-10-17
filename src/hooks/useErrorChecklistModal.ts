import { useCallback, useState } from 'react'
import type { ChecklistItem } from '../components/ErrorChecklistModal'

function useErrorChecklistModal() {
  const [error, setError] = useState<string | null>( null )
  const [errorChecklist, setErrorChecklist] = useState<ChecklistItem[]>( [] )
  const [errorTitle, setErrorTitle] = useState<string | null>( null )

  const openError = useCallback( (message: string, checklist: ChecklistItem[] = [], title: string | null = null ) => {
    setError( message )
    setErrorChecklist( checklist )
    setErrorTitle( title )
  }, [] )

  const clearError = useCallback( () => {
    setError( null )
    setErrorChecklist( [] )
    setErrorTitle( null )
  }, [] )

  return {
    error,
    errorChecklist,
    errorTitle,
    setError,
    setErrorChecklist,
    openError,
    clearError,
  }
}

export { useErrorChecklistModal }
