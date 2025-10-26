# Analysis: How infinite-canvas-main Successfully Centers New Components

## Date
2025-10-26

## Purpose
This document analyzes how the infinite-canvas-main project successfully displays newly created components in the current viewport, regardless of camera position.

---

## Key Success Factors

### 1. **Simple, Direct Viewport-to-World Conversion**

**Location:** `context/canvas-context.tsx:508-531`

```typescript
const addComponent = useCallback((type: ComponentType, x?: number, y?: number, useViewportCenter: boolean = false) => {
  const size = getDefaultComponentSize(type)

  let finalX = x ?? 0
  let finalY = y ?? 0

  // If useViewportCenter is true or no coordinates provided, calculate viewport center
  if (useViewportCenter || x === undefined || y === undefined) {
    // Calculate the center of the visible viewport in canvas coordinates
    const viewportCenterX = window.innerWidth / 2
    const viewportCenterY = window.innerHeight / 2

    // Convert screen coordinates to canvas coordinates
    // Account for canvas offset and scale
    finalX = (viewportCenterX - state.offsetX) / state.scale - size.width / 2
    finalY = (viewportCenterY - state.offsetY) / state.scale - size.height / 2

    console.log(`📍 Viewport-aware positioning:`)
    console.log(`  - Viewport center (screen): (${viewportCenterX}, ${viewportCenterY})`)
    console.log(`  - Canvas offset: (${state.offsetX}, ${state.offsetY})`)
    console.log(`  - Canvas scale: ${state.scale}`)
    console.log(`  - Component size: ${size.width}x${size.height}`)
    console.log(`  - Final canvas position: (${finalX.toFixed(1)}, ${finalY.toFixed(1)})`)
  }

  // ... create component with finalX, finalY
}, [state.offsetX, state.offsetY, state.scale])
```

**Key Points:**
- ✅ **No async operations** - Calculation happens synchronously
- ✅ **Direct state access** - Uses current `state.offsetX`, `state.offsetY`, `state.scale` from React state
- ✅ **Simple formula** - `(screenX - offsetX) / scale - componentWidth/2`
- ✅ **No caching** - Always computes fresh position from current viewport state
- ✅ **No race conditions** - Everything happens in one synchronous block

---

### 2. **Component Creation Menu Explicitly Requests Viewport Centering**

**Location:** `components/infinite-canvas/add-component-menu.tsx:302-306`

```typescript
const handleOptionClick = (type: ComponentType) => {
  // Add component using viewport-aware positioning
  // This will automatically place the component in the center of the visible viewport
  // accounting for canvas scale and offset
  addComponent(type, undefined, undefined, true)  // ← TRUE flag forces viewport centering

  // Hide menu
  toggleAddMenu()
}
```

**Key Points:**
- ✅ **Explicit intent** - Passes `useViewportCenter: true` flag
- ✅ **No position passed** - Sets `x` and `y` to `undefined` so viewport centering is used
- ✅ **Clear API** - The function signature makes the intent obvious

---

### 3. **Canvas State Structure is Simple**

**Location:** `context/canvas-context.tsx:30-58`

```typescript
interface CanvasState {
  components: CanvasComponent[]
  scale: number       // ← Zoom level
  offsetX: number     // ← Camera X translation
  offsetY: number     // ← Camera Y translation
  isPanning: boolean
  isPanMode: boolean
  lastX: number
  lastY: number
  activeComponentId: string | null
  performanceMode: "balanced" | "performance" | "eco"
  // ... other state
}
```

**Key Points:**
- ✅ **Flat structure** - No nested camera object
- ✅ **Single source of truth** - State is the authoritative source
- ✅ **Direct access** - No need for refs or getters
- ✅ **Simple naming** - `offsetX`, `offsetY`, `scale` are clear

---

### 4. **No Snapshot/Cache Interference**

The infinite-canvas project does NOT:
- ❌ Save component positions to localStorage and restore them
- ❌ Use `resolvePosition` functions that return cached values
- ❌ Have "fresh note seeds" or "MRU positions"
- ❌ Mix persisted and computed positions

**This is CRITICAL** - Every new component gets a freshly computed position based on current viewport.

---

### 5. **Utility Function Also Supports Viewport Centering**

**Location:** `components/infinite-canvas/utils/canvas.utils.ts:38-99`

```typescript
export const getViewportPosition = (canvasState: CanvasState, existingComponents: ComponentConfig[] = []): Position => {
  // Get current viewport bounds in world coordinates
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;

  // Calculate viewport bounds in world coordinates
  const viewportBounds = {
    left: -canvasState.offsetX,
    top: -canvasState.offsetY,
    right: -canvasState.offsetX + (viewportWidth / canvasState.scale),
    bottom: -canvasState.offsetY + (viewportHeight / canvasState.scale)
  };

  // Calculate center with some randomization to avoid overlapping
  const centerX = (viewportBounds.left + viewportBounds.right) / 2;
  const centerY = (viewportBounds.top + viewportBounds.bottom) / 2;

  // Add some randomization around the center (within 30% of viewport)
  const randomOffsetX = (Math.random() - 0.5) * (viewportWidth / canvasState.scale) * 0.3;
  const randomOffsetY = (Math.random() - 0.5) * (viewportHeight / canvasState.scale) * 0.3;

  let newX = centerX + randomOffsetX;
  let newY = centerY + randomOffsetY;

  // ... collision avoidance logic

  return { x: newX, y: newY };
};
```

**Key Points:**
- ✅ **Alternative approach** - Uses viewport bounds calculation
- ✅ **Collision avoidance** - Adds randomization and checks for overlaps
- ✅ **Same principle** - Converts screen space to world space using offset and scale

