// tools/seed_reputation_emulator.mjs: Seeds the minimal auth and project state for reputation integration tests.

import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-qt4-e2e'
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST

if( !firestoreHost || !authHost ) {
  throw new Error( 'Auth and Firestore emulators are required for reputation integration tests.' )
}

const app = getApps().length > 0
  ? getApps()[0]
  : initializeApp( { projectId, storageBucket: `${projectId}.appspot.com` } )
const auth = getAuth( app )
const db = getFirestore( app )

const clearEmulatorState = async () => {
  const firestoreResponse = await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
  if( !firestoreResponse.ok ) {
    throw new Error( `Failed to clear Firestore emulator: ${firestoreResponse.status}` )
  }

  const authResponse = await fetch(
    `http://${authHost}/emulator/v1/projects/${projectId}/accounts`,
    { method: 'DELETE' },
  )
  if( !authResponse.ok ) {
    throw new Error( `Failed to clear Auth emulator: ${authResponse.status}` )
  }
}

const seedState = async () => {
  const member = await auth.createUser( {
    uid: 'user-member-1',
    email: 'member@example.com',
    password: 'password123',
    displayName: 'Member User',
  } )
  const timestamp = Timestamp.now()
  const batch = db.batch()
  batch.set( db.doc( `userProfiles/${member.uid}` ), {
    email: member.email,
    displayName: member.displayName,
    isAdmin: false,
  } )
  batch.set( db.doc( 'projects/project-e2e-reputation' ), {
    name: 'Reputation Integration Project',
    leaderId: member.uid,
    shortId: 901,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  } )
  batch.set( db.doc( 'projectMembers/project-e2e-reputation_user-member-1' ), {
    projectId: 'project-e2e-reputation',
    userId: member.uid,
    role: 'leader',
    email: member.email,
    createdAt: timestamp,
    updatedAt: timestamp,
  } )
  await batch.commit()
}

await clearEmulatorState()
await seedState()
console.log( 'Reputation emulator state seeded.' )
