# Plain-Mode Batching Test Specifications
Date: 2025-08-30
Type: Test Documentation

## Test Coverage Overview

This document outlines comprehensive test specifications for the plain-mode batching implementation. Tests are organized by component and include unit, integration, and end-to-end test scenarios.

## Unit Tests

### 1. PlainBatchManager Tests

**File**: `__tests__/batching/plain-batch-manager.test.ts`

#### Test Suite: Operation Queueing

```typescript
describe('PlainBatchManager - Operation Queueing', () => {
  test('should queue operations without immediate execution', async () => {
    const mockProvider = createMockProvider()
    const manager = new PlainBatchManager(mockProvider, {
      maxBatchSize: 10,
      batchTimeout: 1000
    })
    
    await manager.enqueue({
      entityType: 'document',
      entityId: 'doc1',
      operation: 'update',
      data: { content: 'test' }
    })
    
    expect(mockProvider.batchExecute).not.toHaveBeenCalled()
    expect(manager.getQueueSize()).toBe(1)
  })
  
  test('should generate unique operation IDs', async () => {
    const manager = new PlainBatchManager(mockProvider, config)
    const ids = new Set()
    
    for (let i = 0; i < 100; i++) {
      const op = await manager.enqueue({
        entityType: 'document',
        entityId: `doc${i}`,
        operation: 'update',
        data: {}
      })
      ids.add(op.id)
    }
    
    expect(ids.size).toBe(100)
  })
  
  test('should maintain separate queues per entity', async () => {
    const manager = new PlainBatchManager(mockProvider, config)
    
    await manager.enqueue({ entityType: 'document', entityId: 'doc1', operation: 'update', data: {} })
    await manager.enqueue({ entityType: 'branch', entityId: 'branch1', operation: 'create', data: {} })
    await manager.enqueue({ entityType: 'panel', entityId: 'panel1', operation: 'update', data: {} })
    
    expect(manager.getQueues().size).toBe(3)
  })
})
```

#### Test Suite: Coalescing Logic

```typescript
describe('PlainBatchManager - Coalescing', () => {
  test('should coalesce multiple updates to same entity', async () => {
    const manager = new PlainBatchManager(mockProvider, {
      coalesce: true,
      maxBatchSize: 10
    })
    
    await manager.enqueue({
      entityType: 'document',
      entityId: 'doc1',
      operation: 'update',
      data: { title: 'Version 1' }
    })
    
    await manager.enqueue({
      entityType: 'document',
      entityId: 'doc1',
      operation: 'update',
      data: { content: 'Content', title: 'Version 2' }
    })
    
    await manager.flushAll()
    
    const executed = mockProvider.batchExecute.mock.calls[0][1]
    expect(executed).toHaveLength(1)
    expect(executed[0].data).toEqual({
      title: 'Version 2',
      content: 'Content'
    })
  })
  
  test('should not coalesce when disabled', async () => {
    const manager = new PlainBatchManager(mockProvider, {
      coalesce: false,
      maxBatchSize: 10
    })
    
    await manager.enqueue({ entityType: 'document', entityId: 'doc1', operation: 'update', data: { v: 1 } })
    await manager.enqueue({ entityType: 'document', entityId: 'doc1', operation: 'update', data: { v: 2 } })
    
    await manager.flushAll()
    
    const executed = mockProvider.batchExecute.mock.calls[0][1]
    expect(executed).toHaveLength(2)
  })
  
  test('should preserve operation order for different entities', async () => {
    const manager = new PlainBatchManager(mockProvider, {
      coalesce: true,
      preserveOrder: true
    })
    
    const operations = []
    for (let i = 0; i < 5; i++) {
      operations.push(await manager.enqueue({
        entityType: 'document',
        entityId: `doc${i}`,
        operation: 'update',
        data: { order: i }
      }))
    }
    
    await manager.flushAll()
    
    const executed = mockProvider.batchExecute.mock.calls[0][1]
    executed.forEach((op, index) => {
      expect(op.data.order).toBe(index)
    })
  })
})
```

#### Test Suite: Flush Triggers

