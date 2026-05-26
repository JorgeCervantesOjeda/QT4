// File metadata, upload, replace, and download controls for the currently selected version.
import type { RefObject } from 'react'
import type { FileStorageProviderKind } from '../../domain/types'
import type { FileRefSummary, VersionSummary } from './types'
import {
  formatFileSize,
  formatStorageProviderLabel,
} from './utils'

type VersionFilePanelProps = {
  selectedVersion: VersionSummary
  selectedFileRef: FileRefSummary | null
  filePanelRef: RefObject<HTMLElement | null>
  uploadInputRef: RefObject<HTMLInputElement | null>
  fileMetadataNotice: string | null
  isBusy: boolean
  canUploadFile: boolean
  uploadStatus: 'idle' | 'uploading' | 'success' | 'error'
  uploadMessage: string
  downloadStatus: 'idle' | 'downloading'
  selectedDownloadProvider: FileStorageProviderKind | null
  onSetError: (message: string) => void
  onUploadFile: (file: File) => void
  onReplaceFile: (file: File) => void
  onDownloadSelectedFile: () => void
}

function VersionFilePanel( {
  selectedVersion,
  selectedFileRef,
  filePanelRef,
  uploadInputRef,
  fileMetadataNotice,
  isBusy,
  canUploadFile,
  uploadStatus,
  uploadMessage,
  downloadStatus,
  selectedDownloadProvider,
  onSetError,
  onUploadFile,
  onReplaceFile,
  onDownloadSelectedFile,
}: VersionFilePanelProps ) {
  return (
    <section ref={filePanelRef} className="panel stack">
      <h3>File</h3>
      {selectedFileRef ? (
        <div className="stack">
          <p className="muted">Name: {selectedFileRef.fileName || 'Unnamed file'}</p>
          <p className="muted">Size: {formatFileSize( selectedFileRef.sizeBytes )}</p>
        </div>
      ) : selectedVersion.hasFile ? (
        <p className="muted">A file is linked to this version, but its metadata is not available in this view.</p>
      ) : (
        <p className="muted">No file linked yet.</p>
      )}
      {fileMetadataNotice ? <p className="muted">{fileMetadataNotice}</p> : null}
      <div className="actions">
        <input
          ref={uploadInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={( event ) => {
            const file = event.target.files?.[0]
            if( file ) {
              if( selectedFileRef ) {
                onReplaceFile( file )
              } else {
                onUploadFile( file )
              }
            }
          }}
          disabled={isBusy}
        />
        <button
          type="button"
          onClick={() => {
            if( !canUploadFile ) {
              onSetError( 'You can upload a file only while the version is In Creation.' )
              return
            }
            uploadInputRef.current?.click()
          }}
          disabled={isBusy}
        >
          {selectedFileRef ? 'Replace file' : 'Upload file'}
        </button>
        {selectedFileRef ? (
          <>
            <button
              type="button"
              onClick={onDownloadSelectedFile}
              disabled={isBusy || downloadStatus === 'downloading'}
            >
              Download file
            </button>
            <span className="download-provider-hint">
              {`From: ${formatStorageProviderLabel( selectedDownloadProvider )}`}
            </span>
          </>
        ) : null}
      </div>
      {uploadStatus === 'uploading' ? <p className="muted">{uploadMessage}</p> : null}
      {uploadStatus === 'success' ? <p className="muted">{uploadMessage}</p> : null}
      {uploadStatus === 'error' ? <p className="error">{uploadMessage}</p> : null}
      <p className="muted">Max size: 20 MB. Uploads are allowed only in In Creation.</p>
    </section>
  )
}

export default VersionFilePanel
