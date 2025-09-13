# Phase 2: Layer Controls UI Test Script

## Prerequisites
1. Complete Phase 1 setup
2. Enable multi-layer canvas feature:
```javascript
localStorage.setItem('offlineFeatureFlags', JSON.stringify({ 'ui.multiLayerCanvas': true }))
location.reload()
```

## Test Steps

### 1. Verify Layer Controls Component
1. Open Notes Explorer
2. Look for "Layer Controls" panel in bottom-right corner
3. **Expected**: Panel shows with following sections:
   - Active Layer selector (Notes/Popups)
   - Layer Settings (visibility and opacity)
   - Sync Settings (Pan/Zoom toggles)
   - Action buttons (Reset, Sidebar, Shortcuts)

### 2. Test Active Layer Switching
1. Click "Notes" button in Active Layer section
   - **Expected**: Notes layer becomes active (blue highlight)
   - **Expected**: Visual indicator at top shows Notes active
2. Click "Popups" button
   - **Expected**: Popups layer becomes active (purple highlight)
   - **Expected**: Visual indicator updates
3. Press Tab key
   - **Expected**: Toggles between layers
4. Press Escape key
   - **Expected**: Switches to Notes layer
5. Press Cmd/Ctrl+1
   - **Expected**: Switches to Notes layer
6. Press Cmd/Ctrl+2
   - **Expected**: Switches to Popups layer

### 3. Test Layer Visibility
1. Click eye icon next to "Notes"
   - **Expected**: Notes layer hides (eye becomes eye-off)
   - **Expected**: Notes content disappears from canvas
2. Click eye-off icon
   - **Expected**: Notes layer shows again
3. Repeat for "Popups" layer
   - **Expected**: Same behavior for popups

### 4. Test Layer Opacity
1. Drag Notes opacity slider to 50%
   - **Expected**: Notes layer becomes semi-transparent
   - **Expected**: Percentage updates to show "50%"
2. Drag to 0%
   - **Expected**: Notes layer becomes invisible
3. Drag to 100%
   - **Expected**: Notes layer fully opaque
4. Repeat for Popups layer
   - **Expected**: Same behavior

### 5. Test Sync Controls
1. Click "Pan" button (should be green if synced)
   - **Expected**: Button toggles to gray (unsynced)
   - **Expected**: Link icon changes to unlink
2. With Pan unsynced:
   - Hold Space and drag on Notes layer
   - **Expected**: Only Notes layer moves
   - Switch to Popups layer
   - Hold Space and drag
   - **Expected**: Only Popups layer moves
3. Click "Pan" to re-enable sync
   - **Expected**: Both layers move together when panning
4. Test "Zoom" sync similarly
   - **Expected**: Same sync/unsync behavior for zoom

### 6. Test Action Buttons
1. Click "Reset" button
   - **Expected**: All layers return to origin (0,0)
   - **Expected**: Zoom returns to 100%
2. Click "Hide Sidebar" button
   - **Expected**: Notes Explorer sidebar hides
   - **Expected**: Button text changes to "Show Sidebar"
3. Click keyboard icon
   - **Expected**: Shortcuts modal appears
   - **Expected**: Shows all keyboard shortcuts with descriptions
4. Click X or outside modal
   - **Expected**: Modal closes

### 7. Test Visual Indicators
1. Look at top-center of screen
   - **Expected**: Floating indicator shows:
     - Active layer (blue dot for Notes, purple for Popups)
     - Sync status (green link icon if synced)
2. Switch layers
   - **Expected**: Indicator updates immediately
3. Toggle sync
   - **Expected**: Sync indicator appears/disappears

### 8. Test Control Panel Collapse
1. Click header of Layer Controls panel
   - **Expected**: Panel collapses, only header visible
   - **Expected**: Chevron icon points up
2. Click header again
   - **Expected**: Panel expands
   - **Expected**: Chevron icon points down

### 9. Test with Popups
1. Create some popups by hovering folder eye icons
2. Switch to Popups layer
3. Adjust popups opacity to 50%
   - **Expected**: All popups become semi-transparent
4. Toggle popups visibility
   - **Expected**: All popups hide/show
5. Test pan with sync off
   - **Expected**: Can position popups independently from notes

### 10. Test Keyboard Shortcuts Integration
1. Use Tab to switch layers
   - **Expected**: Layer Controls UI updates to reflect change
2. Use Cmd/Ctrl+B to toggle sidebar
   - **Expected**: Sidebar button in controls updates
3. Use Cmd/Ctrl+0 to reset view
   - **Expected**: Same as clicking Reset button

## Performance Tests

### 1. Opacity Performance
1. Create multiple popups (5-10)
2. Rapidly drag opacity slider
   - **Expected**: Smooth updates without lag
   - **Expected**: No flashing or jank

### 2. Layer Switching Performance
1. Rapidly toggle between layers using Tab
   - **Expected**: Instant switching
   - **Expected**: UI updates immediately

## Accessibility Tests

### 1. Keyboard Navigation
1. Tab through Layer Controls
   - **Expected**: All controls focusable
   - **Expected**: Focus indicators visible

### 2. Screen Reader
1. Use screen reader
   - **Expected**: All controls have proper labels
   - **Expected**: State changes announced

## Debug Commands

```javascript
// Check layer states
const layer = document.querySelector('[data-layer="popups"]')
console.log('Opacity:', layer.style.opacity)
console.log('Visibility:', layer.style.visibility)

// Check active layer
// In React DevTools, find LayerProvider
$r.props.value.activeLayer

// Check sync states
$r.props.value.syncPan
$r.props.value.syncZoom

// Programmatically update opacity
$r.props.value.updateLayerOpacity('popups', 0.5)
```

## Expected Results

✅ Layer Controls panel renders with all sections
✅ Active layer switching works via UI and keyboard
✅ Visibility toggles hide/show layers
✅ Opacity sliders adjust transparency
✅ Sync controls enable/disable coordinated movement
✅ Action buttons perform expected functions
✅ Visual indicators show current state
✅ Panel collapses and expands
✅ Keyboard shortcuts integrate with UI
✅ Performance is smooth
✅ Accessibility requirements met

## Known Issues

- TypeScript configuration warnings (not runtime issues)
- Opacity may not affect connection lines (enhancement)
- Some browsers may not support all CSS features