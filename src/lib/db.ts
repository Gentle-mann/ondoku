// Shared IndexedDB connection for ondoku app.
// All stores are created here so version upgrades are coordinated.

const DB_NAME = 'ondoku'
const DB_VERSION = 2

export function openAppDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('mining_queue')) {
        db.createObjectStore('mining_queue', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('book_sentences')) {
        db.createObjectStore('book_sentences', { keyPath: 'bookId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
