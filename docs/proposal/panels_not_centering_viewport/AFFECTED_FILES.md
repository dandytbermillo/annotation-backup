# Affected Files - Panels Not Centering Viewport

## Overview
This document lists all files affected by the panel centering issue investigation. Full copies of these files are available in the `affected_files/` directory.

---

## Primary Files

### 1. `components/annotation-app.tsx`

**Backup Location:** `affected_files/annotation-app.tsx`

**Relevant Sections:**

#### Note Selection Handler (Lines 677-717)
```typescript
const handleNoteSelect = (noteId: string) => {
  // Tracks note access and triggers centering
  // Key logic: Force re-center when same note clicked
}
```

#### Centering Effect with Retry Mechanism (Lines 719-792)
```typescript
useEffect(() => {
  if (!selectedNoteId) return

  // Retry mechanism to wait for canvas to mount
  let attempts = 0
  const maxAttempts = 10

  const attemptCenter = () => {
    attempts++

    // Check if canvas is ready
    if (canvasRef.current?.centerOnPanel) {
      canvasRef.current.centerOnPanel('main')
      return
    }

    // Retry if not ready
    if (attempts < maxAttempts) {
      timeoutId = setTimeout(attemptCenter, 100)
    }
  }

  attemptCenter()
}, [selectedNoteId, centerTrigger])
```

**Issue:** Canvas ref becomes available, but centering still fails

---

### 2. `components/annotation-canvas-modern.tsx`

**Backup Location:** `affected_files/annotation-canvas-modern.tsx`

**Relevant Sections:**

#### Storage State Loading (Lines 294-407)
```typescript
useEffect(() => {
  // Load saved state from localStorage
  const snapshot = loadStateFromStorage(noteId)

  // Apply viewport settings (MODIFIED - now resets to defaults)
  setCanvasState((prev) => ({
    ...prev,
    zoom: viewport.zoom ?? prev.zoom,
    translateX: defaultViewport.translateX,  // ← Reset to default
    translateY: defaultViewport.translateY,  // ← Reset to default
    showConnections: viewport.showConnections ?? prev.showConnections,
  }))

  // Reset main panel position to default
  const restoredItems = snapshot.items.map((item) => ({
    ...item,
    position: item.itemType === 'panel' && item.panelId === 'main'
      ? { x: 2000, y: 1500 }  // ← Default position
      : item.position
  }))
}, [noteId])
```

**Issue:** Reset logic added but centering still not working

#### centerOnPanel Implementation (Lines 838-926)
```typescript
centerOnPanel: (panelId: string) => {
  const getPanelPosition = (id: string) => {
    // Get panel position from canvasItems or DOM
  }

  const attemptCenter = () => {
    const position = getPanelPosition(panelId)

    if (position) {
      // Get actual panel dimensions from DOM
      const panelElement = document.querySelector(`[data-panel-id="${panelId}"]`)
      const panelDimensions = panelElement
        ? { width: panelElement.offsetWidth, height: panelElement.offsetHeight }
        : { width: 500, height: 400 }

      // Calculate center offset
      const centerOffset = {
        x: (viewportWidth / 2 - panelDimensions.width / 2) / zoom,
        y: (viewportHeight / 2 - panelDimensions.height / 2) / zoom
      }

      // Calculate target viewport position
      const targetX = -position.x + centerOffset.x
      const targetY = -position.y + centerOffset.y

      // Disable CSS transition via DOM manipulation
      const canvasEl = document.getElementById('infinite-canvas')
      if (canvasEl) {
        canvasEl.style.transition = 'none'
        void canvasEl.offsetHeight  // Force reflow
      }

      // Update viewport with flushSync
      flushSync(() => {
        setCanvasState(prev => ({
          ...prev,
          translateX: targetX,
          translateY: targetY
        }))
      })

      // Restore transition
      if (canvasEl) {
        requestAnimationFrame(() => {
          canvasEl.style.transition = ''
        })
      }
    }
  }

  attemptCenter()
}
```

**Issue:** Calculation appears correct in logs, but visual result is wrong

#### Canvas Transform CSS (Lines 1044-1059)
```typescript
<div
  id="infinite-canvas"
  style={{
    position: 'absolute',
    transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${zoom})`,
    transformOrigin: '0 0',
    transition: isDragging ? 'none' : 'transform 0.3s ease',
    willChange: isDragging ? 'transform' : 'auto',
    backfaceVisibility: 'hidden',
    transformStyle: 'preserve-3d',
  }}
