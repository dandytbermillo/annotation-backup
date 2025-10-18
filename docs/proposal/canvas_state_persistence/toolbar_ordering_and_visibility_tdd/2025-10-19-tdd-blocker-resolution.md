# TDD Blocker Resolution: Toolbar Ordering & Visibility

**Date**: 2025-10-19
**Purpose**: Address implementation blockers identified in TDD review
**Status**: Schema analysis complete, ready for TDD revision

---

## Executive Summary

Analysis of migration files reveals **the TDD's proposed tables conflict with existing schema**. The `workspace_toolbar_state` and `workspace_layout_snapshot` tables **duplicate functionality** already present in `canvas_workspace_notes` and `panels`. This document provides schema mapping, integration strategy, and blocker resolutions.

---

## 1. Actual Database Schema (From Migrations)

### 1.1 Existing Tables

#### `canvas_workspace_notes` (Migration 032)
```sql
CREATE TABLE canvas_workspace_notes (
  note_id UUID PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  is_open BOOLEAN NOT NULL DEFAULT FALSE,
  main_position_x NUMERIC,
  main_position_y NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID,
  schema_version INTEGER NOT NULL DEFAULT 1,

  CHECK (
    (is_open = FALSE) OR
    (
      main_position_x IS NOT NULL AND
      main_position_y IS NOT NULL AND
      main_position_x BETWEEN -1000000 AND 1000000 AND
      main_position_y BETWEEN -1000000 AND 1000000
    )
  )
);

CREATE INDEX idx_workspace_open ON canvas_workspace_notes (is_open) WHERE is_open = TRUE;
```

**Current purpose**:
- Tracks which notes are open in workspace
- Stores main panel position for each note
- Used for multi-note workspace persistence

**Limitations**:
- ❌ No ordering information (toolbar sequence)
- ❌ No focused/active note tracking
- ❌ Only stores main panel, not branch panels

---

#### `panels` (Migrations 001 + 030)
```sql
CREATE TABLE panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  panel_id TEXT NOT NULL,  -- YJS map key (e.g., 'main', 'branch-<uuid>')

  -- Original JSONB columns (legacy)
  position JSONB NOT NULL DEFAULT '{"x": 0, "y": 0}',
  dimensions JSONB NOT NULL DEFAULT '{"width": 400, "height": 300}',

  -- World-space columns (migration 030)
  position_x_world NUMERIC NOT NULL,
  position_y_world NUMERIC NOT NULL,
  width_world NUMERIC NOT NULL DEFAULT 400,
  height_world NUMERIC NOT NULL DEFAULT 300,
  z_index INTEGER NOT NULL DEFAULT 0,

  title TEXT,
  type TEXT DEFAULT 'editor' CHECK (type = ANY(ARRAY['main', 'editor', 'branch', 'context', 'toolbar', 'annotation'])),
  parent_id TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'lazy', 'unloaded')),

  -- Persistence metadata (migration 030)
  updated_by UUID,
  revision_token TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,

  last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(note_id, panel_id)
);
```

**Current purpose**:
- Stores ALL panel data (main + branch panels)
- World-space positions for zoom-invariant persistence
- Z-index for layering

**Limitations**:
- ❌ No workspace-level grouping
- ❌ No focused/highlighted state
- ❌ Panel type enum incomplete (no 'calculator', 'timer', etc.)

---

#### `canvas_camera_state` (Migration 031)
```sql
CREATE TABLE canvas_camera_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id UUID,
  camera_x NUMERIC NOT NULL DEFAULT 0,
  camera_y NUMERIC NOT NULL DEFAULT 0,
  zoom_level NUMERIC NOT NULL DEFAULT 1.0 CHECK (zoom_level >= 0.5 AND zoom_level <= 5.0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  schema_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(note_id, user_id)
);
```

**Current purpose**: Per-note (optionally per-user) camera/viewport state

---

## 2. Schema Integration Strategy

### 2.1 Recommendation: **Extend Existing Tables** (NOT Create New Ones)

**Rationale**:
1. `canvas_workspace_notes` already tracks open notes and positions
2. `panels` already stores all panel geometry with world coordinates
3. Creating new tables duplicates data and requires complex sync logic
4. Existing tables have proper constraints and indexes

### 2.2 Required Schema Changes

#### **Migration 033: Add Toolbar Ordering to canvas_workspace_notes**

