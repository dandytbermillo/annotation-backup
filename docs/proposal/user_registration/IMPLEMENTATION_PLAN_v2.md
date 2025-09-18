# Workspace-Based Data Scoping Implementation Plan (REVISED)

**Feature Slug:** `workspace_scoping`  
**Date:** 2025-01-17  
**Author:** Claude  
**Status:** Planning Phase - REVISED  
**Mode:** Option A (offline, single-user, no Yjs runtime)

## ⚠️ CRITICAL WARNINGS

1. **This is a THEORETICAL plan** - All code is untested
2. **Breaking changes** - Will require data migration for existing users
3. **Complex implementation** - Touches many core tables and files
4. **No rollback without data loss** - Once workspace_id is added and enforced
5. **Requires maintenance window** - `018a` must run while writes are paused to avoid NULL leakage

## Problem Statement

Multiple browsers accessing the same local PostgreSQL see different data because there's no consistent workspace context. Each browser session operates independently, creating data fragmentation.

## Solution Architecture

### Core Design Decisions

1. **Database-stored workspace** - NOT memory singleton (survives restarts)
2. **Workspace per PostgreSQL instance** - Single default workspace
3. **Server-side enforcement** - All workspace filtering in backend
4. **Transparent to frontend** - No UI changes needed
5. **Lazy initialization** - Create workspace on first access

### Tables Requiring workspace_id

Based on schema analysis, these tables need workspace_id:

**Primary Tables (directly need workspace_id):**
- `notes` - Top-level entity
- `items` - File tree structure (folders/notes)
- `search_history` - User searches
- `offline_queue` - Pending operations

`search_history` and `offline_queue` retain nullable workspace_id to support diagnostics/system retries, but all queries should filter by workspace and the plan adds auto-default triggers plus dedicated indexes to keep them aligned.

**Secondary Tables (inherit through foreign keys):**
- `branches` - Has note_id FK → inherits workspace
- `panels` - Has note_id FK → inherits workspace  
- `connections` - Has note_id FK → inherits workspace
- `snapshots` - Has note_id FK → inherits workspace
- `document_saves` - Has note_id FK → inherits workspace
- `debug_logs` - Has note_id FK → inherits workspace

**Tables that DON'T need workspace_id:**
- `yjs_updates` - Uses doc_name pattern
- `sync_status` - System-level
- `compaction_log` - System-level
- `oplog` - System-level
- `offline_dead_letter` - System-level

## Implementation Plan

### Phase 1: Database Schema Changes (Staged)

**Objective:** introduce workspace scoping without blocking live writes or creating NULL data during rollout. Split the work into migrations with an explicit code deployment between them.

1. **`018a_add_workspace_bootstrap` (nullable bootstrap)** – create the `workspaces` table, add *nullable* `workspace_id` columns to every note-linked table, seed a default workspace, and backfill existing rows. Run while the app is in a maintenance/read-only window to avoid concurrent inserts.
2. **Deploy application changes (Phases 2–6)** – roll out code behind a `FEATURE_WORKSPACE_SCOPING` flag so new writes populate `workspace_id` everywhere. Monitor the NULL counters in each table.
3. **`018d_workspace_integrity` (guards + auto-default)** – enforce composite parent/child relationships and add triggers that fall back to the session workspace_id when callers forget to supply it.
4. **`018c_enforce_workspace_not_null` + RLS (enforcement)** – once telemetry shows `workspace_id` stays non-null and integrity guards pass, set the columns to `NOT NULL`, add indexes (including search_history/offline_queue), and attach RLS policies. Abort if validation queries detect lingering NULLs.

`search_history` and `offline_queue` intentionally remain nullable to preserve diagnostics and system operations. They still receive `workspace_id` during backfill and auto-default triggers, and queries should filter by workspace_id using the indexes added in 018c.

#### Migration 018a_add_workspace_bootstrap.up.sql

