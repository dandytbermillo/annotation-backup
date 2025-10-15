# Canvas Workspace API Implementation

**Date**: 2025-10-14
**Scope**: Phase 1 Backend Only (Multi-Note Workspace Persistence)
**Status**: Implementation Complete, Ready for Testing

---

## Summary

Implemented the backend infrastructure for multi-note workspace persistence as specified in `implementation.md` lines 51-70. This enables tracking which notes are "open in canvas" and persisting their main panel positions for workspace layout restoration.

**Phase 1 ONLY** - Backend API and database schema. Phase 2 (LayerManager isolation, composite IDs, frontend refactor) is explicitly excluded from this implementation.

---

## Files Created

### 1. Database Migration

**`migrations/032_add_canvas_workspace_notes.up.sql`**
- Created `canvas_workspace_notes` table with shared workspace model
- Schema: `note_id` (PK), `is_open`, `main_position_x`, `main_position_y`, `updated_at`, `updated_by`, `schema_version`
- CHECK constraint: Validates coordinates are finite and within -1,000,000 to 1,000,000 range when `is_open=true`
- Partial index on `is_open=TRUE` for fast startup queries
- Trigger for auto-updating `updated_at` timestamp

**`migrations/032_add_canvas_workspace_notes.down.sql`**
- Rollback script: drops trigger, function, index, and table

### 2. Validation Utility

**`lib/utils/coordinate-validation.ts`** (142 lines)
- `validatePosition()`: Validates Position objects with field-level error reporting
- `coercePosition()`: Parses and validates positions from unknown input
- `validatePositions()`: Batch validation for multiple positions
- Bounds: -1,000,000 to 1,000,000 for both x and y
- Checks: typeof, isFinite, range validation

### 3. API Endpoint

**`app/api/canvas/workspace/route.ts`** (295 lines)

**GET /api/canvas/workspace**
- Fetches all notes where `is_open = TRUE`
- Returns `{ success: true, openNotes: [{ noteId, mainPosition, updatedAt }] }`
- Ordered by `updated_at DESC`
- Logs telemetry to `debug_logs` table

**PATCH /api/canvas/workspace**
- Request body: `{ notes: [{ noteId, isOpen, mainPosition? }] }`
- Validates all notes before applying changes (fail-fast)
- UPSERT for opening notes, UPDATE for closing (soft delete)
- Transaction-wrapped with BEGIN/COMMIT/ROLLBACK
- Field-level validation errors: `{ error: 'Validation failed', fields: { ... } }`
- Logs telemetry for each update

---

## Design Decisions

### Workspace Scope
**Shared workspace** (not per-user) for Phase 1
- `note_id` is PRIMARY KEY (no `user_id` column)
- All users see same "open notes" state
- Rationale: Simpler MVP, aligns with single-user offline-first mode

### Deletion Strategy
**Soft delete** with cleanup job
- Setting `is_open=FALSE` preserves position history
- Future: 30-day cleanup job to hard-delete old records
- Rationale: Supports "reopen where I left off" UX

### Concurrency Control
**Last-write-wins** for Phase 1
- No optimistic locking (`version` column not included)
- No revision history
- Rationale: Simpler implementation, acceptable for MVP

### Coordinate Validation
**Range: -1,000,000 to 1,000,000**
- Enforced in both database CHECK constraint and API validation
- Prevents NaN, Infinity, and out-of-bounds values
- Rationale: Matches existing camera position bounds

---

## Integration Points

### Existing Infrastructure
✅ `canvas-workspace-context.tsx` - Per-note DataStore/EventEmitter map (lines 27-39)
✅ `canvas-context.tsx` - Accepts `externalDataStore` and `externalEvents` props (lines 112-113)
✅ Camera API pattern - Followed existing `/api/canvas/camera/[noteId]/route.ts` structure

### NOT Implemented (Phase 2)
❌ LayerManager per-note isolation
❌ Composite panel IDs (`noteId:panelId` format)
❌ UI changes for multi-note canvas
❌ Hydration logic calling workspace API
❌ Auto-save on position changes

---

## Validation Results

### Type Check
```bash
$ npm run type-check
```
✅ No errors in new files
⚠️ Pre-existing test errors in `__tests__/` (unrelated to this implementation)

### File Verification
```bash
$ ls -la migrations/032_add_canvas_workspace_notes.*
-rw-r--r--  032_add_canvas_workspace_notes.down.sql  (294 bytes)
-rw-r--r--  032_add_canvas_workspace_notes.up.sql   (1990 bytes)

$ test -f lib/utils/coordinate-validation.ts && echo "Present"
Present

$ test -f app/api/canvas/workspace/route.ts && echo "Present"
Present
```

---

## Testing Checklist (Not Yet Run)

### Database Migration
- [ ] Apply migration: Run `.up.sql` in local Postgres
- [ ] Verify table structure: `\d canvas_workspace_notes`
- [ ] Verify index: `\d idx_workspace_open`
- [ ] Test CHECK constraint with invalid coordinates
- [ ] Test rollback: Run `.down.sql` and verify cleanup

### API Endpoints
- [ ] GET /api/canvas/workspace with no open notes
- [ ] GET /api/canvas/workspace with multiple open notes
- [ ] PATCH with valid note opening (isOpen=true, valid position)
- [ ] PATCH with note closing (isOpen=false)
- [ ] PATCH with invalid coordinates (should reject)
- [ ] PATCH with missing mainPosition when isOpen=true (should reject)
- [ ] PATCH with multiple notes in transaction (verify atomicity)
- [ ] Verify telemetry logs in `debug_logs` table

### Validation Utility
- [ ] Unit tests for `validatePosition()` with edge cases
- [ ] Unit tests for `coercePosition()` with string/number inputs
- [ ] Unit tests for boundary values (±1,000,000)
- [ ] Unit tests for NaN, Infinity rejection

---

## Next Steps (When Ready)

1. **Run database migration** in local development environment
2. **Test API endpoints** with curl/Postman or integration tests
3. **Phase 2 Planning**: LayerManager refactor and frontend integration (separate task)

---

## References

- **Spec**: `docs/proposal/canvas_state_persistence/affected_files/implementation.md` lines 51-70
- **Pattern**: `app/api/canvas/camera/[noteId]/route.ts`
- **Schema Compatibility**: Migration designed to support future Yjs integration (Option B)

---

## Compliance

✅ MANDATORY VERIFICATION CHECKPOINTS satisfied:
- [x] Read current file state with Read tool (all 4 files verified)
- [x] Implementation origin: Created by assistant in this session
- [x] Type-check run: Passed for new code
- [x] File timestamps verified with ls -la

✅ IMPLEMENTATION REPORTS requirements:
- [x] Summary of what was implemented
- [x] Files/paths modified listed
- [x] Commands to validate included
- [x] Test checklist provided
- [x] Next steps documented
