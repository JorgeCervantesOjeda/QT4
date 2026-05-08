import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp( firebaseConfig );

const auth = getAuth( app );
const db = getFirestore( app );
const storage = getStorage( app );

const useFirebaseEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
const authEmulatorHost = ( import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1' ).trim()
const authEmulatorPort = Number( import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT ?? '9099' )
const firestoreEmulatorHost = ( import.meta.env.VITE_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1' ).trim()
const firestoreEmulatorPort = Number( import.meta.env.VITE_FIRESTORE_EMULATOR_PORT ?? '8080' )
const storageEmulatorHost = ( import.meta.env.VITE_FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1' ).trim()
const storageEmulatorPort = Number( import.meta.env.VITE_FIREBASE_STORAGE_EMULATOR_PORT ?? '9199' )

if( useFirebaseEmulators ) {
  connectAuthEmulator(
    auth,
    `http://${authEmulatorHost}:${authEmulatorPort}`,
    { disableWarnings: true },
  )
  connectFirestoreEmulator( db, firestoreEmulatorHost, firestoreEmulatorPort )
  connectStorageEmulator( storage, storageEmulatorHost, storageEmulatorPort )
}

void setPersistence( auth, browserLocalPersistence ).catch( () => {
  // ignore persistence setup errors
} );

const analyticsPromise = import.meta.env.PROD && !useFirebaseEmulators
  ? isSupported().then( ( supported ) => ( supported ? getAnalytics( app ) : null ) )
  : Promise.resolve( null );

export { app, auth, db, storage, analyticsPromise };
