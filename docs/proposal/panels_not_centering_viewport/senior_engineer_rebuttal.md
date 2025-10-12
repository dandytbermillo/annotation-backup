# Rebuttal to Senior Engineer's Analysis

## Their Central Claim
> "your effect fires and setRenderPosition(position) yanks the DOM back during the drag"

## Why They're WRONG

### Evidence from Debug Logs

**First drag sequence:**
```
18:16:17.951 | position_update_skipped_during_drag |
  panelId: "main"
  globalDraggingPanelId: "main"
  propPosition: {x: 1979, y: 1237}
```

**The effect is SKIPPED, not fired:**
- Log shows `position_update_skipped_during_drag` (not `position_update_sources`)
- `globalDraggingPanelId === "main"` proves the check worked
- `setRenderPosition()` was NOT called during drag

### The Code is Working Correctly

```typescript
useEffect(() => {
  const isPanelBeingDragged = globalDraggingPanelId === panelId
  if (!isPanelBeingDragged) {
    setRenderPosition(position) // This does NOT run during drag
  } else {
    debugLog({ action: 'position_update_skipped_during_drag' }) // This DOES run
  }
}, [position, panelId])
```

**Proof:** The `skipped_during_drag` log only appears when the `else` branch executes.

## What They Got Right (But Misdiagnosed)

### Correct Observation
✅ The position prop DOES change during first drag:
- Before drag: `{x: 2000, y: 1500}` (centered)
- During drag: `{x: 1979, y: 1237}` (mystery value)

### Wrong Conclusion
❌ They claim this prop change causes the effect to "yank the DOM back"
❌ The effect is correctly blocked by our guard clause

## The REAL Mystery

If the effect is being skipped correctly, **why does the panel still snap?**

### Possible Explanations

1. **The snap happens OUTSIDE the useEffect:**
   - Some other code path is calling `setRenderPosition`
   - Or directly manipulating `panel.style.left/top`
   - Or the parent is forcing a re-render that resets DOM

2. **The snap happens AFTER drag ends:**
   - Not during the drag at all
   - When `globalDraggingPanelId` is set to null
   - The useEffect then fires with the wrong position prop

3. **The mystery position `{1979, 1237}` causes a re-render:**
   - Even though we skip setRenderPosition
   - The prop change might reset some ref or state
   - This affects the drag calculation in subtle ways

4. **Branch panels are involved:**
   - The main panel is fine
   - But a BRANCH panel snaps when main panel is dragged
   - We need to check logs for `branch-*` panelIds

## Their Suggestions (Evaluated)

### ✅ Good Suggestions
1. "Instrument who writes position before first drag" - **YES, we need stack traces**
2. "Confirm globalDraggingPanelId timing" - **Already confirmed, it's set correctly**
3. "Inspect parent selector that feeds position prop" - **YES, check PanelsRenderer**
4. "Verify canvasNode?.position defaults" - **YES, might be lazily initialized**

### ❌ Bad Suggestions
1. "See which initialization path runs during the drag" - **Misses that effect is skipped**
2. "Effect might observe old undefined value" - **Logs prove it observes 'main'**

## What to Actually Investigate

### 1. Find the Source of `{1979, 1237}`
This position appears during first drag but never again. Where does it come from?

**Hypothesis:** Camera panning during auto-scroll calculates "panel position in world coordinates" and someone writes it to stores.

**How to prove:** Add stack trace to dataStore.update and branchesMap.set

### 2. Check If Snap Happens During or After Drag
User says "panel moves to right side" - when exactly?
- While actively dragging and auto-scrolling?
- At the moment drag ends?
- Shortly after drag ends?

### 3. Find ALL setRenderPosition Calls
```bash
grep -n "setRenderPosition" components/canvas/canvas-panel.tsx
```

Lines where it's called:
- 357: In useEffect (skipped during drag ✓)
- 1502: In handleMouseDown (drag start)
- 1716: In handleMouseUp (drag end)

**Hypothesis:** One of these non-useEffect calls is using the wrong position.

### 4. Check Parent Re-render Behavior
PanelsRenderer passes position from `branch.position`:
```typescript
const position = branch.position || { x: 2000, y: 1500 }
```

If `branch.position` is a new object reference each render, React will think the prop changed even if values are the same. This could cause re-renders that interfere with drag.

## Conclusion

The senior engineer correctly identified that the position prop changes during first drag, but incorrectly concluded that this causes the effect to fire. Our logs prove the effect is skipped.

**The real question is not "why does the effect fire?" but "what ELSE is setting the panel position?"**

Three candidates:
1. handleMouseDown line 1502 - when drag starts, maybe uses wrong initial position
2. handleMouseUp line 1716 - when drag ends, maybe uses wrong final position
3. PanelsRenderer causing re-renders that reset some drag-related ref/state

**Next step:** Add logging to ALL three setRenderPosition calls to see which one uses the wrong value.
