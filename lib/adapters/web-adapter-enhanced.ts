import * as Y from 'yjs'
import { PersistenceProvider } from '../enhanced-yjs-provider'

export class EnhancedWebPersistenceAdapter implements PersistenceProvider {
  private serviceWorkerReady: Promise<ServiceWorkerRegistration> | null = null
  private offlineQueue: Array<{ docName: string; update: Uint8Array }> = []
  private quotaManager: QuotaManager
  private compress?: (data: Uint8Array) => Promise<Uint8Array>
  private offloadOperation?: (operation: string, data: any) => Promise<any>
  private dbName: string
  private db: IDBDatabase | null = null
  
  constructor(dbName: string) {
    this.dbName = dbName
    this.quotaManager = new QuotaManager()
    this.initializeAdvancedFeatures()
  }
  
  private async initializeAdvancedFeatures(): Promise<void> {
    // Initialize IndexedDB
    await this.initializeDB()
    
    // PWA features
    await this.registerServiceWorker()
    await this.setupOfflineQueue()
    await this.enableBackgroundSync()
    
    // Storage quota management
    await this.quotaManager.requestPersistentStorage()
    
    // Web platform optimizations
    this.enableCompressionStream()
    this.setupWebWorkerOffloading()
  }
  
  private async initializeDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        
        if (!db.objectStoreNames.contains('updates')) {
          db.createObjectStore('updates', { keyPath: 'id', autoIncrement: true })
        }
        
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'docName' })
        }
      }
    })
  }
  
  async persist(docName: string, update: Uint8Array): Promise<void> {
    if (!this.db) await this.initializeDB()
    
    const transaction = this.db!.transaction(['updates'], 'readwrite')
    const store = transaction.objectStore('updates')
    
    const data = {
      docName,
      update: Array.from(update),
      timestamp: Date.now()
    }
    
    if (this.compress) {
      data.update = Array.from(await this.compress(update))
    }
    
    return new Promise((resolve, reject) => {
      const request = store.add(data)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
  
  async load(docName: string): Promise<Uint8Array | null> {
    // Try to load snapshot first
    const snapshot = await this.loadSnapshot(docName)
    if (snapshot) return snapshot
    
    // Load and merge all updates
    const updates = await this.getAllUpdates(docName)
    if (updates.length === 0) return null
    
    // Merge updates
    const doc = new Y.Doc()
    updates.forEach(update => Y.applyUpdate(doc, update))
    
    return Y.encodeStateAsUpdate(doc)
  }
  
  async getAllUpdates(docName: string): Promise<Uint8Array[]> {
    if (!this.db) await this.initializeDB()
    
    const transaction = this.db!.transaction(['updates'], 'readonly')
    const store = transaction.objectStore('updates')
    const index = store.index ? store.index('docName') : null
    
    return new Promise((resolve, reject) => {
      const updates: Uint8Array[] = []
      const request = index ? index.openCursor(docName) : store.openCursor()
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          if (cursor.value.docName === docName) {
            updates.push(new Uint8Array(cursor.value.update))
          }
          cursor.continue()
        } else {
          resolve(updates)
        }
      }
      
      request.onerror = () => reject(request.error)
    })
  }
  
  async clearUpdates(docName: string): Promise<void> {
    if (!this.db) await this.initializeDB()
    
    const transaction = this.db!.transaction(['updates'], 'readwrite')
    const store = transaction.objectStore('updates')
    
    // Delete all updates for this doc
    return new Promise((resolve, reject) => {
      const request = store.openCursor()
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          if (cursor.value.docName === docName) {
            cursor.delete()
          }
          cursor.continue()
        } else {
          resolve()
        }
      }
      
      request.onerror = () => reject(request.error)
    })
  }
  
  async saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    if (!this.db) await this.initializeDB()
    
    const transaction = this.db!.transaction(['snapshots'], 'readwrite')
    const store = transaction.objectStore('snapshots')
    
    const data = {
      docName,
      snapshot: Array.from(snapshot),
      timestamp: Date.now()
    }
    
    if (this.compress) {
      data.snapshot = Array.from(await this.compress(snapshot))
    }
    
    return new Promise((resolve, reject) => {
      const request = store.put(data)
      request.onsuccess = () => {
        // Clear old updates after saving snapshot
        this.clearUpdates(docName)
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
  }
  
  async loadSnapshot(docName: string): Promise<Uint8Array | null> {
    if (!this.db) await this.initializeDB()
    
    const transaction = this.db!.transaction(['snapshots'], 'readonly')
    const store = transaction.objectStore('snapshots')
    
    return new Promise((resolve, reject) => {
      const request = store.get(docName)
      
      request.onsuccess = () => {
        const result = request.result
        if (result) {
          resolve(new Uint8Array(result.snapshot))
        } else {
          resolve(null)
        }
      }
      
      request.onerror = () => reject(request.error)
    })
  }
  
  async compact(docName: string): Promise<void> {
    // Load all updates
    const updates = await this.getAllUpdates(docName)
    if (updates.length === 0) return
    
    // Merge into single update
    const doc = new Y.Doc()
    updates.forEach(update => Y.applyUpdate(doc, update))
    
    // Save as snapshot
    const snapshot = Y.encodeStateAsUpdate(doc)
    await this.saveSnapshot(docName, snapshot)
  }
  
  private async registerServiceWorker(): Promise<void> {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js')
        this.serviceWorkerReady = navigator.serviceWorker.ready
        
        // Listen for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              this.notifyUserOfUpdate()
            }
          })
        })
      } catch (error) {
        console.error('Service Worker registration failed:', error)
      }
    }
  }
  
  async enableBackgroundSync(): Promise<void> {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const registration = await this.serviceWorkerReady
      if (registration && 'sync' in registration) {
        try {
          await (registration as any).sync.register('yjs-sync')
          console.log('Background sync registered')
        } catch (error) {
          console.error('Background sync registration failed:', error)
        }
      }
    }
  }
  
  async setupOfflineQueue(): Promise<void> {
    // Listen for online/offline events
    window.addEventListener('online', () => this.flushOfflineQueue())
    window.addEventListener('offline', () => this.enableOfflineMode())
    
    // Check initial state
    if (!navigator.onLine) {
      this.enableOfflineMode()
    }
  }
  
  private enableOfflineMode(): void {
    console.log('Entering offline mode')
    // Switch to local-only sync strategy
    const event = new CustomEvent('sync-strategy-change', {
      detail: { strategy: 'local', reason: 'offline' }
    })
    window.dispatchEvent(event)
  }
  
  private async flushOfflineQueue(): Promise<void> {
    console.log('Flushing offline queue, items:', this.offlineQueue.length)
    
    for (const { docName, update } of this.offlineQueue) {
      try {
        await this.persist(docName, update)
      } catch (error) {
        console.error('Failed to sync queued document:', error)
      }
    }
    
    this.offlineQueue = []
    
    // Switch back to optimal sync strategy
    const event = new CustomEvent('sync-strategy-change', {
      detail: { strategy: 'auto', reason: 'online' }
    })
    window.dispatchEvent(event)
  }
  
  private enableCompressionStream(): void {
    if ('CompressionStream' in window) {
      // Use native compression for large updates
      this.compress = async (data: Uint8Array): Promise<Uint8Array> => {
        const stream = new (window as any).CompressionStream('gzip')
        const writer = stream.writable.getWriter()
        writer.write(data)
        writer.close()
        
        const compressed: Uint8Array[] = []
        const reader = stream.readable.getReader()
        
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          compressed.push(value)
        }
        
        // Combine all chunks
        const totalLength = compressed.reduce((sum, chunk) => sum + chunk.length, 0)
        const result = new Uint8Array(totalLength)
        let offset = 0
        
        for (const chunk of compressed) {
          result.set(chunk, offset)
          offset += chunk.length
        }
        
        return result
      }
    }
  }
  
  private setupWebWorkerOffloading(): void {
    if (typeof Worker !== 'undefined') {
      // Offload heavy operations to Web Worker
      const worker = new Worker('/yjs-worker.js')
      
      this.offloadOperation = (operation: string, data: any) => {
        return new Promise((resolve, reject) => {
          const id = Math.random().toString(36)
          
          const handler = (event: MessageEvent) => {
            if (event.data.id === id) {
              worker.removeEventListener('message', handler)
              if (event.data.error) {
                reject(new Error(event.data.error))
              } else {
                resolve(event.data.result)
              }
            }
          }
          
          worker.addEventListener('message', handler)
          worker.postMessage({ id, operation, data })
        })
      }
    }
  }
  
  private notifyUserOfUpdate(): void {
    const event = new CustomEvent('app-update-available')
    window.dispatchEvent(event)
  }
}

// Quota management for web platform
class QuotaManager {
  async requestPersistentStorage(): Promise<boolean> {
    if (navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persist()
      console.log(`Persistent storage ${isPersisted ? 'granted' : 'denied'}`)
      return isPersisted
    }
    return false
  }
  
  async getStorageEstimate(): Promise<StorageEstimate | null> {
    if (navigator.storage && navigator.storage.estimate) {
      return await navigator.storage.estimate()
    }
    return null
  }
  
  async checkQuota(): Promise<{ usage: number; quota: number }> {
    const estimate = await this.getStorageEstimate()
    return {
      usage: estimate?.usage || 0,
      quota: estimate?.quota || 0
    }
  }
  
  async requestAdditionalQuota(bytes: number): Promise<boolean> {
    // Check if we have enough space
    const { usage, quota } = await this.checkQuota()
    
    if (usage + bytes > quota * 0.9) { // 90% threshold
      // Request more quota or clean up old data
      console.warn('Storage quota nearly exceeded')
      await this.cleanupOldData()
      return false
    }
    
    return true
  }
  
  private async cleanupOldData(): Promise<void> {
    // Implement cleanup strategy
    // Remove old snapshots, compact updates, etc.
    console.log('Cleaning up old data...')
  }
} 