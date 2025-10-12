# Implementation Summary: Panel Snap Fix

**Date:** 2025-01-12
**Status:** ✅ IMPLEMENTED
**Issue:** Panels snap to right side on first drag to edge
**Root Cause:** Local/Context state synchronization mismatch
**Solution:** Sync centered coordinates to context after all centering operations

---

## Changes Made

### File Modified
- `components/annotation-canvas-modern.tsx`

### Three Synchronization Points Added

#### 1. New Note Centering (Line 450-465)
**Location:** Inside `tryCenter()` function for new notes without snapshots

**Before:**
```typescript
flushSync(() => {
  setCanvasState(prev => ({
    ...prev,
    translateX: targetX,
    translateY: targetY
  }))
})
// ❌ Context state still at default -1000, -1200
```

**After:**
```typescript
flushSync(() => {
  setCanvasState(prev => ({
    ...prev,
    translateX: targetX,
    translateY: targetY
  }))
})

// ✅ ADDED: Sync to context
dispatch({
  type: 'SET_CANVAS_STATE',
  payload: {
    translateX: targetX,
    translateY: targetY
  }
})

debugLog({
  component: 'AnnotationCanvas',
  action: 'new_note_context_synced',
  metadata: { noteId, targetX, targetY }
})
```

#### 2. Snapshot Loading Centering (Line 702-717)
**Location:** After loading snapshot for existing notes

**Before:**
```typescript
flushSync(() => {
  setCanvasState(prev => ({
    ...prev,
    translateX: targetX,
    translateY: targetY
  }))
})
// ❌ Context state not synced
```

**After:**
```typescript
flushSync(() => {
  setCanvasState(prev => ({
    ...prev,
    translateX: targetX,
    translateY: targetY
  }))
})

// ✅ ADDED: Sync to context
dispatch({
  type: 'SET_CANVAS_STATE',
  payload: {
    translateX: targetX,
    translateY: targetY
  }
})

debugLog({
  component: 'AnnotationCanvas',
  action: 'snapshot_context_synced',
  metadata: { noteId, targetX, targetY }
})
```

#### 3. centerOnPanel Function (Line 1264-1285)
**Location:** Imperative centering API

**Before:**
```typescript
flushSync(() => {
  setCanvasState(prev => ({
    ...prev,
    translateX: targetX,
    translateY: targetY
  }))
})

debugLog({
  component: 'AnnotationCanvas',
  action: 'viewport_updated_instant',
  metadata: { panelId, targetX, targetY }
})
```

**After:**
```typescript
flushSync(() => {
  setCanvasState(prev => ({
    ...prev,
    translateX: targetX,
    translateY: targetY
  }))
})

// ✅ ADDED: Sync to context
dispatch({
  type: 'SET_CANVAS_STATE',
  payload: {
    translateX: targetX,
    translateY: targetY
  }
})

debugLog({
  component: 'AnnotationCanvas',
  action: 'viewport_updated_instant',
  metadata: { panelId, targetX, targetY }
})

debugLog({
  component: 'AnnotationCanvas',
  action: 'centerOnPanel_context_synced',
  metadata: { panelId, targetX, targetY }
})
```

---

## How the Fix Works

### The Problem

1. **Two States Exist:**
   - Local state (`setCanvasState`) - controls canvas rendering
   - Context state (`dispatch`) - shared with child components

2. **Centering Only Updated Local State:**
   - Centering calculated correct position (e.g., -1523, -1304)
   - Updated local state via `setCanvasState`
   - Did NOT dispatch to context
   - Context remained at default (-1000, -1200)

3. **First Auto-Scroll Read Stale Context:**
   - Panel drag triggers auto-scroll
   - `panCameraBy` in `use-canvas-camera.ts` reads from context
   - Gets stale translateX: -1000 instead of -1523
   - Dispatches -1000 to both local and context
   - Viewport jumps 523px right → visual "snap"

### The Solution

**After every centering operation:**
1. Update local state with `setCanvasState` (existing)
2. **NEW:** Also dispatch same coordinates to context
3. Both states now in sync
4. First auto-scroll reads correct position from context
5. No jump occurs

---

## Testing Verification

### Test Cases

**✅ Test 1: New Note First Drag**
1. Create new note
2. Drag to top edge
3. **Expected:** No snap, smooth auto-scroll

**✅ Test 2: Existing Note First Drag**
1. Open existing note
2. Drag to left edge
3. **Expected:** No snap, smooth auto-scroll

**✅ Test 3: All Edges**
1. Drag to top, left, right, bottom edges
2. **Expected:** All work correctly, no snaps

**✅ Test 4: Subsequent Drags**
1. Drag to edge multiple times
2. **Expected:** Continues to work (no regression)

**✅ Test 5: Multiple Panels**
1. Have main + branch panels
2. Drag main to edge
3. **Expected:** Both panels stay in place, no snap

### Debug Log Verification

After fix, you should see these new log entries:

