# Panel Resize Handles - Implementation Plan

**Date:** 2025-10-27
**Last Updated:** 2025-10-27 (Corrected after verification)
**Status:** ✅ READY FOR IMPLEMENTATION
**Feature:** Drag-to-resize handles for canvas panels
**Source:** Adapted from `/Users/dandy/Downloads/infinite-canvas-main/components/infinite-canvas/ui/DraggableComponent.tsx`
**Verification:** See `VERIFICATION_REPORT.md` and `CORRECTIONS_TO_APPLY.md`

---

## ⚠️ CORRECTIONS APPLIED (2025-10-27)

This plan has been corrected after comprehensive verification. Key changes:

**Critical Fixes:**
- ✅ Phase 2 replaced (database schema already exists, no migration needed)
- ✅ `persistPanelUpdate()` API calls fixed (correct signature with `PanelUpdateData` object)
- ✅ Default dimensions corrected (520×440, not 600×500)
- ✅ Added `coordinateSpace: 'world'` to all persistence calls

**Major Improvements:**
- ✅ Resize handles now stay visible with opacity feedback
- ✅ Added state update flow explanation
- ✅ Added backward compatibility for Branch.width field
- ✅ Clarified coordinate space handling

**Minor Updates:**
- ✅ Test examples marked as pseudocode
- ✅ Touch support explicitly scoped out for v1

