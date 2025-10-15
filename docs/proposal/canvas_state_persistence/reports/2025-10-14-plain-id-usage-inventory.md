# Plain ID Usage Inventory - Complete List

**Date**: 2025-10-14
**Purpose**: Exhaustive list of all locations that need migration to composite keys

---

## Summary

**Total Locations Found**: 80+
**Priority Files**: 10 files with critical paths
**Estimated Migration Time**: 4-6 hours

---

## dataStore.get() - 37 occurrences

### HIGH PRIORITY - Core Rendering (Must Fix First)

| File | Line | Code | Context | noteId Available? |
|------|------|------|---------|-------------------|
| `annotation-canvas-modern.tsx` | 807 | `dataStore.get('main')` | Loading state | ✅ Yes (in scope) |
| `annotation-canvas-modern.tsx` | 1106 | `dataStore.get(panelId)` | Panel creation | ✅ Yes (in scope) |
| `annotation-canvas-modern.tsx` | 1893 | `dataStore.get(storeKey)` | ✅ CORRECT | Already uses composite |
| `canvas-panel.tsx` | 957 | `dataStore.get(panelId)` | Update existing | ✅ Yes (prop) |
| `canvas-panel.tsx` | 987 | `dataStore.get(panelId)` | Update existing | ✅ Yes (prop) |
| `canvas-panel.tsx` | 1051 | `dataStore.get(panelId)` | Get store data | ✅ Yes (prop) |
| `canvas-panel.tsx` | 1292 | `dataStore.get(panelId)` | Get current | ✅ Yes (prop) |
| `canvas-panel.tsx` | 1314 | `dataStore.get(panelId)` | Get existing | ✅ Yes (prop) |
| `canvas-panel.tsx` | 1615 | `dataStore.get(currentId)` | Get current branch | ✅ Yes (prop) |
| `canvas-panel.tsx` | 2049 | `dataStore.get(panelId)?.branches` | Get branches | ✅ Yes (prop) |
| `canvas-panel.tsx` | 2056 | `dataStore.get(branchId)` | Get store child | ✅ Yes (prop) |
| `canvas-panel.tsx` | 2076 | `dataStore.get(panelId)?.branches` | Check branches | ✅ Yes (prop) |
| `canvas-panel.tsx` | 2239 | `dataStore.get(panelId)` | Ternary | ✅ Yes (prop) |

### MEDIUM PRIORITY - UI Components

| File | Line | Code | Context | noteId Available? |
|------|------|------|---------|-------------------|
| `annotation-toolbar.tsx` | 207 | `dataStore.get(panel)` | Get parent panel | ❌ Need to pass |
| `annotation-toolbar.tsx` | 224 | `dataStore.get(panel)` | Get parent panel | ❌ Need to pass |
| `connections-svg.tsx` | 20 | `dataStore.get(panel.branchId)` | Get branch for connection | ❌ Need to pass |
| `connections-svg.tsx` | 37 | `dataStore.get(toId)` | Get from branch | ❌ Need to pass |
| `connections-svg.tsx` | 38 | `dataStore.get(fromId)` | Get to branch | ❌ Need to pass |
| `branches-section.tsx` | 78 | `dataStore.get(panelId)` | Get current branch | ✅ Yes (context) |
| `branches-section.tsx` | 84 | `dataStore.get(panelId)` | Fallback | ✅ Yes (context) |
| `branches-section.tsx` | 91 | `dataStore.get(branchId)` | Get child branch | ✅ Yes (context) |
| `branch-item.tsx` | 50 | `dataStore.get(branchId)` | Get branch | ❌ Need to pass |
| `branch-item.tsx` | 56 | `dataStore.get(branchId)` | Fallback | ❌ Need to pass |
| `branch-item.tsx` | 93 | `dataStore.get(parentId)` | Get parent branch | ❌ Need to pass |
| `branch-item.tsx` | 102 | `dataStore.get(parentId)` | Get parent | ❌ Need to pass |
| `enhanced-minimap.tsx` | 83 | `dataStore.get(panel.panelId!)` | Get branch for minimap | ❌ Need to pass |
| `enhanced-minimap.tsx` | 176 | `dataStore.get(panel.panelId!)` | Get branch | ❌ Need to pass |
| `enhanced-minimap.tsx` | 473 | `dataStore.get(panel.panelId!)` | Get branch | ❌ Need to pass |
| `editor-section.tsx` | 47 | `dataStore.get(panelId)` | Get existing branch | ✅ Yes (context) |
| `editor-section.tsx` | 159 | `dataStore.get(currentId)` | Get current branch | ✅ Yes (context) |
| `floating-toolbar.tsx` | 2022 | `dataStore.get(currentPanelId)` | Get current branch | ❌ Need to pass |

