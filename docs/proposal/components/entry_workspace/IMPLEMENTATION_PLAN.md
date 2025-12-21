# Entry Workspace Wheel Scrolling Implementation Plan

**Feature Slug:** `entry_workspace_wheel_scrolling`
**Created:** 2025-12-21
**Status:** Planning

---

## 1. Overview

### Problem Statement
The Entry Workspace (infinite canvas) currently requires users to:
- Hold **Shift + Wheel** to zoom
- Hold **Space + Click+Drag** or use the **Pan tool** to pan/scroll

This differs from the Entry Dashboard, which uses native browser scrolling where **plain mouse wheel** scrolls the content naturally.

### Goal
Add plain wheel panning to the Entry Workspace so users can pan the canvas without modifier keys. This provides wheel-pan parity, but not identical dashboard behavior because the workspace uses transform-based infinite canvas (no native scrollbars/momentum). Exact parity would require Option B.

---

## 2. Current Architecture Analysis

### Entry Dashboard Scrolling (DashboardView.tsx)

| Component | Implementation |
|-----------|---------------|
| Container | `<div ref={dashboardContainerRef} className="overflow-auto">` |
| Scroll Type | Native browser scroll via CSS `overflow-auto` |
| Canvas Size | Dynamic: `Math.max(viewport + 200, maxPanelEdge + 500)` |
| Wheel Behavior | Native scroll (no JS handling needed) |
| Auto-scroll | `useAutoScroll` hook during panel drag |

**Key Code Locations:**
- Container: `DashboardView.tsx:1324-1330`
- Canvas sizing: `DashboardView.tsx:153-187`
- Auto-scroll: `DashboardView.tsx:192-294`

### Entry Workspace Scrolling (annotation-canvas-modern.tsx)

| Component | Implementation |
|-----------|---------------|
| Container | Fixed viewport with CSS transforms |
| Scroll Type | Transform-based (`translateX`, `translateY`, `scale`) |
| Canvas Size | "Infinite" (no boundaries) |
| Wheel Behavior | Shift+Wheel = zoom only |
| Auto-scroll | `useAutoScroll` during panel drag (CanvasPanel) |

**Key Code Locations:**
- Wheel handler: `use-canvas-pointer-handlers.ts:126-150`
- Transform state: `use-canvas-transform.ts`
- Canvas render: `annotation-canvas-modern.tsx:1204-1209`
- Auto-scroll: `components/canvas/canvas-panel.tsx:963-1035`

---

## 3. Implementation Options

### Option A: Add Wheel Panning (Recommended)
**Complexity:** Low
**Risk:** Low
**Changes:** 1 file

Add plain wheel panning to the existing infinite canvas system. Wheel without Shift pans the canvas; Shift+Wheel continues to zoom.

**Pros:**
- Minimal code change
- Preserves infinite canvas architecture
- No impact on existing zoom behavior
- Works with trackpads (two-finger scroll = pan)

**Cons:**
- Editors inside panels need wheel event passthrough
- Not identical to dashboard native scroll (no scrollbar/momentum)

### Option B: Convert to Scrollable Container
**Complexity:** High
**Risk:** High
**Changes:** 10+ files

Replace the infinite canvas transform system with a scrollable container like the dashboard.

**Pros:**
- Identical behavior to dashboard
- Native scrollbars visible
- Native momentum scrolling on trackpads

**Cons:**
- Major architectural refactor
- Affects camera persistence, minimap, panel positioning
- May break existing workspace features
- Loses "infinite" canvas feel

### Recommendation
**Option A** for wheel-pan parity. If you need identical dashboard behavior, choose **Option B**.

---

## 4. Detailed Implementation Plan (Option A)

### Phase 1: Core Wheel Panning

#### Task 1.1: Modify Wheel Handler
**File:** `lib/hooks/annotation/use-canvas-pointer-handlers.ts`

**Current Behavior:**
```typescript
const handleWheel = useCallback(
  (event: React.WheelEvent) => {
    captureInteractionPoint(event)
    if (!event.shiftKey) {
      return  // <-- Ignores non-shift wheel events
    }
    // ... zoom logic
  },
  [...]
)
```