>
```

**Issue:** CSS transition was causing slide animation (fixed with DOM manipulation)

---

### 3. `lib/canvas/pan-animations.ts`

**Backup Location:** `affected_files/pan-animations.ts`

**Relevant Sections:**

#### smoothPanTo Function (Lines 71-147)
```typescript
export function smoothPanTo(
  currentViewport: ViewportState,
  targetPosition: { x: number; y: number },
  updateViewport: (viewport: Partial<ViewportState>) => void,
  options: PanOptions = {}
): () => void {
  const { duration = 500, ease = easings.easeInOutCubic, offset = { x: 0, y: 0 }, callback } = options

  // Calculate target viewport position (negative because we're moving the viewport)
  const targetX = -targetPosition.x + offset.x
  const targetY = -targetPosition.y + offset.y

  // If duration is 0 or negative, update immediately without animation
  if (duration <= 0) {
    updateViewport({ x: targetX, y: targetY })
    callback?.()
    return () => {}
  }

  // Otherwise animate with RAF
  // ...
}
```

#### panToPanel Function (Lines 152-189)
```typescript
export function panToPanel(
  panelId: string,
  getPanelPosition: (id: string) => { x: number; y: number } | null,
  currentViewport: ViewportState,
  updateViewport: (viewport: Partial<ViewportState>) => void,
  options: PanOptions = {}
): boolean {
  const position = getPanelPosition(panelId)
  if (!position) return false

  // Default panel dimensions
  const panelDimensions = { width: 500, height: 400 }
  const viewportDimensions = { width: window.innerWidth, height: window.innerHeight }

  // Calculate offset to center the panel
  const centerOffset = {
    x: (viewportDimensions.width / 2 - panelDimensions.width / 2) / currentViewport.zoom,
    y: (viewportDimensions.height / 2 - panelDimensions.height / 2) / currentViewport.zoom
  }

  smoothPanTo(currentViewport, position, updateViewport, { ...options, offset: centerOffset })
  return true
}
```

**Note:** This code was NOT being used in the latest fix attempt. We duplicated the logic in `centerOnPanel` instead.

---

### 4. `lib/canvas/canvas-storage.ts`

**Backup Location:** `affected_files/canvas-storage.ts`

**Relevant Sections:**

#### State Loading (Lines ~30-60)
```typescript
export function loadStateFromStorage(noteId: string): CanvasSnapshot | null {
  try {
    const key = `canvas_state_${noteId}`
    const stored = localStorage.getItem(key)
    if (!stored) return null

    const snapshot = JSON.parse(stored) as CanvasSnapshot
    return snapshot
  } catch (error) {
    console.error('[CanvasStorage] Failed to load state:', error)
    return null
  }
}
```

#### State Saving (Lines ~70-100)
```typescript
export function saveStateToStorage(
  noteId: string,
  items: CanvasItem[],
  viewport: ViewportSnapshot
): void {
  try {
    const snapshot: CanvasSnapshot = {
      items,
      viewport,
      savedAt: Date.now()
    }

    const key = `canvas_state_${noteId}`
    localStorage.setItem(key, JSON.stringify(snapshot))
  } catch (error) {
    console.error('[CanvasStorage] Failed to save state:', error)
  }
}
```

**Issue:** Auto-save may be restoring old viewport positions immediately after centering

---

## Timeline of Changes

### Session 1: Fix Slide Animation
1. Added `duration: 0` to `panToPanel` call
2. Added `isInstantCentering` flag to disable CSS transition
3. Used `flushSync` to force separate renders
4. **Result:** ❌ Failed - React batched updates

### Session 2: Direct DOM Manipulation
1. Used direct DOM manipulation to disable transition
2. Forced reflow with `offsetHeight`
3. Wrapped viewport update in `flushSync`
4. **Result:** ✅ Eliminated slide animation, but centering still broken

### Session 3: Fix Storage Race Condition
1. Reset viewport to defaults when loading state
2. Reset main panel position to default (2000, 1500)
3. Added resets to all code paths (pending snapshot, fresh content, etc.)
4. **Result:** 🔴 Testing in progress

---

## Debug Log Snapshots

### Latest Working Debug Output (2025-10-12 03:00:26)
```json
{
  "component": "AnnotationCanvas",
  "action": "panel_dimensions",
  "metadata": {
    "panelId": "main",
    "panelFound": true,
    "panelDimensions": {"width": 600, "height": 500},
    "viewportDimensions": {"width": 1554, "height": 892},
    "zoom": 1
  }
}

{
  "component": "AnnotationCanvas",
  "action": "calculated_target",
  "metadata": {
    "panelId": "main",
    "position": {"x": 2299.99, "y": 1749.99},
    "targetX": -1822.99,
    "targetY": -1553.99,
    "currentX": -1000,
    "currentY": -1200
  }
}

{
  "component": "AnnotationCanvas",
  "action": "viewport_updated_instant",
  "metadata": {
    "panelId": "main",
    "targetX": -1822.99,
    "targetY": -1553.99
  }
}
```

**Analysis:**
- Panel found: ✅
- Dimensions correct: ✅
- Target calculated: ✅
- Viewport updated: ✅
- **But panel appears in upper-left corner on screen** ❌

---

## Known Issues

1. **Viewport state not resetting properly between notes**
   - Stale values from previous note may persist
   - Reset logic added but needs verification

2. **Storage auto-save may override centering**
   - Auto-save runs on state changes
   - May restore old viewport immediately after centering

3. **Coordinate system transformation unclear**
   - Calculation appears correct but visual result wrong
   - May be mismatch between world/viewport/screen coordinates

4. **Panel position in DOM may not match state**
   - Panel's actual DOM position needs verification
   - Transform may not be applied correctly

---

## Next Steps

See `RESEARCH_PLAN.md` for detailed investigation steps.

Priority tasks:
1. Verify viewport reset is actually applied before centering
2. Check if storage auto-save overrides centered position
3. Validate centering math with manual calculation
4. Inspect actual DOM transform values after centering
