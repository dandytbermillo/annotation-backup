# Implementation Plan Corrections – Panel Resize Handles

**Date:** 2025-10-27
**Purpose:** Corrected code and guidance to fix critical issues in `implementation_plan.md`
**Based on:** `VERIFICATION_REPORT.md` findings
**Status:** Ready to apply

---

## How to Use This Document

This document provides **corrected versions** of all problematic sections identified in the verification report. Apply these corrections to `implementation_plan.md` before implementation.

**Correction Priority:**
- 🔴 **CRITICAL** - Must fix (will cause implementation failure)
- 🟡 **MAJOR** - Should fix (will cause issues)
- 🟢 **MINOR** - Nice to fix (documentation quality)

---

## 🔴 CRITICAL CORRECTION #1: Remove Phase 2 (Database Migration)

### Location
**Section:** Phase 2 (Database Schema Migration)
**Lines:** Entire phase

### Problem
The `dimensions` column **already exists** in the database. Migration will fail.

### Current Database Schema
```sql
-- ACTUAL schema (verified 2025-10-27)
Table "public.panels"
      Column      |            Type             | Default
------------------+-----------------------------+------------------------------------------
 dimensions       | jsonb                       | '{"width": 400, "height": 300}'::jsonb
 width_world      | numeric                     | 400
 height_world     | numeric                     | 300
```

### CORRECTION: Delete Phase 2 Entirely

**REMOVE this entire section:**
```markdown
## Phase 2: Database Schema Migration

**Objective:** Add `dimensions` column to `panels` table.

**Migration File:** `migrations/XXX_add_panel_dimensions.sql`

```sql
ALTER TABLE panels
ADD COLUMN dimensions JSONB DEFAULT '{"width": 600, "height": 500}';
```
```

**REPLACE with:**
```markdown
## Phase 2: Verify Existing Database Schema

**Objective:** Confirm existing `dimensions` column is compatible.

**Current Schema (Verified 2025-10-27):**
```sql
Table "public.panels"
 dimensions       | jsonb  | '{"width": 400, "height": 300}'::jsonb
 width_world      | numeric | 400
 height_world     | numeric | 300
```

**Notes:**
- ✅ `dimensions` column already exists (JSONB)
- ⚠️ Database default is 400×300 (differs from app defaults)
- ✅ No migration needed
- 📝 Consider updating database default to match `DEFAULT_PANEL_DIMENSIONS` (520×440) in future

**Verification Command:**
```sql
-- Run this to verify schema
PGPASSWORD=postgres psql -h localhost -U postgres -d annotation_dev -c "\d panels"
```

**Action:** None required for this phase. Proceed to Phase 3.
```

---

## 🔴 CRITICAL CORRECTION #2: Fix persistPanelUpdate API Usage

### Location
**Section:** Phase 4.2 (Resize MouseMove Handler)
**Lines:** 524-526

### Problem
Function signature is wrong. Actual function takes a `PanelUpdateData` object, not `(storeKey, branch)`.

### INCORRECT Code
```typescript
// ❌ WRONG - This will cause TypeScript error
persistPanelUpdate(storeKey, branch)
```

### CORRECTED Code
```typescript
// ✅ CORRECT - Use PanelUpdateData interface
persistPanelUpdate({
  panelId: panelId,           // Required: panel identifier
  storeKey: storeKey,          // Optional: dataStore key
  size: {                      // Use "size" field, NOT "dimensions"
    width: newWidth,
    height: newHeight
  },
  position: {                  // Include position if changed (corner resize)
    x: newX,
    y: newY
  },
  coordinateSpace: 'world'     // REQUIRED: specify coordinate system
})
```

### Full Context (Phase 4.2 - Lines 500-530)

