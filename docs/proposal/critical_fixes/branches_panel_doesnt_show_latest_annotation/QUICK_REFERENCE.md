# Quick Reference: Branches Panel Bug Fix

## TL;DR

**Problem:** New annotations weren't showing in branches panel until reload

**Root Cause:** `canvas-panel.tsx` `handleUpdate()` was spreading entire object and overwriting the `branches` array with stale data

**Solution:** Only update specific fields in `handleUpdate()`, don't spread entire object

---

## The Fix (One Line Summary)

**File:** `components/canvas/canvas-panel.tsx` (line 1025)

**Before:**
```typescript
const updatedData = { ...currentBranch, content: payload, ... }
```

**After:**
```typescript
const updatedData = { content: payload, preview, metadata, type, position }
```

**Why:** Spreading `...currentBranch` included stale `branches` array, overwriting newly created annotations

---

## Affected Files

1. **`components/canvas/canvas-panel.tsx`** - PRIMARY FIX (handleUpdate function)
2. `lib/data-store.ts` - Debug logging (can be removed)
3. `components/canvas-aware-floating-toolbar.tsx` - Debug logging (can be removed)
4. `components/floating-toolbar.tsx` - Debug logging (can be removed)
5. `components/canvas/annotation-toolbar.tsx` - Debug logging (can be removed)
6. `components/canvas/canvas-context.tsx` - Debug logging (can be removed)
7. `components/canvas/branches-section.tsx` - Debug logging (can be removed)

---

## Verification

✅ Create annotation → appears immediately in branches panel (NO RELOAD NEEDED)

---

## See Also

- Full report: `BUG_FIX_REPORT.md`
- Architecture improvements completed during this fix documented in full report
