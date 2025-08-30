# Plain-Mode Batching Integration Guide
Date: 2025-08-30
Type: Integration Documentation

## Overview

This guide provides step-by-step instructions for integrating the plain-mode batching system into the existing annotation project. The batching system is designed to work seamlessly with the current Option A (plain mode) implementation.

## Integration Points

### 1. Application Initialization

**File**: `app/annotation-app.tsx` or main entry point

```typescript
import { PlainOfflineProvider } from '@/lib/providers/plain-offline-provider'
import { PlainBatchMonitor } from '@/components/debug/plain-batch-monitor'
import { getPlainBatchConfig } from '@/lib/batching/plain-batch-config'

export function AnnotationApp() {
  const [provider, setProvider] = useState<PlainOfflineProvider>()
  
  useEffect(() => {
    // Initialize provider with batching enabled
    const plainProvider = new PlainOfflineProvider({
      enableBatching: true,
      batchConfig: getPlainBatchConfig()
    })
    
    setProvider(plainProvider)
    
    // Connect DataStore to batch manager
    if (dataStore && plainProvider.getBatchManager) {
      dataStore.setBatchManager(plainProvider.getBatchManager())
    }
  }, [])
  
  return (
    <>
      {/* Your app components */}
      
      {/* Add batch monitor in development */}
      {process.env.NODE_ENV === 'development' && provider?.getBatchManager && (
        <PlainBatchMonitor batchManager={provider.getBatchManager()} />
      )}
    </>
  )
}
```

### 2. DataStore Integration

The DataStore automatically uses batching when a batch manager is set:

```typescript
// In your component or provider initialization
const dataStore = new DataStore()
const batchManager = new PlainBatchManager(provider, config)

dataStore.setBatchManager(batchManager)

// Now all dataStore operations are automatically batched
dataStore.set('branch:123', branchData) // Queued for batching
dataStore.update('panel:456', { position: newPosition }) // Queued for batching
```

### 3. Environment Configuration

**File**: `.env.local`

```bash
# Batching Configuration
NEXT_PUBLIC_BATCHING_ENABLED=true
NEXT_PUBLIC_BATCH_MAX_SIZE=50
NEXT_PUBLIC_BATCH_TIMEOUT=1000
NEXT_PUBLIC_BATCH_DEBOUNCE=200
NEXT_PUBLIC_BATCH_COALESCE=true
NEXT_PUBLIC_BATCH_DEBUG=true
```

### 4. API Route Setup

Create batch endpoints for each entity type:

**File**: `app/api/postgres-offline/documents/batch/route.ts`
```typescript
export { POST, PUT, DELETE } from '@/lib/api/batch-handler'
```

**File**: `app/api/postgres-offline/branches/batch/route.ts`
```typescript
export { POST, PUT, DELETE } from '@/lib/api/batch-handler'
```

**File**: `app/api/postgres-offline/panels/batch/route.ts`
```typescript
export { POST, PUT, DELETE } from '@/lib/api/batch-handler'
```

### 5. Migration Requirements

Ensure these migrations are applied:
- `004_offline_queue.*` - Offline queue table
- `005_document_saves.*` - Document saves table
- `009_allow_document_saves_in_offline_queue.*` - Allow document_saves in offline_queue

## Configuration Options

### Development Configuration

```typescript
const devConfig: PlainBatchConfig = {
  maxBatchSize: 10,          // Smaller batches for easier debugging
  maxBatchSizeBytes: 102400, // 100KB
  batchTimeout: 500,         // Faster flushes for testing
  debounceMs: 100,          // Quick response
  coalesce: true,           // Test coalescing logic
  debug: true,              // Enable debug logging
  monitor: true             // Show batch monitor UI
}
```

### Production Configuration

```typescript
const prodConfig: PlainBatchConfig = {
  maxBatchSize: 50,          // Larger batches for efficiency
  maxBatchSizeBytes: 512000, // 500KB
  batchTimeout: 1000,        // 1 second max wait
  debounceMs: 200,          // Balance responsiveness
  coalesce: true,           // Reduce redundant updates
  debug: false,             // Disable debug logging
  monitor: false            // Hide monitor UI
}
```

### Electron Configuration

```typescript
const electronConfig: PlainBatchConfig = {
  maxBatchSize: 100,         // More aggressive batching
  maxBatchSizeBytes: 1048576, // 1MB
  batchTimeout: 2000,        // Longer timeout acceptable
  debounceMs: 300,          // Can be less responsive
  coalesce: true,           // Important for local DB
  persistQueue: true,       // Persist across app restarts
  offlineQueueLimit: 1000   // Larger offline capacity
}
```

## Feature Flags

### Enable/Disable Batching

```typescript
// Runtime toggle
provider.setBatchingEnabled(false) // Disable batching
provider.setBatchingEnabled(true)  // Re-enable batching

// Per-operation override
provider.saveDocument(noteId, panelId, content, version, {
  skipBatching: true // Bypass batching for this operation
})
```

### Debug Mode

```typescript
// Enable verbose logging
if (process.env.NEXT_PUBLIC_BATCH_DEBUG === 'true') {
  batchManager.on('operation-queued', (op) => {
    console.log('[Batch] Queued:', op)
  })
  
  batchManager.on('batch-flushed', ({ queueKey, count }) => {
    console.log(`[Batch] Flushed ${count} ops for ${queueKey}`)
  })
  
  batchManager.on('batch-error', ({ operations, error }) => {
    console.error('[Batch] Error:', error, operations)
  })
}
```

## Migration Path

### Phase 1: Parallel Implementation
1. Add batching alongside existing code
2. Use feature flag to control activation
3. Monitor both paths in production

