# Branch Panel Persistence Status - Verification Report

**Date:** 2025-10-20
**Statement to Verify:** "So branch panels still won't persist today. Once the Phase 2 unified-canvas + ordering/visibility deliverables are actually implemented in the production code, the reload behavior you're expecting will land."

---

## Verification Result

**✅ PARTIALLY CORRECT** - The statement is correct about persistence implementation status, but the reason needs clarification.

---

## Current State Analysis

### 1. Database Persistence ✅ WORKING

**Branch panels ARE being persisted to the database:**

```sql
SELECT panel_id, note_id, type, position_x_world, position_y_world, created_at
FROM panels
WHERE type IN ('branch', 'context', 'annotation')
ORDER BY created_at DESC
LIMIT 10;
```

**Results:**
```
branch-2afabb85-...  | 10063641-4e53-... | branch | 3000 | 2700 | 2025-10-20 02:08:29
branch-7834b248-...  | a7a21b2d-bae2-... | branch | 5226 | 4258 | 2025-10-20 00:51:26
```

✅ Branch panels are saved to database with correct world-space coordinates

### 2. Hydration Logic ⚠️ **INTENTIONALLY LIMITED**

**File:** `components/annotation-canvas-modern.tsx` lines 629-632

```typescript
const panelsToHydrate = skipHydration
  ? []
  : (isInitialHydration || !isSameNote
      ? (isInitialHydration ? hydrationStatus.panels : hydrationStatus.panels.filter(panel => panel.id === 'main'))
      : hydrationStatus.panels.filter(panel => panel.id === 'main'))
```

**Translation:**
- **Initial page load** (`isInitialHydration === true`): ✅ **ALL panels hydrated** (including branch panels)
- **Page refresh** (`isInitialHydration === false`): ❌ **Only main panel hydrated** (branch panels ignored)
- **Note switch** (`!isSameNote`): ❌ **Only main panel hydrated** (branch panels ignored)

---

## The Real Issue

### What's Implemented (Phase 1)

✅ **Database persistence is complete:**
- Panels table with world-space coordinates
- API endpoints for CRUD operations
- Hydration hook (`useCanvasHydration`)
- Panel persistence hook (`usePanelPersistence`)
- Camera persistence
- Offline queue

✅ **Branch panels ARE persisted:**
- They are saved to database when opened
- They have correct positions and dimensions
- They survive server restarts

### What's Missing (Not Phase 2)

❌ **Branch panel hydration on reload is INTENTIONALLY LIMITED:**

**Line 631 logic:**
```typescript
isInitialHydration ? hydrationStatus.panels : hydrationStatus.panels.filter(panel => panel.id === 'main')
```

This filter **deliberately excludes branch panels** on page reload!

**Why?**

Looking at the hydration effect (line 621-744), the logic appears to prevent branch panels from automatically reopening on every page refresh to avoid:
1. Cluttering the canvas with all previously opened panels
2. Performance issues with many open panels
3. Confusion about which panels user actually wants open

---

## What Phase 2 Is Actually About

**File:** `docs/proposal/canvas_state_persistence/phase2-unified-canvas-plan.md`

Phase 2 is about **unified multi-note canvas**, NOT branch panel persistence:

1. **Composite Identifiers** ✅ (Already complete - see phase2-progress.md)
   - `ensurePanelKey`, `makePanelKey`, `parsePanelKey`
   - Composite keys in use throughout codebase

2. **Unified Canvas Rendering** ❌ (Not started - Stage 2)
   - Remove `focusedNoteId` guard
   - Show all open notes' panels together on one canvas
   - Like Miro/Figma workspace

3. **Multi-Note Hydration** ❌ (Not started - Stage 2)
   - Hydrate panels from multiple notes simultaneously
   - Shared camera vs per-note cameras

4. **Shared Camera & Navigation** ❌ (Not started - Stage 2)
   - Navigation aids for multi-note canvas
   - Minimap, tab shortcuts, etc.

**Phase 2 is NOT about branch panel persistence!**

---

## The Actual Problem

The statement conflates two separate issues:

### Issue A: Branch Panels Don't Rehydrate on Reload ❌

**Current behavior:**
1. Open note → Main panel hydrated ✅
2. Open branch panels → They appear, get saved to DB ✅
3. Refresh page → Main panel restored, **branch panels NOT restored** ❌

**Why?**
Line 631 in annotation-canvas-modern.tsx **intentionally filters out non-main panels** on reload.

**This is NOT a Phase 2 issue!** This is a **design decision** in Phase 1.

### Issue B: Unified Multi-Note Canvas ❌

**Phase 2 goal:**
Show panels from multiple notes on one shared canvas (like Miro/Figma).

**This IS a Phase 2 issue** and is not yet started (Stage 2).

