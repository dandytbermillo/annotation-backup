# Canvas State Persistence - Migration Fixes

**Date**: 2025-10-12
**Status**: ✅ Migrations Applied Successfully

---

## Issues Fixed

### Migration 030: `add_canvas_persistence_columns.up.sql`

**Issue 1**: Foreign key reference to non-existent `users` table
```sql
-- BEFORE (line 23):
ADD COLUMN updated_by UUID REFERENCES users(id),

-- AFTER:
ADD COLUMN updated_by UUID,
```
**Fix**: Removed foreign key constraint. Column still exists for tracking purposes, but without referential integrity.

**Issue 2**: CHECK constraint missing 'main' panel type
```sql
-- BEFORE (line 31):
CHECK (type = ANY(ARRAY['editor', 'branch', 'context', 'toolbar', 'annotation']))

-- AFTER:
CHECK (type = ANY(ARRAY['main', 'editor', 'branch', 'context', 'toolbar', 'annotation']))
```
**Fix**: Added 'main' to allowed panel types. Database had existing panels with type='main'.

---

### Migration 031: `add_canvas_camera_state.up.sql`

**Issue**: Foreign key reference to non-existent `users` table
```sql
-- BEFORE (line 9):
user_id UUID REFERENCES users(id) ON DELETE CASCADE,

-- AFTER:
user_id UUID,
```
**Fix**: Removed foreign key constraint. Column is nullable and can store user IDs without referential integrity.

---

## Migration Results

### ✅ Migration 030 Applied
**Panels table new columns:**
- `position_x_world` (NUMERIC NOT NULL) - world-space X coordinate
- `position_y_world` (NUMERIC NOT NULL) - world-space Y coordinate
- `width_world` (NUMERIC NOT NULL, default 400) - world-space width
- `height_world` (NUMERIC NOT NULL, default 300) - world-space height
- `z_index` (INTEGER NOT NULL, default 0) - layer ordering
- `updated_by` (UUID) - update tracking
- `revision_token` (TEXT) - conflict detection
- `schema_version` (INTEGER NOT NULL, default 1) - schema versioning

**Indexes created:**
- `idx_panels_note_position` - for spatial queries
- `idx_panels_updated_at` - for temporal queries
- `idx_panels_revision` - for conflict resolution

**Constraints:**
- `check_panel_type` - validates panel types

### ✅ Migration 031 Applied
**New table: `canvas_camera_state`**
- `id` (UUID PRIMARY KEY)
- `note_id` (UUID NOT NULL, FK to notes)
- `user_id` (UUID) - nullable for shared camera
- `camera_x` (NUMERIC NOT NULL, default 0)
- `camera_y` (NUMERIC NOT NULL, default 0)
- `zoom_level` (NUMERIC NOT NULL, default 1.0, 0.5-5.0 range)
- `updated_at` (TIMESTAMPTZ NOT NULL)
- `schema_version` (INTEGER NOT NULL, default 1)

**Indexes:**
- Primary key on `id`
- Unique constraint on `(note_id, user_id)`
- `idx_camera_state_note` - note lookups
- `idx_camera_state_user` - user-specific cameras (partial index)
- `idx_camera_state_updated` - temporal queries

**Triggers:**
- `trigger_update_canvas_camera_updated_at` - auto-update timestamp

---

## Verification

### Database State
```bash
$ docker exec annotation_postgres psql -U postgres -d annotation_dev -c "\dt"
```

Tables now include:
- ✅ `canvas_camera_state` (new)
- ✅ `panels` (with new columns)

### Testing Readiness

The system is now ready for testing:

1. ✅ Database schema complete
2. ✅ All code fixes applied (8 critical issues)
3. ✅ Type-check passing
4. ✅ Next.js dev server running on http://localhost:3000

Proceed with manual testing as outlined in `INTEGRATION_DONE.md`.

---

## Files Modified

### Migrations:
- `migrations/030_add_canvas_persistence_columns.up.sql` (fixed)
- `migrations/031_add_canvas_camera_state.up.sql` (fixed)

### Backups:
- `migrations/030_add_canvas_persistence_columns.up.sql.backup`
- `migrations/031_add_canvas_camera_state.up.sql.backup`

---

## Notes

- `user_id` columns are nullable and do not reference a users table
- This is acceptable for the current single-user offline mode (Option A)
- Future multi-user support (Option B) can add users table and foreign keys via new migration
- All constraints, indexes, and triggers are in place as designed

---

**Status**: ✅ Ready for testing
