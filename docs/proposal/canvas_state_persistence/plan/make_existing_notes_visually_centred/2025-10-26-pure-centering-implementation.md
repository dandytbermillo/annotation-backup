# Pure Viewport Centering for Existing Notes - Implementation

**Date:** 2025-10-26
**Status:** ✅ IMPLEMENTED
**Feature Flag:** `NEXT_PUBLIC_CANVAS_CENTER_EXISTING_NOTES`

---

## Objective

Make existing notes appear **100% viewport-centered** when reopened, using the exact same approach as new notes (no decay blending).

---

## The Change

**File:** `components/annotation-app.tsx`
**Lines:** 1477-1481

### Before (Used Decay Blending)

```typescript
if (centeredCandidate && resolvedPosition) {
  // WRONG: Blends persisted position (15%) with centered position (85%)
  resolvedPosition = computeCenteredPositionWithDecay(
    resolvedPosition,      // persisted position
    centeredCandidate,     // centered position
    lastCanvasInteractionRef.current,
  )
  usedCenteredOverride = true
} else if (centeredCandidate && !resolvedPosition) {
  resolvedPosition = centeredCandidate
  usedCenteredOverride = true
}
```

### After (Pure Centering)

```typescript
// Use pure centered position (100%) - same behavior as new notes
if (centeredCandidate) {
  resolvedPosition = centeredCandidate
  usedCenteredOverride = true
}
```

---

## What Changed

1. **Removed decay blending** - No longer calls `computeCenteredPositionWithDecay()`
2. **Simplified logic** - Single if-statement instead of if-else chain
3. **100% centered** - Existing notes now appear exactly where new notes appear
4. **Removed unused import** - Cleaned up `computeCenteredPositionWithDecay` import

---

## Behavior

### New Notes (unchanged)
- Click "+ Note" → appears centered in viewport
- Uses `computeVisuallyCenteredWorldPosition()`
- Pure viewport centering (100%)

### Existing Notes (changed)
- **Before**: Appeared ~85% centered + ~15% at old position (blended)
- **After**: Appear 100% centered (exactly like new notes)
- Click "Restore position" icon → jumps to persisted location

---

## Data Flow

```
User clicks note in Recents
  ↓
handleNoteSelect() checks CENTER_EXISTING_NOTES_ENABLED
  ↓
computeVisuallyCenteredWorldPosition() calculates viewport center
  ↓
resolvedPosition = centeredCandidate (PURE - no blending!)
  ↓
openWorkspaceNote() with mainPosition: resolvedPosition
  ↓
Canvas renders at centered position
```

---

## Verification

### Type-check
```bash
$ npm run type-check
✓ No errors
```

### Code Verification
- [x] Removed decay blending call
- [x] Uses pure `centeredCandidate`
- [x] Removed unused import
- [x] Type-check passes

### Expected Behavior
- [ ] Existing notes appear centered (USER TESTING REQUIRED)
- [ ] No position blending occurs
- [ ] Restore position icon still works
- [ ] Debug logs show centered override

---

## Debug Logs

Check centering behavior:
```sql
SELECT
  metadata->>'noteId' as note,
  metadata->'persistedPosition' as persisted,
  metadata->'centeredPosition' as centered,
  created_at
FROM debug_logs
WHERE component = 'AnnotationApp'
  AND action = 'open_note_centered_override'
ORDER BY created_at DESC LIMIT 10;
```

**Expected:** `centeredPosition` should be pure viewport center, NOT blended with `persistedPosition`

---

## Related Documents

1. **New notes implementation:** `docs/proposal/canvas_state_persistence/plan/new_note_centered/implementation_plan.md`
2. **Three bugs fix:** `docs/proposal/canvas_state_persistence/fixing_doc/2025-10-26-FINAL-FIX-hardcoded-legacy-positions.md`
3. **Original existing notes plan:** `docs/proposal/canvas_state_persistence/plan/make_existing_notes_visually_centred/implementation_plan.md`

---

## Summary

Existing notes now use **pure viewport centering** (100%) instead of decay blending (85% centered + 15% old position). This makes them behave identically to new notes.

**The change was 4 lines of code** - removing the blending call and simplifying to direct assignment.
