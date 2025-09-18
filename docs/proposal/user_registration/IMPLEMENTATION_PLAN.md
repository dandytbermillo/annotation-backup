# Workspace-Based Data Scoping Implementation Plan

**Feature Slug:** `user_registration`  
**Date:** 2025-01-17  
**Author:** Claude  
**Status:** Planning Phase  
**Mode:** Option A (offline, single-user, no Yjs runtime)  

## Executive Summary

Implement a workspace-based data scoping system to ensure consistent data access across all browsers on the same local machine. This solves the issue of different browsers showing different notes when accessing the same local PostgreSQL instance.

**IMPORTANT SAFETY NOTES:**
- This plan is **NOT TESTED** - all code examples are theoretical
- Migration scripts must be tested in a development environment first
- Database backups should be taken before applying migrations
- The existing schema uses `branches` table (not `annotations`) per migration 002
- **CRITICAL:** The current schema includes YJS tables (`yjs_updates`, `snapshots`) with BYTEA columns - these must be preserved for future Option B compatibility but NOT used in Option A runtime code
- **ON DELETE RESTRICT**: Changed from CASCADE to RESTRICT to prevent accidental data loss. Workspace deletion now requires explicit handling of associated data
- **Feature Slug Note**: Using "user_registration" as slug though this implements workspace scoping. Consider renaming to "workspace_scoping" in future iterations for clarity

## Problem Statement

Currently, when multiple browsers access the local annotation app, they may see different data sets because there's no consistent user/workspace context. This creates a fragmented experience on the same machine.

## Solution Overview

Implement a **single default workspace** approach using a server-issued UUID. All data will be scoped to this workspace, ensuring all browsers accessing the same local PostgreSQL instance see the same notes and annotations.

### Architecture Approach

**Based on codebase analysis:**
1. **No authentication/session system** - App has no user auth currently
2. **Direct database connections** - API routes create their own Pool instances
3. **Adapter pattern** - Web adapters call API routes, Electron adapters use direct DB
4. **Server-side filtering** - Workspace scoping happens in backend only
5. **Singleton workspace** - One workspace per PostgreSQL instance

**Workspace ID Flow:**
```
Browser A → API Route → Pool → workspace_manager → PostgreSQL
Browser B → API Route → Pool → workspace_manager → PostgreSQL
                                    ↓
                            (Same workspace ID)
```

### Key Principles
- **Zero Configuration**: Works immediately without user setup
- **Privacy-First**: No hardware fingerprinting or personal data collection  
- **Future-Proof**: Easy to extend to multiple workspaces later
- **Minimal Changes**: Only modify what's necessary

## Database Design

### New Tables

```sql
-- Workspace definition
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) DEFAULT 'Default Workspace',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create index for default workspace lookup
CREATE UNIQUE INDEX idx_default_workspace ON workspaces(is_default) WHERE is_default = true;
```

### Modified Tables

```sql
-- Add workspace reference to top-level entities (RESTRICT for safety)
ALTER TABLE notes 
  ADD COLUMN workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;

-- Create indexes for workspace queries (single and composite)
CREATE INDEX idx_notes_workspace ON notes(workspace_id);
CREATE INDEX idx_notes_workspace_updated ON notes(workspace_id, updated_at DESC);

-- Optional: Add to panels if queried independently
ALTER TABLE panels 
  ADD COLUMN workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
CREATE INDEX idx_panels_workspace ON panels(workspace_id);
CREATE INDEX idx_panels_workspace_accessed ON panels(workspace_id, last_accessed DESC);
```

### Migration Strategy

**IMPORTANT:** Following CLAUDE.md requirements, next migration number should be 018 or higher based on existing migrations (017 already exists).

