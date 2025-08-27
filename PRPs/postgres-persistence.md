name: "PostgreSQL-Only Persistence Implementation (Electron-First)"
version: 1
last_updated: 2025-08-26
description: |
  Clean PostgreSQL-only persistence implementation with Electron failover and Web API support. No IndexedDB migration.

## Purpose
Implement PostgreSQL as the sole persistence layer for the YJS-based annotation system. Electron gets direct SQL with remote→local failover and oplog resync. Web uses remote-only API routes. This ensures the schema remains compatible with future YJS real-time collaboration features.

## Core Principles
1. **Context is King**: Include all PostgreSQL patterns, YJS binary handling, IPC details
2. **Validation Loops**: Test persistence at every step with clear gates
3. **Information Dense**: Use existing adapter patterns from codebase
4. **Progressive Success**: Electron adapter first, validate thoroughly, then Web API
5. **Global rules**: Follow CLAUDE.md, preserve YJS runtime behavior

---

## Goal
Create a robust PostgreSQL persistence layer:
- **Electron**: Direct SQL with transparent remote→local failover
- **Web**: Remote-only via API routes (Notion-style, no offline)
- **Binary storage**: YJS updates/snapshots as BYTEA
- **Oplog resync**: Queue and sync offline changes
- **Future-ready**: Schema supports YJS collaboration later

## Why
- **No limits**: PostgreSQL removes browser storage constraints
- **Professional**: ACID guarantees, complex queries, analytics
- **Multi-device ready**: Foundation for future device sync
- **Performance**: Direct SQL in Electron, optimized queries
- **Reliability**: Automatic failover, conflict resolution

## What
### User-visible behavior
- Seamless persistence without data loss
- Electron works offline, syncs when reconnected
- Web requires connection (clean architecture)
- Same editing experience, better performance

### Technical requirements
- Implement `PersistenceProvider` interface
- Binary YJS data handling (Uint8Array ↔ BYTEA)
- Connection failover with health checks
- Oplog-based reconciliation
- Platform-specific adapters

### Success Criteria
- [ ] Postgres adapters implement all `PersistenceProvider` methods
- [ ] Electron failover is transparent (remote→local→remote)
- [ ] Oplog correctly syncs offline changes
- [ ] All existing persistence tests pass
- [ ] Sub-100ms typical query performance
- [ ] Schema supports future YJS collaboration
- [ ] Integration tests pass both platforms

## All Needed Context

### Documentation & References
```yaml
# MUST READ - PostgreSQL specifics
- url: https://node-postgres.com/features/connecting
  why: Connection pooling, timeouts, SSL configuration
  critical: Pool vs Client usage patterns
  
- url: https://node-postgres.com/features/types
  why: Binary data handling for YJS updates
  section: "Custom type parsers" for BYTEA
  
# Existing patterns to follow
- file: lib/adapters/electron-adapter.ts
  why: ElectronPersistenceAdapter pattern (mock SQLite)
  lines: 18-231
  
- file: lib/adapters/web-adapter-enhanced.ts  
  why: WebPersistenceAdapter with offline queue
  lines: 4-401
  critical: OfflineQueue pattern for oplog
  
- file: lib/enhanced-yjs-provider.ts:11-19
  why: PersistenceProvider interface definition
  critical: Must implement all methods exactly
  
- file: docs/yjs-annotation-architecture.md
  why: Understand YJS persistence vs runtime
  critical: "Never replace YJS with Postgres for live CRDT"
  warning: We store YJS binary data, not replace YJS operations
  
- file: migrations/001_initial_schema.up.sql
  why: Database schema already exists
  tables: notes, branches, panels, snapshots, yjs_updates
  
- file: lib/utils/platform-detection.ts
  why: detectPlatform() for adapter selection
  
- file: docker-compose.yml
  why: Postgres already configured
  connection: postgres://postgres:postgres@localhost:5432/annotation_system
```

### Current Codebase Structure
```bash
annotation-backup/
├── lib/
│   ├── adapters/
│   │   ├── electron-adapter.ts      # Mock SQLite pattern
│   │   └── web-adapter-enhanced.ts  # IndexedDB with PWA
│   ├── enhanced-yjs-provider.ts     # Uses PersistenceProvider
│   └── utils/
│       └── platform-detection.ts    # Platform detection
├── migrations/                      # SQL schemas ready
├── docker-compose.yml              # Postgres configured
└── package.json                    # Missing: pg, @types/pg
```