**REPLACE entire resize handler section with:**
```typescript
// CORRECTED: Phase 4.2 - Resize MouseMove Handler

const handleResizeMove = useCallback((e: MouseEvent) => {
  if (!isResizing || !resizeDirection) return

  const dx = (e.clientX - resizeStart.mouseX) / zoom  // Convert to world space
  const dy = (e.clientY - resizeStart.mouseY) / zoom

  let newWidth = resizeStart.width
  let newHeight = resizeStart.height
  let newX = resizeStart.x
  let newY = resizeStart.y

  // Calculate new dimensions based on resize direction
  if (resizeDirection.includes('e')) {
    newWidth = Math.max(MIN_PANEL_WIDTH, resizeStart.width + dx)
  }
  if (resizeDirection.includes('w')) {
    const widthChange = Math.min(dx, resizeStart.width - MIN_PANEL_WIDTH)
    newWidth = resizeStart.width - widthChange
    newX = resizeStart.x + widthChange
  }
  if (resizeDirection.includes('s')) {
    newHeight = Math.max(MIN_PANEL_HEIGHT, resizeStart.height + dy)
  }
  if (resizeDirection.includes('n')) {
    const heightChange = Math.min(dy, resizeStart.height - MIN_PANEL_HEIGHT)
    newHeight = resizeStart.height - heightChange
    newY = resizeStart.y + heightChange
  }

  // Update local state (for immediate visual feedback)
  const updatedBranch: Branch = {
    ...branch,
    dimensions: { width: newWidth, height: newHeight },
    position: { x: newX, y: newY }
  }

  // ✅ CORRECT: Use dataStore.set for immediate update
  dataStore.set(storeKey, updatedBranch)

  // ✅ CORRECT: Persist with correct API signature
  persistPanelUpdate({
    panelId: panelId,
    storeKey: storeKey,
    size: { width: newWidth, height: newHeight },    // Use "size" not "dimensions"
    position: { x: newX, y: newY },
    coordinateSpace: 'world'                         // REQUIRED
  })
}, [isResizing, resizeDirection, resizeStart, zoom, branch, storeKey, panelId, dataStore, persistPanelUpdate])
```

### API Reference
```typescript
// From lib/hooks/use-panel-persistence.ts
export interface PanelUpdateData {
  panelId: string                                    // Required
  storeKey?: string                                  // Optional
  position?: { x: number; y: number }                // Optional
  size?: { width: number; height: number }           // ← NOT "dimensions"
  zIndex?: number                                    // Optional
  state?: string                                     // Optional
  coordinateSpace?: 'screen' | 'world'               // Optional but recommended
  expectedRevision?: string                          // Optional (optimistic locking)
}

// Function signature
const persistPanelUpdate: (update: PanelUpdateData) => Promise<void>
```

---

## 🔴 CRITICAL CORRECTION #3: Update All Default Dimensions

### Problem
Plan states default dimensions are 600×500 throughout. Actual defaults vary by source.

### Actual Default Values (Verified 2025-10-27)

```typescript
// lib/canvas/panel-metrics.ts (Line 25)
const DEFAULT_PANEL_DIMENSIONS = { width: 520, height: 440 }

// Database default
dimensions = '{"width": 400, "height": 300}'

// Type-specific widths (lib/models/annotation.ts)
getDefaultPanelWidth('note')    // 380
getDefaultPanelWidth('explore') // 500
getDefaultPanelWidth('promote') // 550
getDefaultPanelWidth('main')    // 600
```

### CORRECTIONS Required

#### Location 1: Phase 1.1 (Update TypeScript Interface)
**Line ~40**

**INCORRECT:**
```typescript
dimensions?: { width: number; height: number }  // e.g., {width: 600, height: 500}
```

**CORRECT:**
```typescript
dimensions?: { width: number; height: number }  // Defaults: 520×440 (DEFAULT_PANEL_DIMENSIONS)
                                                 // Database default: 400×300
                                                 // Type-specific widths: note=380, explore=500, promote=550, main=600
```

#### Location 2: Phase 3 (State Management)
**Line ~100**

**INCORRECT:**
```typescript
const DEFAULT_WIDTH = 600
const DEFAULT_HEIGHT = 500
```

**CORRECT:**
```typescript
// Import from panel-metrics instead of hardcoding
import { DEFAULT_PANEL_DIMENSIONS } from '@/lib/canvas/panel-metrics'

const MIN_PANEL_WIDTH = 300
const MIN_PANEL_HEIGHT = 200

// Use imported constant
const effectiveWidth = branch.dimensions?.width ?? DEFAULT_PANEL_DIMENSIONS.width   // 520
const effectiveHeight = branch.dimensions?.height ?? DEFAULT_PANEL_DIMENSIONS.height // 440
```

#### Location 3: Phase 5.1 (Resize Handle Rendering)
**Line ~605**

