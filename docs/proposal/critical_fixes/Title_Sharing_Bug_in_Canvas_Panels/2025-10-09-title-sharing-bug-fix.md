# Title Sharing Bug Fix - Canvas Panels

**Date:** October 9, 2025
**Status:** ✅ Fixed and Verified
**Severity:** Critical (Runtime Display Bug)
**Category:** Event-driven State Management

---

## Executive Summary

Fixed a critical bug where editing the title of ANY panel (main or branch) caused ALL panels to display the same title at runtime. The bug was caused by a global event broadcast pattern that didn't distinguish between note-level renames (main panel) and panel-level renames (individual branches).

**Key Finding:** Database persistence was working correctly; the bug was purely a runtime state synchronization issue caused by improper event scoping.

---

## Symptom

### Observed Behavior (Before Fix)

1. User edits the title of any panel (e.g., branch-123 → "New Title")
2. **ALL panels immediately display "New Title":**
   - Main panel changes to "New Title" ❌
   - Branch-123 shows "New Title" ✓ (correct)
   - Branch-456 changes to "New Title" ❌
   - All other branches change to "New Title" ❌
3. After app reload, all titles are correct ✓

### Critical Clue

The fact that titles were correct after reload proved:
- ✅ Database persistence was working properly
- ❌ Runtime state management had a shared reference or broadcast issue

---

## Root Cause Analysis

### The Event Flow Problem

Every `CanvasPanel` instance subscribes to a global `'note-renamed'` event. When ANY panel's title is saved:

1. **Panel emits event** (line 947-949):
   ```typescript
   window.dispatchEvent(new CustomEvent('note-renamed', {
     detail: { noteId, newTitle: result.title }
   }))
   ```

2. **ALL panels receive the event** (line 179):
   ```typescript
   window.addEventListener('note-renamed', handleNoteRenamed)
   ```

3. **Each panel checks only noteId** (line 161):
   ```typescript
   if (renamedNoteId === noteId) {
     dataStore.update(panelId, { title: newTitle.trim() })
   }
   ```

### The Core Issue

**All panels within the same note share the same `noteId` but have different `panelId` values:**

- Main panel: `panelId='main'`, `noteId='note-xyz'`
- Branch-123: `panelId='branch-123'`, `noteId='note-xyz'`
- Branch-456: `panelId='branch-456'`, `noteId='note-xyz'`

When branch-123 is renamed:
1. Line 900: `dataStore.update('branch-123', { title: 'New Title' })` ✓ (correct)
2. Line 947: Emits `'note-renamed'` with `noteId='note-xyz'`
3. **ALL three panels match `noteId='note-xyz'`** ✓
4. **ALL three panels execute:** `dataStore.update(panelId, { title: 'New Title' })`
   - Main: `dataStore.update('main', { title: 'New Title' })` ❌ Wrong!
   - Branch-123: `dataStore.update('branch-123', { title: 'New Title' })` ✓ Correct
   - Branch-456: `dataStore.update('branch-456', { title: 'New Title' })` ❌ Wrong!

**Result:** All panels share the same title at runtime.

### Why Reload Fixed It

On reload, each panel loads its title directly from the database (which was persisted correctly at line 900), creating fresh independent objects with correct titles.

---

## The Fix

### Strategy

Restrict the `'note-renamed'` event to its original intent: **note-level renames (main panel only)**.

Branch panels should:
- Update their titles independently via `dataStore.update()` (already working)
- NOT broadcast global events
- NOT listen to note-rename events

### Code Changes

**File:** `components/canvas/canvas-panel.tsx`

#### Change 1: Event Listener Guard (Line 162)

**Before:**
```typescript
// Only update if this panel is showing the renamed note
if (renamedNoteId === noteId) {
  console.log('[CanvasPanel] Received rename event for this panel:', newTitle.trim())

  // Guard: Ensure dataStore.update doesn't throw
  try {
    dataStore.update(panelId, { title: newTitle.trim() })
    dispatch({ type: "BRANCH_UPDATED" })
  } catch (updateError) {
    console.error('[CanvasPanel] Failed to update panel title:', updateError)
  }
}
```

**After:**
```typescript
// Only update if this is the main panel and showing the renamed note
// Branch panels manage their own titles independently via handleSaveRename
if (panelId === 'main' && renamedNoteId === noteId) {
  console.log('[CanvasPanel] Main panel received note rename event:', newTitle.trim())

  // Guard: Ensure dataStore.update doesn't throw
  try {
    dataStore.update(panelId, { title: newTitle.trim() })
    dispatch({ type: "BRANCH_UPDATED" })
  } catch (updateError) {
    console.error('[CanvasPanel] Failed to update panel title:', updateError)
  }
}
```

**What Changed:**
- Added `panelId === 'main'` check
- Only main panel listens to and responds to `note-renamed` events
- Branch panels ignore the event entirely

#### Change 2: Event Emitter Guard (Line 950)

