# Branch Panel Cross-Browser Sync Fix

**Date**: 2025-10-10
**Issue**: Branch panels show stale content across different browsers while main panel syncs correctly
**Root Cause**: Branch panels always load from localStorage snapshot without checking provider version
**Status**: Fix identified, ready to implement

---

## Problem Description

**Observed Behavior**:
- **Same browser (Chrome tabs)**: Both main and branch sync ✅
- **Cross-browser**:
  - Main panel syncs ✅
  - Branch panels DON'T sync (show old content) ❌

**User Impact**: When editing branch content in Chrome, then opening Firefox, Firefox shows outdated branch content while main panel shows correct content.

---

## Root Cause Analysis

### Main Panel Loading (Works Correctly)

**File**: `components/annotation-canvas-modern.tsx:361-368`

```typescript
if (plainProvider && providerVersion > 0 && providerHasContent) {
  console.log('[AnnotationCanvas] Skipping snapshot restore: provider already has fresh content', {
    providerVersion,
    savedAt: snapshot.savedAt,
    items: snapshot.items.length,
  })
  setIsStateLoaded(true)
  return  // ← SKIPS stale snapshot if provider has content
}
```

**How it works**:
1. Check provider for main panel content (line 315: `providerVersion = plainProvider.getDocumentVersion(noteId, 'main')`)
2. If provider has content (`providerVersion > 0 && providerHasContent`), skip snapshot
3. Provider cache is empty in new browser → loads from database → fresh ✅

---

### Branch Panel Loading (BROKEN)

**File**: `components/canvas/canvas-context.tsx:238-256`

```typescript
// Pre-populate additional branches from cache before remote load
snapshotMap.forEach((value, key) => {
  if (key === 'main') return
  const cachedBranch = value as Record<string, any>
  dataStore.set(key, {
    id: key,
    type: cachedBranch.type,
    title: cachedBranch.title || '',
    originalText: cachedBranch.originalText || '',  // ← STALE from localStorage!
    content: cachedBranch.content,                   // ← STALE from localStorage!
    preview: cachedBranch.preview || '',
    hasHydratedContent: cachedBranch.hasHydratedContent ?? false,
    branches: cachedBranch.branches || [],
    parentId: cachedBranch.parentId ?? 'main',
    position: cachedBranch.position || { x: 2500 + Math.random() * 500, y: 1500 + Math.random() * 500 },
    dimensions: cachedBranch.dimensions || { width: 400, height: 300 },
    isEditable: cachedBranch.isEditable ?? true,
    metadata: { displayId: key }
  })
})
```

**Problem**:
1. **NO version check** for branch panels
2. **ALWAYS** uses snapshot `originalText` and `content` from localStorage
3. Snapshot contains stale data from previous browser session
4. Even when provider has fresh data from database, snapshot takes precedence

**Result**: Branch panels show old content across browsers ❌

---

## The Fix

Add the same version check for branch panels that main panel uses.

### Implementation

**File**: `components/canvas/canvas-context.tsx`

**Location**: Before line 238 (before the `snapshotMap.forEach`)

**Add this code**:

```typescript
// Pre-populate additional branches from cache before remote load
// BUT skip branches where provider has fresher content (same logic as main panel)
snapshotMap.forEach((value, key) => {
  if (key === 'main') return

  const cachedBranch = value as Record<string, any>

  // NEW: Check if provider has fresher content for this branch
  let shouldSkipSnapshot = false
  if (plainProvider) {
    try {
      const branchProviderVersion = plainProvider.getDocumentVersion(noteId, key)
      const branchProviderContent = plainProvider.getDocument(noteId, key)
      const providerHasContent = branchProviderContent ? !plainProvider.isEmptyContent(branchProviderContent) : false

      if (branchProviderVersion > 0 && providerHasContent) {
        console.log(`[CanvasContext] Skipping snapshot for branch ${key}: provider has fresh content`, {
          branchId: key,
          providerVersion: branchProviderVersion,
          snapshotSavedAt: cachedBranch.savedAt
        })
        shouldSkipSnapshot = true
      }
    } catch (err) {
      console.warn(`[CanvasContext] Failed to check provider for branch ${key}:`, err)
    }
  }

  // Skip if provider has fresher data
  if (shouldSkipSnapshot) {
    return
  }

  // Otherwise, use snapshot (existing logic)
  dataStore.set(key, {
    id: key,
    type: cachedBranch.type,
    title: cachedBranch.title || '',
    originalText: cachedBranch.originalText || '',
    content: cachedBranch.content,
    preview: cachedBranch.preview || '',
    hasHydratedContent: cachedBranch.hasHydratedContent ?? false,
    branches: cachedBranch.branches || [],
    parentId: cachedBranch.parentId ?? 'main',
    position: cachedBranch.position || { x: 2500 + Math.random() * 500, y: 1500 + Math.random() * 500 },
    dimensions: cachedBranch.dimensions || { width: 400, height: 300 },
    isEditable: cachedBranch.isEditable ?? true,
    metadata: { displayId: key }
  })
})
```

