// src/lib/appMetadata.ts: Centralizes product identity, support links, and version labels for the UI.
const countOfMarketingVersionSegments = 2

const resolveMarketingVersion = ( technicalVersion: string ) => {
  const versionParts = technicalVersion
    .split( '.' )
    .filter( Boolean )
  return versionParts
    .slice( 0, countOfMarketingVersionSegments )
    .join( '.' ) || technicalVersion
}

export const APP_METADATA = {
  productName: 'QualiTeam',
  marketingVersion: resolveMarketingVersion( __APP_VERSION__ ),
  technicalVersion: __APP_VERSION__,
  institutionName: 'Universidad Autónoma Metropolitana',
  institutionSiteLabel: 'UAM Cuajimalpa',
  institutionSiteUrl: 'http://www.cua.uam.mx',
  helpAssistantUrl: 'https://notebooklm.google.com/notebook/a602cd8e-4c62-4baa-b559-53ae95facaef',
  description:
    'QualiTeam is a platform for managing projects, documents, versions, and collaborative reviews.',
  supportCopy: 'Ask questions about how to use QualiTeam.',
  supportLabel: 'QualiTeam help assistant',
  technologyLabel: 'React, Vite, and Firebase',
} as const