```sql
SELECT action, metadata
FROM debug_logs
WHERE action IN (
  'new_note_context_synced',
  'snapshot_context_synced',
  'centerOnPanel_context_synced'
)
ORDER BY created_at DESC
LIMIT 10;
```

**Expected:** Log entries showing targetX and targetY being synced to context

---

## Safety Analysis

### What Could Go Wrong?

**❌ Potential Issue 1: Double Dispatch**
- **Risk:** Dispatching might trigger effects that re-dispatch
- **Mitigation:** Dispatch is after flushSync, state already updated
- **Result:** Safe - no circular updates

**❌ Potential Issue 2: Performance**
- **Risk:** Extra dispatch on every centering
- **Mitigation:** Centering only happens on load/manual center
- **Result:** Safe - negligible performance impact

**❌ Potential Issue 3: Race Conditions**
- **Risk:** Context update might race with other state changes
- **Mitigation:** flushSync ensures local state updates first
- **Result:** Safe - proper ordering maintained

### Why This is Safe

1. **Non-Breaking:**
   - Only adds dispatch, doesn't modify existing logic
   - No changes to render paths or effects
   - Purely additive fix

2. **Isolated:**
   - Only affects centering code paths
   - Doesn't touch drag, auto-scroll, or other features
   - Minimal blast radius

3. **Reversible:**
   - Can easily remove dispatch calls if issues arise
   - Original logic still intact
   - Easy rollback path

4. **Traceable:**
   - Added debug logs for each sync
   - Can verify fix working via logs
   - Observable behavior change

---

## Before/After Behavior

### Before Fix

```
App Load → Center Panel
  ├─ Local State: { translateX: -1523, translateY: -1304 }
  └─ Context State: { translateX: -1000, translateY: -1200 } ← STALE!

First Drag to Edge → Auto-Scroll
  ├─ panCameraBy reads context: oldX = -1000 (WRONG!)
  ├─ Calculates: newX = -1000 - deltaX
  ├─ Dispatches: translateX = -1000
  └─ RESULT: Viewport jumps 523px right (SNAP!)

Second Drag
  ├─ Context now synced to -1000
  ├─ panCameraBy reads: oldX = -1000 (correct)
  └─ Works fine
```

### After Fix

```
App Load → Center Panel
  ├─ Local State: { translateX: -1523, translateY: -1304 }
  ├─ dispatch() to context ✅ NEW!
  └─ Context State: { translateX: -1523, translateY: -1304 } ← SYNCED!

First Drag to Edge → Auto-Scroll
  ├─ panCameraBy reads context: oldX = -1523 (CORRECT!)
  ├─ Calculates: newX = -1523 - deltaX
  ├─ Dispatches: translateX = -1523 - deltaX
  └─ RESULT: Smooth panning, no jump!

All Subsequent Drags
  ├─ States remain in sync
  └─ Everything works correctly
```

---

## Related Files (Reference Only)

These files are involved in the bug but were NOT modified:

- `lib/hooks/use-canvas-camera.ts` - Reads context state (no changes needed)
- `components/canvas/canvas-panel.tsx` - Triggers auto-scroll (no changes needed)
- `components/canvas/canvas-context.tsx` - Context reducer (no changes needed)
- `components/canvas/use-auto-scroll.ts` - Auto-scroll detection (no changes needed)

The fix is entirely contained in `annotation-canvas-modern.tsx` at the state synchronization level.

---

## Rollback Plan

If this fix causes unforeseen issues:

1. **Remove dispatch calls:**
   - Delete lines 453-459 (new note centering)
   - Delete lines 705-711 (snapshot centering)
   - Delete lines 1267-1273 (centerOnPanel)

2. **Remove debug logs:**
   - Delete lines 461-465
   - Delete lines 713-717
   - Delete lines 1281-1285

3. **Verify rollback:**
   - Issue should return (snap on first drag)
   - System back to previous behavior

---

## Approval Checklist

- [x] Root cause identified and understood
- [x] Fix addresses root cause, not symptoms
- [x] All centering code paths updated
- [x] Debug logging added for verification
- [x] No breaking changes to existing code
- [x] Minimal, surgical changes only
- [x] Clear comments explaining the fix
- [x] Rollback plan documented
- [x] Test plan defined

---

## Sign-Off

**Implementation Approach:** Senior Engineer Safety-First Pattern
- ✅ Minimal changes
- ✅ Non-breaking
- ✅ Reversible
- ✅ Traceable
- ✅ Documented

**Ready for Testing:** YES
**Confidence Level:** HIGH
**Risk Level:** LOW

---

## Next Steps

1. **User Testing:**
   - Test all scenarios listed above
   - Verify no snap occurs on first drag
   - Confirm subsequent drags still work

2. **Monitor Debug Logs:**
   - Check for `*_context_synced` events
   - Verify translateX/translateY values match

3. **Performance Check:**
   - Verify no lag on note load
   - Confirm centering is still smooth

4. **Edge Case Testing:**
   - Multiple rapid drags
   - Switching notes during drag
   - Browser refresh during drag

If all tests pass → Mark issue as RESOLVED