#### Forward Migration (`018_add_workspace_support.up.sql`)
```sql
BEGIN;

-- 0. Ensure UUID generation support (may already exist from migration 000)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Create workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) DEFAULT 'Default Workspace',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX idx_default_workspace ON workspaces(is_default) WHERE is_default = true;

-- 2. Add workspace_id to notes (nullable initially, RESTRICT delete for safety)
ALTER TABLE notes 
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;

-- 3. Create default workspace (safe insertion - won't fail if already exists)
-- Using DO block for safer error handling
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE is_default = true) THEN
    INSERT INTO workspaces (name, is_default) 
      VALUES ('Default Workspace', true);
  END IF;
END $$;

-- 4. Assign all existing notes to default workspace
UPDATE notes 
SET workspace_id = (SELECT id FROM workspaces WHERE is_default = true)
WHERE workspace_id IS NULL;

-- 5. Make workspace_id non-nullable after migration
ALTER TABLE notes 
  ALTER COLUMN workspace_id SET NOT NULL;

-- 6. Add indexes (single and composite for common query patterns)
CREATE INDEX IF NOT EXISTS idx_notes_workspace ON notes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notes_workspace_updated ON notes(workspace_id, updated_at DESC);

-- 7. Add trigger to workspaces table (using existing update_updated_at function from migration 001)
CREATE TRIGGER update_workspaces_updated BEFORE UPDATE ON workspaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 8. Note: update_updated_at() function already exists from migration 001_initial_schema.up.sql

-- 9. Optionally add to panels (for independent queries)
ALTER TABLE panels 
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;

UPDATE panels p
SET workspace_id = (SELECT workspace_id FROM notes n WHERE n.id = p.note_id)
WHERE p.workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_panels_workspace ON panels(workspace_id);
CREATE INDEX IF NOT EXISTS idx_panels_workspace_accessed ON panels(workspace_id, last_accessed DESC);

COMMIT;
```

#### Rollback Migration (`018_add_workspace_support.down.sql`)
```sql
BEGIN;

-- Safety check: Ensure we're not losing critical data
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM notes WHERE workspace_id IS NOT NULL LIMIT 1) THEN
    RAISE NOTICE 'Removing workspace associations from % notes', 
      (SELECT COUNT(*) FROM notes WHERE workspace_id IS NOT NULL);
  END IF;
END $$;

-- Remove triggers first
DROP TRIGGER IF EXISTS update_workspaces_updated ON workspaces;

-- Remove workspace dependencies in reverse order
DROP INDEX IF EXISTS idx_panels_workspace_accessed;
DROP INDEX IF EXISTS idx_panels_workspace;
ALTER TABLE panels DROP COLUMN IF EXISTS workspace_id;

DROP INDEX IF EXISTS idx_notes_workspace_updated;
DROP INDEX IF EXISTS idx_notes_workspace;
ALTER TABLE notes DROP COLUMN IF EXISTS workspace_id;

DROP INDEX IF EXISTS idx_default_workspace;
DROP TABLE IF EXISTS workspaces;

-- Note: Not dropping update_updated_at() as it's used by other tables

COMMIT;
```

## Implementation Steps

### Phase 1: Database Layer & Workspace Initialization (Day 1)

1. **Create Migration Files**
   - Write forward migration script
   - Write rollback migration script
   - Test both directions locally

2. **Update Database Types**
   ```typescript
   // lib/types/workspace.ts
   export interface Workspace {
     id: string;
     name: string;
     isDefault: boolean;
     createdAt: Date;
     updatedAt: Date;
     metadata: Record<string, any>;
   }
   ```

3. **Create Workspace Initialization**
   
   **IMPORTANT**: The app doesn't use a services pattern. Instead, workspace initialization will be handled directly in API routes and adapters.
   
   ```typescript
   // lib/workspace/workspace-manager.ts (new file)
   import { Pool } from 'pg'
   
   export async function ensureDefaultWorkspace(pool: Pool): Promise<string> {
     // Check for existing default workspace
     const result = await pool.query(
       'SELECT id FROM workspaces WHERE is_default = true LIMIT 1'
     )
     
     if (result.rows.length > 0) {
       return result.rows[0].id
     }
     
     // Create default workspace if not exists
     const createResult = await pool.query(
       `INSERT INTO workspaces (name, is_default) 
        VALUES ('Default Workspace', true) 
        RETURNING id`
     )
     
     return createResult.rows[0].id
   }
   
   // Global singleton for workspace ID (server-side only)
   let currentWorkspaceId: string | null = null
   
   export async function getCurrentWorkspaceId(pool: Pool): Promise<string> {
     if (!currentWorkspaceId) {
       currentWorkspaceId = await ensureDefaultWorkspace(pool)
     }
     return currentWorkspaceId
   }
   ```

### Phase 2: API Layer Updates (Day 2)

