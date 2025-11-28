# Note Workspace Live-State Issues Documentation

## Overview

This document details two critical issues encountered during workspace switching and their respective fixes:

1. **Non-main panel flickering when adding notes**
2. **Non-main panel disappearance on rapid workspace switching**

Both issues stem from the complex interaction between React component lifecycle, workspace snapshot restoration, and canvas state synchronization.

---

## Issue 1: Non-Main Panel Flickering When Adding Notes

### Symptoms

- When adding a second note to a workspace, non-main panels (annotation/branch panels) flicker
- Flickering also occurs when dragging notes or performing other canvas operations
- Main panels remain stable

### Root Cause

This issue was **introduced** by attempted fixes for Issue 2 (workspace switching). Two approaches were tried, both causing flickering:

#### Failed Fix Attempt 1: Validation Approach

**Location**: `lib/hooks/annotation/use-canvas-note-sync.ts`

**Code**:
```typescript
// Filter noteIds to only those with workspace positions
const notesWithValidPositions = noteIds.filter(id =>
  resolveWorkspacePosition(id) !== null
)

if (notesWithValidPositions.length === 0 && noteIds.length > 0) {
  debugLog({
    component: "AnnotationCanvas",
    action: "noteIds_sync_skip_no_valid_positions",
    metadata: {
      noteIds,
      reason: "no_notes_have_workspace_positions",
    },
  })
  return prev // Skip sync entirely
}
```

**Why it caused flickering**:
- When adding new notes, they don't have workspace positions yet (still at default)
- This validation triggered false positives during normal operations
- Sync would skip when it shouldn't, causing panels to disappear temporarily
- Resulted in visible flicker as panels were removed and re-added

#### Failed Fix Attempt 2: Main Panel Restoration

**Location**: `lib/hooks/annotation/use-canvas-note-sync.ts`

**Code**:
```typescript
if (revisionChanged) {
  // When workspace changes, restore only main panels from workspace positions
  const mainPanels: CanvasItem[] = noteIds.map(id => {
    const position = resolveWorkspacePosition(id) ?? getDefaultMainPosition()
    const storeKey = ensurePanelKey(id, "main")
    return createPanelItem("main", position, "main", id, storeKey)
  })

  debugLog({
    component: "AnnotationCanvas",
    action: "workspace_switch_restoring_main_panels",
    metadata: {
      workspaceSnapshotRevision,
      noteIds,
      panelCount: mainPanels.length,
    },
  })

  return mainPanels // Let hydration add non-main panels
}
```

**Why it caused flickering**:
- Cleared all non-main panels and returned only main panels
- Relied on `useNonMainPanelHydration` to fetch and re-add non-main panels asynchronously
- Created a visible gap between clearing non-main panels and re-adding them
- Both main and non-main panels flickered during this transition

### Solution

The final fix that resolved both Issue 1 and Issue 2 was **synchronous initialization** (see Issue 2 solution below). By computing initial canvas items synchronously on mount, we avoided triggering unnecessary sync operations that caused flickering.

---

## Issue 2: Non-Main Panel Disappearance on Rapid Workspace Switching

### Symptoms

- After rapid workspace switching (e.g., A → B → A → B), workspace B shows:
  - Empty canvas (0 panels), OR
  - Default workspace content instead of workspace B's content
- Non-main panels disappear completely
- Main panels may also be missing

### Root Cause Analysis

#### 1. Component Unmount/Remount Cycles

Debug logs showed:
```
isFirstMount: true, previousRevision: null
```

This appeared on **subsequent** workspace switches, indicating the component was remounting, not just updating.

**Why remounting occurs**:
- Workspace switches trigger parent component re-renders
- React's reconciliation sometimes unmounts and remounts the canvas component
- Each remount starts with a fresh component instance

#### 2. Empty State Initialization

**Location**: `lib/hooks/annotation/use-canvas-items.ts` (original code)

```typescript
export function useCanvasItems({ noteId }: UseCanvasItemsOptions): UseCanvasItemsResult {
  const [canvasItems, internalSetCanvasItems] = useState<CanvasItem[]>([])
  // ...
}
```

**Problem**:
- `useState([])` initializes with empty array on **every** mount
- During rapid switching, component remounts frequently
- Each remount starts with `canvasItems = []`
- Results in empty canvas

#### 3. Snapshot Restore State Updates Lost

**Sequence during rapid switching**:

1. **User switches to workspace B**:
   - `workspaceSnapshotRevision` changes
   - Snapshot restore calls `setCanvasItems(snapshotData)`
   - State update scheduled

2. **Before state commits, user switches back to workspace A**:
   - Component unmounts (workspace B)
   - Scheduled state update is lost
   - Component remounts (workspace A)
   - Starts with empty array again

3. **Sync runs with wrong data**:
   ```
   noteIds_sync_effect_triggered:
   - noteIds: [from old workspace]
   - workspaceSnapshotRevision: [new value]
   - currentItemsCount: 0
   ```

**Why sync fails**:
- `noteIds` and `workspaceSnapshotRevision` don't update atomically
- Sync runs with mismatched data
- Filters out panels because noteIds don't match current workspace
- Canvas stays empty

#### 4. Debug Log Evidence

**Empty canvas renders**:
```json
{
  "component": "AnnotationCanvas",
  "action": "rendering_panels_list",
  "metadata": {
    "hydrationReady": true,
    "totalCanvasItems": 0,
    "totalPanels": 0,
    "panelIds": []
  }
}
```

**Sync with empty state**:
```json
{
  "component": "AnnotationCanvas",
  "action": "noteIds_sync_effect_triggered",
  "metadata": {
    "noteIds": ["note-456"],
    "currentItemsCount": 0,
    "workspaceSnapshotRevision": 5
  }
}
```