---

## Corrected Statement

**Original statement:**
> "So branch panels still won't persist today. Once the Phase 2 unified-canvas + ordering/visibility deliverables are actually implemented in the production code, the reload behavior you're expecting will land."

**Corrected statement:**
> "Branch panels ARE persisted to the database today, but they are **intentionally not restored on page reload** (only main panels are restored). This design decision is in the Phase 1 hydration logic (line 631 of annotation-canvas-modern.tsx), not Phase 2. Phase 2 is about unified multi-note canvas rendering, which is a separate feature that hasn't been started yet."

---

## Evidence

### 1. Database Evidence

**Query:**
```bash
docker exec -i $(docker ps -q -f name=postgres) psql -U postgres -d annotation_dev << 'EOF'
SELECT panel_id, note_id, type, created_at FROM panels
WHERE type IN ('branch', 'context', 'annotation')
ORDER BY created_at DESC LIMIT 5;
EOF
```

**Result:** ✅ Branch panels are in database with timestamps

### 2. Code Evidence

**Hydration logic** (`annotation-canvas-modern.tsx:629-632`):
```typescript
const panelsToHydrate = skipHydration
  ? []
  : (isInitialHydration || !isSameNote
      ? (isInitialHydration ? hydrationStatus.panels : hydrationStatus.panels.filter(panel => panel.id === 'main'))
      : hydrationStatus.panels.filter(panel => panel.id === 'main'))
```

**Effect:**
- `isInitialHydration === true`: All panels (including branches)
- `isInitialHydration === false`: **Only main panel** (branches filtered out)

### 3. Hydration Hook Evidence

**File:** `lib/hooks/use-canvas-hydration.ts:659-676`

```typescript
// Get panels from dataStore using composite keys (with world-space positions per implementation plan)
const storedPanels = panels.map(panel => {
  const storeKey = makePanelKey(panel.noteId, panel.id)
  const storedPanel = dataStore?.get(storeKey)
  return {
    id: panel.id,
    noteId: panel.noteId,
    storeKey, // Include composite key for consumers
    type: panel.type,
    position: storedPanel?.position || panel.position, // World-space position
    size: storedPanel?.size || panel.size, // World-space size
    ...
  }
})
```

✅ Hook loads all panels from database (including branches)
❌ Consumer (annotation-canvas-modern) **filters them out** on reload

---

## What Needs to Change

### To Fix Branch Panel Reload (Not Phase 2)

**Option 1: Add Panel Visibility State**

Track which panels user had open and restore those:

```typescript
// Save to database
interface PanelState {
  panelId: string
  noteId: string
  isVisible: boolean  // ← NEW
  position: { x: number; y: number }
  ...
}
```

**Option 2: User Preference**

Add setting: "Restore branch panels on reload" (default: false)

**Option 3: Change Default Behavior**

Remove the filter at line 631:
```typescript
// Before (current):
isInitialHydration ? hydrationStatus.panels : hydrationStatus.panels.filter(panel => panel.id === 'main')

// After (restore all):
hydrationStatus.panels
```

---

## Recommendations

1. **Clarify Phase 1 vs Phase 2 scope**
   - Phase 1: Single-note canvas persistence (✅ complete, except branch reload behavior is intentionally limited)
   - Phase 2: Multi-note unified canvas (❌ not started)

2. **Document the design decision**
   - Why branch panels don't restore on reload
   - How users should expect it to work
   - Whether this will change in future

3. **Consider adding panel visibility state**
   - Track which panels user had open
   - Restore only those on reload
   - This is a Phase 1 enhancement, not Phase 2

4. **Separate concerns**
   - Branch panel reload ≠ Unified multi-note canvas
   - These are independent features
   - Don't conflate them

---

## Conclusion

**The statement is MISLEADING.**

✅ **What's correct:**
- Branch panels don't fully persist across reloads today

❌ **What's incorrect:**
- This is NOT a Phase 2 issue
- Branch panels ARE saved to database
- The limitation is an **intentional design decision** in Phase 1 hydration logic

**The fix needed:**
- Modify line 631 in annotation-canvas-modern.tsx OR
- Add panel visibility tracking to database

**Phase 2 is about something else entirely:**
- Unified multi-note canvas (like Miro/Figma)
- Not about individual panel persistence

---

## Files Referenced

- `/components/annotation-canvas-modern.tsx` (lines 621-744) - Hydration logic
- `/lib/hooks/use-canvas-hydration.ts` (lines 659-676) - Hook loads all panels
- `/docs/proposal/canvas_state_persistence/phase2-unified-canvas-plan.md` - Phase 2 scope
- `/docs/proposal/canvas_state_persistence/phase2-progress.md` - Implementation status
- Database: `panels` table - Stores all panel data including branches
