// Local sync queue that uses localStorage instead of PostgreSQL
import { OfflineOperation } from './types'
import { v4 as uuidv4 } from 'uuid'

export class LocalSyncQueue {
  private static QUEUE_KEY = 'offline-sync-queue'
  private isProcessing = false
  private processInterval: NodeJS.Timeout | null = null
  
  constructor(private adapter: any) {
    // Start queue processor if online (client side only)
    if (typeof window !== 'undefined' && navigator.onLine) {
      this.startQueueProcessor()
    }
  }
  
  async enqueue(operations: OfflineOperation | OfflineOperation[]): Promise<void> {
    if (typeof window === 'undefined') return
    
    const ops = Array.isArray(operations) ? operations : [operations]
    
    // Always use localStorage for offline queue
    const queue = this.getQueue()
    
    // Add IDs if missing
    ops.forEach(op => {
      if (!op.id) {
        op.id = uuidv4()
      }
      if (!op.timestamp) {
        op.timestamp = new Date()
      }
      if (!op.status) {
        op.status = 'pending'
      }
    })
    
    queue.push(...ops)
    this.saveQueue(queue)
  }
  
  async getQueuedOperations(): Promise<OfflineOperation[]> {
    if (typeof window === 'undefined') return []
    
    return this.getQueue().filter(op => op.status === 'pending')
  }
  
  private getQueue(): OfflineOperation[] {
    try {
      const stored = localStorage.getItem(LocalSyncQueue.QUEUE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch (error) {
      console.error('Failed to parse queue from localStorage:', error)
    }
    return []
  }
  
  private saveQueue(queue: OfflineOperation[]): void {
    try {
      localStorage.setItem(LocalSyncQueue.QUEUE_KEY, JSON.stringify(queue))
    } catch (error) {
      console.error('Failed to save queue to localStorage:', error)
    }
  }
  
  async flush(): Promise<void> {
    if (this.isProcessing) {
      console.log('Queue is already being processed')
      return
    }
    
    this.isProcessing = true
    
    try {
      const operations = await this.getQueuedOperations()
      console.log(`Processing ${operations.length} queued operations`)
      
      for (const operation of operations) {
        await this.processOperation(operation)
      }
    } finally {
      this.isProcessing = false
    }
  }
  
  private async processOperation(operation: OfflineOperation): Promise<void> {
    try {
      // Update status to processing
      this.updateOperationStatus(operation.id, 'processing')
      
      // Execute the operation based on type
      switch (operation.table) {
        case 'branches':
          await this.processBranchOperation(operation)
          break
        case 'notes':
          await this.processNoteOperation(operation)
          break
        case 'panels':
          await this.processPanelOperation(operation)
          break
        default:
          throw new Error(`Unknown table: ${operation.table}`)
      }
      
      // Remove from queue after successful processing
      this.removeFromQueue(operation.id)
    } catch (error: any) {
      console.error(`Failed to process operation ${operation.id}:`, error)
      
      // Update retry count and status
      this.updateOperationStatus(operation.id, 'failed', error.message)
      
      // Retry logic with exponential backoff
      if (operation.retryCount < 3) {
        const delay = Math.pow(2, operation.retryCount) * 1000
        setTimeout(() => {
          this.updateOperationStatus(operation.id, 'pending')
          this.updateOperationRetryCount(operation.id)
        }, delay)
      }
    }
  }
  
  private async processBranchOperation(operation: OfflineOperation): Promise<void> {
    const apiUrl = '/api/persistence'
    
    switch (operation.type) {
      case 'create':
      case 'update':
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'saveBranch',
            branch: operation.data
          })
        })
        if (!response.ok) {
          throw new Error(`Failed to save branch: ${response.statusText}`)
        }
        break
        
      case 'delete':
        const deleteResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'deleteBranch',
            branchId: operation.entityId
          })
        })
        if (!deleteResponse.ok) {
          throw new Error(`Failed to delete branch: ${deleteResponse.statusText}`)
        }
        break
    }
  }
  
  private async processNoteOperation(operation: OfflineOperation): Promise<void> {
    const apiUrl = '/api/persistence'
    
    switch (operation.type) {
      case 'create':
      case 'update':
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'saveNote',
            note: operation.data
          })
        })
        if (!response.ok) {
          throw new Error(`Failed to save note: ${response.statusText}`)
        }
        break
        
      case 'delete':
        const deleteResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'deleteNote',
            noteId: operation.entityId
          })
        })
        if (!deleteResponse.ok) {
          throw new Error(`Failed to delete note: ${deleteResponse.statusText}`)
        }
        break
    }
  }
  
  private async processPanelOperation(operation: OfflineOperation): Promise<void> {
    const apiUrl = '/api/persistence'
    
    switch (operation.type) {
      case 'create':
      case 'update':
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'savePanel',
            panel: operation.data
          })
        })
        if (!response.ok) {
          throw new Error(`Failed to save panel: ${response.statusText}`)
        }
        break
        
      case 'delete':
        const deleteResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'deletePanel',
            panelId: operation.entityId
          })
        })
        if (!deleteResponse.ok) {
          throw new Error(`Failed to delete panel: ${deleteResponse.statusText}`)
        }
        break
    }
  }
  
  private updateOperationStatus(
    id: string, 
    status: 'pending' | 'processing' | 'failed',
    error?: string
  ): void {
    const queue = this.getQueue()
    const operation = queue.find(op => op.id === id)
    if (operation) {
      operation.status = status
      if (error) {
        operation.errorMessage = error
      }
      this.saveQueue(queue)
    }
  }
  
  private updateOperationRetryCount(id: string): void {
    const queue = this.getQueue()
    const operation = queue.find(op => op.id === id)
    if (operation) {
      operation.retryCount = (operation.retryCount || 0) + 1
      this.saveQueue(queue)
    }
  }
  
  private removeFromQueue(id: string): void {
    const queue = this.getQueue()
    const filtered = queue.filter(op => op.id !== id)
    this.saveQueue(filtered)
  }
  
  startQueueProcessor(): void {
    if (this.processInterval) return
    
    // Process queue every 30 seconds when online
    this.processInterval = setInterval(() => {
      if (navigator.onLine && !this.isProcessing) {
        this.flush().catch(err => {
          console.error('Queue processor error:', err)
        })
      }
    }, 30000)
  }
  
  stopQueueProcessor(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval)
      this.processInterval = null
    }
  }
}