```typescript
describe('PlainBatchManager - Flush Triggers', () => {
  test('should flush when reaching maxBatchSize', async () => {
    const manager = new PlainBatchManager(mockProvider, {
      maxBatchSize: 3,
      batchTimeout: 10000 // Long timeout
    })
    
    for (let i = 0; i < 3; i++) {
      await manager.enqueue({
        entityType: 'document',
        entityId: `doc${i}`,
        operation: 'update',
        data: {}
      })
    }
    
    // Should auto-flush at size limit
    expect(mockProvider.batchExecute).toHaveBeenCalledTimes(1)
  })
  
  test('should flush when reaching maxBatchSizeBytes', async () => {
    const manager = new PlainBatchManager(mockProvider, {
      maxBatchSize: 100,
      maxBatchSizeBytes: 1000, // 1KB limit
      batchTimeout: 10000
    })
    
    const largeData = 'x'.repeat(500) // 500 bytes per operation
    
    await manager.enqueue({ entityType: 'document', entityId: 'doc1', operation: 'update', data: { content: largeData } })
    await manager.enqueue({ entityType: 'document', entityId: 'doc2', operation: 'update', data: { content: largeData } })
    
    // Should flush at size limit
    expect(mockProvider.batchExecute).toHaveBeenCalled()
  })
  
  test('should flush after batchTimeout', async () => {
    jest.useFakeTimers()
    
    const manager = new PlainBatchManager(mockProvider, {
      maxBatchSize: 100,
      batchTimeout: 1000,
      debounceMs: 100
    })
    
    await manager.enqueue({ entityType: 'document', entityId: 'doc1', operation: 'update', data: {} })
    
    jest.advanceTimersByTime(1100)
    
    expect(mockProvider.batchExecute).toHaveBeenCalled()
    
    jest.useRealTimers()
  })
  
  test('should debounce rapid operations', async () => {
    jest.useFakeTimers()
    
    const manager = new PlainBatchManager(mockProvider, {
      debounceMs: 200,
      batchTimeout: 5000
    })
    
    // Rapid operations
    for (let i = 0; i < 5; i++) {
      await manager.enqueue({ entityType: 'document', entityId: `doc${i}`, operation: 'update', data: {} })
      jest.advanceTimersByTime(50) // Less than debounce
    }
    
    expect(mockProvider.batchExecute).not.toHaveBeenCalled()
    
    jest.advanceTimersByTime(200) // Complete debounce
    
    expect(mockProvider.batchExecute).toHaveBeenCalledTimes(1)
    
    jest.useRealTimers()
  })
})
```

### 2. PlainOfflineQueue Tests

**File**: `__tests__/batching/plain-offline-queue.test.ts`

```typescript
describe('PlainOfflineQueue', () => {
  test('should queue operations when offline', async () => {
    const queue = new PlainOfflineQueue(config)
    
    // Simulate offline
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: false
    })
    
    await queue.enqueue(createMockOperation())
    
    expect(queue.getQueueStatus().size).toBe(1)
    expect(queue.getQueueStatus().online).toBe(false)
  })
  
  test('should process queue when coming online', async () => {
    const queue = new PlainOfflineQueue(config)
    const executeSpy = jest.spyOn(queue, 'executeOperation')
    
    // Start offline
    Object.defineProperty(navigator, 'onLine', { value: false })
    
    await queue.enqueue(createMockOperation())
    
    // Go online
    Object.defineProperty(navigator, 'onLine', { value: true })
    window.dispatchEvent(new Event('online'))
    
    await new Promise(resolve => setTimeout(resolve, 100))
    
    expect(executeSpy).toHaveBeenCalled()
  })
  
  test('should implement exponential backoff on failures', async () => {
    const queue = new PlainOfflineQueue({
      retryAttempts: 3,
      retryBackoff: [100, 200, 400]
    })
    
    const failingOp = createMockOperation()
    queue.executeOperation = jest.fn().mockRejectedValue(new Error('Network error'))
    
    await queue.enqueue(failingOp)
    
    const status = queue.getQueueStatus()
    const queuedOp = queue.getQueue()[0]
    
    expect(queuedOp.retryCount).toBe(0)
    
    // Process and fail
    await queue.processQueue()
    
    expect(queuedOp.retryCount).toBe(1)
    expect(queuedOp.nextRetryAt).toBeGreaterThan(Date.now())
  })
  
  test('should persist queue to localStorage', async () => {
    const queue = new PlainOfflineQueue({
      persistQueue: true
    })
    
    const operations = [
      createMockOperation(),
      createMockOperation(),
      createMockOperation()
    ]
    
    for (const op of operations) {
      await queue.enqueue(op)
    }
    
    const stored = localStorage.getItem('plain-offline-queue')
    expect(stored).toBeDefined()
    
    const parsed = JSON.parse(stored!)
    expect(parsed).toHaveLength(3)
  })
  
  test('should limit queue size', async () => {
    const queue = new PlainOfflineQueue({
      offlineQueueLimit: 5,
      persistQueue: true
    })
    
    for (let i = 0; i < 10; i++) {
      await queue.enqueue(createMockOperation())
    }
    
    queue.saveToStorage()
    
    const stored = JSON.parse(localStorage.getItem('plain-offline-queue')!)
    expect(stored).toHaveLength(5)
  })
})
```