---

## How the Fix Works

### Before Fix (Current Behavior)

**Browser A (Chrome)**:
1. Edit branch panel → saves to database (version 112)
2. Saves to localStorage snapshot

**Browser B (Firefox)**:
1. Opens note → provider cache is EMPTY
2. Loads branch from localStorage snapshot (version 111 - STALE)
3. Editor shows old content ❌

### After Fix (Expected Behavior)

**Browser A (Chrome)**:
1. Edit branch panel → saves to database (version 112)
2. Saves to localStorage snapshot

**Browser B (Firefox)**:
1. Opens note → provider cache is EMPTY
2. **Checks provider for branch content** → provider fetches from DB
3. **Provider has version 112** → skips stale snapshot ✅
4. Editor calls `loadDocument(noteId, branchId)` → loads version 112 from DB
5. Editor shows fresh content ✅

---

## Testing Plan

### Manual Testing

**Test 1: Cross-Browser Branch Sync**
1. **Chrome**: Create note with branch panel
2. **Chrome**: Edit branch content: "Test from Chrome v1"
3. **Chrome**: Wait 2 seconds (autosave)
4. **Firefox**: Open same note
5. **Expected**: Branch shows "Test from Chrome v1" ✅

**Test 2: Multiple Edits**
1. **Chrome**: Edit branch: "Test v2"
2. **Safari**: Open note
3. **Expected**: Branch shows "Test v2" ✅
4. **Safari**: Edit branch: "Test v3"
5. **Chrome**: Reload page
6. **Expected**: Chrome shows "Test v3" ✅

**Test 3: Main Panel Still Works**
1. **Chrome**: Edit main panel: "Main content"
2. **Firefox**: Open note
3. **Expected**: Main panel shows "Main content" ✅ (regression test)

---

## Validation

### Before Implementation

```bash
# Verify current behavior
# 1. Edit branch in Chrome
# 2. Open Firefox
# Expected: Shows old branch content ❌
```

### After Implementation

```bash
# Run type-check
npm run type-check  # Must pass

# Run lint
npm run lint  # Must pass

# Manual test
# 1. Edit branch in Chrome
# 2. Open Firefox
# Expected: Shows new branch content ✅
```

---

## Risks and Mitigations

### Risk 1: Performance Impact
**Risk**: Checking provider version for every branch on load
**Mitigation**:
- Same logic already used for main panel (proven safe)
- Provider checks are in-memory (fast)
- Only runs once on note load

### Risk 2: Provider Not Ready
**Risk**: Provider might not be initialized when snapshot loads
**Mitigation**:
- Wrapped in try/catch
- Falls back to snapshot if provider check fails
- Same pattern as main panel

### Risk 3: Breaks Same-Browser Sync
**Risk**: Might break Chrome tab-to-tab sync
**Mitigation**:
- Same-browser tabs share database connection
- Provider will have correct version
- Fix only affects cross-browser case

---

## Alternative Approaches Considered

### Approach 1: Wire `document:remote-update` Listener
**Pros**: Would also fix conflict error handling
**Cons**: More complex, requires editor component changes
**Decision**: Save for later, this fix is simpler and targeted

### Approach 2: Force Provider Reload on Visibility
**Pros**: Simple
**Cons**: Performance impact, unnecessary reloads
**Decision**: Not needed, version check is sufficient

### Approach 3: Remove Snapshot System
**Pros**: Eliminates stale data source
**Cons**: Breaks offline support, major refactor
**Decision**: Keep snapshot, just add version guard

---

## Implementation Checklist

- [ ] Read `components/canvas/canvas-context.tsx` completely
- [ ] Add version check logic before `snapshotMap.forEach` (line 238)
- [ ] Test in Chrome → Firefox scenario
- [ ] Test in Firefox → Safari scenario
- [ ] Test same-browser sync still works
- [ ] Run `npm run type-check`
- [ ] Run `npm run lint`
- [ ] Create verification report with test results

---

## Expected Impact

**Before**:
- Main panel: ✅ Cross-browser sync
- Branch panels: ❌ Stale content across browsers

**After**:
- Main panel: ✅ Cross-browser sync (unchanged)
- Branch panels: ✅ Cross-browser sync (FIXED)

---

## Next Steps

1. Implement the fix in `components/canvas/canvas-context.tsx`
2. Test cross-browser scenarios
3. Verify no regressions in same-browser sync
4. Update this report with test results
5. Consider adding automated test for cross-browser sync

---

**Status**: Ready to implement
**Estimated Time**: 15 minutes implementation + 15 minutes testing
**Files to Modify**: 1 file (`components/canvas/canvas-context.tsx`)