**INCORRECT:**
```typescript
// Default to 600×500 if no dimensions
const width = branch.dimensions?.width ?? 600
const height = branch.dimensions?.height ?? 500
```

**CORRECT:**
```typescript
import { DEFAULT_PANEL_DIMENSIONS } from '@/lib/canvas/panel-metrics'

// Use constant instead of hardcoded value
const width = branch.dimensions?.width ?? DEFAULT_PANEL_DIMENSIONS.width
const height = branch.dimensions?.height ?? DEFAULT_PANEL_DIMENSIONS.height
```

#### Location 4: Phase 6 (Database Persistence)
**Section description**

**INCORRECT:**
```markdown
When a panel is resized, persist the new dimensions (default: 600×500).
```

**CORRECT:**
```markdown
When a panel is resized, persist the new dimensions.

**Default dimension sources:**
- Application constant: `DEFAULT_PANEL_DIMENSIONS` = 520×440 (`lib/canvas/panel-metrics.ts`)
- Database default: 400×300 (`panels.dimensions` column default)
- Type-specific widths: Set by `getDefaultPanelWidth()` when panel is created
  - note: 380px
  - explore: 500px
  - promote: 550px
  - main: 600px

**Note:** Height is always 440px by default unless specified. Type-specific defaults only apply to width.
```

---

## 🟡 MAJOR CORRECTION #4: Add Coordinate Space Specification

### Location
**Section:** Phase 4.2 (Resize MouseMove Handler)
**Multiple locations**

### Problem
Resize calculations use world coordinates but don't specify `coordinateSpace` when persisting.

### Why This Matters
The persistence layer needs to know if you're passing screen pixels or world coordinates:
- **Screen coordinates:** Raw pixel values from mouse events
- **World coordinates:** Values divided by zoom, adjusted for pan

### CORRECTION

**In all `persistPanelUpdate` calls, add:**
```typescript
coordinateSpace: 'world'  // Since we divide by zoom
```

**Example (Phase 4.2):**
```typescript
// Calculate in world space
const dx = (e.clientX - resizeStart.mouseX) / zoom  // ← Division by zoom = world space
const dy = (e.clientY - resizeStart.mouseY) / zoom

// ... calculation ...

// MUST specify coordinate space when persisting
persistPanelUpdate({
  panelId,
  storeKey,
  size: { width: newWidth, height: newHeight },
  position: { x: newX, y: newY },
  coordinateSpace: 'world'  // ← REQUIRED
})
```

**If you were using screen coordinates (not recommended for resize):**
```typescript
// Screen space (no zoom division)
const dx = e.clientX - resizeStart.mouseX  // ← No zoom = screen space
const dy = e.clientY - resizeStart.mouseY

persistPanelUpdate({
  panelId,
  storeKey,
  size: { width: newWidth, height: newHeight },
  position: { x: newX, y: newY },
  coordinateSpace: 'screen'  // ← Specify screen if using screen coords
})
```

**Rule of Thumb:**
- Did you divide by `zoom`? → `coordinateSpace: 'world'`
- Raw pixel values from mouse event? → `coordinateSpace: 'screen'`

---

## 🟡 MAJOR CORRECTION #5: Fix Resize Handle Visibility

### Location
**Section:** Phase 5.1 (Resize Handle UI)
**Line ~610**

### Problem
Handles are hidden during resize, causing confusing UX.

### INCORRECT Code
```tsx
{panelId === 'main' && !isResizing && (  // ❌ Handles disappear when dragging
  <div className="resize-handle-se" .../>
)}
```

### CORRECTED Code
```tsx
{panelId === 'main' && (  // ✅ Always show for main panel
  <div
    className={cn(
      "resize-handle-se",
      "absolute bottom-0 right-0",
      "w-4 h-4 cursor-se-resize",
      "hover:bg-blue-500/20",
      isResizing && resizeDirection === 'se' ? "bg-blue-500/30" : "bg-transparent"
    )}
    style={{
      opacity: isResizing && resizeDirection === 'se' ? 0.8 : 1,  // Dim when active
      transition: 'opacity 0.1s ease-in-out'
    }}
    onMouseDown={(e) => handleResizeStart(e, 'se')}
  />
)}
```