### LOW PRIORITY - Context/Internal

| File | Line | Code | Context | noteId Available? |
|------|------|------|---------|-------------------|
| `canvas-context.tsx` | 252 | `dataStore.get(key)` | Get existing | ⚠️ Complex - key may already be composite |
| `canvas-context.tsx` | 294 | `dataStore.get('main')` | Get main | ❌ Need noteId from context |
| `canvas-context.tsx` | 387 | `dataStore.get(uiId)` | Get existing | ❌ Need noteId |
| `canvas-context.tsx` | 483 | `dataStore.get('main')` | Get main panel | ❌ Need noteId |
| `canvas-context.tsx` | 491 | `dataStore.get(parentId)` | Get parent | ❌ Need noteId |
| `annotation-canvas.tsx` | 171 | `dataStore.get(branchId)` | Old canvas | ⚠️ May be deprecated |

### ALREADY CORRECT ✅

| File | Line | Code | Status |
|------|------|------|--------|
| `use-canvas-hydration.ts` | 478 | `dataStore.get(storeKey)` | ✅ Uses composite |
| `use-panel-persistence.ts` | 70 | `dataStore.get(key)` | ✅ Uses composite (key = storeKey \|\| panelId) |
| `state-transaction.ts` | 109 | `dataStore.get(id)` | ✅ Receives composite from callers |

---

## dataStore.set() - 15 occurrences

### HIGH PRIORITY

| File | Line | Code | Context | noteId Available? |
|------|------|------|---------|-------------------|
| `annotation-toolbar.tsx` | 177 | `dataStore.set(branchId, branchData)` | Set branch data | ❌ Need to pass |
| `annotation-toolbar.tsx` | 231 | `dataStore.set(panel, {...})` | Set panel | ❌ Need to pass |
| `annotation-canvas-modern.tsx` | 810 | `dataStore.set('main', mainBranch)` | Set main branch | ✅ Yes (in scope) |

### MEDIUM PRIORITY

| File | Line | Code | Context | noteId Available? |
|------|------|------|---------|-------------------|
| `canvas-context.tsx` | 233 | `dataStore.set('main', {...})` | Initialize main | ❌ Need noteId |
| `canvas-context.tsx` | 271 | `dataStore.set(key, merged)` | Set merged | ⚠️ Complex |
| `canvas-context.tsx` | 297 | `dataStore.set('main', main)` | Set main | ❌ Need noteId |
| `canvas-context.tsx` | 437 | `dataStore.set(uiId, {...})` | Set UI data | ❌ Need noteId |
| `canvas-context.tsx` | 486 | `dataStore.set('main', mainPanel)` | Set main panel | ❌ Need noteId |
| `canvas-context.tsx` | 494 | `dataStore.set(parentId, parent)` | Set parent | ❌ Need noteId |
| `canvas-context.tsx` | 517 | `dataStore.set(id, data)` | Set data | ❌ Need noteId |
| `annotation-canvas.tsx` | 122 | `dataStore.set(id, data)` | Old canvas | ⚠️ May be deprecated |
| `annotation-canvas.tsx` | 175 | `dataStore.set(branchId, data)` | Old canvas | ⚠️ May be deprecated |
| `annotation-canvas.tsx` | 181 | `dataStore.set(branchId, branchData)` | Old canvas | ⚠️ May be deprecated |

### ALREADY CORRECT ✅

