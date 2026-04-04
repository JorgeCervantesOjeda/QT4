import {
  DELETE_FIELD_SENTINEL,
  FakeTimestamp,
  SERVER_TIMESTAMP_SENTINEL,
  deleteDocData,
  generateId,
  getCollectionDocs,
  getDocData,
  readComparable,
  setDocData,
  updateDocData,
} from './state'
import { consumeInjectedFault } from './faults'

type Direction = 'asc' | 'desc'

type CollectionReference = {
  kind: 'collection'
  path: string
  id: string
}

type DocumentReference = {
  kind: 'doc'
  path: string
  id: string
}

type QueryConstraint =
  | { type: 'where'; field: string; operator: '==' | '>=' | '<=' | 'in' | 'array-contains'; value: unknown }
  | { type: 'orderBy'; field: string; direction: Direction }
  | { type: 'limit'; count: number }

type QueryReference = {
  kind: 'query'
  path: string
  constraints: QueryConstraint[]
}

type FakeDocumentSnapshot = {
  id: string
  exists: () => boolean
  data: () => Record<string, unknown>
}

type FakeQuerySnapshot = {
  docs: FakeDocumentSnapshot[]
  empty: boolean
  size: number
  forEach: (callback: (snapshot: FakeDocumentSnapshot) => void) => void
}

class QuerySnapshot {}

type Listener = {
  key: number
  target: DocumentReference | QueryReference
  callback: (snapshot: FakeDocumentSnapshot | FakeQuerySnapshot) => void
}

type BatchOperation =
  | { type: 'set'; ref: DocumentReference; data: Record<string, unknown>; merge: boolean }
  | { type: 'update'; ref: DocumentReference; data: Record<string, unknown> }
  | { type: 'delete'; ref: DocumentReference }

const db = { kind: 'db' as const, path: '' }
const listeners = new Map<number, Listener>()
let nextListenerKey = 1

const makeDocSnapshot = (ref: DocumentReference): FakeDocumentSnapshot => {
  const data = getDocData( ref.path )
  return {
    id: ref.id,
    exists: () => Boolean( data ),
    data: () => ( data ? structuredCloneFallback( data ) : {} ),
  }
}

const makeQuerySnapshot = (target: CollectionReference | QueryReference): FakeQuerySnapshot => {
  const queryRef = target.kind === 'query' ? target : query( target )
  const docs = applyQuery( queryRef ).map( (entry) => makeDocSnapshot( { kind: 'doc', path: entry.path, id: entry.id } ) )
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: (callback) => {
      docs.forEach( callback )
    },
  }
}

const structuredCloneFallback = <T,>(value: T): T => {
  if( value instanceof FakeTimestamp ) {
    return FakeTimestamp.fromDate( value.toDate() ) as T
  }
  if( value instanceof Date ) {
    return new Date( value.getTime() ) as T
  }
  if( Array.isArray( value ) ) {
    return value.map( ( item ) => structuredCloneFallback( item ) ) as T
  }
  if( value && typeof value === 'object' ) {
    return Object.fromEntries(
      Object.entries( value as Record<string, unknown> ).map( ( [ key, entryValue ] ) => [ key, structuredCloneFallback( entryValue ) ] ),
    ) as T
  }
  return value
}

const collection = (
  source: typeof db | DocumentReference,
  ...segments: string[]
): CollectionReference => {
  const basePath = source.kind === 'doc' ? source.path : ''
  const path = [ basePath, ...segments ].filter( Boolean ).join( '/' )
  return {
    kind: 'collection',
    path,
    id: path.split( '/' ).at( -1 ) ?? '',
  }
}

const doc = (
  source: typeof db | CollectionReference,
  ...segments: string[]
): DocumentReference => {
  if( source.kind === 'collection' && segments.length === 0 ) {
    const generatedId = generateId( source.id || 'doc' )
    return {
      kind: 'doc',
      path: `${source.path}/${generatedId}`,
      id: generatedId,
    }
  }
  const basePath = source.kind === 'collection' ? source.path : ''
  const path = [ basePath, ...segments ].filter( Boolean ).join( '/' )
  return {
    kind: 'doc',
    path,
    id: path.split( '/' ).at( -1 ) ?? '',
  }
}

const where = (field: string, operator: '==' | '>=' | '<=' | 'in' | 'array-contains', value: unknown): QueryConstraint => ( {
  type: 'where',
  field,
  operator,
  value,
} )

const orderBy = (field: string, direction: Direction = 'asc'): QueryConstraint => ( {
  type: 'orderBy',
  field,
  direction,
} )

const limit = (count: number): QueryConstraint => ( {
  type: 'limit',
  count,
} )

const query = (
  source: CollectionReference,
  ...constraints: QueryConstraint[]
): QueryReference => ( {
  kind: 'query',
  path: source.path,
  constraints,
} )

const applyQuery = (queryRef: QueryReference) => {
  let docs = getCollectionDocs( queryRef.path )
  queryRef.constraints.forEach( (constraint) => {
    if( constraint.type === 'where' ) {
      docs = docs.filter( (entry) => {
        const candidate = entry.data[constraint.field]
        if( constraint.operator === '==' ) {
          return readComparable( candidate ) === readComparable( constraint.value )
        }
        if( constraint.operator === '>=' ) {
          return Number( readComparable( candidate ) ) >= Number( readComparable( constraint.value ) )
        }
        if( constraint.operator === '<=' ) {
          return Number( readComparable( candidate ) ) <= Number( readComparable( constraint.value ) )
        }
        if( constraint.operator === 'in' ) {
          return Array.isArray( constraint.value ) && constraint.value.some( ( item ) => readComparable( item ) === readComparable( candidate ) )
        }
        if( constraint.operator === 'array-contains' ) {
          return Array.isArray( candidate ) && candidate.some( ( item ) => readComparable( item ) === readComparable( constraint.value ) )
        }
        return false
      } )
    }
    if( constraint.type === 'orderBy' ) {
      docs = [ ...docs ].sort( (left, right) => {
        const leftValue = readComparable( left.data[constraint.field] )
        const rightValue = readComparable( right.data[constraint.field] )
        if( leftValue === rightValue ) {
          return 0
        }
        if( leftValue === undefined || leftValue === null ) {
          return 1
        }
        if( rightValue === undefined || rightValue === null ) {
          return -1
        }
        const result = leftValue < rightValue ? -1 : 1
        return constraint.direction === 'desc' ? -result : result
      } )
    }
    if( constraint.type === 'limit' ) {
      docs = docs.slice( 0, constraint.count )
    }
  } )
  return docs
}

