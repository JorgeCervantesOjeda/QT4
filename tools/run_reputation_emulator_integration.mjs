// tools/run_reputation_emulator_integration.mjs: Runs reputation Functions and UI smoke tests on Firebase emulators.

import { spawn } from 'node:child_process'

const command = [
  'npx firebase-tools emulators:exec',
  '--project demo-qt4-e2e',
  '--only auth,firestore,functions',
  '"node tools/seed_reputation_emulator.mjs && node tools/reputation_functions_emulator.mjs && playwright test -c playwright.reputation.config.ts src/test/e2e/reputation.emulator.spec.ts"',
].join( ' ' )

const child = spawn( command, {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: true,
} )

child.on( 'exit', (code, signal) => {
  if( signal ) {
    process.kill( process.pid, signal )
    return
  }
  process.exit( code ?? 1 )
} )
