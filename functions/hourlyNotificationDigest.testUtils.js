// functions/hourlyNotificationDigest.testUtils.js: Provides Firestore fixtures for digest tests.
const assert = require( "node:assert/strict" )

const createSnapshot = (collectionName, id, data) => ( {
  id,
  exists: Boolean( data ),
  data: () => data,
  ref: {
    path: `${collectionName}/${id}`,
  },
} )

const createFakeDb = ({
  commentDocs = [],
  digestStore = {},
  eventDocs = [],
  profileStore = {},
  threadStore = {},
  writes = [],
}) => ( {
  batch() {
    return {
      set: (ref, data, options) => {
        writes.push( { type: "batch-set", path: ref.path, data, options } )
      },
      commit: async () => undefined,
    }
  },
  collection(collectionName) {
    if( collectionName === "notificationEvents" ) {
      const filters = []
      return {
        where(fieldName, op, value) {
          filters.push( [ fieldName, op, value ] )
          return this
        },
        orderBy(fieldName, direction = "asc") {
          assert.equal( fieldName, "digestHourKey" )
          assert.equal( direction, "asc" )
          return this
        },
        limit(limitValue) {
          assert.equal( limitValue, 500 )
          return this
        },
        get: async () => {
          assert.deepEqual( filters, [
            [ "digestStatus", "==", "pending" ],
            [ "digestHourKey", "<", "2026-09-28T19" ],
          ] )
          return { docs: eventDocs }
        },
      }
    }
    if( collectionName === "comments" ) {
      return {
        where(fieldName, op, value) {
          assert.equal( fieldName, "threadId" )
          assert.equal( op, "==" )
          return {
            get: async () => ( {
              docs: commentDocs.filter( (comment) => comment.data().threadId === value ),
            } ),
          }
        },
      }
    }
    return {
      doc(documentId) {
        return {
          id: documentId,
          path: `${collectionName}/${documentId}`,
          get: async () => {
            if( collectionName === "userProfiles" ) {
              return createSnapshot( collectionName, documentId, profileStore[documentId] )
            }
            if( collectionName === "notificationDigests" ) {
              return createSnapshot( collectionName, documentId, digestStore[documentId] )
            }
            if( collectionName === "threads" ) {
              return createSnapshot( collectionName, documentId, threadStore[documentId] )
            }
            return createSnapshot( collectionName, documentId, null )
          },
          set: async (data, options) => {
            writes.push( {
              type: "doc-set",
              id: documentId,
              path: `${collectionName}/${documentId}`,
              data,
              options,
            } )
            digestStore[documentId] = {
              ...( digestStore[documentId] || {} ),
              ...data,
            }
          },
        }
      },
    }
  },
} )

const createAdmin = (db) => {
  const admin = {
    firestore: () => db,
  }
  admin.firestore.FieldValue = {
    serverTimestamp: () => "server-timestamp",
  }
  return admin
}

module.exports = {
  createAdmin,
  createFakeDb,
  createSnapshot,
}