### 3. Idempotency Tests

**File**: `__tests__/batching/idempotency.test.ts`

```typescript
describe('Idempotency', () => {
  test('should generate unique idempotency keys', () => {
    const manager = new PlainBatchManager(mockProvider, config)
    const keys = new Set()
    
    for (let i = 0; i < 1000; i++) {
      const key = manager.generateIdempotencyKey({
        entityType: 'document',
        entityId: 'doc1',
        operation: 'update'
      })
      keys.add(key)
    }
    
    expect(keys.size).toBe(1000)
  })
  
  test('should include entity info in idempotency key', () => {
    const manager = new PlainBatchManager(mockProvider, config)
    
    const key1 = manager.generateIdempotencyKey({
      entityType: 'document',
      entityId: 'doc1',
      operation: 'update'
    })
    
    const key2 = manager.generateIdempotencyKey({
      entityType: 'document',
      entityId: 'doc2',
      operation: 'update'
    })
    
    expect(key1).toContain('document')
    expect(key1).toContain('doc1')
    expect(key1).toContain('update')
    expect(key1).not.toBe(key2)
  })
  
  test('should preserve idempotency keys on retry', async () => {
    const manager = new PlainBatchManager(mockProvider, config)
    
    const originalOp = {
      entityType: 'document' as const,
      entityId: 'doc1',
      operation: 'update' as const,
      data: {},
      idempotencyKey: 'original-key-123'
    }
    
    await manager.enqueue(originalOp)
    
    const queued = manager.getQueue()[0]
    expect(queued.idempotencyKey).toBe('original-key-123')
  })
})
```

## Integration Tests

### 1. Database Integration

**File**: `__tests__/integration/plain-batching-db.test.ts`

```typescript
describe('Plain Batching - Database Integration', () => {
  let pool: Pool
  let provider: PlainOfflineProvider
  
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL })
    provider = new PlainOfflineProvider({
      enableBatching: true,
      batchConfig: {
        maxBatchSize: 5,
        batchTimeout: 100
      }
    })
  })
  
  afterAll(async () => {
    await pool.end()
  })
  
  test('should batch save documents to PostgreSQL', async () => {
    const noteId = generateUUID()
    const panelId = 'main'
    
    // Queue multiple saves
    for (let i = 0; i < 5; i++) {
      await provider.saveDocument(noteId, panelId, {
        content: `Version ${i}`,
        timestamp: Date.now()
      }, i)
    }
    
    // Wait for batch flush
    await new Promise(resolve => setTimeout(resolve, 200))
    
    // Verify in database
    const result = await pool.query(
      `SELECT * FROM document_saves 
       WHERE note_id = $1 AND panel_id = $2
       ORDER BY version DESC`,
      [noteId, panelId]
    )
    
    expect(result.rows).toHaveLength(1) // Coalesced to latest
    expect(result.rows[0].version).toBe(4)
  })
  
  test('should handle transaction rollback on batch failure', async () => {
    const invalidBranch = {
      id: 'invalid',
      noteId: null, // Will cause constraint violation
      type: 'annotation'
    }
    
    const validBranch = {
      id: generateUUID(),
      noteId: generateUUID(),
      type: 'annotation'
    }
    
    await expect(
      provider.batchExecute('branch', [invalidBranch, validBranch])
    ).rejects.toThrow()
    
    // Verify no partial commits
    const result = await pool.query(
      `SELECT * FROM branches WHERE id IN ($1, $2)`,
      [invalidBranch.id, validBranch.id]
    )
    
    expect(result.rows).toHaveLength(0)
  })
  
  test('should queue to offline_queue when offline', async () => {
    // Mock offline state
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    
    const operation = {
      entityType: 'document' as const,
      entityId: generateUUID(),
      operation: 'update' as const,
      data: { content: 'Offline content' }
    }
    
    await provider.getBatchManager().enqueue(operation)
    
    // Should be in offline_queue
    const result = await pool.query(
      `SELECT * FROM offline_queue 
       WHERE entity_id = $1 AND status = 'pending'`,
      [operation.entityId]
    )
    
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].table_name).toBe('document_saves')
  })
})
```

### 2. API Integration

