// Sync queue manager for offline operations
import { OfflineOperation } from './types'

export class SyncQueue {
  private apiUrl = '/api/offline-queue'
  private isProcessing = false
  private processInterval: NodeJS.Timeout | null = null
  
  constructor(private adapter: any) {
    // Start queue processor if online (client side only)
    if (typeof window !== 'undefined' && navigator.onLine) {
      this.startQueueProcessor()
    }
  }
  
  private getApiUrl(path: string = ''): string {
    // Skip API calls on server side
    if (typeof window === 'undefined') {
      throw new Error('API calls are not supported on server side')
    }
    return `${this.apiUrl}${path}`
  }
  
  async enqueue(operations: OfflineOperation | OfflineOperation[]): Promise<void> {
    const ops = Array.isArray(operations) ? operations : [operations]
    
    // Save to PostgreSQL offline_queue table
    try {
      const response = await fetch(this.getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations: ops })
      })
      
      if (!response.ok) {
        throw new Error(`Failed to enqueue operations: ${response.statusText}`)
      }
    } catch (error) {
      console.error('Failed to enqueue operations:', error)
      // Store in memory as fallback
      if (typeof localStorage !== 'undefined') {
        const existing = localStorage.getItem('offline_queue') || '[]'
        const queue = JSON.parse(existing)
        queue.push(...ops)
        localStorage.setItem('offline_queue', JSON.stringify(queue))
      }
    }
  }
  
  async getQueuedOperations(): Promise<OfflineOperation[]> {
    // Skip loading on server side
    if (typeof window === 'undefined') {
      return []
    }
    
    try {
      const response = await fetch(this.getApiUrl('?status=pending'))
      if (!response.ok) {
        throw new Error(`Failed to get queued operations: ${response.statusText}`)
      }
      
      const data = await response.json()
      return data.operations || []
    } catch (error) {
      console.error('Failed to get queued operations:', error)
      
      // Fallback to localStorage
      if (typeof localStorage !== 'undefined') {
        const existing = localStorage.getItem('offline_queue') || '[]'
        return JSON.parse(existing)
      }
      
      return []
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
      
      // Clear localStorage queue after successful flush
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('offline_queue')
      }
    } finally {
      this.isProcessing = false
    }
  }
  
  private async processOperation(operation: OfflineOperation): Promise<void> {
    try {
      // Update status to processing
      await this.updateOperationStatus(operation.id, 'processing')
      
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
      await this.removeFromQueue(operation.id)
    } catch (error) {
      console.error(`Failed to process operation ${operation.id}:`, error)
      
      // Update retry count and status
      await this.updateOperationStatus(operation.id, 'failed', error.message)
      
      // Retry logic with exponential backoff
      if (operation.retryCount < 3) {
        const delay = Math.pow(2, operation.retryCount) * 1000
        setTimeout(() => {
          this.processOperation({
            ...operation,
            retryCount: operation.retryCount + 1,
            status: 'pending'
          })
        }, delay)
      }
    }
  }
  
  private async processBranchOperation(operation: OfflineOperation): Promise<void> {
    const apiUrl = typeof window !== 'undefined' ? '/api/persistence' : ''
    
    switch (operation.type) {
      case 'create':
      case 'update':
        await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'saveBranch',
            branch: operation.data
          })
        })
        break
        
      case 'delete':
        await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'deleteBranch',
            branchId: operation.entityId
          })
        })
        break
    }
  }
  
  private async processNoteOperation(operation: OfflineOperation): Promise<void> {
    const apiUrl = typeof window !== 'undefined' ? '/api/persistence' : ''
    
    switch (operation.type) {
      case 'create':
      case 'update':
        await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'saveNote',
            note: operation.data
          })
        })
        break
        
      case 'delete':
        await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'deleteNote',
            noteId: operation.entityId
          })
        })
        break
    }
  }
  
  private async processPanelOperation(operation: OfflineOperation): Promise<void> {
    const apiUrl = typeof window !== 'undefined' ? '/api/persistence' : ''
    
    switch (operation.type) {
      case 'create':
      case 'update':
        await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'savePanel',
            panel: operation.data
          })
        })
        break
        
      case 'delete':
        await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'deletePanel',
            panelId: operation.entityId
          })
        })
        break
    }
  }
  
  private async updateOperationStatus(
    id: string, 
    status: 'pending' | 'processing' | 'failed',
    error?: string
  ): Promise<void> {
    try {
      await fetch(this.getApiUrl(`/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, error })
      })
    } catch (err) {
      console.error(`Failed to update operation status:`, err)
    }
  }
  
  private async removeFromQueue(id: string): Promise<void> {
    try {
      await fetch(this.getApiUrl(`/${id}`), {
        method: 'DELETE'
      })
    } catch (err) {
      console.error(`Failed to remove operation from queue:`, err)
    }
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