### Visual Feedback Enhancement
```tsx
// Add visual feedback for which handle is being dragged
const getHandleOpacity = (direction: string) => {
  if (!isResizing) return 1
  return resizeDirection === direction ? 0.8 : 0.3  // Active handle dimmed, others faded
}

// Example for all four handles
<div className="resize-handle-ne" style={{ opacity: getHandleOpacity('ne') }} />
<div className="resize-handle-nw" style={{ opacity: getHandleOpacity('nw') }} />
<div className="resize-handle-se" style={{ opacity: getHandleOpacity('se') }} />
<div className="resize-handle-sw" style={{ opacity: getHandleOpacity('sw') }} />
```

---

## 🟡 MAJOR CORRECTION #6: Clarify State Update Pattern

### Location
**Section:** Phase 4.2 (Resize MouseMove Handler)
**Lines:** 515-530

### Problem
Plan shows `dataStore.set()` but doesn't explain how this triggers React re-render.

### Current Pattern Analysis

The plan assumes:
```typescript
dataStore.set(storeKey, updatedBranch)  // Does this trigger re-render?
```

**This works IF:**
- `dataStore` is a Zustand store or similar reactive state
- Parent component subscribes to dataStore changes
- `branch` prop updates automatically when dataStore changes

### CORRECTION: Add Explanation

**Add this note to Phase 4.2:**

```markdown
### State Update Flow

**How resize updates reach the UI:**

1. **Mouse move** → Calculate new dimensions
2. **Update dataStore:**
   ```typescript
   dataStore.set(storeKey, updatedBranch)
   ```
3. **Parent re-renders** → Passes updated `branch` prop to CanvasPanel
4. **CanvasPanel re-renders** → Uses new `branch.dimensions`

**IMPORTANT:** This assumes the parent component (likely `annotation-canvas-modern.tsx`) subscribes to dataStore changes and re-renders when the store updates. Verify this subscription exists:

```typescript
// In parent component (annotation-canvas-modern.tsx)
const branch = dataStore.get(storeKey)  // Should be reactive

// OR using Zustand selector
const branch = dataStore((state) => state.branches[storeKey])
```

**If dataStore.set() does NOT trigger re-render**, use local state for immediate feedback:

```typescript
// Add local state for immediate visual feedback
const [localDimensions, setLocalDimensions] = useState<{width: number; height: number} | null>(null)

// In resize handler
setLocalDimensions({ width: newWidth, height: newHeight })
dataStore.set(storeKey, updatedBranch)

// In render
const effectiveWidth = localDimensions?.width ?? branch.dimensions?.width ?? DEFAULT_PANEL_DIMENSIONS.width
const effectiveHeight = localDimensions?.height ?? branch.dimensions?.height ?? DEFAULT_PANEL_DIMENSIONS.height

// Clear local state on mouseup
const handleResizeEnd = () => {
  setIsResizing(false)
  setLocalDimensions(null)  // Clear override, use dataStore value
}
```

**Verification Steps:**
1. Check if dataStore updates trigger parent re-render
2. If yes: Current pattern works
3. If no: Add local state pattern above
```
---

## 🟡 MAJOR CORRECTION #7: Branch Interface Backward Compatibility

### Location
**Section:** Phase 1.1 (Update TypeScript Interface)
**Lines:** ~35-45

### Problem
Adding `dimensions` field may conflict with existing `width` prop usage.

### CORRECTED Interface Definition

```typescript
// types/canvas.ts

export interface Branch {
  // ...existing fields
  title: string
  type: "main" | "note" | "explore" | "promote"
  content: string | ProseMirrorJSON
  position: { x: number; y: number }

  // NEW: Unified dimensions (preferred going forward)
  dimensions?: { width: number; height: number }

  // DEPRECATED: Legacy width prop (kept for backward compatibility)
  // Use dimensions.width instead in new code
  // @deprecated Use dimensions.width instead
  width?: number

  // ...other existing fields
  isEditable: boolean
  branches?: string[]
}
```

### Migration Strategy

**Add helper function to handle both patterns:**