**Before:**
```typescript
// 2. Set timestamped tombstone (self-expires after 5 seconds)
window.localStorage.setItem(`${cachedKey}:invalidated`, Date.now().toString())

// 3. Emit event for live components (e.g., popup overlay) to refresh
window.dispatchEvent(new CustomEvent('note-renamed', {
  detail: { noteId, newTitle: result.title }
}))

console.log('[CanvasPanel] Invalidated localStorage cache with tombstone')
```

**After:**
```typescript
// 2. Set timestamped tombstone (self-expires after 5 seconds)
window.localStorage.setItem(`${cachedKey}:invalidated`, Date.now().toString())

// 3. Emit event for live components (e.g., popup overlay) to refresh
// CRITICAL: Only emit note-renamed event for main panel (note-level rename)
// Branch panels manage their own titles independently
if (panelId === 'main') {
  window.dispatchEvent(new CustomEvent('note-renamed', {
    detail: { noteId, newTitle: result.title }
  }))
}

console.log('[CanvasPanel] Invalidated localStorage cache with tombstone')
```

**What Changed:**
- Added `if (panelId === 'main')` guard before emitting event
- Only main panel broadcasts note-renamed events
- Branch panels update silently (no global event)

---

## Affected Files

### Modified Files

1. **`components/canvas/canvas-panel.tsx`**
   - Line 162: Added `panelId === 'main'` check to event listener
   - Line 950: Added `if (panelId === 'main')` guard to event emitter
   - **Total changes:** 2 guards added

### Related Files (Not Modified)

- `lib/data-store.ts` - DataStore implementation (working correctly)
- `components/canvas/branch-item.tsx` - Branch title display (working correctly)
- `components/canvas/branches-section.tsx` - Branch list rendering (working correctly)
- `components/annotation-canvas-modern.tsx` - Panel instantiation (working correctly)

---

## Technical Details

### Event Semantics (Correct Interpretation)

**`note-renamed` event should mean:**
- The note document itself was renamed (main panel title change)
- Used by PopupOverlay and other UI components to sync note title displays
- Should NOT be used for individual branch panel renames

**Branch panel title changes should:**
- Update `dataStore` directly (already working at line 900)
- Trigger React re-render via `dispatch({ type: "BRANCH_UPDATED" })`
- NOT broadcast global events (branches are internal to the note)

### DataStore Pattern

The `DataStore` class in `lib/data-store.ts`:

```typescript
update(key: string, updates: any) {
  const existing = this.get(key) || {}
  const newValue = { ...existing, ...updates }
  this.set(key, newValue)
  this.emit('update', key)
}
```

- Creates shallow copies at top level
- Emits local 'update' events (not global window events)
- Each `panelId` key has independent data
- The bug was NOT in DataStore; it was in the global event broadcast

### Why Previous Fixes Failed

Two fixes were attempted before the correct diagnosis:

**Attempt 1:** Deep copy in `getBranchData()` (line 842)
```typescript
const dataCopy = JSON.parse(JSON.stringify(data))
return dataCopy
```
- **Why it failed:** Event still broadcast to all panels, overwriting the copies

**Attempt 2:** Title preservation in `handleUpdate()` (line 1036)
```typescript
title: currentBranch.title,
```
- **Why it failed:** Event listener still overwrote titles globally

**Root Issue:** These fixes addressed symptoms (shared references, missing fields) but not the root cause (global event broadcast pattern).

---

## Verification Steps

### Manual Testing

1. **Test Branch Panel Rename:**
   ```
   1. Open a note with multiple branch panels (e.g., main + 2 branches)
   2. Enter edit mode in branches panel
   3. Double-click a branch title to rename
   4. Type new title and press Enter
   5. ✅ VERIFY: Only that branch's title changes
   6. ✅ VERIFY: Main panel keeps its title
   7. ✅ VERIFY: Other branches keep their titles
   ```

2. **Test Main Panel Rename:**
   ```
   1. Click main panel title to edit
   2. Type new title and save
   3. ✅ VERIFY: Only main panel's title changes
   4. ✅ VERIFY: Branch panels keep their titles
   5. ✅ VERIFY: PopupOverlay note title updates (event listener works)
   ```

3. **Test Persistence:**
   ```
   1. Rename any panel (main or branch)
   2. Reload the app
   3. ✅ VERIFY: All titles persist correctly
   4. ✅ VERIFY: No title sharing occurs after reload
   ```

4. **Test Multi-Edit Scenario:**
   ```
   1. Open note with 3+ branch panels
   2. Rapidly rename multiple branches
   3. ✅ VERIFY: Each rename only affects its own panel
   4. ✅ VERIFY: No race conditions or cross-contamination
   ```

### Expected Console Logs

**When renaming branch-123:**
```
[CanvasPanel] Rename succeeded: { title: "New Title", ... }
[CanvasPanel] Invalidated localStorage cache with tombstone
// NO "note-renamed" event emitted
```

**When renaming main panel:**
```
[CanvasPanel] Rename succeeded: { title: "Updated Note Title", ... }
[CanvasPanel] Invalidated localStorage cache with tombstone
// "note-renamed" event IS emitted
[CanvasPanel] Main panel received note rename event: Updated Note Title
```