### Target Codebase Structure
```bash
annotation-backup/
├── lib/
│   ├── adapters/
│   │   ├── postgres-adapter.ts           # NEW: Base implementation
│   │   ├── electron-postgres-adapter.ts  # NEW: With failover
│   │   └── web-postgres-adapter.ts       # NEW: API client
│   └── database/
│       ├── connection-manager.ts         # NEW: Pool management
│       └── oplog-sync.ts                 # NEW: Sync engine
├── app/
│   └── api/
│       └── persistence/
│           └── route.ts                  # NEW: API endpoints
├── electron/
│   └── ipc/
│       └── persistence-handlers.ts       # NEW: IPC bridge
└── __tests__/
    └── persistence/
        └── postgres-adapter.test.ts      # NEW: Test suite
```

### Known Gotchas & Critical Patterns
```typescript
// CRITICAL: Binary data conversion
// YJS → Postgres: Buffer.from(uint8Array)
// Postgres → YJS: new Uint8Array(buffer)

// CRITICAL: Connection pooling required
// Use pg.Pool not pg.Client
// Pool handles reconnection automatically

// CRITICAL: IPC serialization
// Cannot pass Uint8Array through Electron IPC
// Convert to Array: Array.from(uint8Array)
// Convert back: new Uint8Array(array)

// GOTCHA: Next.js App Router
// Export named functions: export async function POST()
// Use NextResponse.json() for responses

// GOTCHA: Platform detection
// Always use detectPlatform() from utils
// Don't assume window.electronAPI exists

// GOTCHA: Oplog timestamps
// Use database NOW() not JavaScript Date
// Ensures consistent ordering across systems
```

## Implementation Blueprint

### Data Models and Types
```typescript
// lib/database/types.ts
export interface ConnectionConfig {
  remote: PoolConfig
  local?: PoolConfig  // Optional for web
  timeout: number     // Connection timeout ms
}

export interface OplogEntry {
  id: number
  entity_type: 'yjs_update' | 'snapshot'
  entity_id: string   // doc_name
  operation: 'persist' | 'compact'
  payload: Buffer     // Binary data
  timestamp: Date
  origin: 'local' | 'remote'
  synced: boolean
}

// lib/adapters/postgres-adapter.ts
export abstract class PostgresAdapter implements PersistenceProvider {
  protected pool: Pool
  
  protected toBuffer(data: Uint8Array): Buffer {
    return Buffer.from(data)
  }
  
  protected fromBuffer(buffer: Buffer): Uint8Array {
    return new Uint8Array(buffer)
  }
}
```

### Task Breakdown

```yaml
Task 1: Install PostgreSQL dependencies
MODIFY package.json:
  - ADD dependency: "pg": "^8.11.3"
  - ADD devDependency: "@types/pg": "^8.10.9"
  - RUN: npm install
  - VERIFY: No peer dependency warnings

Task 2: Create base PostgresAdapter
CREATE lib/adapters/postgres-adapter.ts:
  - ABSTRACT class implementing PersistenceProvider
  - PATTERN from: lib/adapters/electron-adapter.ts
  - ADD binary conversion helpers
  - IMPLEMENT core methods: persist, load, getAllUpdates
  - USE prepared statements for security
  
Task 3: Implement connection management  
CREATE lib/database/connection-manager.ts:
  - SINGLETON pattern for Pool instances
  - SEPARATE pools for remote and local
  - HEALTH check with timeout
  - CONNECTION retry with exponential backoff
  - PATTERN: Similar to web-adapter-enhanced.ts retry

Task 4: Build ElectronPostgresAdapter
CREATE lib/adapters/electron-postgres-adapter.ts:
  - EXTEND PostgresAdapter
  - IMPLEMENT failover logic:
    * Try remote with timeout
    * On failure, switch to local
    * Track state for resync
  - ADD oplog entry on local writes
  - PATTERN from: ElectronPersistenceAdapter

Task 5: Create oplog sync engine
CREATE lib/database/oplog-sync.ts:
  - QUERY pending local entries
  - BATCH sync to remote
  - HANDLE conflicts via YJS merge
  - UPDATE synced flag atomically
  - PATTERN: Web offline queue

Task 6: Add Electron IPC handlers
CREATE electron/ipc/persistence-handlers.ts:
  - REGISTER handlers for each method
  - CONVERT Uint8Array ↔ Array for IPC
  - VALIDATE all inputs (security)
  - ERROR handling with proper codes
  - PATTERN: Structured like API routes

Task 7: Implement WebPostgresAdapter (lower priority)
CREATE lib/adapters/web-postgres-adapter.ts:
  - EXTEND PostgresAdapter
  - USE fetch() to call API routes
  - NO offline support (by design)
  - HANDLE auth headers
  
Task 8: Create API routes (if time permits)
CREATE app/api/persistence/route.ts:
  - POST /api/persistence/persist
  - GET /api/persistence/load
  - POST /api/persistence/compact
  - AUTH middleware
  - RATE limiting

Task 9: Wire adapters into provider
MODIFY lib/enhanced-yjs-provider.ts:
  - DETECT platform in constructor
  - CREATE appropriate adapter
  - MAINTAIN interface compatibility
  - PRESERVE existing behavior

Task 10: Add comprehensive tests
CREATE __tests__/persistence/postgres-adapter.test.ts:
  - UNIT tests for adapters
  - INTEGRATION tests with real Postgres
  - FAILOVER scenario tests
  - BINARY data round-trip tests
  - MOCK pg for unit tests
```