### Solution: Synchronous Initialization with useMemo

Instead of relying on asynchronous state updates, compute initial canvas items **synchronously** when the component mounts.

#### Implementation

**Step 1: Modify `use-canvas-items.ts` to accept initial items**

```typescript
type UseCanvasItemsOptions = {
  noteId: string
  initialItems?: CanvasItem[]  // NEW: Allow passing initial items
}

export function useCanvasItems({ noteId, initialItems = [] }: UseCanvasItemsOptions): UseCanvasItemsResult {
  const [canvasItems, internalSetCanvasItems] = useState<CanvasItem[]>(initialItems)
  const canvasItemsRef = useRef<CanvasItem[]>(canvasItems)
  // ...rest of hook unchanged
}
```

**Step 2: Add useMemo in `annotation-canvas-modern.tsx` to compute initial items**

```typescript
import { CanvasItem, createPanelItem } from "@/types/canvas-items"

// Compute initial canvas items synchronously from workspace data
// This prevents empty canvas during rapid workspace switches (unmount/remount cycles)
const initialCanvasItems = useMemo(() => {
  if (!noteIds || noteIds.length === 0) {
    debugLog({
      component: "AnnotationCanvas",
      action: "initial_canvas_items_empty",
      metadata: {
        reason: "no_noteIds",
        workspaceSnapshotRevision,
      },
    })
    return []
  }

  // Create main panels from workspace positions synchronously
  const mainPanels = noteIds.map(id => {
    const position = resolveWorkspacePosition(id) ?? getDefaultMainPosition()
    const storeKey = ensurePanelKey(id, "main")
    return createPanelItem("main", position, "main", id, storeKey)
  })

  debugLog({
    component: "AnnotationCanvas",
    action: "initial_canvas_items_computed",
    metadata: {
      workspaceSnapshotRevision,
      noteIds,
      panelCount: mainPanels.length,
      positions: mainPanels.map(p => ({ noteId: p.noteId, position: p.position })),
    },
  })

  return mainPanels
}, [workspaceSnapshotRevision, noteIds, resolveWorkspacePosition])

// Pass initial items to useCanvasItems
const {
  canvasItems,
  setCanvasItems,
  canvasItemsRef,
  dedupeWarnings,
  updateDedupeWarnings,
} = useCanvasItems({ noteId, initialItems: initialCanvasItems })
```

#### Why This Works

1. **Synchronous Computation**:
   - `useMemo` runs during render, before component mounts
   - Initial items computed from workspace data immediately
   - No async state updates that can be lost during unmount

2. **Stable Dependencies**:
   - `workspaceSnapshotRevision` is the primary dependency
   - When workspace changes, `useMemo` recomputes
   - New initial items are created with correct workspace positions

3. **No Empty State**:
   - Component never starts with empty array
   - Main panels always present from the start
   - Non-main panels added by hydration hook after mount

4. **Atomic Update**:
   - `initialItems` and `workspaceSnapshotRevision` always match
   - No race between props updating and state initializing
   - Sync logic runs on correct data

#### Files Changed

1. **`lib/hooks/annotation/use-canvas-items.ts`**:
   - Added `initialItems?: CanvasItem[]` parameter
   - Changed `useState<CanvasItem[]>([])` to `useState<CanvasItem[]>(initialItems)`

2. **`components/annotation-canvas-modern.tsx`**:
   - Added import: `createPanelItem`
   - Added `useMemo` block to compute `initialCanvasItems`
   - Passed `initialItems: initialCanvasItems` to `useCanvasItems`

#### Validation

Type-check passed with no new errors:
```bash
$ npm run type-check
# No errors related to these changes
```

---

## Related Components

### useCanvasNoteSync
**Location**: `lib/hooks/annotation/use-canvas-note-sync.ts`

**Role**: Synchronizes canvas items with note list changes

**Existing guards** (still in place):
- Skip sync during `workspaceRestorationInProgressRef.current === true`
- Skip sync when `revisionChanged` (let snapshot restore handle it)
- Skip sync during `hydrationInProgressRef.current === true`

**Interaction with fix**:
- Sync still runs but operates on correctly initialized state
- No longer encounters empty canvas on rapid switches
- Guards prevent conflicts with workspace restoration

### useNonMainPanelHydration
**Location**: `lib/hooks/annotation/use-non-main-panel-hydration.ts`

**Role**: Fetches non-main panels from database after workspace restoration

**Interaction with fix**:
- Still runs after workspace switches to load non-main panels
- Now operates on canvas that already has main panels
- No flickering because it adds panels, doesn't replace them

### PanelsRenderer
**Location**: `components/canvas/panels-renderer.tsx`

**Role**: Renders canvas panels from `canvasItems` state

**Interaction with fix**:
- Receives correctly initialized canvas items from the start
- No longer sees empty arrays during workspace switches
- `hydrationReady` logic still prevents non-main panels from showing too early during initial page load

---

## Summary

Both issues were fundamentally caused by React's asynchronous state updates interacting poorly with rapid workspace switches:

- **Flickering**: Attempted fixes that cleared non-main panels and relied on async hydration to restore them
- **Empty canvas**: Component remounting with empty state, losing scheduled state updates

**Final solution**: Synchronous initialization using `useMemo` ensures canvas items are computed from workspace data immediately on mount, eliminating both flickering and empty canvas issues.

**Key insight**: For rapidly changing UI state (workspace switches), prefer synchronous computation (useMemo) over asynchronous state updates (useEffect + setState).