```sql
BEGIN;

-- Ensure extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Create workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL DEFAULT 'Default Workspace',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settings JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT only_one_default UNIQUE (is_default) WHERE is_default = true
);

-- Strict timestamps helper (reused later)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_workspaces_updated BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Add workspace_id columns (nullable for now)
ALTER TABLE notes            ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE items            ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE search_history   ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE offline_queue    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE branches         ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE panels           ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE connections      ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE snapshots        ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE document_saves   ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE debug_logs       ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;

-- 3. Create default workspace (id cached for backfill)
DO $$
DECLARE
  default_workspace_id UUID;
BEGIN
  SELECT id INTO default_workspace_id FROM workspaces WHERE is_default = true;

  IF default_workspace_id IS NULL THEN
    INSERT INTO workspaces (name, is_default)
    VALUES ('Default Workspace', true)
    ON CONFLICT ON CONSTRAINT only_one_default
    DO UPDATE SET updated_at = NOW()
    RETURNING id INTO default_workspace_id;

    RAISE NOTICE 'Created default workspace with ID: %', default_workspace_id;
  END IF;

  PERFORM set_config('app.default_workspace_id', default_workspace_id::text, false);
END $$;

-- 4. Backfill existing data to the default workspace
UPDATE notes
SET workspace_id = current_setting('app.default_workspace_id')::uuid
WHERE workspace_id IS NULL;

UPDATE items
SET workspace_id = current_setting('app.default_workspace_id')::uuid
WHERE workspace_id IS NULL;

UPDATE search_history
SET workspace_id = current_setting('app.default_workspace_id')::uuid
WHERE workspace_id IS NULL;

UPDATE offline_queue
SET workspace_id = current_setting('app.default_workspace_id')::uuid
WHERE workspace_id IS NULL;

UPDATE branches b
SET workspace_id = n.workspace_id
FROM notes n
WHERE b.workspace_id IS NULL AND b.note_id = n.id;

UPDATE panels p
SET workspace_id = n.workspace_id
FROM notes n
WHERE p.workspace_id IS NULL AND p.note_id = n.id;

UPDATE connections c
SET workspace_id = n.workspace_id
FROM notes n
WHERE c.workspace_id IS NULL AND c.note_id = n.id;

UPDATE snapshots s
SET workspace_id = n.workspace_id
FROM notes n
WHERE s.workspace_id IS NULL AND s.note_id = n.id;

UPDATE document_saves d
SET workspace_id = n.workspace_id
FROM notes n
WHERE d.workspace_id IS NULL AND d.note_id = n.id;

UPDATE debug_logs l
SET workspace_id = n.workspace_id
FROM notes n
WHERE l.workspace_id IS NULL AND l.note_id = n.id;

-- 5. Helper for runtime initialization
CREATE OR REPLACE FUNCTION get_or_create_default_workspace()
RETURNS UUID AS $$
DECLARE
  workspace_id UUID;
BEGIN
  SELECT id INTO workspace_id FROM workspaces WHERE is_default = true;

  IF workspace_id IS NULL THEN
    INSERT INTO workspaces (name, is_default)
    VALUES ('Default Workspace', true)
    ON CONFLICT ON CONSTRAINT only_one_default
    DO UPDATE SET updated_at = NOW()
    RETURNING id INTO workspace_id;
  END IF;

  RETURN workspace_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
```

**Validation (run immediately after 018a):**

```sql
SELECT 'notes' AS table, COUNT(*) AS null_rows FROM notes WHERE workspace_id IS NULL
UNION ALL
SELECT 'items', COUNT(*) FROM items WHERE workspace_id IS NULL
UNION ALL
SELECT 'branches', COUNT(*) FROM branches WHERE workspace_id IS NULL
UNION ALL
SELECT 'panels', COUNT(*) FROM panels WHERE workspace_id IS NULL
UNION ALL
SELECT 'connections', COUNT(*) FROM connections WHERE workspace_id IS NULL
UNION ALL
SELECT 'snapshots', COUNT(*) FROM snapshots WHERE workspace_id IS NULL
UNION ALL
SELECT 'document_saves', COUNT(*) FROM document_saves WHERE workspace_id IS NULL
UNION ALL
SELECT 'debug_logs', COUNT(*) FROM debug_logs WHERE workspace_id IS NULL;
```

Abort the rollout if any counts are non-zero.

#### Migration 018a_add_workspace_bootstrap.down.sql

```sql
BEGIN;

DROP FUNCTION IF EXISTS get_or_create_default_workspace();

ALTER TABLE debug_logs       DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE document_saves   DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE snapshots        DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE connections      DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE panels           DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE branches         DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE offline_queue    DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE search_history   DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE items            DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE notes            DROP COLUMN IF EXISTS workspace_id;

DROP TRIGGER IF EXISTS update_workspaces_updated ON workspaces;
DROP TABLE IF EXISTS workspaces;

COMMIT;
```

#### Migration 018c_enforce_workspace_not_null.up.sql

Run only after the application rollout and monitoring show zero NULL rows for all workspace-aware tables.