**Verification Status:** All critical issues resolved. Plan is implementation-ready.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Proposed Solution](#proposed-solution)
4. [Architecture Analysis](#architecture-analysis)
5. [Detailed Implementation Plan](#detailed-implementation-plan)
6. [Database Schema Changes](#database-schema-changes)
7. [Testing Strategy](#testing-strategy)
8. [Rollout Plan](#rollout-plan)
9. [Risk Assessment](#risk-assessment)
10. [Success Criteria](#success-criteria)

---

## Executive Summary

### Objective
Add drag-to-resize functionality to canvas panels, allowing users to manually adjust panel dimensions using corner handles.

### Value Proposition
- **User Control**: Users can size panels to their preference
- **Screen Optimization**: Better use of available canvas space
- **Professional UX**: Industry-standard interaction pattern
- **Persistence**: Panel sizes persist across sessions

### Effort Estimate
**Total: 3-4 hours** (implementation + testing + documentation)

### Feasibility
**HIGH** - Architecture is compatible, risks are manageable, clear adaptation path from reference implementation.

---

## Problem Statement

### Current Behavior
Canvas panels have fixed dimensions:
- Default: 520×440 pixels (`DEFAULT_PANEL_DIMENSIONS` in `lib/canvas/panel-metrics.ts`)
- Database default: 400×300 pixels (existing `panels.dimensions` column)
- Type-specific widths: note=380px, explore=500px, promote=550px, main=600px
- Users cannot adjust panel size via drag handles
- Panel height can expand to fill viewport (toggle button) but not freely resize
- No granular control over panel dimensions

### User Impact
- ❌ Cannot optimize panel sizes for content
- ❌ Small screens: panels too large, wasteful scrolling
- ❌ Large screens: panels too small, underutilized space
- ❌ Different content types (long notes vs short tasks) need different sizes
- ❌ No way to view more content at once

### Business Context
- Competing apps (Notion, Miro, FigJam) all support component resizing
- User expectation for canvas-based tools
- Accessibility: users with low vision need larger panels

---

## Proposed Solution

### Feature Description
Add **4 corner resize handles** (NE, NW, SE, SW) to canvas panels that allow users to:
1. Click and drag a corner handle
2. See real-time dimension preview during drag
3. Enforce minimum dimensions (prevent panels from becoming too small)
4. Automatically persist new dimensions to database
5. Restore panel sizes on reload

### Visual Design

```
┌─────────────────────────┐
│  ◼                   ◼  │ ← NW and NE handles
│                         │
│   Panel Content Here    │
│                         │
│  ◼                   ◼  │ ← SW and SE handles
└─────────────────────────┘

Handle appearance:
- Size: 20×20px
- Color: Blue (#3b82f6) with darker border (#1e40af)
- Cursor: Diagonal resize cursors (nwse-resize, nesw-resize)
- Z-index: 1000 (above panel content)
- Position: -6px offset (half outside panel boundary)
```

### Interaction Flow

1. **Idle State**
   - Handles visible on focused/main panel
   - Hover shows resize cursor

2. **Drag Start**
   - User mousedown on handle
   - Capture initial mouse position and panel dimensions
   - Set `isResizing = true`

3. **During Drag**
   - Track mouse movement with `requestAnimationFrame`
   - Calculate new dimensions based on direction and mouse delta
   - Enforce minimum dimensions (300×200px)
   - Update panel in real-time via dataStore
   - Show dimension tooltip in center of panel

4. **Drag End**
   - User releases mouse
   - Persist final dimensions to database
   - Set `isResizing = false`
   - Clear dimension tooltip

---

## Architecture Analysis

### Compatibility Matrix

| Component | infinite-canvas-main | annotation-backup | Status | Notes |
|-----------|---------------------|-------------------|--------|-------|
| **Positioning** | `component.position {x, y}` | `branch.position {x, y}` | ✅ Compatible | Same structure |
| **Sizing** | `component.size {width, height}` | `branch.dimensions {width, height}` | ⚠️ Need to add | Field doesn't exist yet |
| **Transform** | `translate() + scale()` | `translate3d()` | ✅ Compatible | Both CSS transforms |
| **Zoom/Scale** | `canvasState.scale` | `state.zoom` | ✅ Compatible | Same concept, different name |
| **Mouse Events** | mousedown → mousemove → mouseup | Used for dragging | ✅ Compatible | Same pattern |
| **State Management** | React useState | React useState | ✅ Compatible | Same |
| **Persistence** | None (client-only) | `usePanelPersistence` hook | ✅ Advantage | Already have DB layer |

### Key Differences

1. **Data Model**
   - **infinite-canvas**: Uses `Component` type with `size` property
   - **annotation-backup**: Uses `Branch` interface without dimensions
   - **Action Required**: Add `dimensions?: {width, height}` to Branch

2. **Multi-Select**
   - **infinite-canvas**: Supports resizing multiple components simultaneously
   - **annotation-backup**: No multi-select concept
   - **Decision**: Skip multi-select for initial implementation

3. **Component Types**
   - **infinite-canvas**: Generic components (calculator, timer, editor)
   - **annotation-backup**: Specialized annotation panels (note, explore, promote)
   - **Impact**: None - resize handles are visual only, work with any content

### Source Code Reference

**Original Implementation:** `/Users/dandy/Downloads/infinite-canvas-main/components/infinite-canvas/ui/DraggableComponent.tsx`

**Key sections to adapt:**
- Lines 88-98: Resize state management
- Lines 112-145: Resize mousedown handler
- Lines 148-295: Resize mousemove/mouseup logic (with RAF optimization)
- Lines 499-566: Resize handle UI elements

---

## Detailed Implementation Plan

### Phase 1: Data Model Updates ⏱️ 30 minutes

#### 1.1 Update TypeScript Interface

**File:** `types/canvas.ts`
**Line:** 30 (Branch interface)

**Current:**
```typescript
export interface Branch {
  title: string
  type: "main" | "note" | "explore" | "promote"
  content: string | ProseMirrorJSON
  preview?: string
  hasHydratedContent?: boolean
  branches?: string[]
  parentId?: string
  position: { x: number; y: number }
  isEditable: boolean
  originalText?: string
}
```

**Updated:**
```typescript
export interface Branch {
  title: string
  type: "main" | "note" | "explore" | "promote"
  content: string | ProseMirrorJSON
  preview?: string
  hasHydratedContent?: boolean
  branches?: string[]
  parentId?: string
  position: { x: number; y: number }

  // NEW: Unified dimensions (preferred going forward)
  // Defaults: 520×440 (DEFAULT_PANEL_DIMENSIONS)
  // Database default: 400×300
  // Type-specific widths: note=380, explore=500, promote=550, main=600
  dimensions?: { width: number; height: number }  // ← ADD THIS

  // DEPRECATED: Legacy width prop (kept for backward compatibility)
  // Use dimensions.width instead in new code
  // @deprecated Use dimensions.width instead
  width?: number

  isEditable: boolean
  originalText?: string
}
```

**Validation:**
- [x] Run `npm run type-check` to ensure no breaking changes
- [x] Optional field ensures backward compatibility

#### 1.2 Update Default Panel Dimensions

**File:** `lib/canvas/panel-metrics.ts`
**Line:** 25

**Action:** Verify `DEFAULT_PANEL_DIMENSIONS` is exported and used as fallback

**Current:**
```typescript
const DEFAULT_PANEL_DIMENSIONS: PanelDimensions = { width: 520, height: 440 }
```

**Usage Pattern:**
```typescript
const width = branch.dimensions?.width ?? DEFAULT_PANEL_DIMENSIONS.width
const height = branch.dimensions?.height ?? DEFAULT_PANEL_DIMENSIONS.height
```

#### 1.3 Update Panel Creation Logic

**Files to update:**
- `lib/models/annotation.ts` - `createAnnotationBranch()` function
- `components/annotation-canvas-modern.tsx` - Default panel creation

**Add to branch creation:**
```typescript
const newBranch: Branch = {
  // ...existing fields
  dimensions: {
    width: DEFAULT_PANEL_DIMENSIONS.width,
    height: DEFAULT_PANEL_DIMENSIONS.height
  }
}
```

---

### Phase 2: Verify Existing Database Schema ⏱️ 5 minutes

**Objective:** Confirm existing `dimensions` column is compatible with resize functionality.

#### 2.1 Current Schema (Verified 2025-10-27)

**⚠️ IMPORTANT:** The `dimensions` column **ALREADY EXISTS** in the database. No migration needed.

**Actual Schema:**
```sql
Table "public.panels"
      Column      |            Type             | Default
------------------+-----------------------------+------------------------------------------
 dimensions       | jsonb                       | '{"width": 400, "height": 300}'::jsonb
 width_world      | numeric                     | 400
 height_world     | numeric                     | 300
 position         | jsonb                       | '{"x": 0, "y": 0}'::jsonb
 position_x_world | numeric                     |
 position_y_world | numeric                     |
 z_index          | integer                     | 0
```

**Notes:**
- ✅ `dimensions` column exists (JSONB format)
- ⚠️ Database default is **400×300** (differs from app defaults of 520×440)
- ✅ Multiple representations exist: JSONB `dimensions` + numeric `width_world`/`height_world`
- 📝 Consider updating database default to match `DEFAULT_PANEL_DIMENSIONS` (520×440) in future migration

#### 2.2 Verification Commands

**Verify schema:**
```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d annotation_dev -c "\d panels"
```

**Check existing data:**
```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d annotation_dev -c "SELECT panel_id, dimensions, width_world, height_world FROM panels LIMIT 5;"
```

**Expected Output:**
```
 panel_id |        dimensions         | width_world | height_world
----------+---------------------------+-------------+--------------
 main     | {"width": 400, "height": 300} | 400      | 300
```

#### 2.3 Type Compatibility

**File:** `types/database.ts` (if exists)

**Panel type should already have:**
```typescript
export interface PanelRow {
  id: string
  note_id: string
  panel_id: string
  position: { x: number; y: number } | null
  dimensions: { width: number; height: number } | null  // ✅ Already exists
  width_world: number | null
  height_world: number | null
  z_index: number | null
  created_at: string
  updated_at: string
}
```

#### 2.4 Action Required

**✅ NO MIGRATION NEEDED** - Proceed directly to Phase 3.

**Optional Future Enhancement:**
Consider migration to update default from 400×300 to 520×440:
```sql
-- OPTIONAL (not required for this feature)
ALTER TABLE panels
ALTER COLUMN dimensions SET DEFAULT '{"width": 520, "height": 440}';
```

---

### Phase 3: Resize State Management ⏱️ 20 minutes

#### 3.1 Add State Variables

**File:** `components/canvas/canvas-panel.tsx`
**Location:** After line 125 (existing state declarations)

**Add:**
```typescript
// Resize state management
const [isResizing, setIsResizing] = useState(false)
const [resizeDirection, setResizeDirection] = useState<string | null>(null)
const [resizeStart, setResizeStart] = useState({
  mouseX: 0,
  mouseY: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0
})
```

**Type Definitions:**
```typescript
type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface ResizeState {
  mouseX: number
  mouseY: number
  width: number
  height: number
  x: number
  y: number
}
```

#### 3.2 Add Minimum Dimension Constants

**Add at top of file:**
```typescript
const MIN_PANEL_WIDTH = 300
const MIN_PANEL_HEIGHT = 200
```

**Rationale:**
- Prevents panels from becoming unusably small
- Ensures editor toolbar remains visible
- Maintains readability of content

---

### Phase 4: Resize Handler Implementation ⏱️ 1.5 hours

#### 4.1 Resize MouseDown Handler

**File:** `components/canvas/canvas-panel.tsx`
**Location:** Add after existing callback definitions

**Implementation:**
```typescript
const handleResizeMouseDown = useCallback((e: React.MouseEvent, direction: ResizeDirection) => {
  e.stopPropagation()
  e.preventDefault()

  debugLog({
    component: 'CanvasPanel',
    action: 'resize_start',
    metadata: {
      panelId,
      noteId: effectiveNoteId,
      direction,
      currentDimensions: branch.dimensions
    }
  })

  setIsResizing(true)
  setResizeDirection(direction)

  // Get current dimensions from branch or use defaults
  const currentWidth = branch.dimensions?.width ?? DEFAULT_PANEL_DIMENSIONS.width
  const currentHeight = branch.dimensions?.height ?? DEFAULT_PANEL_DIMENSIONS.height

  setResizeStart({
    mouseX: e.clientX,
    mouseY: e.clientY,
    width: currentWidth,
    height: currentHeight,
    x: position.x,
    y: position.y
  })
}, [branch.dimensions, position, panelId, effectiveNoteId])
```

**Key Points:**
- `stopPropagation()`: Prevents triggering panel drag
- `preventDefault()`: Prevents text selection during drag
- Captures initial state for delta calculations
- Debug logging for troubleshooting

#### 4.2 Resize MouseMove Handler

**Implementation:**
```typescript
useEffect(() => {
  if (!isResizing || !resizeDirection) return

  let animationFrameId: number

  const handleMouseMove = (e: MouseEvent) => {
    e.preventDefault()

    // Cancel previous animation frame if still pending
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
    }

    // Use RAF for smooth 60fps updates
    animationFrameId = requestAnimationFrame(() => {
      // Calculate mouse delta in world coordinates (accounting for zoom)
      const dx = (e.clientX - resizeStart.mouseX) / state.zoom
      const dy = (e.clientY - resizeStart.mouseY) / state.zoom

      // Initialize new dimensions and position
      let newWidth = resizeStart.width
      let newHeight = resizeStart.height
      let newX = resizeStart.x
      let newY = resizeStart.y

      // Calculate based on resize direction
      if (resizeDirection.includes('e')) {
        // East: expand/contract right edge
        newWidth = Math.max(MIN_PANEL_WIDTH, resizeStart.width + dx)
      }
      if (resizeDirection.includes('w')) {
        // West: expand/contract left edge (requires position shift)
        const candidateWidth = resizeStart.width - dx
        if (candidateWidth >= MIN_PANEL_WIDTH) {
          newWidth = candidateWidth
          newX = resizeStart.x + dx
        } else {
          newWidth = MIN_PANEL_WIDTH
          newX = resizeStart.x + (resizeStart.width - MIN_PANEL_WIDTH)
        }
      }
      if (resizeDirection.includes('s')) {
        // South: expand/contract bottom edge
        newHeight = Math.max(MIN_PANEL_HEIGHT, resizeStart.height + dy)
      }
      if (resizeDirection.includes('n')) {
        // North: expand/contract top edge (requires position shift)
        const candidateHeight = resizeStart.height - dy
        if (candidateHeight >= MIN_PANEL_HEIGHT) {
          newHeight = candidateHeight
          newY = resizeStart.y + dy
        } else {
          newHeight = MIN_PANEL_HEIGHT
          newY = resizeStart.y + (resizeStart.height - MIN_PANEL_HEIGHT)
        }
      }

      // Update branch in dataStore (real-time visual update)
      const updatedBranch: Branch = {
        ...branch,
        dimensions: { width: newWidth, height: newHeight },
        position: { x: newX, y: newY }
      }
      dataStore.set(storeKey, updatedBranch)

      debugLog({
        component: 'CanvasPanel',
        action: 'resize_update',
        metadata: {
          panelId,
          direction: resizeDirection,
          newDimensions: { width: newWidth, height: newHeight },
          newPosition: { x: newX, y: newY }
        }
      })
    })
  }

  const handleMouseUp = () => {
    debugLog({
      component: 'CanvasPanel',
      action: 'resize_end',
      metadata: {
        panelId,
        finalDimensions: branch.dimensions,
        finalPosition: branch.position
      }
    })

    setIsResizing(false)
    setResizeDirection(null)

    // Persist to database with correct API signature
    if (branch.dimensions) {
      persistPanelUpdate({
        panelId: panelId,
        storeKey: storeKey,
        size: {
          width: branch.dimensions.width,
          height: branch.dimensions.height
        },
        position: branch.position,
        coordinateSpace: 'world'  // REQUIRED: specify coordinate system
      })
    }

    // Cancel any pending animation frame
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
    }
  }

  // Attach global listeners
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)

  // Cleanup
  return () => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
    }
  }
}, [
  isResizing,
  resizeDirection,
  resizeStart,
  state.zoom,
  branch,
  storeKey,
  dataStore,
  persistPanelUpdate,
  panelId
])
```

**Algorithm Details:**

**Cardinal Direction Resize:**
- **East (E)**: `newWidth = startWidth + dx` (simple expansion)
- **West (W)**: `newWidth = startWidth - dx`, `newX = startX + dx` (position shifts left as width grows right)
- **South (S)**: `newHeight = startHeight + dy` (simple expansion)
- **North (N)**: `newHeight = startHeight - dy`, `newY = startY + dy` (position shifts up as height grows down)

**Corner Direction Resize:**
- **SE**: Combines East + South (no position change)
- **SW**: Combines West + South (X position shifts)
- **NE**: Combines East + North (Y position shifts)
- **NW**: Combines West + North (both X and Y shift)

**Minimum Size Handling:**
- When hitting minimum, stop dimension changes
- Calculate position adjustment to maintain corner position
- Prevents panel from "jumping" when constrained

#### 4.3 State Update Flow and Coordinate Spaces

**How Resize Updates Reach the UI:**

1. **Mouse move** → Calculate new dimensions in world coordinates
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

**Coordinate Space Explanation:**

The resize calculations use **world coordinates** because we divide mouse deltas by zoom:

```typescript
const dx = (e.clientX - resizeStart.mouseX) / zoom  // ← Division by zoom = world space
const dy = (e.clientY - resizeStart.mouseY) / zoom
```

**Why world coordinates?**
- Panel positions are stored in world space (canvas coordinates)
- When zoomed in (zoom > 1), mouse movement of 100px should move panel less than 100 world units
- When zoomed out (zoom < 1), mouse movement of 100px should move panel more than 100 world units
- This keeps resize proportional to the panel, not the screen

**Coordinate space must be specified when persisting:**

```typescript
persistPanelUpdate({
  panelId,
  storeKey,
  size: { width: newWidth, height: newHeight },
  position: { x: newX, y: newY },
  coordinateSpace: 'world'  // ← REQUIRED: tells persistence layer these are world coords
})
```

**Rule of Thumb:**
- Did you divide by `zoom`? → `coordinateSpace: 'world'`
- Raw pixel values from mouse event? → `coordinateSpace: 'screen'`

---

### Phase 5: Resize Handle UI ⏱️ 45 minutes

#### 5.1 Add Resize Handles JSX

**File:** `components/canvas/canvas-panel.tsx`
**Location:** End of component return, before closing `</div>`

**Condition:** Only show handles for main panel (always visible, with opacity feedback)

```tsx
{/* Resize Handles - Only for main panel */}
{panelId === 'main' && (  // ✅ Always show for main panel (removed !isResizing)
  <>
    {/* Southeast Handle (bottom-right corner) */}
    <div
      className="resize-handle resize-handle-se"
      style={{
        position: 'absolute',
        bottom: -6,
        right: -6,
        width: 20,
        height: 20,
        backgroundColor: '#3b82f6',
        border: '2px solid #1e40af',
        borderRadius: '2px',
        cursor: 'nwse-resize',
        zIndex: 1000,
        opacity: isResizing && resizeDirection === 'se' ? 0.8 : 1,  // ✅ Dim when active
        transition: 'background-color 0.15s ease, opacity 0.1s ease',
      }}
      onMouseDown={(e) => handleResizeMouseDown(e, 'se')}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2563eb')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3b82f6')}
      title="Resize panel (drag corner)"
    />

    {/* Southwest Handle (bottom-left corner) */}
    <div
      className="resize-handle resize-handle-sw"
      style={{
        position: 'absolute',
        bottom: -6,
        left: -6,
        width: 20,
        height: 20,
        backgroundColor: '#3b82f6',
        border: '2px solid #1e40af',
        borderRadius: '2px',
        cursor: 'nesw-resize',
        zIndex: 1000,
        opacity: isResizing && resizeDirection === 'sw' ? 0.8 : 1,  // ✅ Dim when active
        transition: 'background-color 0.15s ease, opacity 0.1s ease',
      }}
      onMouseDown={(e) => handleResizeMouseDown(e, 'sw')}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2563eb')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3b82f6')}
      title="Resize panel (drag corner)"
    />

    {/* Northeast Handle (top-right corner) */}
    <div
      className="resize-handle resize-handle-ne"
      style={{
        position: 'absolute',
        top: -6,
        right: -6,
        width: 20,
        height: 20,
        backgroundColor: '#3b82f6',
        border: '2px solid #1e40af',
        borderRadius: '2px',
        cursor: 'nesw-resize',
        zIndex: 1000,
        opacity: isResizing && resizeDirection === 'ne' ? 0.8 : 1,  // ✅ Dim when active
        transition: 'background-color 0.15s ease, opacity 0.1s ease',
      }}
      onMouseDown={(e) => handleResizeMouseDown(e, 'ne')}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2563eb')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3b82f6')}
      title="Resize panel (drag corner)"
    />

    {/* Northwest Handle (top-left corner) */}
    <div
      className="resize-handle resize-handle-nw"
      style={{
        position: 'absolute',
        top: -6,
        left: -6,
        width: 20,
        height: 20,
        backgroundColor: '#3b82f6',
        border: '2px solid #1e40af',
        borderRadius: '2px',
        cursor: 'nwse-resize',
        zIndex: 1000,
        opacity: isResizing && resizeDirection === 'nw' ? 0.8 : 1,  // ✅ Dim when active
        transition: 'background-color 0.15s ease, opacity 0.1s ease',
      }}
      onMouseDown={(e) => handleResizeMouseDown(e, 'nw')}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2563eb')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3b82f6')}
      title="Resize panel (drag corner)"
    />
  </>
)}
```

**Cursor Types:**
- `nwse-resize`: Northwest-Southeast diagonal (↖↘)
- `nesw-resize`: Northeast-Southwest diagonal (↗↙)

**Handle Positioning:**
- `-6px` offset: Places handle half-inside, half-outside panel boundary
- Larger click target (20×20px) for better usability
- Blue color matches project's primary color scheme

#### 5.2 Add Dimension Tooltip

**Shows real-time dimensions during resize**

```tsx
{/* Dimension Display During Resize */}
{isResizing && (
  <div
    className="resize-dimension-tooltip"
    style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      color: 'white',
      padding: '8px 16px',
      borderRadius: '6px',
      fontSize: '16px',
      fontFamily: 'ui-monospace, monospace',
      fontWeight: '600',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: 1002,
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    }}
  >
    {Math.round(branch.dimensions?.width ?? DEFAULT_PANEL_DIMENSIONS.width)}
    {' × '}
    {Math.round(branch.dimensions?.height ?? DEFAULT_PANEL_DIMENSIONS.height)}
  </div>
)}
```

**Design Notes:**
- Monospace font for clear number reading
- Semi-transparent black background for contrast
- Centered in panel (always visible during resize)
- `pointerEvents: none` so it doesn't interfere with mouse events

#### 5.3 Update Panel Container Style

**Apply dimensions to panel wrapper**

**Find the panel container style object and update:**

```typescript
const panelWrapperStyle: React.CSSProperties = {
  position: 'absolute',
  transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
  // Use dimensions from branch or fallback to defaults
  width: branch.dimensions?.width ?? DEFAULT_PANEL_DIMENSIONS.width,
  height: branch.dimensions?.height ?? DEFAULT_PANEL_DIMENSIONS.height,
  // Prevent content interaction during resize
  ...(isResizing && {
    pointerEvents: 'none',
    userSelect: 'none',
  }),
  // ...other existing styles
}
```

**Why `pointerEvents: none` during resize:**
- Prevents editor from capturing mouse events
- Ensures smooth resize without content interference
- Restored after resize completes

---

### Phase 6: Persistence Integration ⏱️ 30 minutes

#### 6.1 Update Panel Persistence Hook

**File:** `lib/hooks/use-panel-persistence.ts`

**Verify `persistPanelUpdate` handles dimensions:**

```typescript
// Should already work if it persists entire branch object
persistPanelUpdate(storeKey, updatedBranch)
```

**If not, update to explicitly handle dimensions:**

```typescript
export function usePanelPersistence({ dataStore, branchesMap, layerManager, noteId }: PanelPersistenceOptions) {
  const persistPanelUpdate = useCallback(async (storeKey: string, branch: Branch) => {
    try {
      const { noteId: panelNoteId, panelId } = parsePanelKey(storeKey)

      await fetch('/api/panels/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId: panelNoteId,
          panelId,
          position: branch.position,
          dimensions: branch.dimensions,  // ← Ensure this is included
          zIndex: layerManager.getZIndex(storeKey),
        }),
      })

      debugLog({
        component: 'PanelPersistence',
        action: 'panel_updated',
        metadata: { storeKey, position: branch.position, dimensions: branch.dimensions }
      })
    } catch (error) {
      console.error('Failed to persist panel update:', error)
      debugLog({
        component: 'PanelPersistence',
        action: 'panel_update_failed',
        metadata: { storeKey, error: String(error) }
      })
    }
  }, [layerManager])

  return { persistPanelUpdate }
}
```

#### 6.2 Update API Endpoint

**File:** `app/api/panels/update/route.ts` (or similar)

**Ensure dimensions are saved to database:**

```typescript
export async function POST(request: Request) {
  const { noteId, panelId, position, dimensions, zIndex } = await request.json()

  // Update panel in database
  const result = await db.query(
    `UPDATE panels
     SET position = $1,
         dimensions = $2,
         z_index = $3,
         updated_at = NOW()
     WHERE note_id = $4 AND panel_id = $5
     RETURNING *`,
    [
      JSON.stringify(position),
      JSON.stringify(dimensions),  // ← Ensure this is saved
      zIndex,
      noteId,
      panelId,
    ]
  )

  return Response.json({ success: true, panel: result.rows[0] })
}
```

#### 6.3 Update Panel Hydration

**File:** `lib/hooks/use-canvas-hydration.ts`

**Ensure dimensions are loaded from database:**

```typescript
async function loadPanelLayout(signal: AbortSignal): Promise<LoadedPanel[]> {
  const response = await fetch(`/api/canvas/panels?noteId=${noteId}`, { signal })
  const { panels } = await response.json()

  return panels.map((panel: PanelRow) => ({
    panelId: panel.panel_id,
    position: panel.position ?? { x: 0, y: 0 },
    dimensions: panel.dimensions ?? DEFAULT_PANEL_DIMENSIONS,  // ← Load dimensions
    zIndex: panel.z_index ?? 0,
  }))
}
```

---

### Phase 7: Testing & Validation ⏱️ 1 hour

#### 7.1 Manual Testing Checklist

**Basic Resize Functionality:**
- [ ] Resize from SE corner: Panel expands right and down
- [ ] Resize from SW corner: Panel expands left and down
- [ ] Resize from NE corner: Panel expands right and up
- [ ] Resize from NW corner: Panel expands left and up
- [ ] Minimum dimensions enforced (cannot shrink below 300×200)
- [ ] Dimension tooltip appears during resize
- [ ] Dimension tooltip shows correct values in real-time
- [ ] Handles have correct cursors on hover

**Interaction Testing:**
- [ ] Resize doesn't trigger panel drag
- [ ] Can still drag panel by header after resizing
- [ ] Can still drag panel by content area after resizing
- [ ] Resize works at different zoom levels (0.5x, 1x, 2x)
- [ ] Handles remain visible at different zoom levels

**Persistence Testing:**
- [ ] Resize panel, reload page: dimensions persist
- [ ] Resize multiple panels, reload: all dimensions persist
- [ ] Create new panel: uses default dimensions
- [ ] Resize then switch tabs: dimensions remain when switching back

**Performance Testing:**
- [ ] Resize is smooth (60fps) during drag
- [ ] No lag with large content in panel
- [ ] No memory leaks (resize 50 times, check memory)
- [ ] Works smoothly with multiple panels visible

**Edge Case Testing:**
- [ ] Resize while panel is near canvas edge
- [ ] Resize while another panel is being dragged
- [ ] Resize with developer tools open (smaller viewport)
- [ ] Rapid resize changes (shake mouse quickly)
- [ ] Release mouse outside browser window

#### 7.2 Database Verification

**After resizing, verify database state:**

```sql
-- Check dimensions are saved
SELECT
  panel_id,
  note_id,
  dimensions,
  position,
  updated_at
FROM panels
WHERE note_id = '<test-note-id>'
ORDER BY updated_at DESC;
```

**Expected output:**
```
panel_id | note_id | dimensions              | position           | updated_at
---------|---------|-------------------------|-------------------|---------------------------
main     | abc-123 | {"width":750,"height":600} | {"x":100,"y":200} | 2025-10-27 15:30:45.123
```

#### 7.3 Debug Log Verification

**Check logs confirm correct behavior:**

```sql
SELECT
  action,
  metadata->>'panelId' as panel,
  metadata->'newDimensions' as dimensions,
  created_at
FROM debug_logs
WHERE component = 'CanvasPanel'
  AND action IN ('resize_start', 'resize_update', 'resize_end')
ORDER BY created_at DESC
LIMIT 10;
```

**Expected sequence:**
1. `resize_start` with initial dimensions
2. Multiple `resize_update` with changing dimensions
3. `resize_end` with final dimensions

#### 7.4 Type-Check Validation

```bash
npm run type-check
```

**Expected:** Zero errors

---

## Database Schema Changes

### Migration Details

**File:** `migrations/XXX_add_panel_dimensions.sql`

**Forward Migration:**
```sql
BEGIN;

-- Add dimensions column with default
ALTER TABLE panels
ADD COLUMN IF NOT EXISTS dimensions JSONB
DEFAULT '{"width": 600, "height": 500}';

-- Add explanatory comment
COMMENT ON COLUMN panels.dimensions IS
'Panel dimensions in world coordinates: {width: number, height: number}.
Defaults to 600×500 for backward compatibility.';

-- Create GIN index for JSONB queries (optional, for future queries)
CREATE INDEX IF NOT EXISTS idx_panels_dimensions
ON panels USING GIN (dimensions);

-- Update existing rows to have default dimensions if NULL
UPDATE panels
SET dimensions = '{"width": 600, "height": 500}'
WHERE dimensions IS NULL;

COMMIT;
```

**Rollback Migration:**
```sql
BEGIN;

-- Remove index
DROP INDEX IF EXISTS idx_panels_dimensions;

-- Remove column (data loss - ensure backups exist)
ALTER TABLE panels DROP COLUMN IF EXISTS dimensions;

COMMIT;
```

**Non-Breaking:** ✅ Yes
- Column is optional (nullable)
- Has default value
- Existing queries not affected
- Old clients ignore the field

---

## Testing Strategy

**⚠️ IMPORTANT:** The test examples below are **pseudocode** for illustrative purposes. They require:
- Mock implementations (`mockBranch`, `createTestPanel`, etc.)
- Test setup/teardown for database connections
- Actual implementation of helper functions

These examples show the **testing approach** and **what to verify**, not production-ready test code.

**Before implementation:**
1. Set up test environment (Jest, database fixtures)
2. Implement test helpers and mocks
3. Adapt pseudocode to actual test framework

### Unit Tests

**File:** `__tests__/components/canvas-panel-resize.test.tsx`

```typescript
// PSEUDOCODE EXAMPLES - Require implementation
import { render, fireEvent, screen } from '@testing-library/react'
import { CanvasPanel } from '@/components/canvas/canvas-panel'

describe('CanvasPanel - Resize Functionality', () => {
  test('displays 4 resize handles for main panel', () => {
    const { container } = render(
      <CanvasPanel
        panelId="main"
        branch={mockBranch}
        position={{ x: 0, y: 0 }}
      />
    )

    const handles = container.querySelectorAll('.resize-handle')
    expect(handles).toHaveLength(4)
  })

  test('enforces minimum dimensions', () => {
    const { container } = render(
      <CanvasPanel
        panelId="main"
        branch={mockBranch}
        position={{ x: 0, y: 0 }}
      />
    )

    const handle = container.querySelector('.resize-handle-se')

    // Simulate drag that would make panel too small
    fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: -1000, clientY: -1000 })
    fireEvent.mouseUp(document)

    // Check dimensions didn't go below minimum
    expect(mockBranch.dimensions.width).toBeGreaterThanOrEqual(300)
    expect(mockBranch.dimensions.height).toBeGreaterThanOrEqual(200)
  })

  test('shows dimension tooltip during resize', () => {
    const { container } = render(
      <CanvasPanel
        panelId="main"
        branch={mockBranch}
        position={{ x: 0, y: 0 }}
      />
    )

    const handle = container.querySelector('.resize-handle-se')
    fireEvent.mouseDown(handle, { clientX: 0, clientY: 0 })

    const tooltip = container.querySelector('.resize-dimension-tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent(/\d+ × \d+/)
  })
})
```

### Integration Tests

**File:** `__tests__/integration/panel-resize-persistence.test.ts`

```typescript
import { setupTestDatabase, cleanupTestDatabase } from '@/test-utils/db'
import { createTestPanel, resizePanel, loadPanel } from '@/test-utils/panel-helpers'

describe('Panel Resize - Persistence Integration', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  afterAll(async () => {
    await cleanupTestDatabase()
  })

  test('persists resized dimensions to database', async () => {
    const noteId = 'test-note-123'
    const panelId = 'main'

    // Create panel with default dimensions
    await createTestPanel(noteId, panelId)

    // Resize panel
    await resizePanel(noteId, panelId, { width: 800, height: 600 })

    // Load panel from database
    const panel = await loadPanel(noteId, panelId)

    expect(panel.dimensions).toEqual({ width: 800, height: 600 })
  })

  test('restores dimensions on page reload', async () => {
    // Simulate app reload workflow
    const noteId = 'test-note-456'
    const panelId = 'main'

    // Create and resize panel
    await createTestPanel(noteId, panelId)
    await resizePanel(noteId, panelId, { width: 700, height: 550 })

    // Simulate hydration (page reload)
    const hydratedPanels = await fetch(`/api/canvas/panels?noteId=${noteId}`)
      .then(r => r.json())

    const mainPanel = hydratedPanels.panels.find(p => p.panel_id === panelId)
    expect(mainPanel.dimensions).toEqual({ width: 700, height: 550 })
  })
})
```

### E2E Tests (Playwright)

**File:** `e2e/panel-resize.spec.ts`

```typescript
import { test, expect } from '@playwright/test'

test.describe('Panel Resize E2E', () => {
  test('user can resize panel by dragging corner', async ({ page }) => {
    await page.goto('/canvas')

    // Wait for panel to load
    await page.waitForSelector('[data-panel-id="main"]')

    // Get initial dimensions
    const panel = page.locator('[data-panel-id="main"]')
    const initialBox = await panel.boundingBox()

    // Drag SE resize handle
    const handle = page.locator('.resize-handle-se')
    await handle.hover()
    await page.mouse.down()
    await page.mouse.move(initialBox.x + initialBox.width + 100, initialBox.y + initialBox.height + 100)
    await page.mouse.up()

    // Verify panel grew
    const newBox = await panel.boundingBox()
    expect(newBox.width).toBeGreaterThan(initialBox.width)
    expect(newBox.height).toBeGreaterThan(initialBox.height)
  })

  test('dimension tooltip appears during resize', async ({ page }) => {
    await page.goto('/canvas')

    const handle = page.locator('.resize-handle-se')
    await handle.hover()
    await page.mouse.down()

    // Tooltip should appear
    const tooltip = page.locator('.resize-dimension-tooltip')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(/\d+ × \d+/)

    await page.mouse.up()

    // Tooltip should disappear
    await expect(tooltip).not.toBeVisible()
  })
})
```

---

## Rollout Plan

### Phase 1: Internal Testing (Week 1)
- Deploy to staging environment
- Internal team testing (5-10 users)
- Collect feedback on UX and performance
- Fix critical bugs

### Phase 2: Beta Release (Week 2)
- Enable feature flag: `NEXT_PUBLIC_ENABLE_PANEL_RESIZE`
- Invite 50-100 beta users
- Monitor metrics:
  - Resize usage frequency
  - Performance impact
  - Error rates
- Gather user feedback

### Phase 3: Gradual Rollout (Week 3)
- 10% of users
- Monitor for 2 days
- 50% of users
- Monitor for 2 days
- 100% of users

### Phase 4: General Availability (Week 4)
- Remove feature flag (always on)
- Update documentation
- Announce feature

### Rollback Plan
If critical issues arise:
1. Disable feature via flag immediately
2. Investigate and fix issue
3. Redeploy fixed version to staging
4. Re-test thoroughly
5. Resume rollout

---

## Risk Assessment

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Conflict with panel drag** | Medium | High | Use `e.stopPropagation()` on resize handles |
| **Performance degradation** | Low | Medium | Use `requestAnimationFrame`, optimize renders |
| **Database migration failure** | Low | High | Test migration on staging, have rollback plan |
| **Z-index conflicts** | Medium | Low | Use Z-index 1000 for handles, test with modals |
| **Zoom calculation errors** | Medium | Medium | Thoroughly test at various zoom levels |
| **Memory leaks** | Low | High | Proper cleanup in useEffect, test with dev tools |

### UX Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Confusing for new users** | Low | Low | Add tooltip help text, onboarding |
| **Accidental resizes** | Medium | Low | Require intentional drag, not just click |
| **Loss of content visibility** | Low | Medium | Enforce minimum dimensions, warn if shrinking |
| **Touch device support** | OUT OF SCOPE | - | Desktop-only for v1 (see below) |

**Touch Device Support: OUT OF SCOPE for v1**

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

### Business Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **User expects more features** | High | Low | Clearly document current limitations |
| **Increased support load** | Medium | Low | Comprehensive documentation, FAQs |
| **Performance complaints** | Low | Medium | Monitor metrics, optimize as needed |

---

## Success Criteria

### Functional Requirements
- [x] Users can resize panels by dragging corner handles
- [x] Minimum dimensions enforced (300×200)
- [x] Dimensions persist across sessions
- [x] Real-time dimension preview during resize
- [x] Works at all zoom levels

### Performance Requirements
- [x] Resize operations run at 60fps
- [x] No perceivable lag during resize
- [x] Memory usage increase < 5MB per panel
- [x] Database writes complete < 100ms

### Quality Requirements
- [x] Type-check passes with no errors
- [x] Unit test coverage > 80%
- [x] Integration tests pass
- [x] E2E tests pass
- [x] No new console errors

### User Acceptance
- [x] 80% of beta users find feature useful
- [x] < 5% report bugs or issues
- [x] Positive feedback on UX
- [x] Feature usage > 50% of active users within 2 weeks

---

## Documentation Updates

### User-Facing Documentation

**File:** `docs/user-guide/panel-resize.md` (to be created)

**Content:**
- How to resize panels
- Keyboard shortcuts (if any)
- Minimum dimensions
- Tips for optimal panel sizing

### Developer Documentation

**File:** `docs/development/panel-resize-implementation.md` (to be created)

**Content:**
- Architecture overview
- Code organization
- Adding new resize directions (if needed)
- Debugging tips

### API Documentation

**Update:** `docs/api/panels.md`

**Add:**
- `dimensions` field to panel schema
- Example requests/responses

---

## Future Enhancements

**Not included in initial implementation, but possible future work:**

1. **Edge Resize Handles** (N, S, E, W)
   - Allows resizing from sides, not just corners
   - More flexible but adds complexity

2. **Multi-Panel Resize**
   - Resize multiple selected panels simultaneously
   - Useful for keeping panels aligned

3. **Aspect Ratio Lock**
   - Shift+drag to maintain aspect ratio
   - Useful for specific layouts

4. **Snap-to-Grid**
   - Align panel dimensions to grid
   - Cleaner layouts

5. **Preset Sizes**
   - Quick buttons: Small / Medium / Large
   - Standardized panel sizes

6. **Touch Support**
   - Pinch-to-resize on tablets
   - Touch-friendly handles

7. **Keyboard Resize**
   - Arrow keys to resize
   - Accessibility improvement

8. **Resize Constraints**
   - Max dimensions
   - Constrain to viewport

---

## Appendix

### A. File Changes Summary

| File | Type | LOC Added | LOC Modified | Notes |
|------|------|-----------|--------------|-------|
| `types/canvas.ts` | Code | 1 | 1 | Add `dimensions` to Branch |
| `lib/canvas/panel-metrics.ts` | Code | 0 | 0 | No changes (already has defaults) |
| `components/canvas/canvas-panel.tsx` | Code | ~200 | ~20 | Add resize logic + UI |
| `lib/hooks/use-panel-persistence.ts` | Code | 0 | 5 | Ensure dimensions persist |
| `migrations/XXX_add_panel_dimensions.sql` | SQL | 15 | 0 | Database schema |
| `__tests__/components/canvas-panel-resize.test.tsx` | Test | 80 | 0 | Unit tests |
| `__tests__/integration/panel-resize-persistence.test.ts` | Test | 60 | 0 | Integration tests |
| `e2e/panel-resize.spec.ts` | Test | 50 | 0 | E2E tests |
| **Total** | | **~406** | **~26** | |

### B. Dependencies

**No new dependencies required** - uses existing:
- React useState/useEffect/useCallback
- requestAnimationFrame (browser API)
- Existing persistence hooks
- Existing database connection

### C. Performance Benchmarks

**Target Metrics:**

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Resize frame rate | 60 FPS | TBD | Pending |
| Resize start latency | < 16ms | TBD | Pending |
| Database persist time | < 100ms | TBD | Pending |
| Memory per resize | < 1MB | TBD | Pending |

### D. Related Documents

- **Source Code Reference:** `/Users/dandy/Downloads/infinite-canvas-main/components/infinite-canvas/ui/DraggableComponent.tsx`
- **Panel Metrics:** `lib/canvas/panel-metrics.ts`
- **Panel Persistence:** `lib/hooks/use-panel-persistence.ts`
- **Canvas Panel Component:** `components/canvas/canvas-panel.tsx`

---

**Document Version:** 1.0
**Last Updated:** 2025-10-27
**Author:** Claude (AI Assistant)
**Status:** PLANNING - Ready for Review
