export type ClientDiagnosticEvent = {
  type: string
  timestamp: string
  data: Record<string, unknown>
}

const MAX_DIAGNOSTIC_EVENTS = 200

const diagnosticBuffer: ClientDiagnosticEvent[] = []

export function logClientDiagnostic(
  type: string,
  data: Record<string, unknown> = {},
): void {
  const event: ClientDiagnosticEvent = {
    type,
    timestamp: new Date().toISOString(),
    data,
  }

  diagnosticBuffer.push( event )

  if( diagnosticBuffer.length > MAX_DIAGNOSTIC_EVENTS ) {
    diagnosticBuffer.shift()
  }

  if( import.meta.env.DEV || window.location.search.includes( 'debugDiagnostics=1' ) ) {
    console.debug( `[diagnostic] ${type}`, data )
  }
}

export function getRecentDiagnostics(): ClientDiagnosticEvent[] {
  return [ ...diagnosticBuffer ]
}