**New Behavior:**
```typescript
const handleWheel = useCallback(
  (event: React.WheelEvent) => {
    captureInteractionPoint(event)

    if (event.shiftKey) {
      // Shift + Wheel = Zoom (existing behavior)
      event.preventDefault()
      // ... existing zoom logic ...
    } else {
      // Plain Wheel = Pan/Scroll

      // Check if inside an editor (let editors handle their own scroll)
      const target = event.target as HTMLElement
      const isInsideEditor = target.closest('.tiptap') ||
                             target.closest('[contenteditable]') ||
                             target.closest('.ProseMirror')

      if (isInsideEditor) {
        return  // Let editor handle scroll
      }

      event.preventDefault()

      // Pan canvas (invert delta for natural scroll direction)
      // Scale by zoom so pan speed feels consistent at non-1x zoom.
      const zoom = Math.max(0.01, canvasState.zoom)
      updateCanvasTransform(prev => ({
        ...prev,
        translateX: prev.translateX - (event.deltaX / zoom),
        translateY: prev.translateY - (event.deltaY / zoom),
      }))
    }
  },
  [canvasState.zoom, captureInteractionPoint, updateCanvasTransform],
)
```

#### Task 1.2: Handle Wheel Event Propagation
**File:** `components/annotation-canvas-modern.tsx`

Ensure wheel events on the canvas background are captured but events inside panels/editors are allowed to propagate.

**Current (line 1206-1208):**
```tsx
onMouseDown={handleCanvasMouseDown}
onWheel={handleWheel}
onMouseMoveCapture={handleCanvasMouseMoveCapture}
```

No change needed here - the handler itself will check the target.

---

### Phase 2: Editor Scroll Passthrough

#### Task 2.1: Allow Editor Scrolling
Editors (TipTap) inside panels need to scroll their own content when the cursor is over them.

**Logic:**
1. Check if `event.target` is inside `.ProseMirror`, `.tiptap-editor`, `.tiptap-editor-content`, or `[contenteditable]`
2. If yes: Do not `preventDefault()`, let the event bubble to the editor
3. If no: Pan the canvas

**Edge Cases:**
- Editor is at scroll boundary (top/bottom) → Should we pan canvas or stop?
- Recommendation: Let editor consume all wheel events when focused

#### Task 2.2: Component Panel Scrolling
Component panels (calculator, timer, sticky note) may have scrollable content.

**Logic:**
- Check if target is inside `[data-component-panel]` with scrollable content
- If scrollable: Let component handle wheel
- If not scrollable: Pan canvas

---

### Phase 3: Scroll Sensitivity & Smoothing (Optional Enhancement)

#### Task 3.1: Add Scroll Speed Multiplier
Allow customization of pan speed.

```typescript
const PAN_SPEED_MULTIPLIER = 1.0  // Adjustable

updateCanvasTransform(prev => ({
  ...prev,
  translateX: prev.translateX - (event.deltaX * PAN_SPEED_MULTIPLIER),
  translateY: prev.translateY - (event.deltaY * PAN_SPEED_MULTIPLIER),
}))
```

#### Task 3.2: Momentum Scrolling (Future)
For trackpad users, could add momentum/inertia to panning for smoother feel.

**Complexity:** Medium
**Recommendation:** Defer to future iteration

---

### Phase 4: Auto-scroll During Panel Drag (Already Implemented)

#### Task 4.1: Document Existing Auto-scroll
Workspace panels already use `useAutoScroll` during drag in `components/canvas/canvas-panel.tsx:963-1035`. Confirm the settings align with dashboard behavior; adjust thresholds/speeds only if you want closer parity.

**Files to review:**
- `components/canvas/canvas-panel.tsx` (existing auto-scroll)

**Current Dashboard Implementation:**
```typescript
const { checkAutoScroll, stopAutoScroll } = useAutoScroll({
  enabled: !!draggingPanelId,
  threshold: 50,
  speedPxPerSec: 400,
  activationDelay: 300,
  onScroll: handleDashboardAutoScroll,
  containerRef: dashboardContainerRef,
})
```

**Workspace Adaptation:**
```typescript
const handleWorkspaceAutoScroll = useCallback((deltaX: number, deltaY: number) => {
  // Instead of container.scrollLeft/scrollTop, update canvas transform
  updateCanvasTransform(prev => ({
    ...prev,
    translateX: prev.translateX + deltaX,
    translateY: prev.translateY + deltaY,
  }))
}, [updateCanvasTransform])
```