1. **Update API Routes to Include Workspace**
   
   Each API route that creates a Pool needs to get the workspace ID:
   
   ```typescript
   // app/api/postgres-offline/notes/route.ts
   import { getCurrentWorkspaceId } from '@/lib/workspace/workspace-manager'
   
   const pool = new Pool({
     connectionString: process.env.DATABASE_URL
   })
   
   // POST - Create note
   export async function POST(request: NextRequest) {
     const workspaceId = await getCurrentWorkspaceId(pool)
     const body = await request.json()
     
     const result = await pool.query(
       `INSERT INTO notes (id, title, metadata, workspace_id, created_at, updated_at)
        VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3::jsonb, $4, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
        RETURNING id, title, metadata, created_at, updated_at`,
       [idOrNull, title, JSON.stringify(metadata), workspaceId]
     )
   }
   
   // GET - List notes
   export async function GET(request: NextRequest) {
     const workspaceId = await getCurrentWorkspaceId(pool)
     
     const result = await pool.query(
       'SELECT * FROM notes WHERE workspace_id = $1 ORDER BY updated_at DESC',
       [workspaceId]
     )
   }
   ```

2. **Update Server-Side Adapters**
   
   ```typescript
   // lib/database/server-postgres-adapter.ts
   import { getCurrentWorkspaceId } from '@/lib/workspace/workspace-manager'
   
   export class ServerPostgresAdapter extends PostgresAdapter {
     private workspaceId: string | null = null
     
     private async ensureWorkspace(): Promise<string> {
       if (!this.workspaceId) {
         this.workspaceId = await getCurrentWorkspaceId(this.pool)
       }
       return this.workspaceId
     }
     
     // Override persistence methods to include workspace
     async persistUpdate(docName: string, update: Uint8Array): Promise<void> {
       const workspaceId = await this.ensureWorkspace()
       // Add workspace filtering to queries
     }
   }
   ```

### Phase 3: Client-Side Adapter Updates (Day 3)

1. **Update Web Postgres Offline Adapter**
   
   The WebPostgresOfflineAdapter doesn't need workspace ID - the API routes handle it:
   
   ```typescript
   // lib/adapters/web-postgres-offline-adapter.ts
   // No changes needed - workspace is handled server-side
   // The adapter just calls API routes which already filter by workspace
   ```

2. **Update Electron Adapters**
   
   ```typescript
   // lib/adapters/electron-postgres-offline-adapter.ts
   import { getCurrentWorkspaceId } from '@/lib/workspace/workspace-manager'
   
   export class ElectronPostgresOfflineAdapter extends PostgresOfflineAdapter {
     private workspaceId: string | null = null
     
     private async ensureWorkspace(): Promise<string> {
       if (!this.workspaceId) {
         const pool = this.getPool()
         this.workspaceId = await getCurrentWorkspaceId(pool)
       }
       return this.workspaceId
     }
     
     async createNote(input: Partial<Note>): Promise<Note> {
       const workspaceId = await this.ensureWorkspace()
       const pool = this.getPool()
       
       const result = await pool.query<Note>(
         `INSERT INTO notes (title, metadata, workspace_id, created_at, updated_at)
          VALUES ($1, $2::jsonb, $3, NOW(), NOW())
          RETURNING id, title, metadata, created_at, updated_at`,
         [title, JSON.stringify(metadata), workspaceId]
       )
       
       return result.rows[0]
     }
   }
   ```

3. **No Frontend Changes Required**
   - Workspace is transparent to UI components
   - All workspace filtering happens in backend
   - No need to pass workspace ID from frontend

### Phase 4: Testing (Day 4)

1. **Unit Tests**
   ```typescript
   // tests/workspace.test.ts
   - Test workspace creation
   - Test default workspace enforcement
   - Test data scoping
   ```

2. **Integration Tests**
   ```typescript
   // tests/integration/multi-browser.test.ts
   - Test same data visible across sessions
   - Test workspace persistence
   - Test migration rollback
   ```

3. **Manual Testing Checklist**
   - [ ] Open app in Chrome - create note
   - [ ] Open app in Firefox - see same note
   - [ ] Open app in Safari - see same note
   - [ ] Modify note in Chrome - see update in Firefox
   - [ ] Test with existing data migration
   - [ ] Test fresh install scenario

## Code Changes Summary

### Files to Create
- `migrations/018_add_workspace_support.up.sql`
- `migrations/018_add_workspace_support.down.sql`
- `lib/types/workspace.ts`
- `lib/workspace/workspace-manager.ts` - Workspace initialization logic
- `tests/workspace.test.ts`
- `tests/integration/multi-browser.test.ts`

