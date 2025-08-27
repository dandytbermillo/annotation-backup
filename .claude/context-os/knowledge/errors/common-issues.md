# Common Issues & Solutions

## YJS Related Errors

### Error: "Cannot read properties of undefined (reading 'gc')"
**Cause**: Trying to access destroyed Y.Doc
**Solution**: 
```typescript
// Always check if doc is destroyed
if (!ydoc.isDestroyed) {
  // Safe to use
}
```

### Error: "Update message is not a valid Yjs update"
**Cause**: Corrupted or incompatible binary data
**Solution**:
```typescript
try {
  Y.applyUpdate(ydoc, update);
} catch (error) {
  // Fetch fresh snapshot from database
  const snapshot = await fetchSnapshot(docId);
  Y.applyUpdate(ydoc, snapshot);
}
```

### Error: "Maximum call stack exceeded" in Y.Doc
**Cause**: Circular references or infinite loops in observers
**Solution**: Use transaction grouping
```typescript
ydoc.transact(() => {
  // All changes in one transaction
  ytext.insert(0, 'content');
  ymap.set('key', 'value');
});
```

## PostgreSQL Errors

### Error: "Connection terminated unexpectedly"
**Cause**: Long-running connection timeout
**Solution**: Use connection pooling with proper config
```typescript
const pool = new Pool({
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### Error: "Serialization failure" in transaction
**Cause**: Concurrent updates to same row
**Solution**: Implement retry logic
```typescript
async function withRetry(fn: () => Promise<any>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error.code === '40001' && i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, i)));
        continue;
      }
      throw error;
    }
  }
}
```

## Next.js / React Errors

### Error: "Text content does not match server-rendered HTML"
**Cause**: YJS state differs between server and client
**Solution**: Disable SSR for collaborative components
```typescript
const CollaborativeEditor = dynamic(
  () => import('./CollaborativeEditor'),
  { ssr: false }
);
```

### Error: "Cannot update a component while rendering"
**Cause**: YJS observer triggering during render
**Solution**: Use useEffect for observers
```typescript
useEffect(() => {
  const observer = () => {
    // Update state here
  };
  ydoc.on('update', observer);
  return () => ydoc.off('update', observer);
}, [ydoc]);
```

## TypeScript Errors

### Error: "Type 'Y.Map<any>' is not assignable to type 'Record<string, any>'"
**Cause**: YJS types don't match TypeScript expectations
**Solution**: Use proper conversion
```typescript
const jsObject = ymap.toJSON() as Record<string, any>;
```

### Error: "Property does not exist on type 'AbstractType'"
**Cause**: TypeScript doesn't know specific YJS type
**Solution**: Type guards
```typescript
if (sharedType instanceof Y.Map) {
  // Now TypeScript knows it's a Y.Map
  sharedType.set('key', 'value');
}
```

## Performance Issues

### Issue: Slow initial page load
**Cause**: Loading entire YJS document history
**Solution**: Load only latest snapshot
```typescript
// Instead of loading all updates
const updates = await loadAllUpdates(docId);

// Load snapshot + recent updates only
const snapshot = await loadSnapshot(docId);
const recentUpdates = await loadUpdatesSince(docId, snapshot.timestamp);
```

### Issue: Memory leak with many documents
**Cause**: Not cleaning up Y.Doc instances
**Solution**: Implement document lifecycle management
```typescript
// See patterns/yjs-integration.md for YDocManager pattern
```

## Debugging Tips

### Enable YJS logging
```typescript
// In development only
if (process.env.NODE_ENV === 'development') {
  Y.log.setVerbosity('debug');
}
```

### Track sync state
```typescript
provider.on('sync', (isSynced: boolean) => {
  console.log('Sync state:', isSynced);
});

provider.on('error', (error: any) => {
  console.error('Provider error:', error);
});
```

### Monitor performance
```typescript
const startTime = performance.now();
Y.applyUpdate(ydoc, update);
const duration = performance.now() - startTime;
if (duration > 100) {
  console.warn(`Slow update: ${duration}ms`);
}
```