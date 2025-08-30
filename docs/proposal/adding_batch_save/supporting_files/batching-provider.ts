import * as Y from 'yjs'
import { EventEmitter } from 'events'
import type { PersistenceProvider } from '../enhanced-yjs-provider'
import { 
  BatchingConfig, 
  BatchMetrics, 
  FlushReason,
  validateConfig
} from './batching-config'

interface QueuedUpdate {
  data: Uint8Array
  timestamp: number
  size: number
}

interface DocumentQueue {
  updates: QueuedUpdate[]
  totalSize: number
  timer?: NodeJS.Timeout
}

/**
 * BatchingPersistenceProvider wraps any PersistenceProvider to add
 * batching, debouncing, and update coalescing capabilities.
 */
export class BatchingPersistenceProvider extends EventEmitter implements PersistenceProvider {
  private queues = new Map<string, DocumentQueue>()
  private metrics: BatchMetrics = {
    totalBatches: 0,
    totalUpdates: 0,
    averageBatchSize: 0,
    compressionRatio: 1,
    flushReasons: {
      timeout: 0,
      size: 0,
      count: 0,
      manual: 0,
      shutdown: 0
    },
    errors: 0
  }
  private isShuttingDown = false
  private flushPromises = new Map<string, Promise<void>>()

  constructor(
    private adapter: PersistenceProvider,
    private config: BatchingConfig
  ) {
    super()
    validateConfig(config)
    
    // Handle process termination (unless disabled for testing)
    if (!config.disableEventListeners) {
      if (typeof process !== 'undefined') {
        process.on('beforeExit', () => this.shutdown())
        process.on('SIGINT', () => this.shutdown())
        process.on('SIGTERM', () => this.shutdown())
      }
      
      // Handle browser unload
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('beforeunload', () => {
          this.shutdown()
        })
      }
    }
  }

  /**
   * Queue an update for batching
   */
  async persist(docName: string, update: Uint8Array): Promise<void> {
    console.log('[BatchingProvider] persist called for:', docName, 'update size:', update.byteLength)
    
    if (this.isShuttingDown) {
      // During shutdown, persist immediately
      return this.adapter.persist(docName, update)
    }

    this.enqueue(docName, update)

    // Check if we should flush based on size or count
    const queue = this.queues.get(docName)!
    if (this.shouldFlushBySize(queue) || this.shouldFlushByCount(queue)) {
      const reason = this.shouldFlushBySize(queue) ? 'size' : 'count'
      await this.flush(docName, reason)
    } else {
      // Reset debounce timer
      this.resetTimer(docName)
    }
  }

  /**
   * Load document data - passthrough to adapter
   */
  async load(docName: string): Promise<Uint8Array | null> {
    // Flush any pending updates for this document first
    await this.flush(docName, 'manual')
    return this.adapter.load(docName)
  }

  /**
   * Get all updates - passthrough to adapter
   */
  async getAllUpdates(docName: string): Promise<Uint8Array[]> {
    // Flush any pending updates first
    await this.flush(docName, 'manual')
    return this.adapter.getAllUpdates(docName)
  }

  /**
   * Clear updates - passthrough to adapter
   */
  async clearUpdates(docName: string): Promise<void> {
    // Flush and clear queue
    await this.flush(docName, 'manual')
    return this.adapter.clearUpdates(docName)
  }

  /**
   * Save snapshot - passthrough to adapter
   */
  async saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    // Flush any pending updates first
    await this.flush(docName, 'manual')
    return this.adapter.saveSnapshot(docName, snapshot)
  }

  /**
   * Load snapshot - passthrough to adapter
   */
  async loadSnapshot(docName: string): Promise<Uint8Array | null> {
    return this.adapter.loadSnapshot(docName)
  }

  /**
   * Compact document - flush then passthrough
   */
  async compact(docName: string): Promise<void> {
    await this.flush(docName, 'manual')
    return this.adapter.compact(docName)
  }

  /**
   * Get current metrics
   */
  getMetrics(): Readonly<BatchMetrics> {
    return { ...this.metrics }
  }

  /**
   * Manually flush a specific document or all documents
   */
  async flushAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const docName of this.queues.keys()) {
      promises.push(this.flush(docName, 'manual'))
    }
    await Promise.all(promises)
  }

  /**
   * Shutdown the provider and flush all pending updates
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return
    
    this.isShuttingDown = true
    this.emit('shutdown')
    
    // Clear all timers
    for (const queue of this.queues.values()) {
      if (queue.timer) {
        clearTimeout(queue.timer)
      }
    }
    
    // Flush all queues
    const promises: Promise<void>[] = []
    for (const docName of this.queues.keys()) {
      promises.push(this.flush(docName, 'shutdown'))
    }
    
    try {
      await Promise.all(promises)
    } catch (error) {
      console.error('Error during shutdown flush:', error)
    }
  }

  /**
   * Add an update to the queue
   */
  private enqueue(docName: string, update: Uint8Array): void {
    let queue = this.queues.get(docName)
    if (!queue) {
      queue = {
        updates: [],
        totalSize: 0
      }
      this.queues.set(docName, queue)
    }

    const queuedUpdate: QueuedUpdate = {
      data: update,
      timestamp: Date.now(),
      size: update.byteLength
    }

    queue.updates.push(queuedUpdate)
    queue.totalSize += queuedUpdate.size
    
    // Update metrics immediately when enqueuing
    this.metrics.totalUpdates++

    if (this.config.debug) {
      console.log(`[BatchingProvider] Queued update for ${docName}. Queue size: ${queue.updates.length}, Total bytes: ${queue.totalSize}`)
    }

    this.emit('enqueue', { docName, queueSize: queue.updates.length, totalSize: queue.totalSize })
  }

  /**
   * Check if queue should flush based on size
   */
  private shouldFlushBySize(queue: DocumentQueue): boolean {
    return queue.totalSize >= this.config.maxBatchSizeBytes
  }

  /**
   * Check if queue should flush based on count
   */
  private shouldFlushByCount(queue: DocumentQueue): boolean {
    return queue.updates.length >= this.config.maxBatchSize
  }

  /**
   * Reset the debounce timer for a document
   */
  private resetTimer(docName: string): void {
    const queue = this.queues.get(docName)
    if (!queue) return

    // Clear existing timer
    if (queue.timer) {
      clearTimeout(queue.timer)
    }

    // Set new timer with debounce
    const timeoutMs = this.config.debounceMs > 0 
      ? this.config.debounceMs + this.config.batchTimeout
      : this.config.batchTimeout

    queue.timer = setTimeout(() => {
      this.flush(docName, 'timeout').catch(error => {
        console.error(`[BatchingProvider] Error in timeout flush for ${docName}:`, error)
        this.metrics.errors++
        this.metrics.lastError = error.message
      })
    }, timeoutMs)
  }

  /**
   * Flush pending updates for a document
   */
  private async flush(docName: string, reason: FlushReason): Promise<void> {
    // Check if already flushing
    const existingFlush = this.flushPromises.get(docName)
    if (existingFlush) {
      return existingFlush
    }

    const flushPromise = this.doFlush(docName, reason)
    this.flushPromises.set(docName, flushPromise)

    try {
      await flushPromise
    } finally {
      this.flushPromises.delete(docName)
    }
  }

  /**
   * Perform the actual flush operation
   */
  private async doFlush(docName: string, reason: FlushReason): Promise<void> {
    const queue = this.queues.get(docName)
    if (!queue || queue.updates.length === 0) return

    // Clear timer
    if (queue.timer) {
      clearTimeout(queue.timer)
      queue.timer = undefined
    }

    // Get updates and clear queue
    const updates = queue.updates
    const totalSize = queue.totalSize
    this.queues.delete(docName)

    if (this.config.debug) {
      console.log(`[BatchingProvider] Flushing ${updates.length} updates for ${docName}. Reason: ${reason}, Total size: ${totalSize}`)
    }

    try {
      let finalUpdate: Uint8Array

      if (this.config.coalesce && updates.length > 1) {
        try {
          // Attempt to merge updates
          const updateArrays = updates.map(u => u.data)
          finalUpdate = Y.mergeUpdates(updateArrays)
          
          // Calculate compression ratio
          const compressionRatio = totalSize / finalUpdate.byteLength
          this.updateCompressionRatio(compressionRatio)

          if (this.config.debug) {
            console.log(`[BatchingProvider] Merged ${updates.length} updates. Original: ${totalSize} bytes, Merged: ${finalUpdate.byteLength} bytes, Ratio: ${compressionRatio.toFixed(2)}x`)
          }
        } catch (mergeError) {
          // Fallback to concatenation if merge fails
          console.warn(`[BatchingProvider] Failed to merge updates for ${docName}, falling back to sequential persist:`, mergeError)
          
          // Persist updates individually
          for (const update of updates) {
            await this.adapter.persist(docName, update.data)
          }
          
          this.updateMetrics(updates.length, reason)
          return
        }
      } else {
        // Single update or coalescing disabled
        if (updates.length === 1) {
          finalUpdate = updates[0].data
        } else {
          // Multiple updates but coalescing disabled - persist individually
          for (const update of updates) {
            await this.adapter.persist(docName, update.data)
          }
          
          this.updateMetrics(updates.length, reason)
          this.emit('flush', { 
            docName, 
            updateCount: updates.length, 
            finalSize: totalSize,
            reason 
          })
          return
        }
      }

      // Persist the final update
      await this.adapter.persist(docName, finalUpdate)
      
      this.updateMetrics(updates.length, reason)
      this.emit('flush', { 
        docName, 
        updateCount: updates.length, 
        finalSize: finalUpdate.byteLength,
        reason 
      })

    } catch (error) {
      console.error(`[BatchingProvider] Error flushing updates for ${docName}:`, error)
      this.metrics.errors++
      this.metrics.lastError = (error as Error).message
      
      // Re-queue updates for retry
      const newQueue: DocumentQueue = {
        updates,
        totalSize
      }
      this.queues.set(docName, newQueue)
      
      throw error
    }
  }

  /**
   * Update metrics after a flush
   */
  private updateMetrics(updateCount: number, reason: FlushReason): void {
    this.metrics.totalBatches++
    // Don't increment totalUpdates here - it's already incremented in enqueue()
    this.metrics.averageBatchSize = this.metrics.totalUpdates / this.metrics.totalBatches
    this.metrics.flushReasons[reason]++
  }

  /**
   * Update compression ratio metric
   */
  private updateCompressionRatio(ratio: number): void {
    // Running average
    const alpha = 0.1 // Smoothing factor
    if (this.metrics.compressionRatio === 1) {
      this.metrics.compressionRatio = ratio
    } else {
      this.metrics.compressionRatio = 
        (1 - alpha) * this.metrics.compressionRatio + alpha * ratio
    }
  }
}