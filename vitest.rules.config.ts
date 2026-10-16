// vitest.rules.config.ts: Runs Firestore security-rule tests in a Node environment.

import { defineConfig } from 'vitest/config'

export default defineConfig( {
  test: {
    environment: 'node',
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 90000,
    include: [
      'src/lib/firestoreRulesHarness.test.ts',
      'src/lib/firestore*Rules.test.ts',
    ],
  },
} )
