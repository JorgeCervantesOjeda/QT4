type TestFault = {
  operation: string
  pathIncludes?: string
  message: string
  code?: string
  once?: boolean
}

const TEST_FAULTS_STORAGE_KEY = 'qt4_test_faults_v1'
const isFaultInjectionEnabled = import.meta.env.MODE === 'emulator'

const readFaults = (): TestFault[] => {
  if( !isFaultInjectionEnabled || typeof window === 'undefined' ) {
    return []
  }
  try {
    const raw = window.localStorage.getItem( TEST_FAULTS_STORAGE_KEY )
    if( !raw ) {
      return []
    }
    const parsed = JSON.parse( raw ) as TestFault[]
    return Array.isArray( parsed ) ? parsed : []
  } catch {
    return []
  }
}

const writeFaults = (faults: TestFault[]) => {
  if( !isFaultInjectionEnabled || typeof window === 'undefined' ) {
    return
  }
  try {
    if( faults.length === 0 ) {
      window.localStorage.removeItem( TEST_FAULTS_STORAGE_KEY )
      return
    }
    window.localStorage.setItem( TEST_FAULTS_STORAGE_KEY, JSON.stringify( faults ) )
  } catch {
    // ignore storage errors
  }
}

const createFaultError = (fault: TestFault): Error & { code?: string } => {
  const error = new Error( fault.message ) as Error & { code?: string }
  if( fault.code ) {
    error.code = fault.code
  }
  return error
}

export const consumeInjectedTestFault = (
  operation: string,
  path: string = '',
): ( Error & { code?: string } ) | null => {
  const faults = readFaults()
  const index = faults.findIndex( ( fault ) =>
    fault.operation === operation &&
    ( !fault.pathIncludes || path.includes( fault.pathIncludes ) ),
  )
  if( index < 0 ) {
    return null
  }
  const [ fault ] = faults.splice( index, 1 )
  if( fault.once === false ) {
    faults.splice( index, 0, fault )
  }
  writeFaults( faults )
  return createFaultError( fault )
}