**File**: `__tests__/integration/plain-batching-api.test.ts`

```typescript
describe('Plain Batching - API Integration', () => {
  test('should handle batch POST requests', async () => {
    const operations = [
      { noteId: generateUUID(), panelId: 'main', content: 'Doc 1', version: 1 },
      { noteId: generateUUID(), panelId: 'main', content: 'Doc 2', version: 1 },
      { noteId: generateUUID(), panelId: 'main', content: 'Doc 3', version: 1 }
    ]
    
    const response = await fetch('/api/postgres-offline/documents/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations })
    })
    
    expect(response.ok).toBe(true)
    
    const result = await response.json()
    expect(result.success).toBe(true)
    expect(result.results).toHaveLength(3)
  })
  
  test('should deduplicate by idempotency key', async () => {
    const idempotencyKey = 'test-key-' + Date.now()
    const operation = {
      noteId: generateUUID(),
      panelId: 'main',
      content: 'Test',
      version: 1,
      idempotencyKey
    }
    
    // First request
    const response1 = await fetch('/api/postgres-offline/documents/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: [operation] })
    })
    
    // Duplicate request
    const response2 = await fetch('/api/postgres-offline/documents/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: [operation] })
    })
    
    const result1 = await response1.json()
    const result2 = await response2.json()
    
    expect(result1.results[0].skipped).toBeFalsy()
    expect(result2.results[0].skipped).toBe(true)
    expect(result2.results[0].reason).toBe('duplicate')
  })
})
```

## End-to-End Tests

### 1. User Workflow Tests

**File**: `__tests__/e2e/plain-batching-workflow.test.ts`

```typescript
import { test, expect } from '@playwright/test'

test.describe('Plain Batching - User Workflows', () => {
  test('should batch rapid typing in editor', async ({ page }) => {
    await page.goto('/annotation/new')
    
    // Enable network monitoring
    const requests = []
    page.on('request', req => {
      if (req.url().includes('/api/postgres-offline')) {
        requests.push(req)
      }
    })
    
    // Type rapidly
    const editor = await page.locator('#editor')
    await editor.type('This is a test of rapid typing to verify batching behavior', {
      delay: 10 // Very fast typing
    })
    
    // Wait for debounce and batch flush
    await page.waitForTimeout(1500)
    
    // Should have minimal API calls
    const batchRequests = requests.filter(r => r.url().includes('/batch'))
    expect(batchRequests.length).toBeLessThanOrEqual(2) // At most 2 batch calls
  })
  
  test('should handle offline to online transition', async ({ page }) => {
    await page.goto('/annotation/edit/123')
    
    // Go offline
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'))
    })
    
    // Make changes
    await page.locator('#editor').type('Offline changes')
    await page.locator('#save-button').click()
    
    // Verify queued indicator
    await expect(page.locator('.offline-indicator')).toBeVisible()
    
    // Go online
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'))
    })
    
    // Wait for sync
    await page.waitForTimeout(2000)
    
    // Verify synced indicator
    await expect(page.locator('.synced-indicator')).toBeVisible()
  })
  
  test('should show batch monitor in development', async ({ page }) => {
    // Set development mode
    await page.goto('/annotation/new?debug=true')
    
    // Monitor should be visible
    const monitor = await page.locator('.batch-monitor')
    await expect(monitor).toBeVisible()
    
    // Make some changes
    await page.locator('#editor').type('Test content')
    
    // Monitor should update
    await expect(monitor.locator('.queued-count')).toContainText('1')
    
    // Wait for flush
    await page.waitForTimeout(1500)
    
    // Monitor should show flushed
    await expect(monitor.locator('.flushed-count')).toContainText('1')
  })
})
```

### 2. Performance Tests

**File**: `__tests__/e2e/plain-batching-performance.test.ts`