| File | Line | Code | Status |
|------|------|------|--------|
| `use-canvas-hydration.ts` | 479 | `dataStore.set(storeKey, ...)` | ✅ Uses composite |
| `state-transaction.ts` | 110 | `dataStore.set(id, value)` | ✅ Receives composite from callers |

---

## branchesMap.get() - 16 occurrences

### HIGH PRIORITY

| File | Line | Code | Context | noteId Available? |
|------|------|------|---------|-------------------|
| `canvas-panel.tsx` | 1050 | `branchesMap.get(panelId)` | Get provider data | ✅ Yes (prop) |
| `canvas-panel.tsx` | 1351 | `branchesMap.get(panelId)` | Get branch data | ✅ Yes (prop) |
| `canvas-panel.tsx` | 2055 | `branchesMap.get(branchId)` | Get provider child | ✅ Yes (prop) |
| `canvas-panel.tsx` | 2240 | `branchesMap.get(panelId)` | Ternary | ✅ Yes (prop) |
| `annotation-canvas-modern.tsx` | 1129 | `branchesMap.get(panelId)` | Get panel data | ✅ Yes (in scope) |
| `annotation-canvas-modern.tsx` | 1177 | `branchesMap.get(panelId)` | Get branch data | ✅ Yes (in scope) |

### MEDIUM PRIORITY

| File | Line | Code | Context | noteId Available? |
|------|------|------|---------|-------------------|
| `branches-section.tsx` | 84 | `branchesMap.get(panelId)` | Get current branch | ✅ Yes (context) |
| `branches-section.tsx` | 91 | `branchesMap.get(branchId)` | Get child branch | ✅ Yes (context) |
| `branch-item.tsx` | 56 | `branchesMap.get(branchId)` | Get branch | ❌ Need to pass |
| `branch-item.tsx` | 93 | `branchesMap.get(parentId)` | Get parent branch | ❌ Need to pass |
| `branch-item.tsx` | 120 | `branchesMap.get(branchId)` | Get branch data | ❌ Need to pass |
| `annotation-decorations.ts` | 117 | `branchesMap.get(uiId)` | Get branch data | ❌ Need to pass |
| `yjs-provider.ts` | 580 | `branchesMap.get(parentId)` | Get parent data | ⚠️ Internal provider |
| `yjs-provider.ts` | 594 | `branchesMap.get(panelId)` | Get panel data | ⚠️ Internal provider |

### ALREADY CORRECT ✅

| File | Line | Code | Status |
|------|------|------|--------|
| `use-canvas-hydration.ts` | 484 | `branchesMap.get(storeKey)` | ✅ Uses composite |
| `state-transaction.ts` | 113 | `branchesMap.get(id)` | ✅ Receives composite from callers |

---

## branchesMap.set() - 9 occurrences

### HIGH PRIORITY

| File | Line | Code | Context | noteId Available? |
|------|------|------|---------|-------------------|
| `canvas-panel.tsx` | 1355 | `branchesMap.set(panelId, branchData)` | Set branch data | ✅ Yes (prop) |
| `canvas-panel.tsx` | 1358 | `branchesMap.set(panelId, updatedData)` | Set updated data | ✅ Yes (prop) |
| `annotation-canvas-modern.tsx` | 1139 | `branchesMap.set(panelId, panelData)` | Set panel data | ✅ Yes (in scope) |

### MEDIUM PRIORITY

| File | Line | Code | Context | noteId Available? |
|------|------|------|---------|-------------------|
| `branch-item.tsx` | 123 | `branchesMap.set(branchId, branchData)` | Set branch data | ❌ Need to pass |
| `yjs-provider.ts` | 574 | `branchesMap.set(branchId, branchData)` | Set branch data | ⚠️ Internal provider |
| `yjs-provider.ts` | 660 | `branchesMap.set(key, value)` | Set value | ⚠️ Internal provider |
| `yjs-provider.ts` | 673 | `branchesMap.set(key, value)` | Set value | ⚠️ Internal provider |

### ALREADY CORRECT ✅