```typescript
// lib/canvas/panel-utils.ts

import { DEFAULT_PANEL_DIMENSIONS } from './panel-metrics'
import { getDefaultPanelWidth } from '@/lib/models/annotation'
import type { Branch } from '@/types/canvas'

/**
 * Get panel dimensions from Branch, handling both old and new patterns
 */
export function getPanelDimensions(branch: Branch): { width: number; height: number } {
  // Priority 1: New dimensions field (if present)
  if (branch.dimensions) {
    return branch.dimensions
  }

  // Priority 2: Legacy width prop (if present)
  if (branch.width) {
    return {
      width: branch.width,
      height: DEFAULT_PANEL_DIMENSIONS.height  // Use default height
    }
  }

  // Priority 3: Type-specific default width
  const typeDefaultWidth = getDefaultPanelWidth(branch.type)
  if (typeDefaultWidth) {
    return {
      width: typeDefaultWidth,
      height: DEFAULT_PANEL_DIMENSIONS.height
    }
  }

  // Fallback: Use DEFAULT_PANEL_DIMENSIONS
  return DEFAULT_PANEL_DIMENSIONS
}
```

**Usage in components:**

```typescript
// BEFORE (direct access, doesn't handle migration)
const width = branch.dimensions?.width ?? 600

// AFTER (handles both patterns)
import { getPanelDimensions } from '@/lib/canvas/panel-utils'

const { width, height } = getPanelDimensions(branch)
```

### Deprecation Timeline

```markdown
**Phase 1 (Current):** Add `dimensions` field, keep `width` prop
- Both fields supported
- Helper function handles migration
- No breaking changes

**Phase 2 (After 3 months):** Migrate all usages
- Replace `branch.width` with `branch.dimensions.width` throughout codebase
- Add console warnings when `width` prop is used
- Update all panel creation code to use `dimensions`

**Phase 3 (After 6 months):** Remove deprecated field
- Remove `width` prop from Branch interface
- Remove backward compatibility code
- Update documentation
```

---

## 🟢 MINOR CORRECTION #8: Test Examples Are Pseudocode

### Location
**Section:** Phase 7 (Testing Strategy)
**Lines:** ~750-850

### Problem
Test code examples won't run as-is (missing mocks, helpers undefined).

### CORRECTION: Add Disclaimer

**Add this note at the beginning of Phase 7:**

```markdown
## Phase 7: Testing Strategy

**⚠️ IMPORTANT:** The test examples below are **pseudocode** for illustrative purposes. They require:
- Mock implementations (`mockBranch`, `createTestPanel`, etc.)
- Test setup/teardown for database connections
- Actual implementation of helper functions

These examples show the **testing approach** and **what to verify**, not production-ready test code.

**Before implementation:**
1. Set up test environment (Jest, database fixtures)
2. Implement test helpers and mocks
3. Adapt pseudocode to actual test framework
```

### Example Correction

**BEFORE (misleading):**
```typescript
it('enforces minimum dimensions', () => {
  resizePanel(mockBranch, { width: 100, height: 100 })  // ❌ resizePanel doesn't exist
  expect(mockBranch.dimensions.width).toBe(MIN_PANEL_WIDTH)
})
```