const getDoc = async (ref: DocumentReference): Promise<FakeDocumentSnapshot> => {
  const fault = consumeInjectedFault( 'firestore.getDoc', ref.path )
  if( fault ) {
    throw fault
  }
  return makeDocSnapshot( ref )
}

const getDocFromServer = async (ref: DocumentReference): Promise<FakeDocumentSnapshot> => getDoc( ref )

const getFirestore = () => db

const connectFirestoreEmulator = () => undefined

const getDocs = async (
  target: CollectionReference | QueryReference,
): Promise<FakeQuerySnapshot> => {
  const fault = consumeInjectedFault( 'firestore.getDocs', target.path )
  if( fault ) {
    throw fault
  }
  return makeQuerySnapshot( target )
}

const serverTimestamp = () => SERVER_TIMESTAMP_SENTINEL

const deleteField = () => DELETE_FIELD_SENTINEL

const setDoc = async (
  ref: DocumentReference,
  data: Record<string, unknown>,
  options?: { merge?: boolean },
) => {
  setDocData( ref.path, data, Boolean( options?.merge ) )
  emitSnapshots()
}

const addDoc = async (
  collectionRef: CollectionReference,
  data: Record<string, unknown>,
) => {
  const ref = doc( collectionRef )
  await setDoc( ref, data )
  return ref
}

const updateDoc = async (
  ref: DocumentReference,
  data: Record<string, unknown>,
) => {
  updateDocData( ref.path, data )
  emitSnapshots()
}

const writeBatch = () => {
  const operations: BatchOperation[] = []
  return {
    set: (ref: DocumentReference, data: Record<string, unknown>, options?: { merge?: boolean }) => {
      operations.push( { type: 'set', ref, data, merge: Boolean( options?.merge ) } )
    },
    update: (ref: DocumentReference, data: Record<string, unknown>) => {
      operations.push( { type: 'update', ref, data } )
    },
    delete: (ref: DocumentReference) => {
      operations.push( { type: 'delete', ref } )
    },
    commit: async () => {
      applyOperations( operations )
      emitSnapshots()
    },
  }
}

const runTransaction = async (
  database: typeof db,
  callback: (transaction: {
    get: (ref: DocumentReference) => Promise<FakeDocumentSnapshot>
    set: (ref: DocumentReference, data: Record<string, unknown>, options?: { merge?: boolean }) => void
    update: (ref: DocumentReference, data: Record<string, unknown>) => void
    delete: (ref: DocumentReference) => void
  }) => Promise<void>,
) => {
  void database
  const operations: BatchOperation[] = []
  await callback( {
    get: async (ref) => getDoc( ref ),
    set: (ref, data, options) => {
      operations.push( { type: 'set', ref, data, merge: Boolean( options?.merge ) } )
    },
    update: (ref, data) => {
      operations.push( { type: 'update', ref, data } )
    },
    delete: (ref) => {
      operations.push( { type: 'delete', ref } )
    },
  } )
  applyOperations( operations )
  emitSnapshots()
}

const applyOperations = (operations: BatchOperation[]) => {
  operations.forEach( (operation) => {
    if( operation.type === 'set' ) {
      setDocData( operation.ref.path, operation.data, operation.merge )
      return
    }
    if( operation.type === 'update' ) {
      updateDocData( operation.ref.path, operation.data )
      return
    }
    deleteDocData( operation.ref.path )
  } )
}

const onSnapshot = (
  target: DocumentReference | QueryReference | CollectionReference,
  callback: (snapshot: FakeDocumentSnapshot | FakeQuerySnapshot) => void,
  onError?: (error: Error) => void,
) => {
  const normalizedTarget = target.kind === 'collection' ? query( target ) : target
  const fault = consumeInjectedFault( 'firestore.onSnapshot', normalizedTarget.path )
  if( fault ) {
    if( onError ) {
      onError( fault )
      return () => undefined
    }
    throw fault
  }
  const key = nextListenerKey
  nextListenerKey += 1
  listeners.set( key, {
    key,
    target: normalizedTarget,
    callback,
  } )
  callback( normalizedTarget.kind === 'doc' ? makeDocSnapshot( normalizedTarget ) : makeQuerySnapshot( normalizedTarget ) )
  return () => {
    listeners.delete( key )
  }
}

const emitSnapshots = () => {
  listeners.forEach( (listener) => {
    listener.callback(
      listener.target.kind === 'doc'
        ? makeDocSnapshot( listener.target )
        : makeQuerySnapshot( listener.target ),
    )
  } )
}

const enableNetwork = async () => undefined
const disableNetwork = async () => undefined

export {
  FakeTimestamp as Timestamp,
  QuerySnapshot,
  addDoc,
  collection,
  connectFirestoreEmulator,
  db,
  deleteField,
  disableNetwork,
  doc,
  enableNetwork,
  getFirestore,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
}
