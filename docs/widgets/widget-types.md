# Widget Types - Persistence and Restoration

This document describes which widget/panel types can be restored from workspace snapshots and which are transient.

## Overview

The canvas workspace persistence system supports saving and restoring panel state across sessions. However, not all panel types are suitable for restoration - some represent transient UI elements that should not be persisted.

## Restorable Panel Types

These panel types represent user content and workspace state, and **can be restored** from snapshots:

- **`main`** - Primary panel for a note, containing the main editor
- **`branch`** - Branch/exploration panels created from annotations
- **`editor`** - Standalone editor panels
- **`context`** - Context panels showing related information
- **`annotation`** - Annotation overlay panels

When the feature flag `NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY=enabled` is active, these panels are automatically restored on workspace load via the snapshot replay mechanism (see TDD §3).

## Non-Restorable Panel Types

These panel types represent transient UI elements and **should NOT be restored** from snapshots:

- **`toolbar`** - Floating toolbar panels (transient, user-invoked)
- **`widget`** - Generic widget panels (unless explicitly marked as persistent in metadata)

### Widget Type (`widget`)

The `widget` type is a special case added in migration `034_extend_panel_types`. It serves as a generic type for non-note components.

**Persistence behavior:**
- By default, `widget` panels are **not restored** from snapshots
- To make a widget persistent, set `metadata.persistent = true`
- Use `metadata.widget_type` to identify the specific widget implementation

**Example widget metadata:**
```json
{
  "widget_type": "minimap",
  "persistent": false
}
```

## Implementation Details

### Feature Flag

The toolbar ordering and snapshot replay feature is controlled by:
```
NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY=enabled
```

When enabled:
- Workspace loads ordered toolbar with focus state
- Active panels are restored from database snapshot
- Panel positions are pre-seeded to prevent jump/rearrangement
- Highlight glow is suppressed during hydration

### Database Schema

**Panels table:**
```sql
type CHECK (
  type = ANY (ARRAY[
    'main',
    'branch',
    'editor',
    'context',
    'toolbar',
    'annotation',
    'widget'  -- Added in migration 034
  ])
)
```

**Workspace notes table (added in migration 033):**
```sql
toolbar_sequence INTEGER,     -- Order in toolbar (0-indexed, NULL when closed)
is_focused BOOLEAN,            -- Whether note is currently highlighted
opened_at TIMESTAMPTZ          -- When note entered workspace
```

## API Endpoints

### GET /api/canvas/workspace
Fetches ordered toolbar and active panels for restoration.

**New path (feature flag enabled):**
- Returns ordered `openNotes` array sorted by `toolbar_sequence`
- Returns all active `panels` for open notes
- Includes `isFocused` state for highlight prevention

**Legacy path (feature flag disabled):**
- Returns unordered `openNotes` array
- No panel snapshot

### POST /api/canvas/workspace/update
Batched updates with optimistic locking and retry logic.

**Updates:**
- `toolbarSequence` - Position in toolbar
- `isFocused` - Focus state
- `mainPositionX`, `mainPositionY` - Main panel position

**Conflict resolution:**
- Default: 1 retry on conflict
- Returns 409 if retries exhausted

### POST /api/canvas/workspace/flush
Emergency flush endpoint for `navigator.sendBeacon` on page unload.

**Behavior:**
- Skips optimistic locking (emergency mode)
- Always returns 204 No Content
- Never returns errors (sendBeacon can't handle them)

## References

- TDD: `docs/proposal/canvas_state_persistence/design/2025-10-19-toolbar-ordering-and-visibility-tdd.md`
- Blocker Resolution: `docs/proposal/canvas_state_persistence/design/2025-10-19-tdd-blocker-resolution.md`
- Migrations: `migrations/033_add_toolbar_ordering.{up,down}.sql`, `migrations/034_extend_panel_types.{up,down}.sql`
- Implementation: `components/canvas/canvas-workspace-context.tsx`, `app/api/canvas/workspace/`
