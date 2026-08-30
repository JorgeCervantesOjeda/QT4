// src/lib/documentDerivation.ts
// Centralizes derived-document and propagated-error-report identity rules.
import { versionNumberToString } from '../domain/types'

type ActiveChangeRequestCandidate = {
  documentId: string
  versionId: string
  projectId: string
  documentType?: string | null
  baseProjectId?: string | null
  baseDocId?: string | null
  baseVersionId?: string | null
  status: string
}

type DerivationLine = {
  variantProjectId: string
  originProjectId: string
  originDocumentId: string
  originVersionId: string
}

type ActiveConfigurationLine = DerivationLine & {
  key: string
  changeRequestVersionIds: string[]
}

type DerivedDocumentLineCandidate = {
  type?: string | null
  projectId?: string | null
  status?: string | null
  originProjectId?: string | null
  originDocumentId?: string | null
  originVersionId?: string | null
}

type ChangeRequestAcceptanceInput = DerivationLine & {
  pendingDerivedGenerationCount: number
  derivedDocuments: DerivedDocumentLineCandidate[]
}

type ChangeRequestAcceptanceDecision =
  | { ok: true }
  | {
    ok: false
    reason: 'acceptedDerivedDocumentExists' | 'derivedGenerationInProgress'
    message: string
  }

type ShortDocumentReferenceInput = {
  projectShortId?: number | null
  documentShortId?: number | null
  versionNumber?: number | null
  title?: string | null
}

const ACCEPTED_DERIVED_DOCUMENT_MESSAGE =
  'This base already has an accepted derived document in the current project. Create an error report for the derived document instead.'

const DERIVED_GENERATION_IN_PROGRESS_MESSAGE =
  'A derived variant is already being generated for this base. Wait until it finishes before accepting another change request.'

const buildDerivationLineKey = (line: DerivationLine) =>
  [
    line.variantProjectId,
    line.originProjectId,
    line.originDocumentId,
    line.originVersionId,
  ].join( '|' )

const isAcceptedChangeRequestCandidate = (candidate: ActiveChangeRequestCandidate) =>
  candidate.documentType === 'changeRequest'
  && candidate.status === 'Accepted'
  && Boolean(
    candidate.projectId
    && candidate.baseProjectId
    && candidate.baseDocId
    && candidate.baseVersionId,
  )

const buildActiveConfiguration = (
  candidates: ActiveChangeRequestCandidate[],
): ActiveConfigurationLine[] => {
  const linesByKey = new Map<string, ActiveConfigurationLine>()
  candidates.forEach( ( candidate ) => {
    if( !isAcceptedChangeRequestCandidate( candidate ) ) {
      return
    }
    const line = {
      variantProjectId: candidate.projectId,
      originProjectId: candidate.baseProjectId ?? '',
      originDocumentId: candidate.baseDocId ?? '',
      originVersionId: candidate.baseVersionId ?? '',
    }
    const key = buildDerivationLineKey( line )
    const existing = linesByKey.get( key )
    if( existing ) {
      existing.changeRequestVersionIds.push( candidate.versionId )
      return
    }
    linesByKey.set( key, {
      ...line,
      key,
      changeRequestVersionIds: [candidate.versionId],
    } )
  } )
  return Array.from( linesByKey.values() )
    .map( ( line ) => ( {
      ...line,
      changeRequestVersionIds: [...new Set( line.changeRequestVersionIds )].sort(),
    } ) )
    .sort( ( left, right ) => left.key.localeCompare( right.key ) )
}

const isAcceptedDerivedDocumentForLine = (
  candidate: DerivedDocumentLineCandidate,
  line: DerivationLine,
) =>
  candidate.type === 'derivedDocument'
  && candidate.status === 'Accepted'
  && candidate.projectId === line.variantProjectId
  && candidate.originProjectId === line.originProjectId
  && candidate.originDocumentId === line.originDocumentId
  && candidate.originVersionId === line.originVersionId

const canAcceptChangeRequestForLine = (
  input: ChangeRequestAcceptanceInput,
): ChangeRequestAcceptanceDecision => {
  if( input.pendingDerivedGenerationCount > 0 ) {
    return {
      ok: false,
      reason: 'derivedGenerationInProgress',
      message: DERIVED_GENERATION_IN_PROGRESS_MESSAGE,
    }
  }
  const acceptedDerivedDocumentExists = input.derivedDocuments.some( ( candidate ) =>
    isAcceptedDerivedDocumentForLine( candidate, input ),
  )
  if( acceptedDerivedDocumentExists ) {
    return {
      ok: false,
      reason: 'acceptedDerivedDocumentExists',
      message: ACCEPTED_DERIVED_DOCUMENT_MESSAGE,
    }
  }
  return { ok: true }
}

const formatShortDocumentReference = (input: ShortDocumentReferenceInput) => {
  const projectLabel = Number.isFinite( input.projectShortId ) ? `P${input.projectShortId}` : 'P?'
  const documentLabel = Number.isFinite( input.documentShortId ) ? `D${input.documentShortId}` : 'D?'
  const versionLabel = Number.isFinite( input.versionNumber )
    ? `v${versionNumberToString( Number( input.versionNumber ) )}`
    : 'v?'
  const title = input.title?.trim()
  return title
    ? `${projectLabel} / ${documentLabel} / ${versionLabel} - ${title}`
    : `${projectLabel} / ${documentLabel} / ${versionLabel}`
}

export {
  ACCEPTED_DERIVED_DOCUMENT_MESSAGE,
  DERIVED_GENERATION_IN_PROGRESS_MESSAGE,
  buildActiveConfiguration,
  buildDerivationLineKey,
  canAcceptChangeRequestForLine,
  formatShortDocumentReference,
  isAcceptedDerivedDocumentForLine,
}
export type {
  ActiveChangeRequestCandidate,
  ActiveConfigurationLine,
  ChangeRequestAcceptanceDecision,
  ChangeRequestAcceptanceInput,
  DerivationLine,
  DerivedDocumentLineCandidate,
}