### Files to Modify
- `app/api/postgres-offline/notes/route.ts` - Add workspace filtering
- `app/api/postgres-offline/notes/[id]/route.ts` - Add workspace filtering 
- `app/api/postgres-offline/panels/route.ts` - Inherit workspace from notes
- `app/api/postgres-offline/panels/batch/route.ts` - Inherit workspace from notes
- `lib/database/server-postgres-adapter.ts` - Add workspace support
- `lib/adapters/postgres-offline-adapter.ts` - Add workspace filtering (base class)
- `lib/adapters/electron-postgres-offline-adapter.ts` - Add workspace filtering
- `lib/adapters/web-postgres-offline-adapter.ts` - No changes (uses API routes)

### Files to Review (No Changes)
- `components/annotation-canvas-modern.tsx` - No changes needed
- `components/canvas/component-panel.tsx` - No changes needed
- Frontend components - Transparent to workspace concept

## Testing Strategy

### Automated Tests
```bash
# Unit tests
npm run test -- workspace

# Integration tests  
npm run test:integration -- multi-browser

# Migration tests
./scripts/test-migration.sh 018_add_workspace_support
```

### Manual Test Scenarios

1. **Fresh Installation**
   - Start with empty database
   - Verify workspace auto-creation
   - Create notes, verify scoping

2. **Existing Data Migration**
   - Start with existing notes
   - Run migration
   - Verify all notes assigned to default workspace
   - Verify rollback works

3. **Multi-Browser Consistency**
   - Create note in Browser A
   - Verify visible in Browser B
   - Edit in Browser B
   - Verify changes in Browser A

## Rollback Plan

If issues arise:

1. **Immediate Rollback**
   ```bash
   psql -d annotation_dev -f migrations/018_add_workspace_support.down.sql
   ```

2. **Data Recovery**
   - All data preserved during migration
   - Workspace columns simply removed
   - Original functionality restored

3. **Feature Flag Alternative**
   ```typescript
   const USE_WORKSPACE = process.env.ENABLE_WORKSPACE === 'true';
   
   if (USE_WORKSPACE) {
     // New workspace logic
   } else {
     // Original logic
   }
   ```

## Security Considerations

1. **SQL Injection Prevention**
   - Always use parameterized queries
   - Never concatenate workspace_id into SQL strings

2. **Workspace Isolation**
   - Enforce workspace_id in all queries
   - Add database-level RLS if needed (with proper null handling):
   ```sql
   ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
   CREATE POLICY workspace_isolation ON notes
     FOR ALL USING (
       workspace_id = COALESCE(
         current_setting('app.workspace_id', true)::uuid,
         '00000000-0000-0000-0000-000000000000'::uuid  -- Fallback to impossible UUID
       )
     );
   ```

3. **Future Multi-User Considerations**
   - Current design allows easy addition of user_id later
   - Workspace can become shared resource
   - No changes needed to core logic

## Performance Impact

### Expected Impact: Minimal
- One additional UUID column per table (16 bytes)
- Indexed for fast lookups
- JOIN complexity unchanged (workspace inherited through relations)

### Benchmarks to Run
```sql
-- Before implementation
EXPLAIN ANALYZE SELECT * FROM notes WHERE id = '...';

-- After implementation  
EXPLAIN ANALYZE SELECT * FROM notes WHERE workspace_id = '...' AND id = '...';
```

## Future Extensibility

### Phase 2: Multiple Workspaces (Future)
```typescript
// Easy to add workspace switcher
interface ExtendedWorkspace {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  lastAccessed?: Date;
}

// Workspace selector UI
<WorkspaceSelector 
  workspaces={workspaces}
  current={currentWorkspace}
  onChange={switchWorkspace}
/>
```

### Phase 3: User Accounts (Future)
```sql
-- Add user ownership
ALTER TABLE workspaces ADD COLUMN owner_id UUID REFERENCES users(id);

-- Share workspaces
CREATE TABLE workspace_members (
  workspace_id UUID REFERENCES workspaces(id),
  user_id UUID REFERENCES users(id),
  role VARCHAR(50),
  PRIMARY KEY (workspace_id, user_id)
);
```

### Phase 4: Sync Across Devices (Future)
- Workspace UUID becomes sync identifier
- Easy to implement cloud sync per workspace
- No changes to core data model

## Success Criteria

1. **Functional Requirements**
   - [ ] All browsers see same data
   - [ ] No configuration required
   - [ ] Existing data migrated successfully
   - [ ] Performance unchanged

2. **Technical Requirements**
   - [ ] All tests pass
   - [ ] Migration reversible
   - [ ] No breaking changes
   - [ ] Code follows project conventions

