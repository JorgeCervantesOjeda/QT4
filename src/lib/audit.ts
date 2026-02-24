import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

export type AuditLogEntry = {
  actorId: string
  actorEmail?: string | null
  action: string
  entityType: string
  entityId: string
  projectId?: string
  docId?: string
  versionId?: string
  threadId?: string
  commentId?: string
  targetUserId?: string
  metadata?: Record<string, unknown>
}

export const logAudit = async (entry: AuditLogEntry): Promise<void> => {
  if( !entry.actorId ) {
    return
  }
  try {
    await addDoc( collection( db, 'auditLogs' ), {
      ...entry,
      createdAt: serverTimestamp(),
    } )
  } catch( err ) {
    console.warn( 'Audit log write failed:', err )
  }
}