### Detailed Implementation Pseudocode

```typescript
// Task 2: Base PostgresAdapter
abstract class PostgresAdapter implements PersistenceProvider {
  protected abstract getPool(): Pool
  
  async persist(docName: string, update: Uint8Array): Promise<void> {
    const pool = this.getPool()
    const buffer = Buffer.from(update)
    
    // PATTERN: Parameterized query prevents injection
    await pool.query(
      'INSERT INTO yjs_updates (doc_name, update, timestamp) VALUES ($1, $2, NOW())',
      [docName, buffer]
    )
  }
  
  async load(docName: string): Promise<Uint8Array | null> {
    // PATTERN: Try snapshot first (like existing adapters)
    const snapshot = await this.loadSnapshot(docName)
    if (snapshot) return snapshot
    
    // Fall back to merging updates
    const updates = await this.getAllUpdates(docName)
    if (updates.length === 0) return null
    
    // CRITICAL: Let YJS handle merging
    const doc = new Y.Doc()
    updates.forEach(u => Y.applyUpdate(doc, u))
    return Y.encodeStateAsUpdate(doc)
  }
}

// Task 4: Electron failover implementation
class ElectronPostgresAdapter extends PostgresAdapter {
  private remotePool: Pool
  private localPool?: Pool
  private currentMode: 'remote' | 'local' = 'remote'
  private syncEngine: OplogSync
  
  async persist(docName: string, update: Uint8Array): Promise<void> {
    try {
      if (this.currentMode === 'remote') {
        // Try remote with timeout
        await this.withTimeout(
          super.persist(docName, update),
          this.config.timeout
        )
        
        // Success - ensure sync engine is running
        if (this.localPool) {
          this.syncEngine.start()
        }
      } else {
        // Local mode - use oplog
        await this.persistLocally(docName, update)
      }
    } catch (error) {
      if (this.isNetworkError(error) && this.localPool) {
        // Switch to local mode
        this.currentMode = 'local'
        await this.persistLocally(docName, update)
        
        // Schedule reconnection attempt
        this.scheduleReconnect()
      } else {
        throw error
      }
    }
  }
  
  private async persistLocally(docName: string, update: Uint8Array): Promise<void> {
    const client = await this.localPool!.connect()
    try {
      await client.query('BEGIN')
      
      // Store update
      await client.query(
        'INSERT INTO yjs_updates (doc_name, update, timestamp) VALUES ($1, $2, NOW())',
        [docName, Buffer.from(update)]
      )
      
      // Add to oplog for later sync
      await client.query(
        'INSERT INTO oplog (entity_type, entity_id, operation, payload, origin, synced) VALUES ($1, $2, $3, $4, $5, $6)',
        ['yjs_update', docName, 'persist', Buffer.from(update), 'local', false]
      )
      
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }
}

// Task 5: Oplog sync
class OplogSync {
  async syncPending(): Promise<void> {
    const pending = await this.localPool.query(
      'SELECT * FROM oplog WHERE origin = $1 AND synced = $2 ORDER BY timestamp',
      ['local', false]
    )
    
    for (const entry of pending.rows) {
      try {
        // Apply to remote
        await this.applyEntry(entry)
        
        // Mark as synced
        await this.localPool.query(
          'UPDATE oplog SET synced = true WHERE id = $1',
          [entry.id]
        )
      } catch (error) {
        // Log but continue with next entry
        console.error(`Sync failed for entry ${entry.id}:`, error)
      }
    }
  }
}

// Task 6: IPC handlers
// electron/ipc/persistence-handlers.ts
export function registerPersistenceHandlers(adapter: ElectronPostgresAdapter) {
  ipcMain.handle('persistence:persist', async (event, docName: string, updateArray: number[]) => {
    // SECURITY: Validate inputs
    if (!isValidDocName(docName)) throw new Error('Invalid doc name')
    
    // Convert from IPC-safe array
    const update = new Uint8Array(updateArray)
    await adapter.persist(docName, update)
  })
  
  ipcMain.handle('persistence:load', async (event, docName: string) => {
    if (!isValidDocName(docName)) throw new Error('Invalid doc name')
    
    const data = await adapter.load(docName)
    // Convert to IPC-safe array
    return data ? Array.from(data) : null
  })
}
```