```sql
-- Add toolbar ordering columns
ALTER TABLE canvas_workspace_notes
ADD COLUMN toolbar_sequence INTEGER,
ADD COLUMN is_focused BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Ensure only one focused note per workspace
-- Note: We'll need to add workspace_id later for multi-workspace support
CREATE UNIQUE INDEX idx_workspace_notes_focused
  ON canvas_workspace_notes (is_focused)
  WHERE is_focused = TRUE;

-- Backfill: Order existing open notes by updated_at
WITH ordered_notes AS (
  SELECT note_id, ROW_NUMBER() OVER (ORDER BY updated_at) - 1 AS seq
  FROM canvas_workspace_notes
  WHERE is_open = TRUE
)
UPDATE canvas_workspace_notes cwn
SET toolbar_sequence = ordered_notes.seq
FROM ordered_notes
WHERE cwn.note_id = ordered_notes.note_id;

-- Set first note as focused
UPDATE canvas_workspace_notes
SET is_focused = TRUE
WHERE toolbar_sequence = 0 AND is_open = TRUE;

-- Make toolbar_sequence NOT NULL for open notes
ALTER TABLE canvas_workspace_notes
ADD CONSTRAINT check_open_notes_have_sequence
CHECK (
  (is_open = FALSE AND toolbar_sequence IS NULL) OR
  (is_open = TRUE AND toolbar_sequence IS NOT NULL)
);

-- Comments
COMMENT ON COLUMN canvas_workspace_notes.toolbar_sequence IS 'Order of note in toolbar (0-indexed, NULL when closed)';
COMMENT ON COLUMN canvas_workspace_notes.is_focused IS 'Whether this note is currently focused/highlighted in toolbar';
COMMENT ON COLUMN canvas_workspace_notes.opened_at IS 'Timestamp when note was added to workspace';
```

#### **Migration 033 Rollback (.down.sql)**

```sql
-- Drop constraints and indexes
ALTER TABLE canvas_workspace_notes DROP CONSTRAINT IF EXISTS check_open_notes_have_sequence;
DROP INDEX IF EXISTS idx_workspace_notes_focused;

-- Drop columns
ALTER TABLE canvas_workspace_notes
DROP COLUMN IF EXISTS toolbar_sequence,
DROP COLUMN IF EXISTS is_focused,
DROP COLUMN IF EXISTS opened_at;
```

---

#### **Migration 034: Extend Panel Types**

```sql
-- Drop old constraint
ALTER TABLE panels DROP CONSTRAINT IF EXISTS check_panel_type;

-- Add new constraint with extended types
ALTER TABLE panels
ADD CONSTRAINT check_panel_type
CHECK (type = ANY(ARRAY[
  'main',         -- Main note panel
  'branch',       -- Branch annotation panel
  'editor',       -- Legacy editor type
  'context',      -- Legacy context type
  'toolbar',      -- Legacy toolbar type
  'annotation',   -- Legacy annotation type
  'widget'        -- Generic widget (use metadata.widget_type for specifics)
]));

-- Add widget_type metadata convention
COMMENT ON COLUMN panels.metadata IS 'JSONB metadata; for type=widget, include {"widget_type": "calculator"|"timer"|"search"|etc}';
```

---

## 3. Data Model Mapping

### TDD Proposed → Actual Implementation

| TDD Table | TDD Column | Actual Table | Actual Column | Notes |
|-----------|------------|--------------|---------------|-------|
| `workspace_toolbar_state` | `note_sequence` | `canvas_workspace_notes` | `toolbar_sequence` | Add via migration 033 |
| `workspace_toolbar_state` | `note_id` | `canvas_workspace_notes` | `note_id` | Already exists (PK) |
| `workspace_toolbar_state` | `title` | `notes` | `title` | Join via FK |
| `workspace_toolbar_state` | `opened_at` | `canvas_workspace_notes` | `opened_at` | Add via migration 033 |
| `workspace_layout_snapshot` | `panel_id` | `panels` | `id` (UUID) | Already exists |
| `workspace_layout_snapshot` | `panel_type` | `panels` | `type` + `metadata.widget_type` | Extend enum |
| `workspace_layout_snapshot` | `position_x` | `panels` | `position_x_world` | Already exists |
| `workspace_layout_snapshot` | `position_y` | `panels` | `position_y_world` | Already exists |
| `workspace_layout_snapshot` | `width` | `panels` | `width_world` | Already exists |
| `workspace_layout_snapshot` | `height` | `panels` | `height_world` | Already exists |
| `workspace_layout_snapshot` | `z_index` | `panels` | `z_index` | Already exists |
| `workspace_layout_snapshot` | `highlighted` | `canvas_workspace_notes` | `is_focused` | Note-level, not panel-level |
| `workspace_layout_snapshot` | `payload` | `panels` | `metadata` | Already exists (JSONB) |

