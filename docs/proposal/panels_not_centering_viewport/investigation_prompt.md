# Investigation Prompt: First-Drag Auto-Scroll Panel Snapping Issue

## Problem Description

When dragging panels (main or branch) to the edge of the viewport to trigger auto-scroll:
- **First drag to edge**: Panel(s) snap/move to the right side of the screen (incorrect behavior)
- **Second and subsequent drags to edge**: Auto-scroll works correctly, no snapping occurs

This is a **first-drag-only** issue that does not reproduce on subsequent drags.

## Expected Behavior

Panels should remain where the user is dragging them during auto-scroll. No unexpected position changes should occur.

## Current Implementation Context

### Files Involved
- `components/canvas/canvas-panel.tsx` - Panel drag handling and auto-scroll logic
- `components/annotation-canvas-modern.tsx` - Canvas state management
- `lib/hooks/use-layer-manager.ts` - LayerManager for z-index and position tracking

### Key Code Areas

1. **Auto-scroll handler** (canvas-panel.tsx, lines 543-603)
   - Uses camera-based panning when `isCameraEnabled: true`
   - Updates `dragState.current.autoScrollOffset`
   - Calculates panel position: `initialPosition + pointerDelta - autoScrollOffset`

2. **Position synchronization useEffect** (canvas-panel.tsx, lines 333-370)
   - Runs when `position` prop changes
   - Skips updates when `globalDraggingPanelId === panelId`
   - Sets `renderPosition` which controls panel CSS position

3. **Drag end handler** (canvas-panel.tsx, lines 1678-1767)
   - Updates LayerManager position
   - Updates dataStore and branchesMap
   - Sets `globalDraggingPanelId = null`
   - Calls `setRenderPosition(finalPosition)`

### Debug Logs Available

Run this query to see the sequence of events:
```sql
SELECT
  to_char(created_at, 'HH24:MI:SS.MS') as time,
  action,
  metadata->>'panelId' as panel_id,
  metadata->>'isPanelBeingDragged' as is_dragging,
  metadata->>'globalDraggingPanelId' as dragging_panel,
  metadata
FROM debug_logs
WHERE component = 'CanvasPanel'
  AND created_at >= NOW() - INTERVAL '2 minutes'
ORDER BY created_at ASC;
```

## Investigation Tasks

### 1. Check for State Initialization Issues
**Hypothesis**: Something is not properly initialized on first drag that gets initialized on subsequent drags.

Check:
- [ ] Initial state of `dragState.current` before first vs second drag
- [ ] Initial state of `renderPosition` before first vs second drag
- [ ] LayerManager node state before first vs second drag
- [ ] dataStore vs branchesMap position values at drag start

**Debug approach**: Add logging to `handleMouseDown` (drag_start) showing ALL position sources:
- `panel.style.left/top`
- `renderPosition`
- `position` prop
- `canvasNode?.position`
- `dataStore.get(panelId).position`
- `branchesMap.get(panelId).position`

### 2. Check for Position Prop Changes During First Drag
**Hypothesis**: The `position` prop is changing during the first drag, triggering the useEffect.

Check:
- [ ] Is `position_update_sources` logged during first drag but not subsequent drags?
- [ ] Does the `position` prop have different values first vs second drag?
- [ ] Is `branch.position` in PanelsRenderer returning different values?

**Debug approach**:
```typescript
// In PanelsRenderer (annotation-canvas-modern.tsx line 1480)
const position = branch.position || { x: 2000, y: 1500 }
console.log('[PanelsRenderer] Panel position:', { panelId, position, branchPosition: branch.position })
```

### 3. Check for React Re-render Differences
**Hypothesis**: First drag triggers more re-renders than subsequent drags, causing position resets.

Check:
- [ ] Count of `position_update_sources` events: first drag vs second drag
- [ ] Count of `position_update_skipped_during_drag` events: first vs second
- [ ] Timing between `drag_start` and first `auto_scroll` event