---

## Related Issues

### Similar Pattern to Watch For

This bug pattern could occur elsewhere with global events:
- ✅ Check all `window.addEventListener()` calls for proper scoping
- ✅ Check all `window.dispatchEvent()` calls for appropriate guards
- ✅ Ensure events match their semantic intent (note-level vs panel-level)

### Previous Fixes in Same Area

- **Branches Panel Auto-Update Fix:** Prevented `handleUpdate()` from overwriting branches array
- **Floating Toolbar Visibility Fix:** Added fallback FloatingToolbar for null selectedNoteId

These fixes were in the same file but addressed different issues (data structure preservation vs event scoping).

---

## Lessons Learned

1. **Event Semantics Matter:** Global events should match their semantic intent. `note-renamed` should be for note-level changes, not panel-level changes.

2. **Guard Broadcasts:** When emitting global events, consider who should receive them and add guards to prevent unintended listeners.

3. **Guard Listeners:** When listening to global events, validate that the event is truly intended for this component instance.

4. **Runtime vs Persistence:** When a bug "fixes itself on reload," it indicates a runtime state management issue, not a persistence issue.

5. **Symptom vs Root Cause:** Deep copies and field preservation addressed symptoms but not the root cause (event broadcast pattern).

---

## Performance Impact

**Before Fix:**
- Every panel rename triggered N event handlers (N = number of panels)
- Caused N DataStore updates + N React dispatches
- O(N) unnecessary re-renders per rename

**After Fix:**
- Branch panel rename triggers 1 DataStore update (the renamed panel)
- Main panel rename triggers 1 DataStore update + 1 event broadcast
- O(1) re-renders per rename

**Improvement:** Eliminated O(N) unnecessary updates, improving performance for notes with many branch panels.

---

## Future Considerations

### Alternative Solutions (Not Implemented)

1. **Add panelId to event detail:**
   ```typescript
   window.dispatchEvent(new CustomEvent('note-renamed', {
     detail: { noteId, panelId, newTitle: result.title }
   }))
   ```
   - Listener checks `if (renamedPanelId === panelId)`
   - More flexible but adds complexity

2. **Separate events:**
   - `note-renamed` for main panel (document-level)
   - `branch-renamed` for branch panels (panel-level)
   - Better semantic separation but requires updating all listeners

3. **Remove global events entirely:**
   - Use React Context or state management
   - More "React-native" but requires larger refactor

**Chosen Solution:** Guard-based approach is minimal, safe, and maintains backward compatibility with PopupOverlay and other components that listen for note-level renames.

---

## Regression Tests

Create automated tests to prevent regression:

```typescript
describe('Canvas Panel Title Isolation', () => {
  it('should only update renamed panel, not other panels', async () => {
    // Setup: note with main + 2 branches
    const { main, branch1, branch2 } = setupMultiPanelNote()

    // Act: Rename branch1
    await renamePanelTitle(branch1, 'New Title')

    // Assert: Only branch1 affected
    expect(branch1.title).toBe('New Title')
    expect(main.title).toBe('Main Document') // Unchanged
    expect(branch2.title).toBe('Note on "text"') // Unchanged
  })

  it('should emit note-renamed event only for main panel', async () => {
    const eventSpy = jest.fn()
    window.addEventListener('note-renamed', eventSpy)

    // Act: Rename branch
    await renamePanelTitle(branchPanel, 'Branch Title')
    expect(eventSpy).not.toHaveBeenCalled() // No event

    // Act: Rename main
    await renamePanelTitle(mainPanel, 'Main Title')
    expect(eventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { noteId: 'note-xyz', newTitle: 'Main Title' }
      })
    )
  })
})
```

---

## Checklist

- [x] Root cause identified and documented
- [x] Fix implemented with minimal code changes
- [x] Manual testing completed successfully
- [x] No TypeScript errors introduced
- [x] Dev server compiles successfully
- [x] User verified fix works in production scenario
- [x] Documentation created with full context
- [x] Related files reviewed for similar patterns
- [x] Performance improvement achieved (O(N) → O(1))
- [ ] Automated regression tests added (TODO)

---

## References

- **Bug Report:** User message on October 9, 2025
- **Investigation:** Root cause analysis via code reading and event tracing
- **Fix Applied:** October 9, 2025
- **User Verification:** Confirmed working same day
- **Related Fixes:** Branches panel auto-update, floating toolbar visibility

---

## Conclusion

This fix demonstrates the importance of proper event scoping in event-driven architectures. By restricting `note-renamed` events to their original semantic intent (note-level renames for main panel only), we eliminated the runtime title sharing bug while maintaining backward compatibility with existing event listeners (PopupOverlay, etc.).

The fix is:
- ✅ Minimal (2 guard statements)
- ✅ Safe (no breaking changes)
- ✅ Performant (reduces unnecessary updates)
- ✅ Semantically correct (events match their intent)
- ✅ User-verified (working in production)
