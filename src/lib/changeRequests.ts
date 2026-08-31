// src/lib/changeRequests.ts
// Defines reusable client-side rules for creating cross-project change requests.
import { versionNumberToString } from '../domain/types'
type ChangeRequestCreationInput = {
  targetProjectId: string
  baseProjectId: string
  baseDocId: string
  baseVersionId: string
  baseVersionStatus: string
  title: string
  userId: string
}

type ChangeRequestCreationValidationResult =
  | { ok: true }
  | { ok: false; message: string }

const SAME_PROJECT_CHANGE_REQUEST_MESSAGE =
  'For changes to accepted requirements inside this same project, create an error report instead.'

const buildChangeRequestTitle = (baseTitle: string, baseVersionNumber?: number | null) => {
  const trimmedTitle = baseTitle.trim()
  const versionLabel = Number.isFinite( baseVersionNumber )
    ? `v${versionNumberToString( Number( baseVersionNumber ) )} - `
    : ''
  return `Change request - ${versionLabel}${trimmedTitle || 'Untitled document'}`
}

const validateChangeRequestCreation = (
  input: ChangeRequestCreationInput,
): ChangeRequestCreationValidationResult => {
  if( !input.userId ) {
    return { ok: false, message: 'Sign in before creating a change request.' }
  }
  if( !input.targetProjectId ) {
    return { ok: false, message: 'Select a target project before creating a change request.' }
  }
  if( !input.baseProjectId ) {
    return { ok: false, message: 'Select a base project before creating a change request.' }
  }
  if( input.baseProjectId === input.targetProjectId ) {
    return { ok: false, message: SAME_PROJECT_CHANGE_REQUEST_MESSAGE }
  }
  if( !input.baseDocId || !input.baseVersionId ) {
    return { ok: false, message: 'Select a base document version before creating a change request.' }
  }
  if( input.baseVersionStatus !== 'Accepted' ) {
    return { ok: false, message: 'Select an accepted base version before creating a change request.' }
  }
  if( input.title.trim().length === 0 ) {
    return { ok: false, message: 'Provide a title for the change request before creating it.' }
  }
  return { ok: true }
}

export {
  SAME_PROJECT_CHANGE_REQUEST_MESSAGE,
  buildChangeRequestTitle,
  validateChangeRequestCreation,
}
export type {
  ChangeRequestCreationInput,
  ChangeRequestCreationValidationResult,
}
