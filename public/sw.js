// Service Worker for offline support and background sync
const CACHE_NAME = 'annotation-system-v1'
const urlsToCache = [
  '/',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/manifest.json'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  )
})

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  )
})

// Background sync for YJS updates
self.addEventListener('sync', (event) => {
  if (event.tag === 'yjs-sync') {
    event.waitUntil(syncYjsUpdates())
  }
})

async function syncYjsUpdates() {
  // Get pending updates from IndexedDB
  const db = await openDB('annotation-system', 1)
  const tx = db.transaction('pending-updates', 'readonly')
  const updates = await tx.store.getAll()
  
  // Send updates to server
  for (const update of updates) {
    try {
      await fetch('/api/sync', {
        method: 'POST',
        body: update.data,
        headers: {
          'Content-Type': 'application/octet-stream'
        }
      })
      
      // Remove synced update
      await db.delete('pending-updates', update.id)
    } catch (error) {
      console.error('Sync failed:', error)
      break // Stop on first failure
    }
  }
}

function openDB(name, version) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains('pending-updates')) {
        db.createObjectStore('pending-updates', { keyPath: 'id', autoIncrement: true })
      }
    }
  })
} 