**Complexity:** Medium
**Recommendation:** Implement after Phase 1-2 are stable

---

## 5. Testing Plan

### Manual Testing Checklist

#### Basic Wheel Panning
- [ ] Wheel up → Canvas pans up (content moves down)
- [ ] Wheel down → Canvas pans down (content moves up)
- [ ] Wheel left → Canvas pans left (if supported by mouse)
- [ ] Wheel right → Canvas pans right (if supported by mouse)
- [ ] Trackpad two-finger scroll → Canvas pans in scroll direction

#### Zoom Behavior (Preserved)
- [ ] Shift + Wheel up → Zoom in (centered on cursor)
- [ ] Shift + Wheel down → Zoom out (centered on cursor)

#### Editor Scroll Passthrough
- [ ] Cursor over TipTap editor → Wheel scrolls editor content
- [ ] Cursor over editor at scroll boundary → Editor handles event
- [ ] Cursor outside editor but inside panel → Canvas pans

#### Component Panel Scrolling
- [ ] Sticky note with long content → Wheel scrolls note content
- [ ] Calculator (no scroll) → Canvas pans

#### Edge Cases
- [ ] Rapid wheel events → No jank or lag
- [ ] Wheel during panel drag → Behavior is sensible
- [ ] Wheel while zoomed in/out → Pan distance scales correctly

### Automated Tests
```typescript
// tests/canvas-wheel-panning.test.ts

describe('Canvas Wheel Panning', () => {
  it('pans canvas on plain wheel event', () => {
    // Simulate wheel event on canvas
    // Assert translateX/Y changed by deltaX/deltaY
  })

  it('zooms on shift+wheel event', () => {
    // Simulate shift+wheel event
    // Assert zoom changed, not translateX/Y
  })

  it('passes wheel to editor when cursor is over editor', () => {
    // Simulate wheel event with target inside .tiptap
    // Assert preventDefault was NOT called
  })
})
```

---

## 6. Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/hooks/annotation/use-canvas-pointer-handlers.ts` | Modify | Add wheel panning logic |
| `components/annotation-canvas-modern.tsx` | Review | Ensure wheel handler wiring is correct |

### Optional (Phase 4):
| File | Change Type | Description |
|------|-------------|-------------|
| `components/canvas/panels-renderer.tsx` | Modify | Add auto-scroll during drag |
| `lib/hooks/annotation/use-canvas-drag-listeners.ts` | Modify | Wire up useAutoScroll |

---

## 7. Rollback Plan

If issues arise after deployment:

1. **Revert the wheel handler change** in `use-canvas-pointer-handlers.ts`
2. **Restore original behavior**: Return early when `!event.shiftKey`

The change is isolated to one function, making rollback simple.

---

## 8. Implementation Timeline

| Phase | Tasks | Estimated Effort |
|-------|-------|------------------|
| Phase 1 | Core wheel panning | 30 minutes |
| Phase 2 | Editor scroll passthrough | 30 minutes |
| Phase 3 | Scroll sensitivity (optional) | 15 minutes |
| Phase 4 | Auto-scroll during drag (optional) | 1-2 hours |

**Total (Phase 1-2):** ~1 hour
**Total (All phases):** ~3 hours

---

## 9. Acceptance Criteria

### Must Have
- [ ] Plain mouse wheel pans the canvas (no modifier keys required)
- [ ] Shift + Wheel continues to zoom (existing behavior preserved)
- [ ] Editors inside panels can still scroll their content with wheel
- [ ] No regressions in existing pan (Space+Drag) or zoom behavior

### Nice to Have
- [ ] Auto-scroll when dragging panels near canvas edge
- [ ] Configurable scroll speed multiplier
- [ ] Smooth momentum scrolling for trackpads

---

## 10. References

- Dashboard scroll implementation: `components/dashboard/DashboardView.tsx:150-294`
- Current wheel handler: `lib/hooks/annotation/use-canvas-pointer-handlers.ts:126-150`
- Auto-scroll hook: `components/canvas/use-auto-scroll.ts`
- Canvas transform hook: `lib/hooks/annotation/use-canvas-transform.ts`
