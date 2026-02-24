import { useCallback, useState } from 'react'
import type { ChecklistItem } from '../components/ErrorChecklistModal'

function useErrorChecklistModal() {
  const [error, setError] = useState<string | null>( null )
  const [errorChecklist, setErrorChecklist] = useState<ChecklistItem[]>( [] )

  const openError = useCallback( (message: string, checklist: ChecklistItem[] = [] ) => {
    setError( message )
    setErrorChecklist( checklist )
  }, [] )

  const clearError = useCallback( () => {
    setError( null )
    setErrorChecklist( [] )
  }, [] )

  return {
    error,
    errorChecklist,
    setError,
    setErrorChecklist,
    openError,
    clearError,
  }
}

export { useErrorChecklistModal }