### Integration Points
```yaml
DATABASE:
  - schema: Use existing migrations/001_initial_schema.up.sql
  - service: Use docker-compose postgres service
  - connection: postgres://postgres:postgres@localhost:5432/annotation_system
  
ENVIRONMENT:
  - file: .env.local (Web)
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/annotation_system"
    NEXT_PUBLIC_PERSISTENCE_MODE: "api"
    
  - file: .env.electron (Electron)
    DATABASE_URL_REMOTE: "postgres://user:pass@production:5432/annotation"
    DATABASE_URL_LOCAL: "postgres://postgres:postgres@localhost:5432/annotation_local"
    PERSISTENCE_MODE: "auto"
    PG_CONN_TIMEOUT_MS: "2000"
    ALLOW_OFFLINE_WRITES: "true"
    
PROVIDER:
  - file: lib/enhanced-yjs-provider.ts
  - location: constructor (around line 69)
  - pattern: Use detectPlatform() to choose adapter
  
ELECTRON:
  - file: electron/main.js (create if needed)
  - register: IPC handlers on app ready
  - security: Enable context isolation
```

## Validation Loop

### Level 1: Syntax & Type Checking
```bash
# After each file creation
npm run lint          # ESLint passes
npm run type-check    # TypeScript compilation

# Fix any errors before proceeding
```

### Level 2: Unit Tests
```typescript
// __tests__/persistence/postgres-adapter.test.ts
import { PostgresAdapter } from '@/lib/adapters/postgres-adapter'
import { Pool } from 'pg'

jest.mock('pg')

describe('PostgresAdapter', () => {
  let adapter: TestablePostgresAdapter
  let mockPool: jest.Mocked<Pool>
  
  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn()
    } as any
    
    ;(Pool as jest.Mock).mockImplementation(() => mockPool)
  })
  
  test('persist stores binary data as BYTEA', async () => {
    const update = new Uint8Array([1, 2, 3, 4, 5])
    
    await adapter.persist('test-doc', update)
    
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO yjs_updates'),
      ['test-doc', Buffer.from(update)]
    )
  })
  
  test('load returns null for non-existent doc', async () => {
    mockPool.query.mockResolvedValue({ rows: [] })
    
    const result = await adapter.load('missing-doc')
    expect(result).toBeNull()
  })
})

# Run unit tests
npm run test __tests__/persistence/postgres-adapter.test.ts
```

### Level 3: Integration Tests
```bash
# Start dependencies
docker compose up -d postgres

# Run migrations
npm run db:migrate

# Integration test script
cat > test-integration.ts << 'EOF'
import { ElectronPostgresAdapter } from './lib/adapters/electron-postgres-adapter'

const config = {
  remote: {
    connectionString: process.env.DATABASE_URL_REMOTE
  },
  local: {
    connectionString: process.env.DATABASE_URL_LOCAL  
  },
  timeout: 2000
}

async function test() {
  const adapter = new ElectronPostgresAdapter(config)
  
  // Test persist/load
  const testUpdate = new Uint8Array([1,2,3,4,5])
  await adapter.persist('test-doc', testUpdate)
  
  const loaded = await adapter.load('test-doc')
  console.assert(loaded?.length === testUpdate.length, 'Round trip failed')
  
  console.log('✓ Integration test passed')
  process.exit(0)
}

test().catch(console.error)
EOF

npx tsx test-integration.ts
```

### Level 4: Failover Testing
```bash
# Test failover scenario
# 1. Start with remote available
# 2. Stop remote postgres  
# 3. Verify failover to local
# 4. Start remote again
# 5. Verify resync completes

# Can be automated with shell script
./test-sync.sh  # Uses existing test script
```