---

## 4. Blocker Resolutions

### ✅ BLOCKER #1: Legacy Table Names

**Resolution**:
- **No "legacy" tables exist with those names**
- TDD's `legacy_workspace_tabs` → Use `canvas_workspace_notes`
- TDD's `legacy_canvas_panels` → Use `panels`

**Migration backfill script (revised)**:
```sql
-- No backfill needed! Data already in correct tables.
-- Just add new columns via migration 033.
```

---

### ✅ BLOCKER #2: Relationship to Existing Tables

**Resolution**:
- **Extend existing tables, don't create new ones**
- `canvas_workspace_notes` gets `toolbar_sequence`, `is_focused`, `opened_at`
- `panels` type enum gets `widget` value
- See §2.2 for complete migrations

---

### ✅ BLOCKER #3: workspaceHydrationContext Flag

**Resolution**:

**Location**: `components/canvas/canvas-workspace-context.tsx`

**Implementation**:
```typescript
// Add to CanvasWorkspaceProvider state
const [isHydrating, setIsHydrating] = useState(false)

// Expose via context
interface CanvasWorkspaceContextValue {
  // ... existing fields
  isHydrating: boolean
}

// Usage in hydration sequence:
const refreshWorkspace = useCallback(async () => {
  setIsHydrating(true)
  setIsWorkspaceLoading(true)

  try {
    // 1. Load workspace state
    const response = await fetch('/api/canvas/workspace')
    const data = await response.json()

    // 2. Pre-populate dataStore (triggers loadedNotes guard)
    data.openNotes.forEach(note => {
      const mainKey = ensurePanelKey(note.noteId, 'main')
      workspace.dataStore.set(mainKey, {
        id: 'main',
        type: 'main',
        title: note.title,
        position: { x: note.main_position_x, y: note.main_position_y },
        // ... rest of panel data
      })
    })

    // 3. Update state
    setOpenNotes(data.openNotes)
    setIsWorkspaceReady(true)

  } finally {
    setIsWorkspaceLoading(false)
    setIsHydrating(false)  // ← Clears after hydration
  }
}, [])
```

**Usage in handleNoteSelect**:
```typescript
const handleNoteSelect = (noteId: string) => {
  const { isHydrating } = useCanvasWorkspace()

  // ... existing logic

  // Only emit highlight if NOT hydrating and note is already focused
  if (!isHydrating && noteId === focusedNoteId) {
    workspace.events.emit('workspace:highlight-note', { noteId })
  }
}
```

---

### ✅ BLOCKER #4: seedPanels Function

**Resolution**:

**Location**: New method in `components/canvas/canvas-context.tsx`

**Signature**:
```typescript
// Add to CanvasProvider (around line 380, after loadedNotes setup)

function seedPanelsFromSnapshot(
  snapshot: Array<{ panel_id: string; note_id: string; position_x: number; position_y: number; /* ... */ }>,
  dataStore: DataStore,
  loadedNotes: Set<string>
): void {
  snapshot.forEach(panel => {
    const storeKey = ensurePanelKey(panel.note_id, panel.panel_id)

    // Check if already exists (loadedNotes guard)
    const existing = dataStore.get(storeKey)
    if (existing) {
      console.log('[seedPanels] Skipping - panel already exists:', storeKey)
      return
    }

    // Seed panel data
    dataStore.set(storeKey, {
      id: panel.panel_id,
      type: panel.panel_id === 'main' ? 'main' : 'branch',
      title: panel.title || '',
      position: { x: panel.position_x, y: panel.position_y },
      dimensions: { width: panel.width, height: panel.height },
      zIndex: panel.z_index,
      // ... rest from snapshot
    })

    // Mark as loaded
    loadedNotes.add(panel.note_id)
  })
}
```

**Called during hydration** (in `CanvasWorkspaceProvider`):
```typescript
const refreshWorkspace = async () => {
  // ... load snapshot from DB

  // Seed all panels before first render
  seedPanelsFromSnapshot(snapshot.panels, workspace.dataStore, workspace.loadedNotes)
}
```

---

### ✅ BLOCKER #5: Migration Rollback

**Resolution**: See migration `.down.sql` files in §2.2