```sql
BEGIN;

-- Enforce NOT NULL
ALTER TABLE notes          ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE items          ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE branches       ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE panels         ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE connections    ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE snapshots      ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE document_saves ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE debug_logs     ALTER COLUMN workspace_id SET NOT NULL;

-- System tables remain nullable (search_history, offline_queue) for diagnostics.

-- Indexes to keep scoped queries fast
CREATE INDEX idx_notes_workspace             ON notes(workspace_id);
CREATE INDEX idx_notes_workspace_updated     ON notes(workspace_id, updated_at DESC);
CREATE INDEX idx_items_workspace             ON items(workspace_id);
CREATE INDEX idx_items_workspace_parent      ON items(workspace_id, parent_id);
CREATE INDEX idx_branches_workspace          ON branches(workspace_id);
CREATE INDEX idx_branches_workspace_note     ON branches(workspace_id, note_id);
CREATE INDEX idx_panels_workspace            ON panels(workspace_id);
CREATE INDEX idx_panels_workspace_note       ON panels(workspace_id, note_id);
CREATE INDEX idx_connections_workspace       ON connections(workspace_id);
CREATE INDEX idx_snapshots_workspace         ON snapshots(workspace_id);
CREATE INDEX idx_document_saves_workspace    ON document_saves(workspace_id);
CREATE INDEX idx_debug_logs_workspace        ON debug_logs(workspace_id);
CREATE INDEX idx_search_history_workspace    ON search_history(workspace_id);
CREATE INDEX idx_offline_queue_workspace     ON offline_queue(workspace_id);

-- Optional: attach RLS policies (defined in Phase 5)

COMMIT;
```

#### Migration 018c_enforce_workspace_not_null.down.sql

```sql
BEGIN;

DROP INDEX IF EXISTS idx_debug_logs_workspace;
DROP INDEX IF EXISTS idx_document_saves_workspace;
DROP INDEX IF EXISTS idx_snapshots_workspace;
DROP INDEX IF EXISTS idx_connections_workspace;
DROP INDEX IF EXISTS idx_panels_workspace;
DROP INDEX IF EXISTS idx_branches_workspace;
DROP INDEX IF EXISTS idx_items_workspace;
DROP INDEX IF EXISTS idx_notes_workspace_updated;
DROP INDEX IF EXISTS idx_notes_workspace;

ALTER TABLE debug_logs     ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE document_saves ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE snapshots      ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE connections    ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE panels         ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE branches       ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE items          ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE notes          ALTER COLUMN workspace_id DROP NOT NULL;

COMMIT;
```

### Phase 3: Integrity Guards (Mandatory)

To prevent cross-workspace drift, add a follow-up migration (`018d_workspace_integrity.sql`) **before** enabling RLS enforcement:

```sql
-- Auto-default workspace_id from current_setting if the app forgot to pass it
CREATE OR REPLACE FUNCTION set_ws_from_setting() RETURNS trigger AS $$
DECLARE
  v text := current_setting('app.current_workspace_id', true);
BEGIN
  IF NEW.workspace_id IS NULL AND v IS NOT NULL AND v <> '' THEN
    NEW.workspace_id := v::uuid;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notes_ws_default ON notes;
CREATE TRIGGER notes_ws_default BEFORE INSERT ON notes
FOR EACH ROW EXECUTE FUNCTION set_ws_from_setting();

DROP TRIGGER IF EXISTS items_ws_default ON items;
CREATE TRIGGER items_ws_default BEFORE INSERT ON items
FOR EACH ROW EXECUTE FUNCTION set_ws_from_setting();

DROP TRIGGER IF EXISTS search_history_ws_default ON search_history;
CREATE TRIGGER search_history_ws_default BEFORE INSERT ON search_history
FOR EACH ROW EXECUTE FUNCTION set_ws_from_setting();

DROP TRIGGER IF EXISTS offline_queue_ws_default ON offline_queue;
CREATE TRIGGER offline_queue_ws_default BEFORE INSERT ON offline_queue
FOR EACH ROW EXECUTE FUNCTION set_ws_from_setting();

-- Keep parent/child tables aligned across workspaces
CREATE UNIQUE INDEX IF NOT EXISTS notes_id_ws_uniq ON notes(id, workspace_id);

ALTER TABLE panels
  ADD CONSTRAINT panels_note_workspace_fk
  FOREIGN KEY (note_id, workspace_id)
  REFERENCES notes(id, workspace_id)
  ON DELETE CASCADE;

ALTER TABLE branches
  ADD CONSTRAINT branches_note_workspace_fk
  FOREIGN KEY (note_id, workspace_id)
  REFERENCES notes(id, workspace_id)
  ON DELETE CASCADE;

ALTER TABLE connections
  ADD CONSTRAINT connections_note_workspace_fk
  FOREIGN KEY (note_id, workspace_id)
  REFERENCES notes(id, workspace_id)
  ON DELETE CASCADE;

ALTER TABLE snapshots
  ADD CONSTRAINT snapshots_note_workspace_fk
  FOREIGN KEY (note_id, workspace_id)
  REFERENCES notes(id, workspace_id)
  ON DELETE CASCADE;

ALTER TABLE document_saves
  ADD CONSTRAINT document_saves_note_workspace_fk
  FOREIGN KEY (note_id, workspace_id)
  REFERENCES notes(id, workspace_id)
  ON DELETE CASCADE;

ALTER TABLE debug_logs
  ADD CONSTRAINT debug_logs_note_workspace_fk
  FOREIGN KEY (note_id, workspace_id)
  REFERENCES notes(id, workspace_id)
  ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION enforce_child_ws() RETURNS trigger AS $$
DECLARE
  parent_ws uuid;
BEGIN
  SELECT workspace_id INTO parent_ws FROM notes WHERE id = NEW.note_id;
  IF parent_ws IS NULL OR NEW.workspace_id IS DISTINCT FROM parent_ws THEN
    RAISE EXCEPTION 'workspace mismatch for %', NEW.note_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS panels_ws_guard ON panels;
CREATE TRIGGER panels_ws_guard BEFORE INSERT OR UPDATE ON panels
FOR EACH ROW EXECUTE FUNCTION enforce_child_ws();

DROP TRIGGER IF EXISTS branches_ws_guard ON branches;
CREATE TRIGGER branches_ws_guard BEFORE INSERT OR UPDATE ON branches
FOR EACH ROW EXECUTE FUNCTION enforce_child_ws();

DROP TRIGGER IF EXISTS connections_ws_guard ON connections;
CREATE TRIGGER connections_ws_guard BEFORE INSERT OR UPDATE ON connections
FOR EACH ROW EXECUTE FUNCTION enforce_child_ws();

DROP TRIGGER IF EXISTS snapshots_ws_guard ON snapshots;
CREATE TRIGGER snapshots_ws_guard BEFORE INSERT OR UPDATE ON snapshots
FOR EACH ROW EXECUTE FUNCTION enforce_child_ws();

DROP TRIGGER IF EXISTS document_saves_ws_guard ON document_saves;
CREATE TRIGGER document_saves_ws_guard BEFORE INSERT OR UPDATE ON document_saves
FOR EACH ROW EXECUTE FUNCTION enforce_child_ws();

DROP TRIGGER IF EXISTS debug_logs_ws_guard ON debug_logs;
CREATE TRIGGER debug_logs_ws_guard BEFORE INSERT OR UPDATE ON debug_logs
FOR EACH ROW EXECUTE FUNCTION enforce_child_ws();
```

These guards must be in place before Phase 3B so any mismatched workspace data is rejected at the database layer.

### Phase 2: Workspace Management Module

#### lib/workspace/workspace-store.ts

```typescript
/**
 * Workspace management helpers – reuse existing pg.Pool instances and
 * provide a single place to scope queries.
 */
import { Pool, PoolClient } from 'pg'

const workspaceIdCache = new WeakMap<Pool, Promise<string>>()

export class WorkspaceStore {
  /**
   * Lazily fetch (and memoize) the default workspace id for a pool.
   */
  static async getDefaultWorkspaceId(pool: Pool): Promise<string> {
    if (!workspaceIdCache.has(pool)) {
      const workspacePromise = pool
        .query<{ get_or_create_default_workspace: string }>(
          'SELECT get_or_create_default_workspace() AS get_or_create_default_workspace'
        )
        .then(result => result.rows[0].get_or_create_default_workspace)
        .catch(error => {
          workspaceIdCache.delete(pool)
          throw error
        })

      workspaceIdCache.set(pool, workspacePromise)
    }

    return workspaceIdCache.get(pool)!
  }

  /**
   * Run a callback with `app.current_workspace_id` set for the session.
   * Ensures RLS/trigger logic can rely on the setting.
   */
  static async withWorkspace<T>(
    pool: Pool,
    fn: (ctx: { client: PoolClient; workspaceId: string }) => Promise<T>
  ): Promise<T> {
    const workspaceId = await this.getDefaultWorkspaceId(pool)
    const client = await pool.connect()

    try {
      await client.query('SELECT set_config($1, $2, false)', [
        'app.current_workspace_id',
        workspaceId,
      ])

      return await fn({ client, workspaceId })
    } finally {
      client.release()
    }
  }
}

export const FEATURE_WORKSPACE_SCOPING =
  process.env.NEXT_PUBLIC_FEATURE_WORKSPACE_SCOPING === 'true'
```