---

## Comparison with annotation-backup Project

### What annotation-backup Does WRONG

| Issue | infinite-canvas | annotation-backup |
|-------|----------------|-------------------|
| **Position calculation** | Synchronous, inline | Async via `resolveMainPanelPosition()` |
| **State access** | Direct from React state | Via refs + async cache lookup |
| **Caching** | None - always fresh | Heavy caching (localStorage, freshNoteSeeds, MRU) |
| **Race conditions** | None - synchronous | Multiple: `alreadyOpen`, async state updates |
| **Coordinate math** | `(screenX - offsetX) / scale` | `screenToWorld()` with complex transforms |
| **API clarity** | `useViewportCenter: boolean` flag | `options?.source === 'toolbar-create'` check |
| **Persistence mix** | No mixing - new = fresh, old = persisted | Mixed - sometimes cached, sometimes computed |

---

## The Core Problem in annotation-backup

The annotation-backup project has **THREE separate position sources**:

1. **Database** - Persisted panel positions from previous sessions
2. **freshNoteSeeds** - Recently computed centered positions for new notes
3. **computeVisuallyCenteredWorldPosition()** - Live calculation for current viewport

The code tries to merge these sources using `resolveMainPanelPosition()`, which creates:
- **Cache invalidation issues** - Old positions return when fresh ones are expected
- **Race conditions** - Rapid clicks skip computation entirely
- **Ordering problems** - Database → MRU → Seeds → Compute, but which wins?

### The Fix annotation-backup Needs

**STOP MIXING PERSISTENCE WITH POSITIONING**

```typescript
// WRONG (current approach)
if (isToolbarCreation && !hasExplicitPosition) {
  // Compute centered position
  const centeredPosition = computeVisuallyCenteredWorldPosition(...)
  // Save to seed cache
  setFreshNoteSeeds(prev => ({ ...prev, [noteId]: centeredPosition }))
} else if (!hasExplicitPosition && !alreadyOpen) {
  // But then immediately try to resolve from cache/DB
  const persistedPosition = resolveMainPanelPosition(noteId)  // ← Returns stale value!
  resolvedPosition = persistedPosition ?? null
}

// RIGHT (infinite-canvas approach)
if (useViewportCenter || x === undefined || y === undefined) {
  // Compute fresh position - NO CACHING
  finalX = (window.innerWidth / 2 - state.offsetX) / state.scale - size.width / 2
  finalY = (window.innerHeight / 2 - state.offsetY) / state.scale - size.height / 2
  // USE IT IMMEDIATELY
}
```

---

## Recommendations for annotation-backup

### 1. **Separate New Note Creation from Note Reopening**

**Create new notes:**
```typescript
function createNewNotePanel(noteId: string) {
  // ALWAYS compute fresh viewport-centered position
  const viewportCenter = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2
  }

  const camera = canvasRef.current?.getCameraState?.() ?? canvasState

  const worldX = (viewportCenter.x - camera.translateX) / camera.zoom - 250  // panel width / 2
  const worldY = (viewportCenter.y - camera.translateY) / camera.zoom - 200  // panel height / 2

  // Create panel at this position
  return { x: worldX, y: worldY }
}
```

**Reopen existing notes:**
```typescript
function reopenExistingNotePanel(noteId: string) {
  // Look up persisted position from database
  const persistedPosition = await fetchPanelPositionFromDB(noteId)

  if (persistedPosition) {
    return persistedPosition
  }

  // If no persisted position, treat as new note
  return createNewNotePanel(noteId)
}
```

### 2. **Remove Position Caching Layers**

- ❌ Delete `freshNoteSeeds` state
- ❌ Delete `resolveMainPanelPosition()` function
- ❌ Don't use `lastCanvasInteractionRef` for position

### 3. **Fix the alreadyOpen Race Condition**

```typescript
// Don't wrap position calculation inside !alreadyOpen check
// Compute position FIRST, then check if note is already open

const isNewNote = !openNotes.some(n => n.id === noteId)
let position: { x: number, y: number }

if (isNewNote) {
  position = createNewNotePanel(noteId)
} else {
  position = reopenExistingNotePanel(noteId)
}

// NOW check if already open (for other UI logic)
if (!alreadyOpen) {
  // ... open the workspace
}
```

### 4. **Use Direct State Access Like infinite-canvas**

```typescript
// Instead of:
const currentCamera = canvasRef.current?.getCameraState?.() ?? canvasState

// Just use:
const { translateX, translateY, zoom } = canvasState

// And make sure canvasState is in the dependency array:
}, [canvasState.translateX, canvasState.translateY, canvasState.zoom])
```

---

## Conclusion

The infinite-canvas-main project succeeds because it:

1. ✅ **Does one thing at a time** - New components = viewport centered, existing = persisted
2. ✅ **No caching** - Every new component gets fresh calculation
3. ✅ **Simple math** - Direct screen-to-world conversion
4. ✅ **Synchronous** - No async operations or race conditions
5. ✅ **Clear API** - `useViewportCenter: boolean` flag makes intent explicit

The annotation-backup project fails because it:

1. ❌ **Mixes concerns** - New note positioning mixed with reopening logic
2. ❌ **Heavy caching** - Multiple layers (DB, seeds, MRU, localStorage)
3. ❌ **Complex flow** - Async lookups, conditional branches
4. ❌ **Race conditions** - `alreadyOpen` check wraps critical logic
5. ❌ **Unclear intent** - `options?.source === 'toolbar-create'` buried in conditionals

**The fix is conceptual, not technical:** Separate "create new" from "reopen existing", and NEVER cache positions for new notes.
