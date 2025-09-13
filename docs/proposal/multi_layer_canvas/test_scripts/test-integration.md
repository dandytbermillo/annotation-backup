# Multi-Layer Canvas Integration Test Script

## Prerequisites
1. Start the development server: `npm run dev`
2. Open browser to http://localhost:3000

## Test Steps

### 1. Enable Feature Flag
Open browser console and run:
```javascript
localStorage.setItem('offlineFeatureFlags', JSON.stringify({ 'ui.multiLayerCanvas': true }))
location.reload()
```

### 2. Verify LayerProvider Wrapping
- Open React DevTools
- Search for "LayerProvider" component
- Should see NotesExplorerPhase1 wrapped by LayerProvider

### 3. Test Popup Creation and Auto-Switch
1. Open Notes Explorer sidebar
2. Hover over a folder with the eye icon
3. Expected: 
   - Popup appears
   - Layer automatically switches to 'popups' (check in React DevTools)
   - Toast notification appears

### 4. Test Keyboard Shortcuts
- **Tab**: Toggle between notes and popups layers
- **Escape**: Focus notes canvas
- **Cmd/Ctrl+1**: Switch to notes layer
- **Cmd/Ctrl+2**: Switch to popups layer
- **Cmd/Ctrl+B**: Toggle sidebar visibility
- **Cmd/Ctrl+0**: Reset view to origin

### 5. Test Canvas Panning
1. Hold **Space** and drag: Should pan the active layer
2. Hold **Alt** and drag: Should pan only the popup layer

### 6. Test Popup Dragging
1. Create a popup by hovering on a folder
2. Click and drag the popup header
3. Expected: Popup moves with mouse
4. Release: Popup stays in new position

### 7. Test Coordinate Transformation
1. Create multiple popups
2. Pan the popup layer (Alt+drag)
3. Create new popup
4. Expected: New popup position accounts for layer transform

### 8. Test Viewport Culling
1. Create many popups across screen
2. Pan far away
3. Check DOM: Only visible popups should be rendered

### 9. Test RAF Batching
1. Rapidly pan while popups are visible
2. Expected: Smooth 60fps animation
3. Check Performance tab: Transform updates batched

### 10. Test Hybrid Sync
1. Create popups in legacy mode (feature flag off)
2. Enable feature flag
3. Expected: Existing popups migrate to layer system
4. Drag/close popups: State syncs between systems

## Expected Results

✅ **Phase 1.1 Integration**: 
- LayerProvider wraps component
- PopupOverlay renders instead of legacy popups

✅ **Phase 1.2 Tests**: 
- Unit tests pass for CoordinateBridge
- Coordinate math is accurate

✅ **Phase 1.3 Viewport Culling**: 
- Only visible popups in DOM
- Performance improved with many popups

✅ **Phase 1.4 RAF Batching**: 
- Smooth transforms
- No jank during panning

## Known Issues

1. TypeScript configuration errors (not runtime issues)
2. Some keyboard shortcuts may conflict with browser defaults
3. Toast notifications need styling improvements

## Debug Commands

Check layer state:
```javascript
// In React DevTools, find LayerProvider and check:
$r.props.value.activeLayer
$r.props.value.transforms
$r.props.value.layers
```

Check popup adaptation:
```javascript
// In NotesExplorerContent component:
$r.adaptedPopups
$r.hoverPopovers
```

Force layer switch:
```javascript
$r.layerContext.setActiveLayer('popups')
```