### Phase 4: API Route Updates

- Reuse the shared `serverPool` singleton; do **not** create throwaway pools per request.
- Guard all workspace-specific logic behind `FEATURE_WORKSPACE_SCOPING` so you can toggle the rollout instantly.
- Use `WorkspaceStore.withWorkspace` (or the thin `withWorkspaceClient` wrapper) for every query touching workspace-aware tables.

#### Example: app/api/postgres-offline/notes/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool' // Shared singleton
import { WorkspaceStore, FEATURE_WORKSPACE_SCOPING } from '@/lib/workspace/workspace-store'

// POST - Create note
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, title = 'Untitled', metadata = {} } = body

    if (!FEATURE_WORKSPACE_SCOPING) {
      // Legacy path while feature flag is disabled
      const result = await serverPool.query(
        `INSERT INTO notes (id, title, metadata, created_at, updated_at)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3::jsonb, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE 
         SET title = $2, metadata = $3, updated_at = NOW()
         RETURNING id, title, metadata, created_at, updated_at`,
        [id, title, JSON.stringify(metadata)]
      )
      return NextResponse.json(result.rows[0], { status: 201 })
    }

    const result = await WorkspaceStore.withWorkspace(serverPool, async ({ client, workspaceId }) => {
      return client.query(
        `INSERT INTO notes (id, title, metadata, workspace_id, created_at, updated_at)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3::jsonb, $4, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE 
         SET title = $2, metadata = $3, updated_at = NOW()
         WHERE notes.workspace_id = $4
         RETURNING id, title, metadata, created_at, updated_at`,
        [id, title, JSON.stringify(metadata), workspaceId]
      )
    })

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: 'Note exists in another workspace' },
        { status: 409 }
      )
    }

    return NextResponse.json(result.rows[0], { status: 201 })
  } catch (error) {
    console.error('[POST /api/postgres-offline/notes] Error:', error)
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 })
  }
}

// GET - List notes
export async function GET() {
  try {
    if (!FEATURE_WORKSPACE_SCOPING) {
      const result = await serverPool.query(
        `SELECT id, title, metadata, created_at, updated_at 
         FROM notes 
         ORDER BY updated_at DESC`
      )
      return NextResponse.json(result.rows)
    }

    const result = await WorkspaceStore.withWorkspace(serverPool, async ({ client, workspaceId }) => {
      return client.query(
        `SELECT id, title, metadata, created_at, updated_at 
         FROM notes 
         WHERE workspace_id = $1
         ORDER BY updated_at DESC`,
        [workspaceId]
      )
    })

    return NextResponse.json(result.rows)
  } catch (error) {
    console.error('[GET /api/postgres-offline/notes] Error:', error)
    return NextResponse.json({ error: 'Failed to list notes' }, { status: 500 })
  }
}
```

### Phase 5: Server-Side Enforcement (RLS + Helpers)

- Enable Row Level Security after `018c` so every query is double checked in the database:

```sql
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_workspace_policy ON notes
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY branches_workspace_policy ON branches
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Repeat for panels, connections, snapshots, document_saves, debug_logs.
```

*Note:* `current_setting(..., true)` returns `NULL` instead of throwing if the setting is missing; combine with a NOT NULL constraint and `withWorkspace` helper to ensure each session sets the workspace before any DML runs.

- Provide a single helper to guarantee every raw SQL call sets the session workspace before execution:

```typescript
export async function withWorkspaceClient<T>(
  pool: Pool,
  handler: (client: PoolClient, workspaceId: string) => Promise<T>
): Promise<T> {
  return WorkspaceStore.withWorkspace(pool, ({ client, workspaceId }) =>
    handler(client, workspaceId)
  )
}
```

- Write unit tests that try to read/write without setting `app.current_workspace_id` and assert that RLS rejects the query.

### Phase 6: Adapter Updates

#### lib/adapters/postgres-offline-adapter.ts

```typescript
import type { PoolClient } from 'pg'
import { WorkspaceStore, FEATURE_WORKSPACE_SCOPING } from '@/lib/workspace/workspace-store'

