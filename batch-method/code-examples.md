# Batching Method - Code Examples

## 1. Basic Integration Example

```typescript
// app.tsx - Main application setup
import { EnhancedCollaborationProvider } from './lib/enhanced-yjs-provider'
import { BatchingMonitor } from './components/batching-monitor'

export function App() {
  const [provider, setProvider] = useState(null)
  
  useEffect(() => {
    // Initialize provider with batching enabled
    const collaborationProvider = EnhancedCollaborationProvider.getInstance()
    setProvider(collaborationProvider)
    
    // Initialize note
    collaborationProvider.initializeNote('note-1', {
      panel1: { title: 'Main Panel', type: 'editor' }
    })
    
    return () => {
      // Cleanup on unmount
      collaborationProvider.destroy()
    }
  }, [])
  
  return (
    <div>
      <YourEditor provider={provider} />
      <BatchingMonitor />  {/* Shows real-time metrics */}
    </div>
  )
}
```

## 2. Custom Configuration Example

```typescript
// custom-config.ts
import { BatchingPersistenceProvider } from './lib/persistence/batching-provider'
import { PostgresAPIAdapter } from './lib/adapters/postgres-api-adapter'

// Create custom configuration for high-traffic scenario
const HIGH_TRAFFIC_CONFIG = {
  maxBatchSize: 500,              // Larger batches
  maxBatchSizeBytes: 5 * 1024 * 1024,  // 5MB limit
  batchTimeout: 5000,             // 5 second timeout
  debounceMs: 1000,              // 1 second debounce
  coalesce: true,                // Enable merging
  debug: false                   // Disable debug in production
}

// Initialize with custom config
const baseAdapter = new PostgresAPIAdapter()
const batchingProvider = new BatchingPersistenceProvider(
  baseAdapter,
  HIGH_TRAFFIC_CONFIG
)

export { batchingProvider }
```

## 3. Manual Flush Example

```typescript
// save-handler.tsx
import { EnhancedCollaborationProvider } from './lib/enhanced-yjs-provider'

export function SaveButton() {
  const [saving, setSaving] = useState(false)
  
  const handleSave = async () => {
    setSaving(true)
    
    try {
      const provider = EnhancedCollaborationProvider.getInstance()
      
      // Force flush all pending updates
      if (provider.persistence instanceof BatchingPersistenceProvider) {
        await provider.persistence.flushAll()
        console.log('All changes saved successfully')
      }
      
      // Show success notification
      toast.success('Changes saved!')
    } catch (error) {
      console.error('Save failed:', error)
      toast.error('Failed to save changes')
    } finally {
      setSaving(false)
    }
  }
  
  return (
    <button onClick={handleSave} disabled={saving}>
      {saving ? 'Saving...' : 'Save All'}
    </button>
  )
}
```

## 4. Metrics Monitoring Example

```typescript
// metrics-dashboard.tsx
import { useEffect, useState } from 'react'

interface DetailedMetrics {
  writeReduction: string
  compressionRatio: number
  queueStatus: string
  lastFlushReason: string
}

export function MetricsDashboard() {
  const [metrics, setMetrics] = useState<DetailedMetrics | null>(null)
  
  useEffect(() => {
    const updateMetrics = () => {
      const provider = (window as any).yjsProvider
      
      if (provider?.getBatchingMetrics) {
        const raw = provider.getBatchingMetrics()
        
        const writeReduction = raw.totalUpdates > 0
          ? ((1 - raw.totalBatches / raw.totalUpdates) * 100).toFixed(1)
          : '0'
        
        const lastFlushReason = Object.entries(raw.flushReasons)
          .sort(([,a], [,b]) => b - a)[0]?.[0] || 'none'
        
        setMetrics({
          writeReduction: writeReduction + '%',
          compressionRatio: raw.compressionRatio,
          queueStatus: `${raw.totalUpdates - raw.totalBatches} pending`,
          lastFlushReason
        })
      }
    }
    
    // Update every second
    const interval = setInterval(updateMetrics, 1000)
    updateMetrics() // Initial update
    
    return () => clearInterval(interval)
  }, [])
  
  if (!metrics) return null
  
  return (
    <div className="metrics-dashboard">
      <h3>Batching Performance</h3>
      <div className="metric">
        <label>Write Reduction:</label>
        <span className="value">{metrics.writeReduction}</span>
      </div>
      <div className="metric">
        <label>Compression:</label>
        <span className="value">{metrics.compressionRatio.toFixed(2)}x</span>
      </div>
      <div className="metric">
        <label>Queue Status:</label>
        <span className="value">{metrics.queueStatus}</span>
      </div>
      <div className="metric">
        <label>Last Flush:</label>
        <span className="value">{metrics.lastFlushReason}</span>
      </div>
    </div>
  )
}
```

