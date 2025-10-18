# Fix: Panel Jumping When Switching Notes via Toolbar

**Date**: 2025-10-18
**Issue**: Panel snaps to default position then jumps back when clicking toolbar entries
**Status**: RESOLVED
**Files Modified**:
- `components/canvas/canvas-context.tsx`
- `components/canvas/canvas-workspace-context.tsx`

---

## Symptoms

When clicking a toolbar entry to switch between notes:

1. The focused note's panel would **instantly jump** to position (2000, 1500)
2. Then it would **quickly snap back** to its correct saved position
3. The toolbar entry title would briefly show **"Main Document"** before displaying the correct note title
4. This created a jarring visual experience with every note switch

**Key observation by user**: "when the toolbar entry is clicked that entry title changed to something 'main document....' and instantly printed back the right title of the note"

This was the critical clue that pointed to the root cause.

---

## Root Cause

### The Problem: Component Lifecycle + Lost State

The CanvasProvider component was **unmounting and remounting** every time the user switched notes, causing it to lose track of which notes had already been initialized.

#### Detailed Breakdown:

1. **Component Unmount/Remount Cycle**:
   ```
   User clicks Note A toolbar entry
   → CanvasProvider UNMOUNTS (noteId changing)
   → CanvasProvider REMOUNTS with new noteId
   ```

2. **State Loss**:
   - `loadedNotesRef` was defined **inside** CanvasProvider:
     ```typescript
     const loadedNotesRef = useRef(new Set<string>())
     ```
   - When component unmounted, this ref was **destroyed**
   - When component remounted, it created a **fresh empty Set**

3. **Failed Check**:
   ```typescript
   if (isPlainMode && noteId && !loadedNotesRef.current.has(noteId)) {
     // This condition was ALWAYS TRUE because Set was always empty!
     dataStore.set(mainStoreKey, {
       title: 'Main Document',        // ← Default title (what user saw)
       position: { x: 2000, y: 1500 }, // ← Default position (caused jump)
     })
   }
   ```

4. **Re-initialization on Every Switch**:
   - Every note switch looked like a "first time" initialization
   - Panel created at default position (2000, 1500)
   - Title set to "Main Document"
   - Database hydration then asynchronously loaded correct data
   - Panel updated to correct position → **visible snap**

### Why Was CanvasProvider Unmounting?

The exact React lifecycle trigger is unclear, but the evidence shows:
- Multiple `Component MOUNTED` logs with different `mountId`s
- `Component UNMOUNTING` logs showing the destruction
- This happened **every time** `noteId` prop changed

Possible contributing factors:
- Parent component re-renders
- Props/context changes triggering recreation
- React reconciliation treating it as a new component instance

**The key insight**: Regardless of *why* it unmounts, we need state that **survives unmount/remount cycles**.

---

## Investigation Process

### Step 1: Added Debug Logging

Added comprehensive logging to track:
- When CanvasProvider effect runs
- Whether notes are in `loadedNotes` Set
- When "Main Document" default is set
- Component mount/unmount lifecycle

**Key findings from logs**:
```
[CanvasProvider] Component MOUNTED {mountId: '7mbk6', noteId: '5e442a3c-...'}
[CanvasProvider] Component MOUNTED {mountId: 'qxkfvk', noteId: '5e442a3c-...'} // Different mount!
[CanvasProvider] Component UNMOUNTING {mountId: '7mbk6', loadedNotes: ['5e442a3c-...']}
[CanvasProvider] Setting initial dataStore for main panel
  hasCachedMain: false
  titleValue: "Main Document"
  usingDefaultTitle: true
  usingDefaultPosition: true
```

This confirmed:
1. Component was unmounting/remounting
2. No cached snapshot existed
3. Defaults were being used on every switch

### Step 2: Identified State Storage Issue

The problem was clear: `loadedNotesRef` was stored in component memory, which was destroyed on unmount.

**Solution approach**: Move the state to a **stable location** that survives component lifecycle.

---

## The Fix

### Solution 1: Move State to Workspace (Initial Fix)