export abstract class PostgresOfflineAdapter extends PostgresAdapter {
  protected async runWithWorkspace<T>(
    handler: (client: PoolClient, workspaceId: string) => Promise<T>
  ): Promise<T> {
    if (!FEATURE_WORKSPACE_SCOPING) {
      throw new Error('Workspace scoping disabled – adapter should use legacy path')
    }

    return WorkspaceStore.withWorkspace(this.getPool(), ({ client, workspaceId }) =>
      handler(client, workspaceId)
    )
  }

  async createNote(input: Partial<Note>): Promise<Note> {
    const { title = 'Untitled', metadata = {} } = input

    const result = await this.runWithWorkspace((client, workspaceId) =>
      client.query<Note>(
        `INSERT INTO notes (title, metadata, workspace_id, created_at, updated_at)
         VALUES ($1, $2::jsonb, $3, NOW(), NOW())
         RETURNING id, title, metadata, created_at, updated_at`,
        [title, JSON.stringify(metadata), workspaceId]
      )
    )

    return result.rows[0]
  }

  async getNote(id: string): Promise<Note | null> {
    const result = await this.runWithWorkspace((client, workspaceId) =>
      client.query<Note>(
        `SELECT id, title, metadata, created_at, updated_at
         FROM notes 
         WHERE id = $1 AND workspace_id = $2`,
        [id, workspaceId]
      )
    )

    return result.rows[0] || null
  }

  // Similar updates for other methods...
}
```

#### Electron IPC / Main-Process Updates

- Update `electron/ipc/postgres-offline-handlers.ts` to import `WorkspaceStore` and wrap each handler in `WorkspaceStore.withWorkspace(pool, ...)`, ensuring `app.current_workspace_id` is set before any SQL runs.
- Maintain a single `Pool` instance in the main process (reuse the existing `getPool` helper) and cache the resolved workspace id via `WorkspaceStore.getDefaultWorkspaceId` so repeated IPC calls do not re-query unnecessarily.
- Confirm IPC responses include the workspace id when useful for diagnostics (e.g., a `postgres-offline:getWorkspace` channel) and add an integration test that opens two Electron windows to verify they read/write within the same workspace context.
- Document that renderer processes should remain unaware of workspace ids; all enforcement stays in the main process and API routes to avoid exposing the setting to client code.

## Files to Modify

### Database Files
- Create: `migrations/018a_add_workspace_bootstrap.up.sql`
- Create: `migrations/018a_add_workspace_bootstrap.down.sql`
- Create: `migrations/018c_enforce_workspace_not_null.up.sql`
- Create: `migrations/018c_enforce_workspace_not_null.down.sql`
- Create: `migrations/018d_workspace_integrity.sql` (auto-default triggers + composite FKs/guards)
- Optional follow-up: `migrations/018e_workspace_rls_policies.sql` if RLS is separated from 018c

### New Files
- Create: `lib/workspace/workspace-store.ts`
- Create: `lib/db/pool.ts` (or refactor existing singleton) to expose a shared `serverPool`
- Create: `lib/types/workspace.ts`
- Create: `__tests__/workspace/workspace-store.test.ts`
- Create: `scripts/monitor-workspace-null.sh`

### API Routes (12 files)
- `app/api/postgres-offline/notes/route.ts`
- `app/api/postgres-offline/notes/[id]/route.ts`
- `app/api/postgres-offline/panels/route.ts`
- `app/api/postgres-offline/panels/batch/route.ts`
- `app/api/postgres-offline/queue/route.ts`
- `app/api/postgres-offline/queue/flush/route.ts`
- `app/api/items/route.ts`
- `app/api/items/[id]/route.ts`
- `app/api/items/[id]/children/route.ts`
- `app/api/items/[id]/move/route.ts`
- `app/api/items/bulk-move/route.ts`
- `app/api/debug-log/route.ts`

### Adapters / IPC (5 files)
- `lib/adapters/postgres-offline-adapter.ts` - Base class
- `lib/adapters/electron-postgres-offline-adapter.ts`
- `lib/database/server-postgres-adapter.ts`
- `lib/adapters/web-postgres-offline-adapter.ts` - No changes (uses API)
- `electron/ipc/postgres-offline-handlers.ts`

## Testing Strategy

### 1. Migration Test
```bash
# Test bootstrap migration
psql -d annotation_test -f migrations/018a_add_workspace_bootstrap.up.sql

# Verify workspace created
psql -d annotation_test -c "SELECT * FROM workspaces"