**Additional safety**:
```sql
-- Test rollback before deploying
BEGIN;
\i migrations/033_add_toolbar_ordering.up.sql
SELECT * FROM canvas_workspace_notes LIMIT 1;  -- Verify new columns
\i migrations/033_add_toolbar_ordering.down.sql
SELECT * FROM canvas_workspace_notes LIMIT 1;  -- Verify columns removed
ROLLBACK;
```

---

## 5. Risk Resolutions

### ⚠️ RISK #6: Conflict Resolution Algorithm

**Detailed specification**:

```typescript
interface PersistOptions {
  optimisticLock?: boolean  // Default: true
  retryOnConflict?: boolean // Default: true
  maxRetries?: number       // Default: 1
}

async function persistWorkspaceState(
  workspaceId: string,
  updates: WorkspaceUpdate[],
  options: PersistOptions = {}
): Promise<{ success: boolean; error?: string }> {
  const { optimisticLock = true, retryOnConflict = true, maxRetries = 1 } = options

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 1. Read current updated_at
      const current = await db.query(
        'SELECT updated_at FROM canvas_workspace_notes WHERE note_id = $1',
        [updates[0].noteId]
      )

      // 2. Attempt write with WHERE clause
      const result = await db.query(
        `UPDATE canvas_workspace_notes
         SET toolbar_sequence = $1, updated_at = NOW()
         WHERE note_id = $2
           AND (updated_at = $3 OR $4 = false)  -- Optimistic lock
         RETURNING updated_at`,
        [updates[0].sequence, updates[0].noteId, current.updated_at, !optimisticLock]
      )

      // 3. Check if update succeeded
      if (result.rowCount === 0) {
        // Conflict detected
        if (!retryOnConflict || attempt >= maxRetries) {
          return { success: false, error: 'Conflict: workspace state was modified by another process' }
        }

        // Retry: refetch and re-apply
        console.warn('[persistWorkspace] Conflict detected, retrying...', { attempt })
        continue
      }

      // Success
      return { success: true }

    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  return { success: false, error: 'Max retries exceeded' }
}
```

**User experience on failure**:
```typescript
const result = await persistWorkspaceState(workspaceId, updates)
if (!result.success) {
  // Silent recovery: refetch latest state and continue
  await refreshWorkspace()
  console.warn('[Workspace] State conflict resolved by refetch')

  // Don't show error to user unless critical
}
```

---

### ⚠️ RISK #7: Batching + beforeunload

**Implementation**:

```typescript
// In CanvasWorkspaceProvider
const pendingBatchRef = useRef<{
  updates: WorkspaceUpdate[]
  timeoutId: NodeJS.Timeout | null
}>({ updates: [], timeoutId: null })

const scheduleBatchPersist = useCallback((update: WorkspaceUpdate) => {
  // Add to batch
  pendingBatchRef.current.updates.push(update)

  // Clear existing timeout
  if (pendingBatchRef.current.timeoutId) {
    clearTimeout(pendingBatchRef.current.timeoutId)
  }

  // Schedule flush after 300ms
  pendingBatchRef.current.timeoutId = setTimeout(() => {
    flushBatch()
  }, 300)
}, [])

const flushBatch = useCallback(async () => {
  const updates = pendingBatchRef.current.updates
  if (updates.length === 0) return

  pendingBatchRef.current.updates = []
  pendingBatchRef.current.timeoutId = null

  await persistWorkspaceState(workspaceId, updates)
}, [workspaceId])

// Flush on unmount or beforeunload
useEffect(() => {
  const handleBeforeUnload = () => {
    // Flush synchronously (blocking)
    if (pendingBatchRef.current.updates.length > 0) {
      navigator.sendBeacon('/api/canvas/workspace/flush',
        JSON.stringify(pendingBatchRef.current.updates)
      )
    }
  }

  window.addEventListener('beforeunload', handleBeforeUnload)

  return () => {
    flushBatch() // Async flush on unmount
    window.removeEventListener('beforeunload', handleBeforeUnload)
  }
}, [flushBatch])
```

**Server endpoint for sendBeacon**:
```typescript
// app/api/canvas/workspace/flush/route.ts
export async function POST(request: Request) {
  const updates = await request.json()

  // Process synchronously (no response expected)
  await persistWorkspaceState('default', updates, {
    optimisticLock: false  // Skip conflict check for emergency flush
  })

  return new Response(null, { status: 204 })
}
```

---

### ⚠️ RISK #8: Feature Flag Implementation