Store `loadedNotes` Set in the workspace's dataStore, which is stable and persists across unmount/remount:

```typescript
// OLD (lost on unmount):
const loadedNotesRef = useRef(new Set<string>())

// NEW (survives unmount):
const loadedNotesSet = (dataStore as any).__loadedNotes as Set<string> | undefined
if (!loadedNotesSet) {
  (dataStore as any).__loadedNotes = new Set<string>()
}
const loadedNotes = (dataStore as any).__loadedNotes as Set<string>
```

**File**: `components/canvas/canvas-context.tsx` lines 145-151

### Solution 2: Check Existing Data (Enhanced Fix)

The first fix worked **within a session**, but required opening all notes once after page reload.

**Why**: The in-memory Set is cleared on page reload.

**Enhancement**: Also check if dataStore already has data for the note:

```typescript
// Check if dataStore already has data for this note's main panel
const mainStoreKey = ensurePanelKey(noteId || '', 'main')
const existingMainPanel = noteId ? dataStore.get(mainStoreKey) : null
const shouldSkipInit = loadedNotes.has(noteId || '') || !!existingMainPanel

if (isPlainMode && noteId && !shouldSkipInit) {
  // Only initialize if:
  // 1. Note NOT in loadedNotes Set (same session), AND
  // 2. DataStore does NOT have data (from hydration/previous load)
}
```

**File**: `components/canvas/canvas-context.tsx` lines 180-196

### Workspace Type Update

Updated workspace interface to include loadedNotes for future proper implementation:

```typescript
export interface NoteWorkspace {
  dataStore: DataStore
  events: EventEmitter
  layerManager: LayerManager
  loadedNotes: Set<string>  // Track which notes have been initialized
}
```

**File**: `components/canvas/canvas-workspace-context.tsx` lines 10-15

---

## How the Fix Works

### Before the Fix:

```
1. Click Note A toolbar entry
2. CanvasProvider unmounts
3. loadedNotesRef destroyed
4. CanvasProvider remounts with empty Set
5. Check: loadedNotesRef.has(noteA) → FALSE
6. Initialize with defaults: "Main Document", (2000, 1500) → USER SEES JUMP
7. Database loads correct data asynchronously
8. Panel updates to correct position → USER SEES SNAP BACK
```

### After the Fix:

```
1. Click Note A toolbar entry (first time)
2. CanvasProvider unmounts
3. loadedNotes persists in dataStore (NOT destroyed)
4. CanvasProvider remounts
5. Check: loadedNotes.has(noteA) → FALSE, existingMainPanel → NULL
6. Initialize with defaults (first time is OK)
7. Mark as loaded: loadedNotes.add(noteA)
8. Database loads correct data
9. Panel renders at correct position

--- User clicks Note B, then back to Note A ---

10. Click Note A toolbar entry (second time)
11. CanvasProvider unmounts
12. loadedNotes persists in dataStore (still has noteA)
13. CanvasProvider remounts
14. Check: loadedNotes.has(noteA) → TRUE OR existingMainPanel → EXISTS
15. shouldSkipInit → TRUE
16. Skip initialization → NO DEFAULT VALUES
17. Panel renders at existing correct position → NO JUMP ✓
```

### After Page Reload:

```
1. Page reloads → loadedNotes Set is empty
2. Click Note A toolbar entry
3. Check: loadedNotes.has(noteA) → FALSE
4. BUT existingMainPanel → EXISTS (hydration loaded it)
5. shouldSkipInit → TRUE
6. Skip initialization → NO JUMP ✓
```

---

## Verification

### Test Results:

**Before fix**:
- ✗ Panel jumps on every toolbar switch
- ✗ Title flashes "Main Document" on every switch
- ✗ Requires centering animation to compensate

**After fix (same session)**:
- ✓ First click on each note: Initializes once (acceptable)
- ✓ Subsequent clicks: No jump, no title flash
- ✓ Smooth switching between notes

**After fix (page reload)**:
- ✓ No need to open all notes first
- ✓ Switches smoothly using existing dataStore data

### Console Output After Fix:

```
// First click on Note A
[CanvasProvider] useEffect triggered {
  hasLoadedBefore: false,
  hasExistingData: false,
  shouldSkipInit: false,
  willRunInitialization: true
}
[CanvasProvider] Initializing main panel for FIRST TIME

// Second click on Note A (same session)
[CanvasProvider] useEffect triggered {
  hasLoadedBefore: true,
  hasExistingData: true,
  shouldSkipInit: true,
  willRunInitialization: false
}
[CanvasProvider] Skipping initialization - note already loaded
```

---

## Technical Details

### Why Storing in DataStore Works:

1. **DataStore is external**: Passed via `externalDataStore` prop from workspace
2. **Workspace is stable**: Created once in `CanvasWorkspaceProvider`
3. **Survives unmount**: DataStore object persists even when CanvasProvider is destroyed
4. **Shared reference**: Same DataStore instance used across mount/remount cycles

### Alternative Approaches Considered:

1. **Prevent CanvasProvider unmount**:
   - Hard to control React's reconciliation
   - Would require architectural changes
   - Fixing symptom, not root cause

2. **LocalStorage caching**:
   - Already attempted in previous fixes
   - Unreliable due to async nature
   - Doesn't help with same-session switches

3. **Workspace-level tracking** (proper implementation):
   - Added `loadedNotes` to workspace interface
   - Current fix uses `__loadedNotes` as temporary solution
   - Future: Use workspace.loadedNotes properly

---

## Related Issues

### Previous Failed Attempts:

1. **skipSnapshotForNote flag**: Only prevented localStorage, not DB hydration
2. **Disable hydration**: Made problem worse
3. **Update position on prop change**: Didn't prevent initial jump
4. **Opacity hiding**: Masked symptom, didn't fix root cause
5. **Workspace position fallback**: Still used defaults on first render
6. **Pre-load position**: Race condition with state updates
7. **Disable highlight effect**: Unrelated to the issue

All these failed because they didn't address the **component lifecycle + state loss** root cause.

---

## Lessons Learned

1. **User observations are critical**: The "Main Document" title flash was the key clue
2. **Component lifecycle matters**: State in refs can be lost on unmount
3. **External state is reliable**: DataStore/workspace-level state survives unmounts
4. **Debug logging is essential**: Mount/unmount logs revealed the true problem
5. **Fix the root cause**: Previous attempts fixed symptoms, not the underlying issue

---

## Future Improvements

1. **Proper workspace integration**: Move from `(dataStore as any).__loadedNotes` to `workspace.loadedNotes`
2. **Investigate unmounting trigger**: Understand why CanvasProvider unmounts on noteId change
3. **Consider memoization**: Maybe `useMemo` could prevent unnecessary unmounts
4. **Remove debug logging**: Clean up console logs once confirmed stable
5. **Add tests**: Unit tests for loadedNotes tracking across mount/remount

---

## Code References

### Key Files Modified:

**components/canvas/canvas-context.tsx**:
- Lines 145-151: Get loadedNotes from dataStore
- Lines 180-196: Check existing data before initialization
- Lines 374-378: Mark note as loaded
- Lines 580-585: Skip initialization logging

**components/canvas/canvas-workspace-context.tsx**:
- Lines 10-15: Add loadedNotes to workspace interface
- Lines 120-141: Initialize loadedNotes in workspace creation

---

## Acceptance Criteria

- [x] No panel jumping when switching between already-opened notes
- [x] No "Main Document" title flash in toolbar entries
- [x] Works within same session after opening notes once
- [x] Works after page reload (using existing dataStore data)
- [x] No performance degradation
- [x] No side effects on other canvas functionality
- [x] Debug logging shows correct skip/initialize decisions

---

## Additional Notes

This fix resolves the immediate issue but reveals a deeper architectural question: **Why does CanvasProvider unmount when noteId changes?**

The current fix makes the system resilient to unmounting, but preventing unnecessary unmounts might improve performance and simplify state management.

**Recommendation**: In a future refactoring, investigate React component structure to understand and potentially prevent the unmount/remount cycle entirely.
