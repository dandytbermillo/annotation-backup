# Complete Fix Implementation for Empty Editor Issue
**Date**: 2024-08-27  
**Issue**: TipTap shows empty content - PostgresAdapter is not implemented
**Author**: Claude

## Root Cause
The `lib/adapters/postgres-adapter.ts` file is empty, causing all persistence operations to fail silently.

## Required Implementation

### 1. Implement PostgresAdapter Base Class
Create the missing implementation in `lib/adapters/postgres-adapter.ts`:

```typescript
import { Pool } from 'pg'
import { PersistenceProvider } from '../enhanced-yjs-provider'

export abstract class PostgresAdapter implements PersistenceProvider {
  protected abstract getPool(): Pool

  async persist(docName: string, update: Uint8Array): Promise<void> {
    const pool = this.getPool()
    await pool.query(
      'INSERT INTO yjs_updates (doc_name, update, timestamp) VALUES ($1, $2, NOW())',
      [docName, Buffer.from(update)]
    )
  }

  async load(docName: string): Promise<Uint8Array | null> {
    const pool = this.getPool()
    
    // First try to load a snapshot
    const snapshot = await this.loadSnapshot(docName)
    if (snapshot) {
      return snapshot
    }
    
    // Otherwise, load and merge all updates
    const updates = await this.getAllUpdates(docName)
    if (updates.length === 0) {
      return null
    }
    
    // Merge all updates into a single state
    const Y = await import('yjs')
    const doc = new Y.Doc()
    updates.forEach(update => {
      Y.applyUpdate(doc, update)
    })
    
    return Y.encodeStateAsUpdate(doc)
  }

  async getAllUpdates(docName: string): Promise<Uint8Array[]> {
    const pool = this.getPool()
    const result = await pool.query(
      'SELECT update FROM yjs_updates WHERE doc_name = $1 ORDER BY timestamp ASC',
      [docName]
    )
    
    return result.rows.map(row => new Uint8Array(row.update))
  }

  async clearUpdates(docName: string): Promise<void> {
    const pool = this.getPool()
    await pool.query(
      'DELETE FROM yjs_updates WHERE doc_name = $1',
      [docName]
    )
  }

  async saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    const pool = this.getPool()
    
    // Calculate checksum
    const crypto = require('crypto')
    const checksum = crypto.createHash('sha256').update(snapshot).digest('hex')
    
    await pool.query(
      'INSERT INTO snapshots (doc_name, state, checksum, created_at) VALUES ($1, $2, $3, NOW())',
      [docName, Buffer.from(snapshot), checksum]
    )
  }

  async loadSnapshot(docName: string): Promise<Uint8Array | null> {
    const pool = this.getPool()
    const result = await pool.query(
      'SELECT state FROM snapshots WHERE doc_name = $1 ORDER BY created_at DESC LIMIT 1',
      [docName]
    )
    
    if (result.rows.length === 0) {
      return null
    }
    
    return new Uint8Array(result.rows[0].state)
  }

  async compact(docName: string): Promise<void> {
    const pool = this.getPool()
    const client = await pool.connect()
    
    try {
      await client.query('BEGIN')
      
      // Load all updates
      const updates = await this.getAllUpdates(docName)
      if (updates.length === 0) {
        await client.query('COMMIT')
        return
      }
      
      // Create a Y.Doc and apply all updates
      const Y = await import('yjs')
      const doc = new Y.Doc()
      updates.forEach(update => {
        Y.applyUpdate(doc, update)
      })
      
      // Save as snapshot
      const snapshot = Y.encodeStateAsUpdate(doc)
      await this.saveSnapshot(docName, snapshot)
      
      // Clear old updates
      await this.clearUpdates(docName)
      
      // Keep initial snapshot as first update for safety
      await client.query(
        'INSERT INTO yjs_updates (doc_name, update, timestamp) VALUES ($1, $2, NOW())',
        [docName, Buffer.from(snapshot)]
      )
      
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}
```

### 2. Fix the Key Mismatch
In `lib/yjs-provider.ts`, ensure consistent key format:

```typescript
// Line 143, change:
const docKey = `${noteId || 'default'}-panel-${panelId}`

// To match the cache key format:
const docKey = noteId ? `${noteId}-${panelId}` : panelId
```

### 3. Add Loading State Feedback
Add a simple loading indicator in `lib/yjs-provider.ts`:

```typescript
// After line 177 (Y.applyUpdate), add:
// Notify that content has loaded
if (typeof window !== 'undefined') {
  window.dispatchEvent(new CustomEvent('ydoc-loaded', { 
    detail: { panelId, noteId, size: data.length }
  }))
}
```

### 4. Optional: Add Debug Logging
To verify the fix is working, add logging:

```typescript
// In PostgresAdapter.load():
console.log(`Loading doc: ${docName}`)
const snapshot = await this.loadSnapshot(docName)
if (snapshot) {
  console.log(`Loaded snapshot for ${docName}, size: ${snapshot.length}`)
  return snapshot
}

const updates = await this.getAllUpdates(docName)
console.log(`Loaded ${updates.length} updates for ${docName}`)
```

## Testing the Fix

1. **Build and run the app**:
```bash
npm run dev
```

2. **Check PostgreSQL logs**:
```bash
docker compose logs postgres -f
```

3. **Verify persistence**:
```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U postgres -d annotation_system

# Check for saved updates
SELECT doc_name, length(update), timestamp FROM yjs_updates ORDER BY timestamp DESC LIMIT 10;

# Check for snapshots
SELECT doc_name, length(state), created_at FROM snapshots ORDER BY created_at DESC LIMIT 10;
```

4. **Test note switching**:
- Create a note with content
- Switch to another note
- Switch back - content should appear immediately

## Why This Fix Works

1. **Implements Missing Persistence**: The PostgresAdapter now properly saves and loads Y.js updates
2. **Handles Initial Load**: The load() method correctly retrieves persisted content
3. **Supports Snapshots**: Faster loading through periodic snapshots
4. **Proper Key Format**: Consistent keys between cache and persistence
5. **Error Handling**: Transactions ensure data integrity

## Rollback Plan
If issues occur:
1. Comment out the PostgresAdapter implementation
2. Use MemoryAdapter as temporary fallback
3. Debug specific SQL queries that fail