## 5. Offline Queue Management Example

```typescript
// offline-manager.ts
import { OfflineStore } from './lib/stores/offline-store'
import { LocalSyncQueue } from './lib/stores/local-sync-queue'

export class OfflineQueueManager {
  private store: OfflineStore
  private syncQueue: LocalSyncQueue
  private statusListeners: Set<(online: boolean) => void> = new Set()
  
  constructor() {
    this.store = new OfflineStore()
    this.syncQueue = new LocalSyncQueue(this.store.postgresAdapter)
    
    this.setupEventListeners()
  }
  
  private setupEventListeners() {
    // Monitor online/offline status
    window.addEventListener('online', () => this.handleOnline())
    window.addEventListener('offline', () => this.handleOffline())
    
    // Check initial status
    if (navigator.onLine) {
      this.handleOnline()
    } else {
      this.handleOffline()
    }
  }
  
  private async handleOnline() {
    console.log('🟢 Online - Starting sync...')
    this.notifyListeners(true)
    
    try {
      // Get queued operations
      const operations = await this.syncQueue.getQueuedOperations()
      console.log(`Found ${operations.length} queued operations`)
      
      // Flush the queue
      await this.syncQueue.flush()
      
      // Verify sync
      const remaining = await this.syncQueue.getQueuedOperations()
      if (remaining.length === 0) {
        console.log('✅ Sync complete - all operations processed')
      } else {
        console.warn(`⚠️ ${remaining.length} operations still pending`)
      }
    } catch (error) {
      console.error('❌ Sync failed:', error)
    }
  }
  
  private handleOffline() {
    console.log('🔴 Offline - Operations will be queued')
    this.notifyListeners(false)
    
    // Stop queue processor
    this.syncQueue.stopQueueProcessor()
  }
  
  // Subscribe to status changes
  onStatusChange(callback: (online: boolean) => void): () => void {
    this.statusListeners.add(callback)
    return () => this.statusListeners.delete(callback)
  }
  
  private notifyListeners(online: boolean) {
    this.statusListeners.forEach(listener => listener(online))
  }
  
  // Get queue statistics
  async getQueueStats() {
    const operations = await this.syncQueue.getQueuedOperations()
    
    const stats = {
      total: operations.length,
      byType: {} as Record<string, number>,
      byTable: {} as Record<string, number>,
      oldestOperation: null as Date | null
    }
    
    operations.forEach(op => {
      // Count by type
      stats.byType[op.type] = (stats.byType[op.type] || 0) + 1
      
      // Count by table
      stats.byTable[op.table] = (stats.byTable[op.table] || 0) + 1
      
      // Find oldest
      if (!stats.oldestOperation || op.timestamp < stats.oldestOperation) {
        stats.oldestOperation = op.timestamp
      }
    })
    
    return stats
  }
}

// Usage in React component
export function OfflineIndicator() {
  const [online, setOnline] = useState(navigator.onLine)
  const [queueStats, setQueueStats] = useState(null)
  
  useEffect(() => {
    const manager = new OfflineQueueManager()
    
    // Subscribe to status changes
    const unsubscribe = manager.onStatusChange(setOnline)
    
    // Update queue stats periodically
    const interval = setInterval(async () => {
      const stats = await manager.getQueueStats()
      setQueueStats(stats)
    }, 5000)
    
    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [])
  
  return (
    <div className={`offline-indicator ${online ? 'online' : 'offline'}`}>
      <span className="status-dot" />
      <span>{online ? 'Online' : 'Offline'}</span>
      {!online && queueStats?.total > 0 && (
        <span className="queue-count">
          ({queueStats.total} pending)
        </span>
      )}
    </div>
  )
}
```