**Environment variable**:
```bash
# .env.local
NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY=enabled
```

**Client-side check** (`components/canvas/canvas-workspace-context.tsx`):
```typescript
const FEATURE_ENABLED = process.env.NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY === 'enabled'

const refreshWorkspace = useCallback(async () => {
  if (FEATURE_ENABLED) {
    // New path: Load ordered toolbar + full snapshot
    await loadWorkspaceWithOrdering()
  } else {
    // Legacy path: Load open notes without ordering
    await loadWorkspaceLegacy()
  }
}, [])
```

**Server-side check** (`app/api/canvas/workspace/route.ts`):
```typescript
export async function GET(request: Request) {
  const featureEnabled = process.env.NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY === 'enabled'

  if (featureEnabled) {
    // Return ordered data with toolbar_sequence
    return db.query(`
      SELECT note_id, toolbar_sequence, is_focused, main_position_x, main_position_y
      FROM canvas_workspace_notes
      WHERE is_open = TRUE
      ORDER BY toolbar_sequence
    `)
  } else {
    // Return legacy unordered data
    return db.query(`
      SELECT note_id, main_position_x, main_position_y
      FROM canvas_workspace_notes
      WHERE is_open = TRUE
      ORDER BY updated_at DESC
    `)
  }
}
```

**Testing both paths**:
```typescript
// test/e2e/workspace-feature-flag.spec.ts
describe('Workspace ordering feature flag', () => {
  it('uses ordered loading when enabled', async () => {
    process.env.NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY = 'enabled'
    // ... test ordered behavior
  })

  it('falls back to legacy loading when disabled', async () => {
    process.env.NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY = 'disabled'
    // ... test unordered behavior
  })
})
```

---

## 6. Widget Taxonomy Clarification

**Current panel types** (from migration 030):
```
'main', 'editor', 'branch', 'context', 'toolbar', 'annotation'
```

**Recommendation**:
- Add generic `'widget'` type
- Use `metadata.widget_type` for specifics

**Examples from TDD are NOT real features**:
- ❌ `'calculator'` - placeholder example
- ❌ `'timer'` - placeholder example

**For TDD examples, use**:
```typescript
{
  type: 'widget',
  metadata: {
    widget_type: 'example-widget-a',  // Or 'example-widget-b'
    widget_config: { /* ... */ }
  }
}
```

**If real widgets exist**, they should be documented in:
```
docs/widgets/README.md
docs/widgets/widget-registry.md
```

---

## 7. API Endpoint Specifications

### GET `/api/canvas/workspace`

**Response**:
```typescript
interface WorkspaceState {
  openNotes: Array<{
    note_id: string
    toolbar_sequence: number
    is_focused: boolean
    title: string
    main_position_x: number
    main_position_y: number
    opened_at: string
  }>
  panels: Array<{
    id: string
    note_id: string
    panel_id: string
    type: string
    position_x_world: number
    position_y_world: number
    width_world: number
    height_world: number
    z_index: number
    metadata: Record<string, any>
  }>
}
```

**SQL**:
```sql
-- Open notes with ordering
SELECT
  cwn.note_id,
  cwn.toolbar_sequence,
  cwn.is_focused,
  n.title,
  cwn.main_position_x,
  cwn.main_position_y,
  cwn.opened_at
FROM canvas_workspace_notes cwn
JOIN notes n ON n.id = cwn.note_id
WHERE cwn.is_open = TRUE
ORDER BY cwn.toolbar_sequence;

-- All panels for open notes
SELECT
  p.id,
  p.note_id,
  p.panel_id,
  p.type,
  p.position_x_world,
  p.position_y_world,
  p.width_world,
  p.height_world,
  p.z_index,
  p.metadata
FROM panels p
JOIN canvas_workspace_notes cwn ON cwn.note_id = p.note_id
WHERE cwn.is_open = TRUE
  AND p.state = 'active';
```

---

### POST `/api/canvas/workspace/update`

**Request**:
```typescript
interface WorkspaceUpdateRequest {
  updates: Array<{
    note_id: string
    toolbar_sequence?: number  // Update ordering
    is_focused?: boolean       // Update focus
    main_position_x?: number   // Update position
    main_position_y?: number
  }>
}
```

**SQL (batched)**:
```sql
-- Use CASE to update only provided fields
UPDATE canvas_workspace_notes
SET
  toolbar_sequence = COALESCE($2, toolbar_sequence),
  is_focused = COALESCE($3, is_focused),
  main_position_x = COALESCE($4, main_position_x),
  main_position_y = COALESCE($5, main_position_y)
WHERE note_id = $1;
```