# Test bootstrap rollback
psql -d annotation_test -f migrations/018a_add_workspace_bootstrap.down.sql

# After code rollout, dry-run enforcement
psql -d annotation_test -f migrations/018c_enforce_workspace_not_null.up.sql
psql -d annotation_test -f migrations/018c_enforce_workspace_not_null.down.sql
```

### 2. Multi-Browser Test
```bash
# Terminal 1 - Start server
npm run dev

# Terminal 2 - Create note in Chrome
open http://localhost:3000

# Terminal 3 - Verify in Firefox  
open -a Firefox http://localhost:3000

# Both should see same notes
```

### 3. Integration Tests
```typescript
// __tests__/workspace/multi-browser.test.ts
import { serverPool } from '@/lib/db/pool'
import { WorkspaceStore } from '@/lib/workspace/workspace-store'

describe('Workspace Consistency', () => {
  test('multiple calls share the default workspace id', async () => {
    const ws1 = await WorkspaceStore.getDefaultWorkspaceId(serverPool)
    const ws2 = await WorkspaceStore.getDefaultWorkspaceId(serverPool)

    expect(ws1).toBe(ws2)
  })
})
```

### 4. RLS & Feature Flag Tests
- Add a test that attempts to read `notes` without calling `withWorkspace` and expect an RLS rejection (e.g., `throw` contains `violates row-level security policy`).
- Integration suite should run with `FEATURE_WORKSPACE_SCOPING` both `true` and `false` to ensure legacy paths still work.
- Performance benchmark: compare `EXPLAIN ANALYZE` on key queries before/after the indexes from `018c` to confirm the 10% threshold.
- Integrity guard: attempt to insert/update a child record (e.g., panel) with a mismatched workspace and assert the composite FK or guard trigger rejects it.

## Risk Analysis

### High Risk Items

1. **Data Migration Failure**
   - Risk: Existing data not properly assigned to workspace or concurrent inserts producing NULLs
   - Mitigation: Run 018a during a maintenance/read-only window, split enforcement into 018c, execute NULL validation queries before proceeding
   
2. **Performance Degradation**  
   - Risk: Additional WHERE clauses slow queries
   - Mitigation: Composite indexes on (workspace_id, commonly_filtered_column)

3. **Connection Pool Issues**
   - Risk: Multiple pools created, connection exhaustion
   - Mitigation: Singleton pool management in WorkspaceStore

4. **Incomplete Implementation**
   - Risk: Some queries miss workspace filter, data leaks
   - Mitigation: Shared `withWorkspace` helper, RLS policies, feature-flag rollout with regression tests

### Medium Risk Items

1. **Frontend Caching**
   - Risk: Cached data without workspace context
   - Mitigation: Clear caches after deployment

2. **Offline Queue**
   - Risk: Queued operations without workspace_id
   - Mitigation: Add workspace_id to queue entries

## Implementation Checklist

### Pre-Implementation
- [ ] Take and verify restorable database backups (run a timed restore rehearsal)
- [ ] Schedule maintenance/read-only window for running `018a`
- [ ] Review all tables with `note_id` or related foreign keys and document join paths for backfills
- [ ] Identify all API routes/adapters that touch scoped tables
- [ ] Create a test database (snapshot of production if possible) for migration dry-runs

### Implementation Phase 1 - Database
- [ ] Run `018a_add_workspace_bootstrap` against the test database
- [ ] Execute validation query to confirm no `workspace_id IS NULL`
- [ ] Run `018a` in development during maintenance window
- [ ] Capture metrics: duration, lock contention, row counts updated
- [ ] Keep app in read-only mode until validation query returns zero NULL rows in every table
- [ ] Verify `update_updated_at` triggers remain active on notes, items, panels, branches, connections, document_saves, debug_logs

### Implementation Phase 1b - Code Rollout
- [ ] Ship backend/app changes behind `FEATURE_WORKSPACE_SCOPING`
- [ ] Update infrastructure scripts to export `NEXT_PUBLIC_FEATURE_WORKSPACE_SCOPING`
- [ ] Monitor NULL counters in notes/panels/branches every minute for at least an hour
- [ ] Run smoke tests with feature flag on/off (API + adapters + Electron IPC)

```bash
# Example monitor script (cron or pm2)
while true; do
  psql "$DATABASE_URL" -c "
    SELECT NOW() AS ts,
           SUM(CASE WHEN workspace_id IS NULL THEN 1 ELSE 0 END) AS null_rows,
           'notes' AS table
      FROM notes
    UNION ALL
    SELECT NOW(), SUM(CASE WHEN workspace_id IS NULL THEN 1 ELSE 0 END), 'items'
      FROM items
    UNION ALL
    SELECT NOW(), SUM(CASE WHEN workspace_id IS NULL THEN 1 ELSE 0 END), 'panels'
      FROM panels
    UNION ALL
    SELECT NOW(), SUM(CASE WHEN workspace_id IS NULL THEN 1 ELSE 0 END), 'branches'
      FROM branches
    UNION ALL
    SELECT NOW(), SUM(CASE WHEN workspace_id IS NULL THEN 1 ELSE 0 END), 'connections'
      FROM connections
    UNION ALL
    SELECT NOW(), SUM(CASE WHEN workspace_id IS NULL THEN 1 ELSE 0 END), 'snapshots'
      FROM snapshots
    UNION ALL
    SELECT NOW(), SUM(CASE WHEN workspace_id IS NULL THEN 1 ELSE 0 END), 'document_saves'
      FROM document_saves
    UNION ALL
    SELECT NOW(), SUM(CASE WHEN workspace_id IS NULL THEN 1 ELSE 0 END), 'debug_logs'
      FROM debug_logs;"
  sleep 60