## Progressive Implementation Strategy

### Phase 1: Core PostgreSQL (Week 1)
- PostgresAdapter base class
- Connection management
- Binary data handling
- Basic unit tests
- **Validation**: `npm test` passes
- **Rollback**: Remove new files, no impact

### Phase 2: Electron Failover (Week 2)
- ElectronPostgresAdapter
- Failover logic
- Oplog implementation
- IPC handlers
- **Validation**: Failover test passes
- **Rollback**: Use `PERSISTENCE_MODE=remote` only

### Phase 3: Production Hardening (Week 3-4)
- Sync engine robustness
- Error recovery
- Performance optimization
- Comprehensive tests
- **Validation**: All integration tests pass
- **Rollback**: Previous phase functionality

### Phase 4: Web API (If time permits)
- API routes
- WebPostgresAdapter
- Authentication
- Rate limiting
- **Validation**: Web platform tests
- **Rollback**: Electron-only deployment

---

## Anti-Patterns to Avoid
- ❌ Don't store YJS data as JSON (must be binary)
- ❌ Don't skip connection pooling
- ❌ Don't pass Uint8Array through IPC directly
- ❌ Don't hardcode connection strings
- ❌ Don't create new persistence patterns
- ❌ Don't implement IndexedDB migration
- ❌ Don't rush oplog implementation

## Security Considerations
- Parameterized queries only (no string concatenation)
- Validate all IPC inputs
- Sanitize docName (alphanumeric + dash only)
- Rate limit API endpoints
- Use connection SSL in production
- Audit log sensitive operations

## Performance Optimization
- Connection pool: 10 (Electron), 25 (Web)
- Prepared statements for repeated queries
- Batch oplog syncs (max 100 per batch)
- Index on (doc_name, timestamp) exists
- Consider partitioning yjs_updates monthly

## Monitoring & Observability
- Log connection state changes
- Track sync latency metrics
- Monitor pool utilization
- Alert on repeated sync failures
- Dashboard for oplog backlog

---

## Final Checklist
- [ ] TypeScript compilation: `npm run type-check`
- [ ] Linting passes: `npm run lint`
- [ ] Unit tests pass: `npm test`
- [ ] Integration tests pass
- [ ] Failover works transparently
- [ ] Oplog syncs correctly
- [ ] Binary data preserved exactly
- [ ] No YJS runtime operations replaced
- [ ] Schema supports future collaboration

---

## Risk Assessment
- **Technical Debt**: [2/9] - Following existing patterns closely
- **Integration Complexity**: [6/9] - Multiple platforms and failover
- **Regression Risk**: [3/9] - Well-isolated changes
- **Performance Impact**: [2/9] - PostgreSQL faster than IndexedDB
- **Security Risk**: [5/9] - New IPC surface, mitigated by validation

### Mitigation Strategies
- Gradual rollout with feature flags
- Comprehensive test coverage
- Monitoring and alerting
- Regular security reviews
- Performance profiling

---

## Rollback Procedures

### Environment Variable Control
```bash
# Full remote-only mode (safest)
PERSISTENCE_MODE=remote

# Local-only mode (offline)
PERSISTENCE_MODE=local  

# Automatic failover (default)
PERSISTENCE_MODE=auto

# Disable problematic features
ALLOW_OFFLINE_WRITES=false
```

### Emergency Rollback
1. Set `PERSISTENCE_MODE=remote`
2. Disable offline writes
3. Monitor for stability
4. Fix issues in local mode
5. Re-enable gradually

---

## Confidence Score and Readiness Assessment

### Confidence Score: 8.5/10

**Strengths:**
- Clear patterns to follow
- Well-defined interfaces  
- Good existing examples
- Schema already prepared

**Complexity points:**
- Oplog sync requires careful implementation
- Failover testing needs thorough scenarios
- IPC serialization needs attention

### Readiness Indicators
- **Green Light (8.5/10)**: Ready for implementation
- All context provided
- Clear validation path
- Realistic timeline (3-4 weeks)

### Minor Clarifications Helpful
1. Preferred IPC error handling pattern
2. Specific performance benchmarks expected
3. Conflict resolution preferences for oplog

### Next Steps
1. Install pg dependencies
2. Create PostgresAdapter base
3. Test binary round-trip
4. Build connection manager
5. Implement Electron failover

Implementation can proceed with high confidence, following existing patterns and focusing on thorough testing of the failover and sync mechanisms.