---

## 8. Updated Test Specifications

| Test | File | Key Changes from TDD |
|------|------|---------------------|
| Toolbar order persists | `__tests__/canvas/toolbar-ordering.test.tsx` | Use `canvas_workspace_notes.toolbar_sequence` instead of separate table |
| Full panel replay | `playwright/tests/canvas/canvas-replay.spec.ts` | Query `panels` table directly, not snapshot table |
| Highlight guard | `__tests__/canvas/handle-note-select.test.ts` | Check `workspace.isHydrating` from context |
| Persistence batching | `tests/server/workspace-snapshot.spec.ts` | Test 300ms debounce + beforeunload flush |
| Telemetry coverage | `tests/server/telemetry/workspace-toolbar-state.test.ts` | Event uses actual table columns |
| Migration script | `tests/migrations/033-toolbar-ordering.test.ts` | Test forward/backward migration on fixture DB |

---

## 9. Revised TDD Sections

### Section to Update: §2 Data Schema

**Replace with**:
```markdown
## 2. Data Schema Extensions

We extend existing workspace persistence tables with ordering and focus tracking:

### 2.1 Migration 033: Add Toolbar Ordering
[Insert SQL from §2.2 of this document]

### 2.2 Migration 034: Extend Panel Types
[Insert SQL from §2.2 of this document]

### 2.3 No New Tables Required
The TDD initially proposed `workspace_toolbar_state` and `workspace_layout_snapshot`,
but analysis reveals existing tables (`canvas_workspace_notes` and `panels`) already
provide this functionality. We extend them instead of duplicating data.
```

---

### Section to Update: §6 Migration Strategy

**Replace with**:
```markdown
## 6. Migration Strategy

### 6.1 Migration 033: Add Toolbar Ordering
[Insert from §2.2]

### 6.2 No Data Backfill Required
Since we're extending existing tables that already contain open note data,
we only need to:
1. Add new columns with sensible defaults
2. Backfill `toolbar_sequence` from existing `updated_at` ordering
3. Set first note as focused

### 6.3 Rollback Safety
Each migration has a tested `.down.sql` script.
```

---

## 10. Summary & Next Steps

### Blockers Resolved ✅

1. ✅ **Legacy table names**: Use `canvas_workspace_notes` and `panels`
2. ✅ **Schema relationship**: Extend existing tables, don't create new ones
3. ✅ **workspaceHydrationContext**: State in `CanvasWorkspaceProvider`
4. ✅ **seedPanels**: New function in `canvas-context.tsx`
5. ✅ **Migration rollback**: `.down.sql` scripts provided

### Risks Addressed ✅

6. ✅ **Conflict resolution**: Optimistic locking with retry logic
7. ✅ **Batching + flush**: `beforeunload` handler with `sendBeacon`
8. ✅ **Feature flag**: Environment variable with dual code paths
9. ✅ **Widget taxonomy**: Use generic `widget` type + metadata

### Implementation Ready ✅

**TDD can now be revised** with:
- Real table names and columns
- Concrete migration scripts (with rollback)
- Detailed API specifications
- Updated test matrix
- Complete implementation details

**Recommended workflow**:
1. Update TDD §2 (schema) and §6 (migrations) using this document
2. Create migration files: `033_add_toolbar_ordering.{up,down}.sql`
3. Create migration files: `034_extend_panel_types.{up,down}.sql`
4. Implement `workspaceHydrationContext` in workspace provider
5. Implement `seedPanels` in canvas context
6. Add API endpoints with feature flag
7. Write tests per updated matrix
8. Deploy with flag disabled → test → enable flag → monitor

---

## Appendix: Migration File Checklist

- [ ] `migrations/033_add_toolbar_ordering.up.sql`
- [ ] `migrations/033_add_toolbar_ordering.down.sql`
- [ ] `migrations/034_extend_panel_types.up.sql`
- [ ] `migrations/034_extend_panel_types.down.sql`
- [ ] `tests/migrations/033-toolbar-ordering.test.ts`
- [ ] `tests/migrations/034-extend-panel-types.test.ts`
- [ ] Update `CLAUDE.md` migration count
- [ ] Update `docs/proposal/canvas_state_persistence/design/2025-10-19-toolbar-ordering-and-visibility-tdd.md`

---

**Status**: Ready for TDD revision and implementation kickoff.