### Phase 2: Gradual Rollout
1. Enable for internal users (5%)
2. Expand to beta users (25%)
3. Monitor metrics and errors
4. Full rollout (100%)

### Phase 3: Cleanup
1. Remove old non-batched code paths
2. Make batching the default
3. Remove feature flags

## Monitoring and Metrics

### Key Metrics to Track

```typescript
interface BatchingMetrics {
  // Performance
  totalOperationsQueued: number
  totalBatchesFlushed: number
  averageBatchSize: number
  coalescingRatio: number // (original - coalesced) / original
  
  // Reliability
  batchSuccessRate: number
  retryCount: number
  failedOperations: number
  
  // Efficiency
  apiCallsReduction: number // % reduction vs non-batched
  bytesTransferred: number
  averageLatency: number
}
```

### Logging Strategy

```typescript
// Structured logging for analysis
const logBatchEvent = (event: string, data: any) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event: `batch.${event}`,
    ...data
  }))
}

batchManager.on('batch-flushed', (data) => {
  logBatchEvent('flushed', {
    queueKey: data.queueKey,
    count: data.count,
    duration: data.duration
  })
})
```

## Troubleshooting

### Common Issues

#### 1. Operations Not Being Batched

**Symptoms**: Individual API calls still being made

**Solutions**:
- Verify batching is enabled: `provider.isBatchingEnabled()`
- Check batch configuration timeouts
- Ensure DataStore has batch manager set
- Verify API endpoints support batch operations

#### 2. Lost Updates

**Symptoms**: Some changes not persisted

**Solutions**:
- Check coalescing logic preserves all fields
- Verify idempotency keys are unique
- Review retry logic for failed batches
- Check offline queue persistence

#### 3. Performance Degradation

**Symptoms**: UI feels sluggish

**Solutions**:
- Reduce batch timeout for faster flushes
- Decrease debounce time
- Check batch size limits
- Profile coalescing performance

### Debug Commands

```javascript
// In browser console

// Check batch manager status
window.__batchManager?.getStatus()

// Force flush all queues
window.__batchManager?.flushAll()

// View queue contents
window.__batchManager?.getQueues()

// Disable batching temporarily
window.__provider?.setBatchingEnabled(false)

// Clear offline queue
localStorage.removeItem('plain-offline-queue')
```

## Testing Integration

### Unit Test Example

```typescript
describe('Batching Integration', () => {
  it('should batch rapid updates', async () => {
    const provider = new PlainOfflineProvider({
      enableBatching: true,
      batchConfig: { maxBatchSize: 3, batchTimeout: 100 }
    })
    
    const spy = jest.spyOn(provider, 'batchExecute')
    
    // Rapid updates
    await provider.saveDocument('note1', 'panel1', 'content1', 1)
    await provider.saveDocument('note1', 'panel1', 'content2', 2)
    await provider.saveDocument('note1', 'panel1', 'content3', 3)
    
    // Should batch into single call
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('document', expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ version: 3 }) })
    ]))
  })
})
```

### E2E Test Example

```typescript
describe('Batching E2E', () => {
  it('should handle offline to online transition', async () => {
    // Simulate offline
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'))
    })
    
    // Make changes while offline
    await page.type('#editor', 'Offline content')
    
    // Verify queued
    const queueSize = await page.evaluate(() => {
      return window.__batchManager?.getQueueStatus().size
    })
    expect(queueSize).toBeGreaterThan(0)
    
    // Go online
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'))
    })
    
    // Wait for flush
    await page.waitForTimeout(2000)
    
    // Verify queue cleared
    const finalSize = await page.evaluate(() => {
      return window.__batchManager?.getQueueStatus().size
    })
    expect(finalSize).toBe(0)
  })
})
```

## Performance Benchmarks

### Expected Improvements

| Metric | Without Batching | With Batching | Improvement |
|--------|-----------------|---------------|-------------|
| API Calls/min | 300-500 | 20-50 | 85-95% reduction |
| DB Transactions/min | 300-500 | 20-50 | 85-95% reduction |
| Network Bytes/min | 150KB | 30KB | 80% reduction |
| Average Latency | 50ms | 45ms | 10% improvement |
| Memory Usage | 50MB | 55MB | 10% increase |

### Load Testing

```bash
# Run load test with batching disabled
npm run test:load -- --no-batching

# Run load test with batching enabled
npm run test:load -- --with-batching

# Compare results
npm run test:load:compare
```

## Security Considerations

### Idempotency Keys

- Use cryptographically secure random generation
- Include user ID in key to prevent cross-user conflicts
- Expire keys after reasonable time (24 hours)

### Rate Limiting

- Implement per-user batch limits
- Monitor for abuse patterns
- Add circuit breakers for failing endpoints

### Data Validation

- Validate batch size limits on server
- Sanitize all inputs in batch operations
- Verify user permissions for all entities in batch

## Rollback Plan

If issues arise with batching:

1. **Immediate**: Disable via feature flag
   ```typescript
   provider.setBatchingEnabled(false)
   ```

2. **Temporary**: Reduce batch sizes
   ```typescript
   provider.updateBatchConfig({ maxBatchSize: 1 })
   ```

3. **Full Rollback**: Revert to previous version
   ```bash
   git revert <batching-commit>
   npm run build
   npm run deploy
   ```

## Conclusion

The plain-mode batching system integrates seamlessly with the existing Option A implementation. It provides significant performance improvements while maintaining backward compatibility and allowing for gradual rollout. The modular design ensures that the system can be enabled, disabled, or tuned without affecting core functionality.