| File | Line | Code | Status |
|------|------|------|--------|
| `use-canvas-hydration.ts` | 485 | `branchesMap.set(storeKey, ...)` | ✅ Uses composite |
| `state-transaction.ts` | 114 | `branchesMap.set(id, value)` | ✅ Receives composite from callers |

---

## layerManager Operations - 7 occurrences

### HIGH PRIORITY

| File | Line | Code | Context | noteId Available? |
|------|------|------|---------|-------------------|
| `component-panel.tsx` | 230 | `layerManager.updateNode(id, ...)` | Update component position | ❌ Components don't have noteId |
| `use-layer-manager.ts` | 192 | `layerManager.removeNode(id)` | Remove node | ⚠️ ID passed from caller |
| `use-layer-manager.ts` | 204 | `layerManager.getNode(id)` | Get node | ⚠️ ID passed from caller |

### ALREADY CORRECT ✅

| File | Line | Code | Status |
|------|------|------|--------|
| `use-canvas-hydration.ts` | 490 | `layerManager.getNode(storeKey)` | ✅ Uses composite |
| `use-canvas-hydration.ts` | 491 | `layerManager.updateNode(storeKey, ...)` | ✅ Uses composite |
| `state-transaction.ts` | 117 | `layerManager.getNode(id)` | ✅ Receives composite from callers |
| `state-transaction.ts` | 118 | `layerManager.updateNode(id, value)` | ✅ Receives composite from callers |

---

## Migration Strategy

### Phase 1: Core Rendering (Blockers) - ~2 hours

**Priority 1 Files** (noteId already available):
1. `annotation-canvas-modern.tsx` - 3 locations (lines 807, 1106)
2. `canvas-panel.tsx` - 13 locations (all have noteId prop)

**Approach**:
- Import `ensurePanelKey` at top of file
- Add `noteId` prop if not present
- Replace: `dataStore.get(panelId)` → `dataStore.get(ensurePanelKey(noteId, panelId))`
- Replace: `dataStore.set(panelId, data)` → `dataStore.set(ensurePanelKey(noteId, panelId), data)`

### Phase 2: UI Components (Medium Priority) - ~2 hours

**Files needing noteId parameter**:
- `annotation-toolbar.tsx` (2 get)
- `connections-svg.tsx` (3 get) - may need to pass via CanvasItem
- `branch-item.tsx` (4 get, 1 set)
- `enhanced-minimap.tsx` (3 get)
- `floating-toolbar.tsx` (1 get)

**Approach**:
- Trace where components are instantiated
- Add `noteId` prop to component interfaces
- Pass `noteId` from parent (likely annotation-canvas-modern.tsx)
- Apply composite key migration

### Phase 3: Context Layer (Complex) - ~1-2 hours

**Files with complex key management**:
- `canvas-context.tsx` - 11 locations
  - May need `currentNoteId` state in context
  - Some keys may already be composite (need to check)

**Approach**:
- Add `currentNoteId` to CanvasContext state
- Update when note changes
- Use for all store operations

### Phase 4: Deprecated/Internal Files (Optional)

**Files that may be deprecated**:
- `annotation-canvas.tsx` - old canvas implementation?
- Check if these are still in use before migrating

**Provider internals**:
- `yjs-provider.ts` - internal Yjs operations
- May need special handling for multi-note support

---

## Testing Checkpoints

After each phase:

1. **Type-check**: `npm run type-check` must pass
2. **Lint**: `npm run lint` must pass
3. **Manual test**: Open note, drag panel, reload
4. **Database check**: Verify composite keys in panels table

---

## Risk Mitigation

**Before starting migration**:
1. Create git branch: `git checkout -b fix/stage1-composite-keys-reader-migration`
2. Commit gap analysis: `git add docs/proposal && git commit -m "docs: stage 1 gap analysis"`
3. Create backups of modified files with `.before-reader-migration.bak` suffix

**During migration**:
- Migrate one file at a time
- Test after each file
- Commit incrementally

**If something breaks**:
- Revert last commit: `git reset --hard HEAD~1`
- Review the backup file
- Fix and retry

---

**Next Action**: Start with Phase 1 - Core Rendering (annotation-canvas-modern.tsx)