3. **User Experience**
   - [ ] Zero user intervention needed
   - [ ] No visible changes to UI
   - [ ] No data loss
   - [ ] No performance degradation

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Migration fails on existing data | Low | High | Test with production-like data; have rollback ready |
| Performance degradation | Low | Medium | Benchmark before/after; indexes in place |
| Workspace_id not properly filtered | Medium | High | Comprehensive test coverage; code review |
| Future multi-workspace complexity | Low | Low | Current design supports extension |
| Null workspace_id after migration | Low | High | Migration enforces NOT NULL after update |
| Concurrent migration runs | Low | High | Use migration tool with locking (e.g., golang-migrate) |
| Orphaned panels without notes | Medium | Medium | Foreign key constraints prevent this |
| Browser cache inconsistency | Medium | Low | Clear cache after migration deployment |

## Implementation Timeline

- **Day 1**: Database schema and migrations
- **Day 2**: Backend services and adapters  
- **Day 3**: API integration and testing
- **Day 4**: Integration testing and documentation
- **Day 5**: Buffer for issues and final validation

## Validation Checklist (Per CLAUDE.md Requirements)

Before marking complete:

- [ ] Migrations tested forward and backward
- [ ] All API endpoints updated and tested
- [ ] Multi-browser scenario validated
- [ ] Performance benchmarks acceptable
- [ ] Documentation updated
- [ ] No regressions in existing functionality
- [ ] Code review completed
- [ ] All validation gates passed:
  - [ ] `npm run lint` - no new lint errors
  - [ ] `npm run type-check` - TypeScript validation
  - [ ] `npm run test` - unit tests
  - [ ] `npm run test:integration` - integration tests
  - [ ] `./scripts/test-plain-mode.sh` - Option A verification
- [ ] Implementation report created in `docs/proposal/user_registration/reports/`
- [ ] No Yjs imports in Option A code (per CLAUDE.md)

## Critical Edge Cases to Handle

1. **Empty Database**: Migration must handle fresh installs with no existing data
2. **Partial Migration Failure**: If migration fails after workspace creation but before note updates, manual intervention may be needed
3. **Panels without Notes**: Some panels might have broken foreign keys to non-existent notes - these need handling
4. **Concurrent Access During Migration**: Database should be in maintenance mode during migration
5. **Workspace ID Conflicts**: UUID collision is astronomically unlikely but handled by PRIMARY KEY constraint
6. **Missing updated_at Trigger**: Migration assumes update_updated_at() exists from migration 001
7. **Index Name Conflicts**: Using IF NOT EXISTS to prevent failures on re-runs

## Notes and Decisions

1. **Why not use session/cookie-based workspaces?**
   - Browsers don't share cookies/sessions
   - Would defeat the purpose of consistent data

2. **Why not hardware fingerprinting?**
   - Privacy concerns
   - Brittle (hardware changes)
   - Complexity without benefit

3. **Why add workspace_id to panels?**
   - Enables independent panel queries
   - Future RLS support
   - Minimal storage overhead

4. **Why single default workspace?**
   - Solves immediate problem
   - Zero configuration
   - Easy to extend later

## References

- Original discussion: Multi-browser data consistency issue
- Related: `CLAUDE.md` - Project conventions
- Database schema: `lib/db/schema.sql`
- Migration examples: `migrations/`

---

## Implementation Readiness Status

### ✅ Ready for Implementation:
1. **Database schema changes** - Clear migration path with proper safety checks
2. **Workspace manager module** - Simple singleton pattern matching app architecture
3. **API route updates** - Clear pattern for adding workspace filtering
4. **Adapter updates** - Know which adapters need changes and how

### ⚠️ Considerations:
1. **Testing Required** - All SQL and code examples are theoretical
2. **Pool Instance Management** - Each API route creates its own Pool (may need optimization)
3. **Workspace Caching** - Using in-memory singleton, may need Redis for production
4. **Migration Tool** - Need to confirm which migration tool is used (manual vs golang-migrate)

### 🚀 Recommended Implementation Order:
1. **Test migration in dev environment first**
2. **Implement workspace-manager.ts with tests**
3. **Update one API route as proof of concept**
4. **Test multi-browser scenario**
5. **Roll out to all routes if successful**

**Next Steps**: 
1. Test the migration script in a development database
2. Create workspace-manager.ts with unit tests
3. Update one API route (suggest `/api/postgres-offline/notes/route.ts`) as proof of concept
4. Verify multi-browser consistency
5. Complete remaining implementation if POC succeeds