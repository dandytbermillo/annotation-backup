import { EventEmitter } from 'events'
import type { BatchOperation, PlainBatchConfig } from './plain-batch-manager'

interface QueuedOperation {
  id: string
  operation: BatchOperation
  retryCount: number
  nextRetryAt: number
  createdAt: number
}

export type ExecuteOperationFunction = (operation: BatchOperation) => Promise<void>

export class PlainOfflineQueue extends EventEmitter {
  private queue: QueuedOperation[] = []
  private processing = false
  private online = true
  private storageKey = 'plain-offline-queue'
  private executeOperation?: ExecuteOperationFunction
  
  constructor(
    private config: PlainBatchConfig,
    executeOperation?: ExecuteOperationFunction
  ) {
    super()
    this.executeOperation = executeOperation
    this.loadFromStorage()
    this.setupOnlineListener()
  }
  
  setExecuteOperation(fn: ExecuteOperationFunction): void {
    this.executeOperation = fn
  }
  
  private setupOnlineListener(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline())
      window.addEventListener('offline', () => this.handleOffline())
      this.online = navigator.onLine
    } else {
      // In Node.js environment (e.g., during SSR), assume online
      this.online = true
    }
  }
  
  private handleOnline(): void {
    this.online = true
    this.emit('online')
    this.processQueue().catch(error => {
      console.error('[PlainOfflineQueue] Error processing queue after coming online:', error)
    })
  }
  
  private handleOffline(): void {
    this.online = false
    this.emit('offline')
  }
  
  async enqueue(operation: BatchOperation): Promise<void> {
    const queued: QueuedOperation = {
      id: this.generateId(),
      operation,
      retryCount: 0,
      nextRetryAt: Date.now(),
      createdAt: Date.now()
    }
    
    this.queue.push(queued)
    
    // Enforce queue limit
    if (this.config.offlineQueueLimit && this.queue.length > this.config.offlineQueueLimit) {
      // Remove oldest operations
      const removeCount = this.queue.length - this.config.offlineQueueLimit
      const removed = this.queue.splice(0, removeCount)
      
      if (this.config.debug) {
        console.warn(`[PlainOfflineQueue] Queue limit reached, removed ${removeCount} oldest operations`)
      }
      
      this.emit('operations-dropped', removed)
    }
    
    this.saveToStorage()
    
    if (this.config.debug) {
      console.log('[PlainOfflineQueue] Operation queued:', queued)
    }
    
    this.emit('operation-queued', queued)
    
    if (this.online && !this.processing) {
      await this.processQueue()
    }
  }
  
  async processQueue(): Promise<void> {
    if (this.processing || !this.online || this.queue.length === 0) return
    
    this.processing = true
    const now = Date.now()
    
    try {
      // Process operations that are ready for retry
      const ready = this.queue.filter(op => op.nextRetryAt <= now)
      
      if (this.config.debug && ready.length > 0) {
        console.log(`[PlainOfflineQueue] Processing ${ready.length} operations`)
      }
      
      for (const queuedOp of ready) {
        try {
          if (!this.executeOperation) {
            throw new Error('executeOperation function not set')
          }
          
          await this.executeOperation(queuedOp.operation)
          
          // Remove successful operation
          this.queue = this.queue.filter(op => op.id !== queuedOp.id)
          this.emit('operation-processed', queuedOp)
          
          if (this.config.debug) {
            console.log('[PlainOfflineQueue] Operation processed successfully:', queuedOp.id)
          }
        } catch (error) {
          // Handle retry logic
          this.handleOperationError(queuedOp, error)
        }
      }
      
      this.saveToStorage()
    } finally {
      this.processing = false
      
      // Schedule next processing if there are pending operations
      if (this.queue.length > 0) {
        const nextRetry = Math.min(...this.queue.map(op => op.nextRetryAt))
        const delay = Math.max(0, nextRetry - Date.now())
        
        if (this.config.debug) {
          console.log(`[PlainOfflineQueue] Scheduling next retry in ${delay}ms`)
        }
        
        setTimeout(() => {
          this.processQueue().catch(error => {
            console.error('[PlainOfflineQueue] Error in scheduled processing:', error)
          })
        }, delay)
      }
    }
  }
  
  private handleOperationError(queuedOp: QueuedOperation, error: any): void {
    queuedOp.retryCount++
    
    if (queuedOp.retryCount >= this.config.retryAttempts) {
      // Move to dead letter queue or discard
      this.queue = this.queue.filter(op => op.id !== queuedOp.id)
      
      console.error(`[PlainOfflineQueue] Operation failed after ${queuedOp.retryCount} attempts:`, error)
      
      this.emit('operation-failed', { operation: queuedOp, error })
    } else {
      // Calculate next retry time with exponential backoff
      const backoffIndex = Math.min(queuedOp.retryCount - 1, this.config.retryBackoff.length - 1)
      const backoffDelay = this.config.retryBackoff[backoffIndex] || 
                          this.config.retryBackoff[this.config.retryBackoff.length - 1] || 
                          1000 // Default to 1 second if no backoff configured
      
      queuedOp.nextRetryAt = Date.now() + backoffDelay
      
      if (this.config.debug) {
        console.log(`[PlainOfflineQueue] Operation retry scheduled (attempt ${queuedOp.retryCount}/${this.config.retryAttempts}):`, {
          id: queuedOp.id,
          nextRetryIn: backoffDelay
        })
      }
      
      this.emit('operation-retry', { operation: queuedOp, attempt: queuedOp.retryCount })
    }
  }
  
  private loadFromStorage(): void {
    if (!this.config.persistQueue || typeof window === 'undefined') return
    
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        
        // Validate and restore queue
        if (Array.isArray(parsed)) {
          this.queue = parsed.filter(item => 
            item && 
            typeof item === 'object' && 
            item.operation && 
            typeof item.operation === 'object'
          )
          
          if (this.config.debug) {
            console.log(`[PlainOfflineQueue] Loaded ${this.queue.length} operations from storage`)
          }
        }
      }
    } catch (error) {
      console.error('[PlainOfflineQueue] Failed to load from storage:', error)
      // Clear corrupted storage
      try {
        localStorage.removeItem(this.storageKey)
      } catch (clearError) {
        // Ignore clear error
      }
    }
  }
  
  private saveToStorage(): void {
    if (!this.config.persistQueue || typeof window === 'undefined') return
    
    try {
      // Limit queue size before saving
      if (this.config.offlineQueueLimit && this.queue.length > this.config.offlineQueueLimit) {
        this.queue = this.queue.slice(-this.config.offlineQueueLimit)
      }
      
      localStorage.setItem(this.storageKey, JSON.stringify(this.queue))
    } catch (error) {
      console.error('[PlainOfflineQueue] Failed to save to storage:', error)
      
      // Try to clear storage if it's full
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        try {
          localStorage.removeItem(this.storageKey)
          console.warn('[PlainOfflineQueue] Cleared storage due to quota exceeded')
        } catch (clearError) {
          // Ignore clear error
        }
      }
    }
  }
  
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
  
  getQueueStatus(): { 
    size: number
    processing: boolean
    online: boolean
    oldestOperation?: number
  } {
    const status: any = {
      size: this.queue.length,
      processing: this.processing,
      online: this.online
    }
    
    if (this.queue.length > 0) {
      status.oldestOperation = Math.min(...this.queue.map(op => op.createdAt))
    }
    
    return status
  }
  
  getQueue(): QueuedOperation[] {
    return [...this.queue]
  }
  
  clearQueue(): void {
    this.queue = []
    this.saveToStorage()
    this.emit('queue-cleared')
  }
  
  // Force retry all queued operations
  async retryAll(): Promise<void> {
    for (const op of this.queue) {
      op.nextRetryAt = Date.now()
      op.retryCount = 0
    }
    
    if (this.online) {
      await this.processQueue()
    }
  }
  
  isOnline(): boolean {
    return this.online
  }
}