## 6. Testing Example

```typescript
// batching.test.ts
import { BatchingPersistenceProvider } from './lib/persistence/batching-provider'
import { TEST_CONFIG } from './lib/persistence/batching-config'

describe('Batching Provider', () => {
  let provider: BatchingPersistenceProvider
  let mockAdapter: any
  
  beforeEach(() => {
    // Create mock adapter
    mockAdapter = {
      persist: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue(null),
      getAllUpdates: jest.fn().mockResolvedValue([]),
      clearUpdates: jest.fn().mockResolvedValue(undefined),
      saveSnapshot: jest.fn().mockResolvedValue(undefined),
      loadSnapshot: jest.fn().mockResolvedValue(null),
      compact: jest.fn().mockResolvedValue(undefined)
    }
    
    // Create provider with test config
    provider = new BatchingPersistenceProvider(mockAdapter, TEST_CONFIG)
  })
  
  afterEach(async () => {
    await provider.shutdown()
  })
  
  test('should batch multiple updates', async () => {
    // Send multiple updates
    const updates = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      new Uint8Array([7, 8, 9])
    ]
    
    for (const update of updates) {
      await provider.persist('test-doc', update)
    }
    
    // Should not persist immediately
    expect(mockAdapter.persist).not.toHaveBeenCalled()
    
    // Wait for timeout flush
    await new Promise(resolve => setTimeout(resolve, 200))
    
    // Should have persisted once with merged updates
    expect(mockAdapter.persist).toHaveBeenCalledTimes(1)
    
    // Check metrics
    const metrics = provider.getMetrics()
    expect(metrics.totalUpdates).toBe(3)
    expect(metrics.totalBatches).toBe(1)
    expect(metrics.flushReasons.timeout).toBe(1)
  })
  
  test('should flush on size limit', async () => {
    // Create large update that exceeds size limit
    const largeUpdate = new Uint8Array(TEST_CONFIG.maxBatchSizeBytes + 1)
    
    await provider.persist('test-doc', largeUpdate)
    
    // Should flush immediately due to size
    expect(mockAdapter.persist).toHaveBeenCalledTimes(1)
    
    const metrics = provider.getMetrics()
    expect(metrics.flushReasons.size).toBe(1)
  })
  
  test('should flush on count limit', async () => {
    // Send updates up to count limit
    for (let i = 0; i < TEST_CONFIG.maxBatchSize; i++) {
      await provider.persist('test-doc', new Uint8Array([i]))
    }
    
    // Should flush due to count
    expect(mockAdapter.persist).toHaveBeenCalledTimes(1)
    
    const metrics = provider.getMetrics()
    expect(metrics.flushReasons.count).toBe(1)
  })
  
  test('should handle shutdown gracefully', async () => {
    // Queue some updates
    await provider.persist('test-doc', new Uint8Array([1]))
    await provider.persist('test-doc', new Uint8Array([2]))
    
    // Shutdown should flush pending updates
    await provider.shutdown()
    
    expect(mockAdapter.persist).toHaveBeenCalledTimes(1)
    
    const metrics = provider.getMetrics()
    expect(metrics.flushReasons.shutdown).toBe(1)
  })
})
```

## 7. Performance Optimization Example

