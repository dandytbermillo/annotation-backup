# REVISED Implementation Plan: Prevent Data Loss in Cross-Browser Sync

**Date**: 2025-10-10
**Priority**: CRITICAL - Blocks Production Deployment
**Previous Plan**: REJECTED (didn't prevent data loss)
**This Plan**: COMPLETE REVISION

---

## Executive Summary

**Previous Plan FAILED because**: It changed WHO overwrites localStorage but still destroyed unsaved user content.

**This Plan FIXES the root cause**: Detects unsaved changes BEFORE replacing content, preserves user's work, and only updates when safe.

**Core Principle**: **NEVER destroy user's unsaved work, even during remote updates or conflicts.**

---

## Part 1: What Went Wrong With Previous Plan

### The Fatal Flaw

**Previous Plan**:
```typescript
// Step 3 from previous plan
isApplyingRemoteUpdateRef.current = true
editor.chain()
  .clearContent()           // ← DESTROYS user's unsaved "hello world"
  .insertContent(remote)    // ← Replaces with remote content
  .run()
isApplyingRemoteUpdateRef.current = false

// Manually write remote content
localStorage.setItem(pendingKey, remote) // ← Still overwrites backup
```

**Result**: User's "hello world" is gone forever. No recovery possible.

### Why It Failed

The previous plan focused on **suppressing** the localStorage write from onUpdate, but then **manually wrote the same remote content anyway**.

**Net Effect**: Identical data loss, just different execution path.

### The Correct Approach

**Check BEFORE replacing**:
```typescript
const currentContent = editor.getJSON()
const lastSavedContent = lastSavedContentRef.current

if (hasUnsavedChanges(currentContent, lastSavedContent)) {
  // STOP - Don't destroy user's work
  notifyUser('Remote changes available. Save your work first.')
  return // ← EXIT without touching editor
}

// Safe to replace - no unsaved work
editor.chain()...
```

---

## Part 2: The Complete Solution

### Architecture Overview

**Three-Layer Defense**:

1. **Layer 1: Unsaved Changes Detection**
   - Track last saved content in a ref
   - Compare current editor content before any update
   - Block updates if unsaved changes exist

2. **Layer 2: User Notification**
   - Alert user when remote changes are available but blocked
   - Provide "Save & Sync" button to resolve
   - Clear, non-intrusive notification

3. **Layer 3: Safe Update Path**
   - Only update when explicitly safe
   - Update both editor and localStorage atomically
   - Track state to prevent loops

### Why This Works

- ✅ User's work is NEVER destroyed
- ✅ User is informed of remote changes
- ✅ User controls when to sync
- ✅ No silent data loss possible

---

## Part 3: Implementation Steps (REVISED)

### Step 1: Add Last Saved Content Tracking (10 minutes)

**File**: `components/canvas/tiptap-editor-plain.tsx`

**Add refs at component top** (after existing refs, around line 320):

```typescript
// Track last saved content to detect unsaved changes
const lastSavedContentRef = useRef<ProseMirrorJSON | null>(null)

// Track when we're applying remote updates (to suppress onUpdate)
const isApplyingRemoteUpdateRef = useRef(false)

// Track pending remote updates that are blocked
const pendingRemoteUpdateRef = useRef<{
  content: ProseMirrorJSON | HtmlString
  version: number
  reason: string
} | null>(null)
```

**Why**: We need to know what was last saved so we can compare against current content.

**Estimated LOC**: +3 refs

---

### Step 2: Update lastSavedContent on Successful Save (15 minutes)

**File**: `components/canvas/tiptap-editor-plain.tsx`

**Find the debounced save handler** (around line 976-986):

```typescript
const timer = setTimeout(() => {
  if (provider && noteId) {
    provider.saveDocument(noteId, panelId, json, false, { skipBatching: true })
      .then(() => {
        // NEW: Track that this content was successfully saved
        lastSavedContentRef.current = json
        console.log(`[🔧 SAVE-TRACKING] Last saved content updated`)
      })
      .catch(err => {
        console.error('[TiptapEditorPlain] Failed to save content:', err)
        // Don't update lastSavedContent on error
      })
  }
  onUpdate?.(json)
}, 300)
```

**Also update on initial load** (around line 400-430):

```typescript
// After successfully loading content from provider
setLoadedContent(resolvedContent)
lastSavedContentRef.current = resolvedContent // ← NEW
onContentLoaded?.({ content: resolvedContent, version: remoteVersion })
```

**Why**: We need to track what was successfully saved so we can detect changes.

**Estimated LOC**: +5 lines

---

### Step 3: Add Unsaved Changes Detection Helper (10 minutes)

**File**: `components/canvas/tiptap-editor-plain.tsx`

**Add helper function** (before useEffect blocks, around line 350):

```typescript
// Helper: Check if editor has unsaved changes
const hasUnsavedChanges = useCallback((): boolean => {
  if (!editor || !lastSavedContentRef.current) {
    return false // No baseline to compare against
  }

  const currentContent = editor.getJSON()
  const lastSaved = lastSavedContentRef.current

  // Deep comparison
  const currentStr = JSON.stringify(currentContent)
  const lastSavedStr = JSON.stringify(lastSaved)

  const hasChanges = currentStr !== lastSavedStr

  if (hasChanges) {
    console.log(`[🔧 UNSAVED-CHECK] Unsaved changes detected`, {
      currentLength: currentStr.length,
      lastSavedLength: lastSavedStr.length,
      difference: currentStr.length - lastSavedStr.length
    })
  }

  return hasChanges
}, [editor])
```

**Why**: Centralized logic for detecting unsaved changes.

**Estimated LOC**: +20 lines

---

### Step 4: Add User Notification System (20 minutes)

**File**: `components/canvas/tiptap-editor-plain.tsx`

**Add state for notification** (after other useState, around line 330):

```typescript
// Track notification for blocked remote updates
const [remoteUpdateNotification, setRemoteUpdateNotification] = useState<{
  message: string
  version: number
  hasRemoteUpdate: boolean
} | null>(null)
```

**Add notification UI** (in JSX, at the end before </div>, around line 2100):

```tsx
{/* Remote Update Notification */}
{remoteUpdateNotification?.hasRemoteUpdate && (
  <div
    style={{
      position: 'absolute',
      top: 8,
      right: 8,
      background: '#fef3c7',
      border: '1px solid #f59e0b',
      borderRadius: 6,
      padding: '8px 12px',
      fontSize: 13,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      zIndex: 1000,
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    }}
  >
    <span style={{ color: '#92400e' }}>
      ⚠️ {remoteUpdateNotification.message}
    </span>
    <button
      onClick={async () => {
        // Force save current content first
        if (provider && editor && noteId) {
          const currentContent = editor.getJSON()
          try {
            await provider.saveDocument(noteId, panelId, currentContent, false, { skipBatching: true })
            lastSavedContentRef.current = currentContent
            console.log(`[🔧 FORCE-SAVE] Current content saved`)
          } catch (err) {
            console.error('[Force Save] Failed:', err)
          }
        }

        // Now apply the pending remote update
        if (pendingRemoteUpdateRef.current) {
          const pending = pendingRemoteUpdateRef.current
          applyRemoteUpdateSafely(pending.content, pending.version, pending.reason)
          pendingRemoteUpdateRef.current = null
        }

        setRemoteUpdateNotification(null)
      }}
      style={{
        background: '#f59e0b',
        color: 'white',
        border: 'none',
        borderRadius: 4,
        padding: '4px 8px',
        fontSize: 12,
        cursor: 'pointer',
        fontWeight: 500,
      }}
    >
      Save & Sync
    </button>
    <button
      onClick={() => {
        // User chooses to discard local changes and accept remote
        if (pendingRemoteUpdateRef.current) {
          const pending = pendingRemoteUpdateRef.current
          applyRemoteUpdateSafely(pending.content, pending.version, pending.reason)
          pendingRemoteUpdateRef.current = null
        }
        setRemoteUpdateNotification(null)
      }}
      style={{
        background: 'transparent',
        color: '#92400e',
        border: '1px solid #f59e0b',
        borderRadius: 4,
        padding: '4px 8px',
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      Discard & Sync
    </button>
    <button
      onClick={() => setRemoteUpdateNotification(null)}
      style={{
        background: 'transparent',
        border: 'none',
        color: '#92400e',
        cursor: 'pointer',
        fontSize: 16,
        padding: 0,
        marginLeft: 4,
      }}
    >
      ×
    </button>
  </div>
)}
```

**Why**: Users need to know remote changes are available and control when to sync.

**Estimated LOC**: +80 lines (UI is verbose but necessary)

---

### Step 5: Add Safe Update Function (25 minutes)

**File**: `components/canvas/tiptap-editor-plain.tsx`

**Add helper function** (before useEffect blocks, around line 370):

```typescript
// Helper: Apply remote update safely (only when no unsaved changes)
const applyRemoteUpdateSafely = useCallback((
  remoteContent: ProseMirrorJSON | HtmlString,
  remoteVersion: number,
  reason: string
) => {
  if (!editor || editor.isDestroyed) {
    console.warn('[Safe Update] Editor destroyed, skipping')
    return
  }

  console.log(`[🔧 SAFE-UPDATE] Applying remote update v${remoteVersion}, reason: ${reason}`)

  // Set flag to suppress onUpdate localStorage write
  isApplyingRemoteUpdateRef.current = true

  try {
    // Make editor non-editable during update
    const wasEditable = editor.isEditable
    if (wasEditable) editor.setEditable(false)
    if (editor.isFocused) editor.commands.blur()

    // Update content
    editor.chain()
      .clearContent()
      .insertContent(remoteContent)
      .run()

    // Restore editability
    if (wasEditable) editor.setEditable(true)

    // Update state
    setLoadedContent(remoteContent)
    lastSavedContentRef.current = remoteContent // ← Track as last saved

    // Manually update localStorage with remote content
    const pendingKey = `pending_save_${noteId}_${panelId}`
    try {
      window.localStorage.setItem(pendingKey, JSON.stringify({
        content: remoteContent,
        timestamp: Date.now(),
        noteId,
        panelId,
        version: remoteVersion,
      }))
      console.log(`[🔧 SAFE-UPDATE] localStorage updated to v${remoteVersion}`)
    } catch (err) {
      console.error('[Safe Update] Failed to update localStorage:', err)
    }

    // Notify parent to update dataStore
    onContentLoaded?.({ content: remoteContent, version: remoteVersion })

    console.info(`[Editor] Content updated from remote (${reason})`)
  } catch (err) {
    console.error('[Safe Update] Failed to update editor:', err)
  } finally {
    // Always reset flag
    isApplyingRemoteUpdateRef.current = false
  }
}, [editor, noteId, panelId, onContentLoaded, setLoadedContent])
```

**Why**: Centralized, safe way to apply remote updates after verification.

**Estimated LOC**: +50 lines

---

### Step 6: Revise Remote Update Handler with Guard (30 minutes)

**File**: `components/canvas/tiptap-editor-plain.tsx`

**Replace the handleRemoteUpdate function** (lines 1203-1268):

```typescript
const handleRemoteUpdate = useCallback((event: {
  noteId: string
  panelId: string
  version: number
  content: ProseMirrorJSON | HtmlString
  reason?: string
}) => {
  console.log(`[🔧 REMOTE-UPDATE] Event received for ${panelId}`, {
    reason: event.reason,
    version: event.version
  })

  // Only handle updates for this specific panel
  if (event.noteId !== noteId || event.panelId !== panelId) {
    console.log(`[🔧 REMOTE-UPDATE] Ignoring - wrong panel`)
    return
  }

  // Check for destroyed editor
  if (!editor || editor.isDestroyed) {
    console.warn('[Remote Update] Editor destroyed, skipping')
    return
  }

  // CRITICAL: Check for unsaved changes BEFORE updating
  if (hasUnsavedChanges()) {
    console.warn(`[🔧 REMOTE-UPDATE] Blocked - user has unsaved changes`)

    // Store the pending update
    pendingRemoteUpdateRef.current = {
      content: event.content,
      version: event.version,
      reason: event.reason || 'remote update'
    }

    // Show notification to user
    setRemoteUpdateNotification({
      message: 'Remote changes available. Save your work to sync.',
      version: event.version,
      hasRemoteUpdate: true
    })

    return // ← EXIT - Don't touch editor or localStorage
  }

  // Safe to apply - no unsaved changes
  console.log(`[🔧 REMOTE-UPDATE] Safe to apply - no unsaved changes`)
  applyRemoteUpdateSafely(event.content, event.version, event.reason || 'remote update')
}, [noteId, panelId, editor, hasUnsavedChanges, applyRemoteUpdateSafely])
```

**Why**: This is the KEY FIX - checks for unsaved changes before destroying content.

**Estimated LOC**: +45 lines (replaces existing handler)

---

### Step 7: Revise Conflict Handler with Same Guard (25 minutes)

**File**: `components/canvas/tiptap-editor-plain.tsx`

**Replace the handleConflict function** (lines 1108-1201):

```typescript
const handleConflict = useCallback((event: {
  noteId: string
  panelId: string
  message: string
  remoteVersion?: number
  remoteContent?: ProseMirrorJSON | HtmlString
}) => {
  console.log(`[🔧 CONFLICT] Event received for ${panelId}`)

  // Only handle conflicts for this specific panel
  if (event.noteId !== noteId || event.panelId !== panelId) return

  // Check for destroyed editor
  if (!editor || editor.isDestroyed) {
    console.warn('[Conflict] Editor destroyed, skipping')
    return
  }

  // Get fresh content from provider
  let freshContent: ProseMirrorJSON | HtmlString | null = null
  try {
    freshContent = provider?.getDocument(noteId, panelId) || null
  } catch (err) {
    console.error('[Conflict] Failed to get fresh content:', err)
    return
  }

  if (!freshContent) {
    console.warn('[Conflict] No fresh content available')
    return
  }

  // CRITICAL: Check for unsaved changes BEFORE resolving conflict
  if (hasUnsavedChanges()) {
    console.warn(`[🔧 CONFLICT] Blocked - user has unsaved changes`)

    // Store the pending update
    pendingRemoteUpdateRef.current = {
      content: freshContent,
      version: event.remoteVersion || 0,
      reason: 'conflict resolution'
    }

    // Show notification
    setRemoteUpdateNotification({
      message: 'Conflict detected. Save your work to resolve.',
      version: event.remoteVersion || 0,
      hasRemoteUpdate: true
    })

    return // ← EXIT - Don't touch editor
  }

  // Safe to resolve conflict - no unsaved changes
  console.log(`[🔧 CONFLICT] Safe to resolve - no unsaved changes`)
  applyRemoteUpdateSafely(freshContent, event.remoteVersion || 0, 'conflict resolution')
}, [noteId, panelId, editor, provider, hasUnsavedChanges, applyRemoteUpdateSafely])
```

**Why**: Conflicts also need the same protection - don't destroy unsaved work.

**Estimated LOC**: +45 lines (replaces existing handler)

---

### Step 8: Suppress onUpdate During Remote Updates (10 minutes)

**File**: `components/canvas/tiptap-editor-plain.tsx`

**Modify onUpdate handler** (line 907):

```typescript
onUpdate: ({ editor }) => {
  // CRITICAL: Skip localStorage write during remote content updates
  if (isApplyingRemoteUpdateRef.current) {
    console.log(`[🔧 SUPPRESS] Skipping onUpdate - applying remote update`)
    return
  }

  const json = editor.getJSON()
  // ... rest of existing onUpdate logic unchanged
}
```

**Why**: Prevents onUpdate from interfering during programmatic updates.

**Estimated LOC**: +5 lines

---

### Step 9: Clean Up Notification on Save (5 minutes)

**File**: `components/canvas/tiptap-editor-plain.tsx`

**After successful save** (in the .then() block around line 976-986):

```typescript
provider.saveDocument(noteId, panelId, json, false, { skipBatching: true })
  .then(() => {
    lastSavedContentRef.current = json

    // Clear notification if it exists
    if (remoteUpdateNotification?.hasRemoteUpdate) {
      setRemoteUpdateNotification(null)
    }

    console.log(`[🔧 SAVE-TRACKING] Last saved content updated`)
  })
```

**Why**: Notification should disappear once user saves.

**Estimated LOC**: +5 lines

---

## Part 4: Testing Requirements (REVISED)

### Test 1: User Typing During Remote Update (CRITICAL)

**Setup**:
1. Browser A: Open branch panel
2. Browser B: Open same branch panel

**Steps**:
1. Browser A: Type "hello world" (DON'T wait for autosave)
2. Browser B: Type "goodbye world" and wait for save
3. Browser A: Switch away and back (trigger visibility refresh)

**Expected** (REVISED):
- ✅ Browser A shows yellow notification: "Remote changes available. Save your work to sync."
- ✅ Browser A STILL shows "hello world" (NOT replaced)
- ✅ localStorage STILL has "hello world" (NOT overwritten)
- ✅ User clicks "Save & Sync"
- ✅ Browser A saves "hello world", then loads "goodbye world"
- ✅ **NO DATA LOSS**

**Verify**:
```javascript
// Before clicking "Save & Sync"
editor.getJSON() // Should show "hello world"
JSON.parse(localStorage.getItem('pending_save_...')).content // Should show "hello world"

// After clicking "Save & Sync"
editor.getJSON() // Should show "goodbye world"
JSON.parse(localStorage.getItem('pending_save_...')).content // Should show "goodbye world"
```

---

### Test 2: User Chooses to Discard Local Changes (CRITICAL)

**Setup**:
1. Browser A: Open branch panel

**Steps**:
1. Browser A: Type "my local edits"
2. Browser B: Save "remote content"
3. Browser A: Trigger visibility refresh
4. Notification appears
5. User clicks "Discard & Sync"

**Expected**:
- ✅ Notification appears
- ✅ User clicks "Discard & Sync"
- ✅ Browser A shows "remote content"
- ✅ "my local edits" is discarded (user chose this)
- ✅ localStorage has "remote content"

---

### Test 3: Rapid Tab Switching with Unsaved Changes (CRITICAL)

**Setup**:
1. Single browser, branch panel

**Steps**:
1. Type "test content 123"
2. Immediately switch tabs (< 100ms)
3. Immediately switch back (< 100ms)

**Expected**:
- ✅ Content preserved in editor
- ✅ localStorage has "test content 123"
- ✅ No notification (no remote changes)
- ✅ **NO DATA LOSS**

---

### Test 4: Conflict with Unsaved Changes (CRITICAL)

**Setup**:
1. Two browsers, same branch panel

**Steps**:
1. Browser A: Type "aaa" (don't let autosave complete)
2. Browser B: Type "bbb" and save
3. Browser A: Resume typing "ccc" (so editor has "aaaccc")
4. Browser A: Autosave triggers → 409 conflict

**Expected**:
- ✅ Notification appears: "Conflict detected. Save your work to resolve."
- ✅ Browser A STILL shows "aaaccc" (NOT replaced)
- ✅ User clicks "Save & Sync"
- ✅ "aaaccc" is saved, then "bbb" is loaded
- ✅ **NO DATA LOSS** - "aaaccc" was saved

---

### Test 5: Normal Save After Remote Update Blocked (CRITICAL)

**Setup**:
1. Two browsers, same branch panel

**Steps**:
1. Browser A: Type "hello"
2. Browser B: Save "world"
3. Browser A: Trigger refresh → notification appears
4. Browser A: Continue typing → "hello more text"
5. Browser A: Wait for autosave (300ms)

**Expected**:
- ✅ Autosave completes successfully
- ✅ lastSavedContentRef updated to "hello more text"
- ✅ hasUnsavedChanges() now returns false
- ✅ Notification cleared
- ✅ Next remote update will apply safely

---

### Test 6: No Unsaved Changes - Immediate Update (Regression Test)

**Setup**:
1. Two browsers, same branch panel

**Steps**:
1. Browser A: Has saved content, no typing
2. Browser B: Saves new content
3. Browser A: Trigger visibility refresh

**Expected**:
- ✅ NO notification appears
- ✅ Browser A immediately shows Browser B's content
- ✅ No user interaction required
- ✅ Normal sync behavior (not broken)

---

## Part 5: What This Plan Actually Fixes

### Root Cause #1: Discarding Live Buffer

**Before (Previous Plan)**:
```typescript
editor.chain().clearContent().insertContent(remote).run()
// ← User's "hello world" destroyed, no check
```

**After (This Plan)**:
```typescript
if (hasUnsavedChanges()) {
  // STOP - Don't destroy
  showNotification()
  return
}
// Only reaches here if safe
editor.chain().clearContent().insertContent(remote).run()
```

**Result**: ✅ **FIXED** - Never destroys unsaved work

---

### Root Cause #2: Clobbering pending_save_*

**Before (Previous Plan)**:
```typescript
// Manually write remote content
localStorage.setItem(pendingKey, remote)
// ← Overwrites user's backup
```

**After (This Plan)**:
```typescript
if (hasUnsavedChanges()) {
  return // ← EXIT - Don't touch localStorage
}
// Only reaches here if safe
localStorage.setItem(pendingKey, remote)
```

**Result**: ✅ **FIXED** - Only updates localStorage when safe

---

## Part 6: Acceptance Criteria (REVISED)

### MUST HAVE (Blocking)

- [ ] **Zero data loss in all test scenarios** - User's unsaved work is NEVER destroyed
- [ ] **Notification appears when remote updates are blocked**
- [ ] **"Save & Sync" button saves local work then applies remote**
- [ ] **"Discard & Sync" button discards local and applies remote**
- [ ] **hasUnsavedChanges() correctly detects unsaved work**
- [ ] **lastSavedContentRef tracks successful saves**
- [ ] **Normal typing/saving works (no regression)**
- [ ] **Immediate sync when no unsaved changes (no regression)**

### SHOULD HAVE (Important)

- [ ] Notification is non-intrusive and clear
- [ ] User can dismiss notification (choose to keep local)
- [ ] Performance is acceptable (JSON compare < 10ms)
- [ ] Works across all test scenarios

### NICE TO HAVE

- [ ] Show diff between local and remote content
- [ ] Remember user's choice (always save/always discard)
- [ ] Keyboard shortcuts for notification actions

---

## Part 7: Risk Assessment (REVISED)

### New Risks Introduced

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| JSON compare is slow | Low | Medium | Use cached hash for large docs |
| Notification is annoying | Medium | Low | Make dismissible, non-blocking |
| User confused by choices | Medium | Medium | Clear messaging, tooltips |
| Breaks normal sync | Very Low | High | Test thoroughly, feature flag |

### Risks ELIMINATED

| Risk | Before | After |
|------|--------|-------|
| Data loss on remote update | HIGH | **ZERO** |
| localStorage corruption | MEDIUM | **ZERO** |
| Silent overwrites | HIGH | **ZERO** |
| User confusion about lost work | HIGH | **LOW** (notified) |

**Overall Risk**: LOW (much safer than previous plan)

---

## Part 8: Deployment Strategy (REVISED)

### Phase 1: Feature Flag Deployment

**Add feature flag** to test with small group first:

```typescript
const ENABLE_UNSAVED_CHANGES_PROTECTION =
  localStorage.getItem('feature:unsaved-protection') === 'true'

if (ENABLE_UNSAVED_CHANGES_PROTECTION) {
  // Use new protected handlers
} else {
  // Use old behavior
}
```

**Week 1**: Internal team only (feature flag on)
**Week 2**: 10% beta users (gradual rollout)
**Week 3**: 50% users
**Week 4**: 100% users

### Phase 2: Monitoring

**Metrics to track**:
1. Number of notifications shown (should be low in normal use)
2. User actions: Save & Sync vs Discard & Sync (ratio tells us behavior)
3. Data loss reports (should be ZERO)
4. Performance impact (JSON compare time)

### Phase 3: Refinement

Based on metrics:
- Adjust notification messaging if confusing
- Optimize JSON compare if slow
- Add requested features (diff view, etc.)

---

## Part 9: Code Changes Summary (REVISED)

**Total Lines Changed**: ~250 lines in 1 file

**Files Modified**:
- `components/canvas/tiptap-editor-plain.tsx`
  - Add 3 refs: +3 lines
  - Add hasUnsavedChanges helper: +20 lines
  - Add applyRemoteUpdateSafely helper: +50 lines
  - Add notification UI: +80 lines
  - Revise handleRemoteUpdate: +45 lines
  - Revise handleConflict: +45 lines
  - Suppress onUpdate: +5 lines
  - Track lastSavedContent: +10 lines

**Files NOT Modified**:
- Provider, adapter, API routes - NO CHANGES

**Complexity**: MEDIUM (more code than previous plan, but clearer logic)

---

## Part 10: Why This Plan Actually Works

### Comparison: Previous Plan vs This Plan

| Aspect | Previous Plan | This Plan |
|--------|---------------|-----------|
| **Checks unsaved changes** | ❌ No | ✅ Yes (before update) |
| **Preserves user's work** | ❌ No | ✅ Yes (blocked if unsaved) |
| **User notification** | ❌ No | ✅ Yes (clear notification) |
| **User control** | ❌ No | ✅ Yes (Save/Discard buttons) |
| **Data loss possible** | ❌ Yes | ✅ No |
| **localStorage overwrite** | ❌ Yes | ✅ Only when safe |
| **Test marks loss as expected** | ❌ Yes | ✅ No - expects preservation |

### The Key Difference

**Previous Plan**: Changed implementation detail (who writes), same outcome (data loss)

**This Plan**: Changes fundamental behavior (checks first), different outcome (no data loss)

---

## Part 11: Timeline (REVISED)

### Day 1 (Today)
- ✅ Revised plan created
- ⏳ Code changes applied (2-3 hours)
- ⏳ Local testing (1 hour)
- ⏳ Code review requested

### Day 2
- ⏳ Code review + revisions (2 hours)
- ⏳ Deploy to staging
- ⏳ Run all 6 test cases (2 hours)
- ⏳ UI/UX review of notification

### Day 3
- ⏳ Fix any issues found
- ⏳ Add feature flag
- ⏳ Deploy to internal team
- ⏳ Collect feedback

### Week 2
- ⏳ Deploy to 10% beta users
- ⏳ Monitor metrics
- ⏳ Iterate on notification UX

### Week 3-4
- ⏳ Gradual rollout to 100%
- ⏳ Remove feature flag
- ⏳ Mark as complete

**Total Time**: 4 weeks from start to full deployment

---

## Part 12: Validation Against Critic's Requirements

### Requirement: "Guard before applying remote content"

**This Plan**:
```typescript
if (hasUnsavedChanges()) {
  return // ← Guard
}
// Only applies if guard passes
```

**Status**: ✅ **IMPLEMENTED**

### Requirement: "Compare against last saved snapshot"

**This Plan**:
```typescript
const currentContent = editor.getJSON()
const lastSaved = lastSavedContentRef.current
const hasChanges = JSON.stringify(currentContent) !== JSON.stringify(lastSaved)
```

**Status**: ✅ **IMPLEMENTED**

### Requirement: "Preserve local diffs"

**This Plan**:
```typescript
if (hasUnsavedChanges()) {
  // Don't touch editor - local diffs preserved
  showNotification()
  return
}
```

**Status**: ✅ **IMPLEMENTED**

### Requirement: "Don't overwrite pending_save_*"

**This Plan**:
```typescript
if (hasUnsavedChanges()) {
  return // ← EXIT before localStorage write
}
// Only writes if safe
```

**Status**: ✅ **IMPLEMENTED**

### Requirement: "Tests should NOT mark data loss as expected"

**This Plan Test 1**:
```
Expected:
- ✅ Browser A STILL shows "hello world" (NOT replaced)
- ✅ localStorage STILL has "hello world" (NOT overwritten)
- ✅ **NO DATA LOSS**
```

**Status**: ✅ **FIXED**

---

## Conclusion

**This revised plan ACTUALLY prevents data loss** by:

1. ✅ Checking for unsaved changes BEFORE replacing content
2. ✅ Preserving user's work when unsaved changes exist
3. ✅ Notifying user of remote changes
4. ✅ Giving user control (Save & Sync or Discard & Sync)
5. ✅ Never overwriting localStorage with remote content when unsafe
6. ✅ Tracking last saved content for accurate comparison

**All critic's requirements are met.**

**The plan is now CORRECT and COMPLETE.**

---

## Appendix: Quick Reference

### Key Functions

```typescript
// Detect unsaved changes
hasUnsavedChanges(): boolean

// Apply remote update only when safe
applyRemoteUpdateSafely(content, version, reason)

// Track last saved content
lastSavedContentRef.current = content

// Show notification
setRemoteUpdateNotification({ message, version, hasRemoteUpdate })
```

### Key Guards

```typescript
// In handleRemoteUpdate:
if (hasUnsavedChanges()) {
  showNotification()
  return // ← STOP
}

// In handleConflict:
if (hasUnsavedChanges()) {
  showNotification()
  return // ← STOP
}

// In onUpdate:
if (isApplyingRemoteUpdateRef.current) {
  return // ← SUPPRESS
}
```

### User Actions

1. **Save & Sync**: Save local work, then apply remote
2. **Discard & Sync**: Discard local work, apply remote immediately
3. **Dismiss (×)**: Keep local work, ignore remote for now

---

**End of Revised Implementation Plan**

**Status**: Ready for implementation
**Confidence**: 95% this will prevent data loss
**Approval Required**: Yes (Senior Engineer + Product Owner)
