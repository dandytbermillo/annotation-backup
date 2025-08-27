# Offline-First Architecture Implementation

## Overview
This document describes the offline-first architecture implementation with PostgreSQL persistence, addressing the YJS proxy issues when offline.

## Key Features

### 1. Direct Property Access
- No YJS proxy complications
- Direct access to properties like `branch.originalText` always works
- Map-based storage for immediate data access

### 2. PostgreSQL Persistence
- Primary persistence layer (not IndexedDB)
- Offline queue stored in PostgreSQL
- Survives app restarts

### 3. Offline Queue Management
- Operations queued when offline
- Automatic sync when connection restored
- Retry logic with exponential backoff

### 4. Optional YJS Integration
- YJS only for real-time collaboration
- Can be enabled/disabled at runtime
- No dependency on YJS for basic operations

## Architecture Components

### Core Components
1. **OfflineStore** (`lib/stores/offline-store.ts`)
   - Map-based storage for branches, notes, panels
   - Change tracking and subscriptions
   - PostgreSQL persistence methods

2. **Zustand Store** (`lib/stores/note-store.ts`)
   - React state management
   - Integration with OfflineStore
   - Helper hooks for component usage

3. **Sync Queue** (`lib/stores/sync-queue.ts`)
   - Manages offline operations
   - Processes queue when online
   - Handles retries and failures

4. **PostgreSQL Adapter** (`lib/adapters/postgres-offline-adapter.ts`)
   - Extends base adapter with offline capabilities
   - Batch operations for efficiency
   - Entity-specific CRUD operations

### Database Schema
```sql
-- Offline queue table
CREATE TABLE offline_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL,
  table_name VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  data JSONB NOT NULL,
  retry_count INTEGER DEFAULT 0,
  status offline_operation_status DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Usage

### Enable Offline-First Mode
```javascript
// Via environment variable
NEXT_PUBLIC_ENABLE_OFFLINE_FIRST=true npm run dev

// Via localStorage
localStorage.setItem('enable-offline-first', 'true')
window.location.reload()
```

### Using the Store
```typescript
import { useNoteStore } from '@/lib/stores/note-store'

function MyComponent() {
  const { createBranch, branches, isOnline } = useNoteStore()
  
  // Create branch - works offline
  const branch = createBranch({
    originalText: 'Selected text',
    type: 'note'
  })
  
  // Direct property access - no proxy errors
  console.log(branch.originalText)
}
```

### Sync Status
```typescript
import { useSyncStatus } from '@/lib/stores/note-store'

function SyncIndicator() {
  const { status, error } = useSyncStatus()
  
  if (status === 'syncing') return <div>Syncing...</div>
  if (status === 'error') return <div>Sync error: {error}</div>
  return <div>Synced</div>
}
```

## Migration from YJS

### Run Migration Tool
```typescript
import { migrateYjsToPostgres } from '@/lib/migration/yjs-to-postgres'

// Migrate all YJS documents
const progress = await migrateYjsToPostgres()
console.log(`Migrated ${progress.processed} documents`)
```

### Manual Migration
The migration tool:
1. Loads YJS documents
2. Extracts structured data
3. Saves to PostgreSQL tables
4. Preserves all metadata

## Testing

### Unit Tests
```bash
npm test stores/offline-store.test.ts
```

### Integration Tests
```bash
# Start PostgreSQL
docker compose up -d postgres

# Run migrations
npm run db:migrate:all

# Run tests
npm run test:integration
```

### Manual Testing
1. Enable offline-first mode
2. Go offline (DevTools > Network > Offline)
3. Create/update branches
4. Verify direct property access works
5. Go online
6. Verify sync completes

## Performance

- Local operations: <10ms
- No network latency for reads
- Batch sync when online
- Optimistic updates with rollback

## Troubleshooting

### Common Issues

1. **Sync not working**
   - Check PostgreSQL connection
   - Verify offline queue API routes
   - Check browser console for errors

2. **Data not persisting**
   - Ensure PostgreSQL is running
   - Check migrations are applied
   - Verify API routes are accessible

3. **Property access errors**
   - Ensure offline-first mode is enabled
   - Check you're using the Zustand store
   - Verify not accessing YJS proxies directly

## Future Enhancements

1. **Conflict Resolution UI**
   - Visual diff for conflicts
   - User-driven merge tools

2. **Selective Sync**
   - Sync specific entities
   - Priority-based sync

3. **Offline Analytics**
   - Track offline usage
   - Queue performance metrics

## API Reference

### OfflineStore Methods
- `createBranch(branch: Partial<Branch>): Branch`
- `updateBranch(id: string, updates: Partial<Branch>): Branch | null`
- `deleteBranch(id: string): boolean`
- `persist(): Promise<void>`
- `restore(): Promise<void>`
- `flushQueue(): Promise<void>`

### Zustand Store Actions
- `createBranch(branch: Partial<Branch>): Branch`
- `getBranch(id: string): Branch | undefined`
- `getBranchesForPanel(panelId: string): Branch[]`
- `syncWithPostgres(): Promise<void>`
- `setOnlineStatus(online: boolean): void`

### Hooks
- `useOfflineStore()`: Access offline store
- `useOnlineStatus()`: Get online/offline status
- `useSyncStatus()`: Get sync status and errors
- `useOfflineIndicator()`: UI indicator helper