**AFTER (clear it's pseudocode):**
```typescript
// PSEUDOCODE EXAMPLE - Requires implementation of resizePanel() helper
it('enforces minimum dimensions', () => {
  // Setup: Create test panel with initial dimensions
  const panel = createTestPanel({ width: 500, height: 400 })

  // Action: Attempt to resize below minimum
  const result = resizePanel(panel, { width: 100, height: 100 })

  // Assert: Dimensions clamped to minimum
  expect(result.dimensions.width).toBe(MIN_PANEL_WIDTH)   // 300
  expect(result.dimensions.height).toBe(MIN_PANEL_HEIGHT) // 200
})

// Helper function implementation (to be created):
function resizePanel(panel, newDimensions) {
  // TODO: Implement this helper
  // Should call the actual resize logic from CanvasPanel
}
```

---

## 🟢 MINOR CORRECTION #9: Touch Device Support Scope

### Location
**Section:** Risk Assessment
**Lines:** ~950

### Problem
Plan mentions touch devices but provides no implementation guidance.

### INCORRECT Text
```markdown
**Touch device support:** High likelihood, Medium impact
```

### CORRECTED Text
```markdown
**Touch device support:** OUT OF SCOPE for v1

**Decision:** Desktop-only implementation for initial release.

**Rationale:**
- Mouse events (`onMouseDown`, `onMouseMove`, `onMouseUp`) are desktop-specific
- Touch requires different events (`onTouchStart`, `onTouchMove`, `onTouchEnd`)
- Touch gestures conflict with pan/zoom interactions
- Multi-touch resize requires additional complexity

**Future Enhancement (v2):**
- Add touch event handlers alongside mouse handlers
- Implement touch gesture detection (pinch = zoom, two-finger drag = pan)
- Add mobile-specific resize handle sizing (larger tap targets)
- Test on iPad and touch-enabled laptops

**Current Status:** Desktop browsers only. Touch devices can use trackpad/mouse.
```

---

## Summary of All Corrections

### Critical Issues (Must Fix)
1. ✅ Remove Phase 2 (database migration) - schema exists
2. ✅ Fix `persistPanelUpdate` API signature - use `PanelUpdateData` object
3. ✅ Update all default dimensions - use 520×440 from `DEFAULT_PANEL_DIMENSIONS`

### Major Issues (Should Fix)
4. ✅ Add `coordinateSpace: 'world'` to all persistence calls
5. ✅ Fix handle visibility - remove `!isResizing` condition, add opacity feedback
6. ✅ Clarify state update pattern - document dataStore reactivity assumption
7. ✅ Add Branch interface backward compatibility - helper function for migration

### Minor Issues (Nice to Fix)
8. ✅ Add pseudocode disclaimer to test examples
9. ✅ Explicitly scope out touch device support for v1

---

## Application Checklist

Use this checklist when applying corrections to `implementation_plan.md`:

- [ ] **Phase 1.1:** Update Branch interface with backward compatibility notes
- [ ] **Phase 1.1:** Fix default dimension comments (520×440, not 600×500)
- [ ] **Phase 2:** REMOVE entire database migration phase
- [ ] **Phase 2:** ADD database verification section (no migration needed)
- [ ] **Phase 3:** Replace hardcoded defaults with `DEFAULT_PANEL_DIMENSIONS` import
- [ ] **Phase 4.2:** Fix `persistPanelUpdate()` calls - use correct API signature
- [ ] **Phase 4.2:** Add `coordinateSpace: 'world'` to all persistence calls
- [ ] **Phase 4.2:** Add state update flow explanation
- [ ] **Phase 5.1:** Remove `!isResizing` condition from handle rendering
- [ ] **Phase 5.1:** Add opacity-based visual feedback for active handle
- [ ] **Phase 6:** Update dimension documentation with actual defaults
- [ ] **Phase 7:** Add pseudocode disclaimer at beginning
- [ ] **Risk Assessment:** Change touch support to "OUT OF SCOPE for v1"
- [ ] **NEW Section:** Add `getPanelDimensions()` helper function to utilities

---

## Verification After Corrections

After applying all corrections, verify:

```bash
# 1. Type-check passes
npm run type-check

# 2. No hardcoded 600×500 values remain
rg "600.*500|500.*600" docs/proposal/panel_resize_handles/

# 3. No incorrect API calls remain
rg "persistPanelUpdate\((?!.*\{)" docs/proposal/panel_resize_handles/

# 4. All coordinate space calls include coordinateSpace
rg "persistPanelUpdate" docs/proposal/panel_resize_handles/ -A 5 | rg "coordinateSpace"

# 5. Database migration phase removed
! rg "ALTER TABLE panels ADD COLUMN dimensions" docs/proposal/panel_resize_handles/
```

**Expected Results:**
- ✅ Type-check: No errors
- ✅ Hardcoded dimensions: 0 matches (except in correction examples)
- ✅ Incorrect API: 0 matches
- ✅ Coordinate space: All `persistPanelUpdate` calls include it
- ✅ Migration: 0 matches (phase removed)

---

## Estimated Time to Apply

**Per correction:**
- Critical corrections: ~10 minutes each (30 minutes total)
- Major corrections: ~5 minutes each (20 minutes total)
- Minor corrections: ~2 minutes each (4 minutes total)

**Total: ~54 minutes** (within 1-hour estimate from verification report)

---

## Next Steps After Corrections

1. ✅ Apply all corrections to `implementation_plan.md`
2. ✅ Run verification commands above
3. ✅ Create `lib/canvas/panel-utils.ts` with `getPanelDimensions()` helper
4. ✅ Update plan status to "READY FOR IMPLEMENTATION"
5. ✅ Begin implementation starting with Phase 1

---

**Corrections Prepared:** 2025-10-27
**Ready to Apply:** YES
**Verification Report:** `VERIFICATION_REPORT.md`
**Original Plan:** `implementation_plan.md`