**Debug approach**: Add render counter in canvas-panel.tsx:
```typescript
const renderCountRef = useRef(0)
renderCountRef.current++
console.log('[CanvasPanel] Render #', renderCountRef.current, { panelId, isDragging: dragState.current?.isDragging })
```

### 4. Check Camera/Viewport State
**Hypothesis**: Camera state is different on first drag vs subsequent drags.

Check:
- [ ] Is `isCameraEnabled` the same for both drags?
- [ ] Is `canvasState` (translateX, translateY, zoom) different?
- [ ] Is `panAccumulation` reset between drags?

**Debug approach**: Log camera state in auto-scroll handler:
```typescript
debugLog({
  component: 'CanvasPanel',
  action: 'auto_scroll_camera_state',
  metadata: {
    panelId,
    isCameraEnabled,
    // Get current camera state from context
  }
})
```

### 5. Check for Branch Panel Side Effects
**Hypothesis**: When both main + branch panels exist, one affects the other on first drag.

Check:
- [ ] Do branch panels receive position updates during main panel drag?
- [ ] Does the issue occur with only main panel (no branches)?
- [ ] Are multiple panels' positions being updated simultaneously?

**Debug approach**:
- Test with only main panel (no branches)
- Add logging to PanelsRenderer to track all panel positions during drag

### 6. Check LayerManager Position Updates
**Hypothesis**: LayerManager position updates during first drag trigger the useEffect.

Check:
- [ ] Does `layerManager.updateNode()` get called during drag (not just at end)?
- [ ] Does `canvasNode?.position` change during first drag?
- [ ] Is LayerManager state different on first load vs after first drag?

**Debug approach**: Add logging to LayerManager's updateNode method

### 7. Check for Auto-Save Interference
**Hypothesis**: Despite disabling auto-save, some persistence mechanism is interfering.

Check:
- [ ] Are there any localStorage reads during drag?
- [ ] Is loadStateFromStorage called during drag?
- [ ] Are provider methods called during drag?

**Debug approach**: Search for localStorage access:
```bash
grep -n "localStorage" components/canvas/canvas-panel.tsx
grep -n "loadState" components/annotation-canvas-modern.tsx
```

## Questions to Answer

1. **What is different about the panel state before first drag vs second drag?**
   - Compare all position sources at drag_start for first vs second drag

2. **Does the position prop change during the first drag but not the second?**
   - Check if `position_update_sources` appears during first drag

3. **Is there a one-time initialization that happens after first drag?**
   - Check what changes in React state, LayerManager, or stores after first drag

4. **Is the issue timing-related?**
   - Measure time from drag_start to first auto_scroll for both cases

5. **Does the issue reproduce with simpler scenarios?**
   - Try with only main panel (no branches)
   - Try dragging without triggering auto-scroll first
   - Try on fresh app load vs after some interaction

## Expected Debug Log Pattern (Success Case)

For a working drag (no snapping):
```
drag_start →
drag_jitter_raf_no_react (multiple) →
auto_scroll + auto_scroll_position_update (continuous) →
position_update_skipped_during_drag (if useEffect triggers) →
drag_end →
drag_end_stores_updated →
position_update_sources (after globalDraggingPanelId = null)
```

## Expected Debug Log Pattern (Failure Case)

For first drag with snapping:
```
drag_start →
drag_jitter_raf_no_react (multiple) →
auto_scroll + auto_scroll_position_update (continuous) →
position_update_sources (UNEXPECTED - should be skipped!) →
  ↑ This causes panel to jump to position prop value
drag_end →
...
```

## Action Items

1. **Reproduce the issue** with fresh app load
2. **Capture debug logs** for first drag with snapping
3. **Capture debug logs** for second drag without snapping
4. **Compare the two logs** side-by-side to find differences
5. **Add logging** to areas that differ between first and second drag
6. **Test hypothesis** that emerges from comparison

## Next Steps After Investigation

Once you identify the root cause, document:
- What state/condition differs between first and second drag
- Why that state is different
- Where in the code this state should be initialized/fixed
- Proposed fix with explanation