```typescript
// performance-optimizer.ts
import { EnhancedCollaborationProvider } from './lib/enhanced-yjs-provider'
import { BatchingConfig } from './lib/persistence/batching-config'

export class BatchingOptimizer {
  private provider: EnhancedCollaborationProvider
  private performanceHistory: Array<{
    timestamp: Date
    writeReduction: number
    compressionRatio: number
    averageBatchSize: number
  }> = []
  
  constructor() {
    this.provider = EnhancedCollaborationProvider.getInstance()
    this.startMonitoring()
  }
  
  private startMonitoring() {
    // Collect metrics every minute
    setInterval(() => {
      const metrics = this.provider.getBatchingMetrics()
      if (metrics) {
        const writeReduction = metrics.totalUpdates > 0
          ? (1 - metrics.totalBatches / metrics.totalUpdates)
          : 0
        
        this.performanceHistory.push({
          timestamp: new Date(),
          writeReduction,
          compressionRatio: metrics.compressionRatio,
          averageBatchSize: metrics.averageBatchSize
        })
        
        // Keep only last hour of data
        const oneHourAgo = Date.now() - 60 * 60 * 1000
        this.performanceHistory = this.performanceHistory.filter(
          entry => entry.timestamp.getTime() > oneHourAgo
        )
        
        // Auto-optimize if needed
        this.autoOptimize()
      }
    }, 60000) // Every minute
  }
  
  private autoOptimize() {
    const recent = this.performanceHistory.slice(-10) // Last 10 minutes
    if (recent.length < 5) return // Need enough data
    
    const avgWriteReduction = recent.reduce(
      (sum, entry) => sum + entry.writeReduction, 0
    ) / recent.length
    
    const avgBatchSize = recent.reduce(
      (sum, entry) => sum + entry.averageBatchSize, 0
    ) / recent.length
    
    // Suggest optimizations
    const suggestions: string[] = []
    
    if (avgWriteReduction < 0.8) {
      suggestions.push('Low write reduction - consider increasing batch timeout')
    }
    
    if (avgBatchSize < 5) {
      suggestions.push('Small batches - consider increasing debounce time')
    }
    
    if (avgBatchSize > 100) {
      suggestions.push('Large batches - consider decreasing batch size limit')
    }
    
    if (suggestions.length > 0) {
      console.log('Performance suggestions:', suggestions)
      this.notifyOptimizations(suggestions)
    }
  }
  
  private notifyOptimizations(suggestions: string[]) {
    // Emit custom event for UI notification
    window.dispatchEvent(new CustomEvent('batching-optimization', {
      detail: { suggestions }
    }))
  }
  
  // Get performance report
  getPerformanceReport() {
    const metrics = this.provider.getBatchingMetrics()
    const history = this.performanceHistory
    
    return {
      current: {
        totalUpdates: metrics?.totalUpdates || 0,
        totalBatches: metrics?.totalBatches || 0,
        compressionRatio: metrics?.compressionRatio || 1,
        errors: metrics?.errors || 0
      },
      averages: {
        writeReduction: history.reduce(
          (sum, e) => sum + e.writeReduction, 0
        ) / history.length,
        compressionRatio: history.reduce(
          (sum, e) => sum + e.compressionRatio, 0
        ) / history.length,
        batchSize: history.reduce(
          (sum, e) => sum + e.averageBatchSize, 0
        ) / history.length
      },
      trend: this.calculateTrend(),
      recommendations: this.getRecommendations()
    }
  }
  
  private calculateTrend(): 'improving' | 'stable' | 'degrading' {
    if (this.performanceHistory.length < 10) return 'stable'
    
    const firstHalf = this.performanceHistory.slice(0, 5)
    const secondHalf = this.performanceHistory.slice(-5)
    
    const firstAvg = firstHalf.reduce(
      (sum, e) => sum + e.writeReduction, 0
    ) / firstHalf.length
    
    const secondAvg = secondHalf.reduce(
      (sum, e) => sum + e.writeReduction, 0
    ) / secondHalf.length
    
    if (secondAvg > firstAvg + 0.1) return 'improving'
    if (secondAvg < firstAvg - 0.1) return 'degrading'
    return 'stable'
  }
  
  private getRecommendations(): string[] {
    const recommendations: string[] = []
    const metrics = this.provider.getBatchingMetrics()
    
    if (!metrics) return recommendations
    
    // Analyze flush reasons
    const totalFlushes = Object.values(metrics.flushReasons).reduce(
      (sum, count) => sum + count, 0
    )
    
    if (totalFlushes > 0) {
      const timeoutPercent = metrics.flushReasons.timeout / totalFlushes
      const sizePercent = metrics.flushReasons.size / totalFlushes
      const countPercent = metrics.flushReasons.count / totalFlushes
      
      if (timeoutPercent > 0.7) {
        recommendations.push(
          'Most flushes are timeout-based. Consider reducing timeout for faster persistence.'
        )
      }
      
      if (sizePercent > 0.5) {
        recommendations.push(
          'Many size-based flushes. Consider increasing maxBatchSizeBytes.'
        )
      }
      
      if (countPercent > 0.5) {
        recommendations.push(
          'Many count-based flushes. Consider increasing maxBatchSize.'
        )
      }
    }
    
    if (metrics.errors > 0) {
      recommendations.push(
        `${metrics.errors} errors detected. Check logs for details.`
      )
    }
    
    return recommendations
  }
}
```

