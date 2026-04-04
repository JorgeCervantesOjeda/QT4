import { getState, persistState } from './state'

type FakeStorageRef = {
  path: string
}

const getStorage = () => ( {
  kind: 'qt4-e2e-storage',
} )

const connectStorageEmulator = () => undefined

const ref = (
  storage: ReturnType<typeof getStorage>,
  path: string,
): FakeStorageRef => {
  void storage
  return { path }
}

const uploadBytes = async (
  storageRef: FakeStorageRef,
  file: File,
  metadata?: { contentType?: string },
) => {
  getState().storage.set( storageRef.path, {
    fileName: file.name,
    contentType: metadata?.contentType ?? file.type ?? 'application/octet-stream',
    sizeBytes: file.size,
  } )
  persistState()
  return {
    ref: storageRef,
  }
}

const getDownloadURL = async (storageRef: FakeStorageRef) => {
  const record = getState().storage.get( storageRef.path )
  if( !record ) {
    const error = new Error( 'Object not found.' ) as Error & { code: string }
    error.code = 'storage/object-not-found'
    throw error
  }
  return `data:${record.contentType};base64,`
}

const deleteObject = async (storageRef: FakeStorageRef) => {
  const exists = getState().storage.delete( storageRef.path )
  if( !exists ) {
    const error = new Error( 'Object not found.' ) as Error & { code: string }
    error.code = 'storage/object-not-found'
    throw error
  }
  persistState()
}

export { connectStorageEmulator, deleteObject, getDownloadURL, getStorage, ref, uploadBytes }
