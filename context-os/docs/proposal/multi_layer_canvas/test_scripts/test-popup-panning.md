# Testing Popup Overlay Panning - Phase 1+

## Test Steps

### 1. Open the application
- Navigate to http://localhost:3001
- Open browser DevTools Console

### 2. Create test popups
1. Select a note from the explorer
2. Hover over a folder's eye icon to open a popup
3. Hover over another folder to open a second popup
4. Verify popups appear and connection lines are drawn

### 3. Test layer switching
1. Check that the layer indicator shows "notes" initially
2. When first popup opens, verify it auto-switches to "popups"
3. Verify the notes canvas becomes dimmed (opacity 0.6)

### 4. Test popup overlay panning
1. With "popups" layer active, click on empty space (not on a popup)
2. Drag to pan - the entire overlay should move
3. Check console for these logs:
   - "[PopupOverlay] Starting pan gesture"
   - "[PopupOverlay] Pan engaged after hysteresis"
   - "[PopupOverlay] Updating transform: {deltaDx, deltaDy, txId}"

### 5. Test gesture isolation
1. Try dragging a popup header - only that popup should move
2. Try clicking and dragging on empty space - all popups should pan together
3. Verify no conflicts between popup drag and overlay pan

### 6. Test interaction blocking
1. With "popups" layer active, try to:
   - Click on notes canvas - should not work
   - Type in editor - should not work (keyboard blocked)
   - Drag panels - should not work
2. Close all popups
3. Verify layer switches back to "notes"
4. Verify all interactions work again

### 7. Test sync behavior
1. Open popups again
2. Pan the overlay
3. Switch to notes layer (if manual switch available)
4. Verify both layers moved together (if syncPan is enabled)

## Expected Console Output

When panning starts:
```
[PopupOverlay] Starting pan gesture
```

After moving 4px (hysteresis):
```
[PopupOverlay] Pan engaged after hysteresis
[PopupOverlay] Updating transform: {deltaDx: X, deltaDy: Y, txId: N}
```

If pan is blocked:
```
[PopupOverlay] Pan blocked: {activeLayer: "notes", isEmptySpace: false, target: "..."}
```

## Debugging Tips

1. If panning doesn't work:
   - Check activeLayer is "popups"
   - Check clicking on empty space (not popup cards)
   - Check no other gesture is active
   - Check pointer-events CSS

2. If transforms don't apply:
   - Check updateTransformByDelta is defined
   - Check currentGesture has valid txId
   - Check LayerProvider is providing context

3. If sync doesn't work:
   - Check syncPan setting in LayerProvider
   - Verify delta application in updateTransform