done
```

### Implementation Phase 2 - Backend
- [ ] Create `WorkspaceStore` helper + feature flag plumbing
- [ ] Update one API route as POC using `withWorkspace`
- [ ] Add shared helper (`withWorkspaceClient`) and refactor remaining routes in batches
- [ ] Update adapters to use `runWithWorkspace`
- [ ] Test multi-browser scenario using shared pool (Chrome vs Firefox)
- [ ] Apply `018d_workspace_integrity` in staging once happy-path tests pass
- [ ] Confirm every API route/queue processor uses `withWorkspace` (no direct pool queries)
- [ ] Verify electron main-process handlers set `app.current_workspace_id` before DML

### Implementation Phase 3 - Testing
- [ ] Unit tests for WorkspaceStore
- [ ] Integration tests for API routes
- [ ] Multi-browser manual testing
- [ ] Performance testing
- [ ] RLS negative tests (queries without workspace fail)
- [ ] Feature-flag regression suite (on/off)
- [ ] Integrity guard tests (composite FK + guard trigger reject mismatches)
- [ ] Smoke test that API routes and Electron IPC fail closed if `app.current_workspace_id` is missing

### Implementation Phase 4 - Enforcement
- [ ] Enable RLS policies once validation queries stay clean
- [ ] Apply `018c_enforce_workspace_not_null` in staging
- [ ] Run validation query and performance checks again
- [ ] Apply `018d_workspace_integrity` in production (after staging sign-off)
- [ ] Apply `018c` in production; monitor errors/locks in real time

### Post-Implementation
- [ ] Documentation update
- [ ] Migration guide for existing users
- [ ] Monitoring for workspace-related errors (include NULL counters + RLS violations)
- [ ] Document rollback plan (backup restore steps + expected downtime)
- [ ] Alert on composite FK / trigger exceptions (workspace mismatch events)

## Success Criteria

1. **Functional**
   - All browsers see same data
   - No data loss during migration
   - Workspace transparently initialized

2. **Performance**
   - Query performance within 10% of baseline
   - No connection pool exhaustion

3. **Quality**
   - All tests passing
   - No workspace_id NULL errors
   - Restore drill documented (backup + timed recovery)

## Critical Decision Points

### Why NOT Memory Singleton?
- Doesn't survive process restarts
- Doesn't work across workers/serverless
- Race conditions on initialization

### Why NOT Session/Cookie Based?
- Browsers don't share sessions
- Would require frontend changes
- Defeats purpose of consistent data

### Why RESTRICT Instead of CASCADE?
- Prevents accidental workspace deletion
- Forces explicit data cleanup
- Safer for production

## Next Steps

1. **Review this plan** with team/stakeholders
2. **Create test database** for safe migration testing (replay 018a/018c end-to-end)
3. **Implement WorkspaceStore + withWorkspace helpers** with comprehensive tests
4. **POC with one API route** before full rollout (feature flag on in staging only)
5. **Decide enforcement timeline** for 018c + RLS after telemetry shows zero NULL rows for 24h
6. **Gradual rollout** with monitoring and documented restore steps (include 018d + 018c)

---

**WARNING**: This implementation is complex and touches core data structures. Proceed with extreme caution and comprehensive testing.
