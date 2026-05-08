import { getCurrentUserRecord, getState, persistCurrentUserId, persistState } from './state'

type ProfileUpdate = {
  displayName?: string | null
}

type FakeUser = {
  uid: string
  email: string | null
  displayName: string | null
  getIdToken: (forceRefresh?: boolean) => Promise<string>
}

type FakeAuth = {
  currentUser: FakeUser | null
}

const browserLocalPersistence = { name: 'browserLocalPersistence' }
const auth: FakeAuth = {
  currentUser: null,
}

const listeners = new Set<(user: FakeUser | null) => void>()

const buildUser = (uid: string): FakeUser | null => {
  const record = getState().usersById[uid]
  if( !record ) {
    return null
  }
  return {
    uid: record.uid,
    email: record.email,
    displayName: record.displayName,
    getIdToken: async () => `fake-token:${record.uid}`,
  }
}

const syncAuthUser = () => {
  const currentRecord = getCurrentUserRecord()
  auth.currentUser = currentRecord ? buildUser( currentRecord.uid ) : null
  listeners.forEach( ( listener ) => listener( auth.currentUser ) )
}

const makeAuthError = (code: string, message: string): Error & { code: string } => {
  const error = new Error( message ) as Error & { code: string }
  error.code = code
  return error
}

const getAuth = () => auth

const connectAuthEmulator = () => undefined

const setPersistence = async () => undefined

const onAuthStateChanged = (
  currentAuth: FakeAuth,
  callback: (user: FakeUser | null) => void,
) => {
  listeners.add( callback )
  callback( currentAuth.currentUser )
  return () => {
    listeners.delete( callback )
  }
}

const signInWithEmailAndPassword = async (
  currentAuth: FakeAuth,
  email: string,
  password: string,
) => {
  const record = getState().usersByEmail[email.trim().toLowerCase()]
  if( !record || record.password !== password ) {
    throw makeAuthError( 'auth/invalid-credential', 'Invalid login credentials.' )
  }
  getState().currentUserId = record.uid
  persistCurrentUserId( record.uid )
  syncAuthUser()
  persistState()
  return {
    user: currentAuth.currentUser as FakeUser,
  }
}

const createUserWithEmailAndPassword = async (
  currentAuth: FakeAuth,
  email: string,
  password: string,
) => {
  const normalizedEmail = email.trim().toLowerCase()
  const state = getState()
  if( state.usersByEmail[normalizedEmail] ) {
    throw makeAuthError( 'auth/email-already-in-use', 'The email address is already in use.' )
  }
  const nextUserIndex = Object.keys( state.usersById ).length + 1
  const uid = `user-created-${nextUserIndex}`
  const record = {
    uid,
    email: email.trim(),
    password,
    displayName: '',
    isAdmin: false,
  }
  state.usersById[uid] = record
  state.usersByEmail[normalizedEmail] = record
  state.currentUserId = uid
  persistCurrentUserId( uid )
  syncAuthUser()
  persistState()
  return {
    user: currentAuth.currentUser as FakeUser,
  }
}

const updateProfile = async (user: FakeUser, updates: ProfileUpdate) => {
  const record = getState().usersById[user.uid]
  if( !record ) {
    return
  }
  record.displayName = updates.displayName?.trim() || ''
  syncAuthUser()
  persistState()
}

const sendPasswordResetEmail = async (
  currentAuth: FakeAuth,
  email: string,
) => {
  void currentAuth
  const record = getState().usersByEmail[email.trim().toLowerCase()]
  if( !record ) {
    throw makeAuthError( 'auth/user-not-found', 'No user found for that email address.' )
  }
}

const signOut = async () => {
  getState().currentUserId = null
  persistCurrentUserId( null )
  syncAuthUser()
  persistState()
}

syncAuthUser()

export {
  auth,
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
}
