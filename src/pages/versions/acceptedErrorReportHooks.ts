// Keeps accepted error-report gate state in sync with the selected base version.
import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AcceptedErrorReportSummary, VersionSummary } from './types'

type AcceptedErrorReportsStatus = 'idle' | 'loading' | 'ready' | 'error'

type ErrorReportGate = {
  isBlocking: boolean
  isLoading: boolean
}

type VersionsErrorSource = 'firestore' | 'storage' | 'auth' | 'ui' | 'network' | 'unknown'

type UseAcceptedErrorReportsParams = {
  projectId: string
  latestVersion: VersionSummary | null
  selectedVersion: VersionSummary | null
  loadAcceptedErrorReportsForBaseVersion: (
    activeProjectId: string,
    baseVersionId: string,
  ) => Promise<AcceptedErrorReportSummary[]>
  reportVersionsError: (error: unknown, action: string, source?: VersionsErrorSource) => void
  setAcceptedErrorReports: Dispatch<SetStateAction<AcceptedErrorReportSummary[]>>
  setAcceptedErrorReportsStatus: Dispatch<SetStateAction<AcceptedErrorReportsStatus>>
  setErrorReportGate: Dispatch<SetStateAction<ErrorReportGate>>
}

function useAcceptedErrorReports( {
  projectId,
  latestVersion,
  selectedVersion,
  loadAcceptedErrorReportsForBaseVersion,
  reportVersionsError,
  setAcceptedErrorReports,
  setAcceptedErrorReportsStatus,
  setErrorReportGate,
}: UseAcceptedErrorReportsParams ) {
  useEffect( () => {
    let isActive = true
    const selectedVersionId = selectedVersion?.id ?? ''
    if( !projectId || !selectedVersionId ) {
      setAcceptedErrorReports( [] )
      setAcceptedErrorReportsStatus( 'idle' )
      return () => {
        isActive = false
      }
    }

    setAcceptedErrorReportsStatus( 'loading' )
    void loadAcceptedErrorReportsForBaseVersion( projectId, selectedVersionId )
      .then( ( reports ) => {
        if( !isActive ) {
          return
        }
        setAcceptedErrorReports( reports )
        setAcceptedErrorReportsStatus( 'ready' )
      } )
      .catch( ( err ) => {
        if( !isActive ) {
          return
        }
        reportVersionsError( err, 'versions.loadSelectedAcceptedErrorReports', 'firestore' )
        setAcceptedErrorReports( [] )
        setAcceptedErrorReportsStatus( 'error' )
      } )

    return () => {
      isActive = false
    }
  }, [
    projectId,
    selectedVersion?.id,
    loadAcceptedErrorReportsForBaseVersion,
    reportVersionsError,
    setAcceptedErrorReports,
    setAcceptedErrorReportsStatus,
  ] )

  useEffect( () => {
    let isActive = true
    const latestVersionId = latestVersion?.id ?? ''
    if( !projectId || !latestVersionId || latestVersion?.status !== 'Accepted' ) {
      setErrorReportGate( { isBlocking: false, isLoading: false } )
      return () => {
        isActive = false
      }
    }

    setErrorReportGate( { isBlocking: true, isLoading: true } )
    void loadAcceptedErrorReportsForBaseVersion( projectId, latestVersionId )
      .then( ( reports ) => {
        if( !isActive ) {
          return
        }
        setErrorReportGate( { isBlocking: reports.length === 0, isLoading: false } )
      } )
      .catch( ( err ) => {
        if( !isActive ) {
          return
        }
        reportVersionsError( err, 'versions.loadLatestAcceptedErrorReportsGate', 'firestore' )
        setErrorReportGate( { isBlocking: true, isLoading: false } )
      } )

    return () => {
      isActive = false
    }
  }, [
    projectId,
    latestVersion?.id,
    latestVersion?.status,
    loadAcceptedErrorReportsForBaseVersion,
    reportVersionsError,
    setErrorReportGate,
  ] )
}

export default useAcceptedErrorReports
