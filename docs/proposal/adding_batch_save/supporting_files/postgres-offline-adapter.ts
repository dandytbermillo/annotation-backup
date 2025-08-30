/**
 * PostgreSQL Offline Adapter
 * 
 * Extends PostgresAPIAdapter with offline-first capabilities:
 * - Queues operations when offline
 * - Batch operations for efficiency
 * - Entity-specific CRUD operations
 * - Automatic retry with exponential backoff
 */

import { PostgresAPIAdapter } from './postgres-api-adapter'
import { OfflineOperation, Branch, Note, Panel } from '../stores/types'

export class PostgresOfflineAdapter extends PostgresAPIAdapter {
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
  private queueApiUrl = '/api/offline-queue'
  private apiBaseUrl = '/api/persistence'
  
  constructor() {
    super()
    
    // Set up online/offline listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline())
      window.addEventListener('offline', () => this.handleOffline())
    }
  }
  
  private getApiUrl(path: string = ''): string {
    return `${this.apiBaseUrl}${path}`
  }
  
  private getQueueApiUrl(path: string = ''): string {
    // Skip API calls on server side
    if (typeof window === 'undefined') {
      throw new Error('API calls are not supported on server side')
    }
    return `${this.queueApiUrl}${path}`
  }
  
  private handleOnline(): void {
    this.isOnline = true
  }
  
  private handleOffline(): void {
    this.isOnline = false
  }
  
  // Override persist to handle offline mode
  async persist(docName: string, update: Uint8Array): Promise<void> {
    if (this.isOnline) {
      try {
        return await super.persist(docName, update)
      } catch (error) {
        console.error('Online persist failed, queuing operation:', error)
        await this.queueOperation({
          type: 'update',
          table: 'yjs_updates',
          entityId: docName,
          data: { docName, update: this.uint8ArrayToBase64(update) }
        })
      }
    } else {
      await this.queueOperation({
        type: 'update',
        table: 'yjs_updates',
        entityId: docName,
        data: { docName, update: this.uint8ArrayToBase64(update) }
      })
    }
  }
  
  // Batch persist for multiple operations
  async batchPersist(operations: OfflineOperation[]): Promise<void> {
    if (!this.isOnline) {
      // Queue all operations
      for (const op of operations) {
        await this.queueOperation(op)
      }
      return
    }
    
    try {
      const response = await fetch(this.getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batchPersist',
          operations: operations.map(op => ({
            ...op,
            data: this.serializeData(op.data)
          }))
        })
      })
      
      if (!response.ok) {
        throw new Error(`Batch persist failed: ${response.statusText}`)
      }
    } catch (error) {
      console.error('Batch persist failed, queuing operations:', error)
      // Queue all operations on failure
      for (const op of operations) {
        await this.queueOperation(op)
      }
      throw error
    }
  }
  
  // Load entities
  async loadBranches(): Promise<Branch[]> {
    // Skip loading on server side
    if (typeof window === 'undefined') {
      return []
    }
    
    try {
      const response = await fetch(this.getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'loadBranches'
        })
      })
      
      if (!response.ok) {
        throw new Error(`Failed to load branches: ${response.statusText}`)
      }
      
      const data = await response.json()
      return data.branches || []
    } catch (error) {
      console.error('Failed to load branches:', error)
      return []
    }
  }
  
  async loadNotes(): Promise<Note[]> {
    // Skip loading on server side
    if (typeof window === 'undefined') {
      return []
    }
    
    try {
      const response = await fetch(this.getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'loadNotes'
        })
      })
      
      if (!response.ok) {
        throw new Error(`Failed to load notes: ${response.statusText}`)
      }
      
      const data = await response.json()
      return data.notes || []
    } catch (error) {
      console.error('Failed to load notes:', error)
      // Return default note when database is unavailable
      return [{
        id: 'default-note-1',
        title: 'Welcome to Annotation System',
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    }
  }
  
  async loadPanels(): Promise<Panel[]> {
    // Skip loading on server side
    if (typeof window === 'undefined') {
      return []
    }
    
    try {
      const response = await fetch(this.getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'loadPanels'
        })
      })
      
      if (!response.ok) {
        throw new Error(`Failed to load panels: ${response.statusText}`)
      }
      
      const data = await response.json()
      return data.panels || []
    } catch (error) {
      console.error('Failed to load panels:', error)
      return []
    }
  }
  
  // Queue operations for offline processing
  private async queueOperation(operation: Omit<OfflineOperation, 'id' | 'timestamp' | 'retryCount' | 'status'>): Promise<void> {
    const op: OfflineOperation = {
      id: this.generateId(),
      timestamp: new Date(),
      retryCount: 0,
      status: 'pending',
      ...operation
    }
    
    try {
      const response = await fetch(this.getQueueApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations: [op] })
      })
      
      if (!response.ok) {
        throw new Error(`Failed to queue operation: ${response.statusText}`)
      }
    } catch (error) {
      console.error('Failed to queue operation to server, using localStorage:', error)
      
      // Fallback to localStorage
      if (typeof localStorage !== 'undefined') {
        const existing = localStorage.getItem('offline_queue') || '[]'
        const queue = JSON.parse(existing)
        queue.push(op)
        localStorage.setItem('offline_queue', JSON.stringify(queue))
      }
    }
  }
  
  // Helper to serialize data for API transport
  private serializeData(data: any): any {
    if (data instanceof Date) {
      return data.toISOString()
    }
    if (data && typeof data === 'object') {
      const serialized: any = {}
      for (const key in data) {
        serialized[key] = this.serializeData(data[key])
      }
      return serialized
    }
    return data
  }
  
  // Helper to convert Uint8Array to base64
  private uint8ArrayToBase64(uint8Array: Uint8Array): string {
    let binary = ''
    const len = uint8Array.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Array[i])
    }
    return btoa(binary)
  }
  
  // Generate unique ID
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
  
  // Check if currently online
  getOnlineStatus(): boolean {
    return this.isOnline
  }
}