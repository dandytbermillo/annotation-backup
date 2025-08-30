import { EventEmitter } from 'events'
import type { PlainOfflineProvider } from '../providers/plain-offline-provider'

export interface BatchOperation {
  id: string
  entityType: 'document' | 'branch' | 'panel'
  entityId: string
  operation: 'create' | 'update' | 'delete'
  data: any
  timestamp: number
  idempotencyKey?: string
}

interface BatchQueue {
  operations: BatchOperation[]
  size: number
  lastFlush: number
}

export interface PlainBatchConfig {
  maxBatchSize: number
  maxBatchSizeBytes: number
  batchTimeout: number
  debounceMs: number
  coalesce: boolean
  preserveOrder?: boolean
  retryAttempts: number
  retryBackoff: number[]
  offlineQueueLimit?: number
  persistQueue?: boolean
  debug?: boolean
  monitor?: boolean
}

export class PlainBatchManager extends EventEmitter {
  private queues: Map<string, BatchQueue> = new Map()
  private flushTimer: NodeJS.Timeout | null = null
  private config: PlainBatchConfig
  private provider: PlainOfflineProvider
  private enabled: boolean = true
  
  constructor(provider: PlainOfflineProvider, config?: Partial<PlainBatchConfig>) {
    super()
    this.provider = provider
    this.config = {
      maxBatchSize: 50,
      maxBatchSizeBytes: 512000, // 500KB
      batchTimeout: 1000, // 1 second
      debounceMs: 200,
      coalesce: true,
      preserveOrder: true,
      retryAttempts: 3,
      retryBackoff: [1000, 2000, 4000],
      offlineQueueLimit: 500,
      persistQueue: true,
      debug: false,
      monitor: false,
      ...config
    }
  }
  
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled && this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }
  
  isEnabled(): boolean {
    return this.enabled
  }
  
  async enqueue(op: Omit<BatchOperation, 'id' | 'timestamp'>): Promise<BatchOperation> {
    if (!this.enabled) {
      throw new Error('Batching is disabled')
    }
    
    const operation: BatchOperation = {
      ...op,
      id: this.generateId(),
      timestamp: Date.now(),
      idempotencyKey: op.idempotencyKey || this.generateIdempotencyKey(op)
    }
    
    const queueKey = `${op.entityType}:${op.entityId}`
    const queue = this.getOrCreateQueue(queueKey)
    
    queue.operations.push(operation)
    queue.size += JSON.stringify(operation).length
    
    if (this.config.debug) {
      console.log('[PlainBatchManager] Operation queued:', operation)
    }
    
    this.emit('operation-queued', operation)
    
    // Check flush conditions
    if (this.shouldFlush(queue)) {
      await this.flush(queueKey)
    } else {
      this.scheduleFlush()
    }
    
    return operation
  }
  
  private shouldFlush(queue: BatchQueue): boolean {
    return (
      queue.operations.length >= this.config.maxBatchSize ||
      queue.size >= this.config.maxBatchSizeBytes ||
      Date.now() - queue.lastFlush >= this.config.batchTimeout
    )
  }
  
  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    
    this.flushTimer = setTimeout(() => {
      this.flushAll().catch(error => {
        console.error('[PlainBatchManager] Flush error:', error)
        this.emit('flush-error', error)
      })
    }, this.config.debounceMs)
  }
  
  async flushAll(): Promise<void> {
    const promises = Array.from(this.queues.keys()).map(key => this.flush(key))
    await Promise.allSettled(promises)
  }
  
  private async flush(queueKey: string): Promise<void> {
    const queue = this.queues.get(queueKey)
    if (!queue || queue.operations.length === 0) return
    
    const operations = queue.operations.slice()
    queue.operations = []
    queue.size = 0
    queue.lastFlush = Date.now()
    
    try {
      const startTime = Date.now()
      const coalesced = this.config.coalesce 
        ? this.coalesceOperations(operations)
        : operations
      
      if (this.config.debug) {
        console.log(`[PlainBatchManager] Flushing ${coalesced.length} operations (coalesced from ${operations.length})`)
      }
      
      await this.executeBatch(coalesced)
      
      const duration = Date.now() - startTime
      this.emit('batch-flushed', { 
        queueKey, 
        count: coalesced.length, 
        originalCount: operations.length,
        duration 
      })
    } catch (error) {
      console.error('[PlainBatchManager] Batch execution failed:', error)
      // Re-queue failed operations with retry logic
      await this.handleBatchError(operations, error)
    }
  }
  
  private coalesceOperations(operations: BatchOperation[]): BatchOperation[] {
    const grouped = new Map<string, BatchOperation>()
    
    for (const op of operations) {
      const key = `${op.entityType}:${op.entityId}:${op.operation}`
      const existing = grouped.get(key)
      
      if (existing) {
        // Merge data, keeping latest values
        existing.data = { ...existing.data, ...op.data }
        existing.timestamp = op.timestamp
        // Preserve the latest idempotency key
        existing.idempotencyKey = op.idempotencyKey
      } else {
        grouped.set(key, { ...op })
      }
    }
    
    // Preserve order if configured
    if (this.config.preserveOrder) {
      const result: BatchOperation[] = []
      const added = new Set<string>()
      
      for (const op of operations) {
        const key = `${op.entityType}:${op.entityId}:${op.operation}`
        if (!added.has(key)) {
          const coalesced = grouped.get(key)
          if (coalesced) {
            result.push(coalesced)
            added.add(key)
          }
        }
      }
      
      return result
    }
    
    return Array.from(grouped.values())
  }
  
  generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
  
  generateIdempotencyKey(op: any): string {
    return `${op.entityType}-${op.entityId}-${op.operation}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
  }
  
  private getOrCreateQueue(key: string): BatchQueue {
    if (!this.queues.has(key)) {
      this.queues.set(key, {
        operations: [],
        size: 0,
        lastFlush: Date.now()
      })
    }
    return this.queues.get(key)!
  }
  
  private async executeBatch(operations: BatchOperation[]): Promise<void> {
    // Group by entity type for efficient batch processing
    const grouped = this.groupByEntityType(operations)
    
    for (const [entityType, ops] of grouped) {
      await this.provider.batchExecute(entityType, ops)
    }
  }
  
  private groupByEntityType(operations: BatchOperation[]): Map<string, BatchOperation[]> {
    const grouped = new Map<string, BatchOperation[]>()
    
    for (const op of operations) {
      const ops = grouped.get(op.entityType) || []
      ops.push(op)
      grouped.set(op.entityType, ops)
    }
    
    return grouped
  }
  
  private async handleBatchError(operations: BatchOperation[], error: any): Promise<void> {
    console.error('[PlainBatchManager] Batch execution failed:', error)
    
    // Emit error event with operations for potential offline queueing
    this.emit('batch-error', { operations, error })
    
    // Re-queue with preserved idempotency keys for retry
    for (const op of operations) {
      try {
        await this.enqueue({
          entityType: op.entityType,
          entityId: op.entityId,
          operation: op.operation,
          data: op.data,
          idempotencyKey: op.idempotencyKey
        })
      } catch (requeueError) {
        console.error('[PlainBatchManager] Failed to re-queue operation:', requeueError)
      }
    }
  }
  
  // Status and monitoring methods
  getQueues(): Map<string, BatchQueue> {
    return new Map(this.queues)
  }
  
  getQueueSize(): number {
    let total = 0
    for (const queue of this.queues.values()) {
      total += queue.operations.length
    }
    return total
  }
  
  getQueueStatus(): { 
    size: number
    queues: number
    enabled: boolean
  } {
    return {
      size: this.getQueueSize(),
      queues: this.queues.size,
      enabled: this.enabled
    }
  }
  
  getConfig(): PlainBatchConfig {
    return { ...this.config }
  }
  
  updateConfig(updates: Partial<PlainBatchConfig>): void {
    this.config = { ...this.config, ...updates }
  }
}