```typescript
test.describe('Plain Batching - Performance', () => {
  test('should reduce API calls by 80%+', async ({ page }) => {
    const apiCalls = { withBatching: 0, withoutBatching: 0 }
    
    // Test without batching
    await page.goto('/annotation/new?batching=false')
    page.on('request', req => {
      if (req.url().includes('/api/postgres-offline')) {
        apiCalls.withoutBatching++
      }
    })
    
    // Perform standard workflow
    await performStandardWorkflow(page)
    
    // Reset and test with batching
    await page.goto('/annotation/new?batching=true')
    page.on('request', req => {
      if (req.url().includes('/api/postgres-offline')) {
        apiCalls.withBatching++
      }
    })
    
    await performStandardWorkflow(page)
    
    // Calculate reduction
    const reduction = 1 - (apiCalls.withBatching / apiCalls.withoutBatching)
    expect(reduction).toBeGreaterThan(0.8) // 80%+ reduction
  })
  
  test('should maintain UI responsiveness', async ({ page }) => {
    await page.goto('/annotation/new')
    
    const startTime = Date.now()
    
    // Rapid interactions
    for (let i = 0; i < 100; i++) {
      await page.locator('#editor').type(`Line ${i}\n`, { delay: 0 })
    }
    
    const duration = Date.now() - startTime
    
    // Should complete quickly despite batching
    expect(duration).toBeLessThan(5000) // Under 5 seconds for 100 lines
  })
})

async function performStandardWorkflow(page) {
  // Type content
  await page.locator('#editor').type('Test document content')
  
  // Create annotation
  await page.locator('#editor').selectText('Test')
  await page.locator('#annotate-button').click()
  
  // Add branch
  await page.locator('#branch-input').type('Test branch')
  await page.locator('#add-branch').click()
  
  // Move panel
  await page.locator('.panel-header').dragTo({ x: 100, y: 100 })
  
  // Save
  await page.locator('#save-button').click()
}
```

## Load Tests

**File**: `__tests__/load/plain-batching-load.test.ts`

```typescript
import { check } from 'k6'
import http from 'k6/http'

export const options = {
  stages: [
    { duration: '30s', target: 100 }, // Ramp up
    { duration: '1m', target: 100 },  // Stay at 100 users
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% under 500ms
    http_req_failed: ['rate<0.1'],    // Error rate under 10%
  },
}

export default function () {
  const operations = []
  
  // Generate batch of operations
  for (let i = 0; i < 10; i++) {
    operations.push({
      noteId: generateUUID(),
      panelId: 'main',
      content: `Load test content ${i}`,
      version: i,
      idempotencyKey: `load-test-${Date.now()}-${i}`
    })
  }
  
  const response = http.post(
    'http://localhost:3000/api/postgres-offline/documents/batch',
    JSON.stringify({ operations }),
    { headers: { 'Content-Type': 'application/json' } }
  )
  
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response has results': (r) => {
      const body = JSON.parse(r.body)
      return body.results && body.results.length === operations.length
    },
    'no errors': (r) => {
      const body = JSON.parse(r.body)
      return body.success === true
    }
  })
}
```

## Validation Commands

```bash
# Run all batching tests
npm test -- --testPathPattern=batching

# Run unit tests only
npm test -- __tests__/batching

# Run integration tests
docker compose up -d postgres
npm run test:integration -- plain-batching

# Run E2E tests
npm run test:e2e -- plain-batching

# Run load tests
npm run test:load -- plain-batching-load.test.ts

# Generate coverage report
npm test -- --coverage --testPathPattern=batching

# Run with specific configuration
BATCH_CONFIG=test npm test -- plain-batching
```

## Test Coverage Requirements

### Minimum Coverage Targets
- **Overall**: 80%
- **Critical Paths**: 95%
  - Coalescing logic
  - Flush triggers
  - Error handling
  - Retry logic
- **Integration Points**: 90%
  - DataStore integration
  - API endpoints
  - Database operations

### Critical Test Scenarios
1. ✅ Rapid consecutive updates are coalesced
2. ✅ Batch flushes at size/time limits
3. ✅ Failed batches are retried with backoff
4. ✅ Offline operations are queued
5. ✅ Online transition processes queue
6. ✅ Idempotency prevents duplicates
7. ✅ Transactions rollback on partial failure
8. ✅ Memory limits are respected
9. ✅ UI remains responsive during batching
10. ✅ Monitor accurately reflects state

## Continuous Integration

### GitHub Actions Workflow

```yaml
name: Plain Batching Tests

on:
  push:
    paths:
      - 'lib/batching/**'
      - '__tests__/**/batching/**'
  pull_request:
    paths:
      - 'lib/batching/**'

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: annotation_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run migrations
        run: npm run migrate:test
        
      - name: Run unit tests
        run: npm test -- __tests__/batching
        
      - name: Run integration tests
        run: npm run test:integration -- plain-batching
        
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          flags: batching
```

## Conclusion

This comprehensive test specification ensures thorough validation of the plain-mode batching implementation. All critical paths are covered with appropriate test scenarios, from unit tests validating individual components to end-to-end tests verifying complete user workflows. The tests are designed to catch regressions, validate performance improvements, and ensure system reliability under various conditions.