## 8. Advanced Error Recovery Example

```typescript
// error-recovery.ts
import { EventEmitter } from 'events'

export class ResilientBatchingSystem extends EventEmitter {
  private retryQueue: Map<string, {
    attempts: number
    lastError: Error
    data: Uint8Array
    nextRetry: Date
  }> = new Map()
  
  async persistWithRecovery(
    provider: BatchingPersistenceProvider,
    docName: string,
    update: Uint8Array
  ): Promise<void> {
    try {
      await provider.persist(docName, update)
      
      // Clear from retry queue if successful
      this.retryQueue.delete(`${docName}-${update.byteLength}`)
      
    } catch (error) {
      console.error('Persist failed:', error)
      
      // Add to retry queue
      const key = `${docName}-${update.byteLength}`
      const existing = this.retryQueue.get(key)
      
      this.retryQueue.set(key, {
        attempts: (existing?.attempts || 0) + 1,
        lastError: error as Error,
        data: update,
        nextRetry: new Date(Date.now() + this.getBackoffDelay(existing?.attempts || 0))
      })
      
      // Schedule retry
      this.scheduleRetry(provider, docName, key)
      
      // Emit error event
      this.emit('persist-error', {
        docName,
        error,
        attempts: (existing?.attempts || 0) + 1
      })
    }
  }
  
  private getBackoffDelay(attempts: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, then 60s
    return Math.min(Math.pow(2, attempts) * 1000, 60000)
  }
  
  private scheduleRetry(
    provider: BatchingPersistenceProvider,
    docName: string,
    key: string
  ) {
    const entry = this.retryQueue.get(key)
    if (!entry) return
    
    const delay = entry.nextRetry.getTime() - Date.now()
    
    setTimeout(async () => {
      // Check if still in queue
      if (!this.retryQueue.has(key)) return
      
      // Attempt retry
      try {
        await provider.persist(docName, entry.data)
        
        // Success - remove from queue
        this.retryQueue.delete(key)
        this.emit('persist-recovered', { docName, attempts: entry.attempts })
        
      } catch (error) {
        // Failed again
        if (entry.attempts >= 10) {
          // Max retries reached
          this.retryQueue.delete(key)
          this.emit('persist-failed', {
            docName,
            error,
            attempts: entry.attempts
          })
        } else {
          // Schedule next retry
          entry.attempts++
          entry.lastError = error as Error
          entry.nextRetry = new Date(
            Date.now() + this.getBackoffDelay(entry.attempts)
          )
          this.scheduleRetry(provider, docName, key)
        }
      }
    }, Math.max(delay, 0))
  }
  
  getRetryQueueStatus() {
    const entries = Array.from(this.retryQueue.entries())
    
    return {
      pending: entries.length,
      items: entries.map(([key, value]) => ({
        key,
        attempts: value.attempts,
        nextRetry: value.nextRetry,
        error: value.lastError.message
      }))
    }
  }
}
```