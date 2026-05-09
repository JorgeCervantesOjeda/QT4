// src/lib/appMetadata.ts: Centralizes product identity, support links, and the single app version used by the UI.

export const APP_METADATA = {
  productName: 'QualiTeam',
  appVersion: __APP_VERSION__,
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
