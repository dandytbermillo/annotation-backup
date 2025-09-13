# Canvas Panning Test Guide

## What's Been Added

We've enabled **canvas-wide panning** for the popup overlay layer! This demonstrates true multi-layer independence where each layer can be transformed independently.

## Test Instructions

### 1. Enable Multi-Layer Canvas
```javascript
// Open browser console (F12)
localStorage.setItem('offlineFeatureFlags', JSON.stringify({
  'ui.multiLayerCanvas': true
}));
// Refresh page (F5)
```

### 2. Setup Test Environment
1. Open Notes Explorer (menu button in top-left)
2. Select a note to load the canvas
3. Open popup cascade:
   - Hover over a folder in the tree
   - Click the eye icon (👁) to open popup

### 3. Test Canvas Panning

#### **Alt+Drag: Pan ONLY Popup Layer** 🎯
1. Hold down `Alt` key
2. Click and drag anywhere on screen
3. **Expected**: Only popups move, notes stay in place
4. **Visual**: Cursor changes to grab/grabbing

#### **Space+Drag: Pan Active Layer** 🎯
1. Hold down `Space` key
2. Click and drag anywhere on screen
3. **Expected**: Active layer moves (check layer indicator)
4. **Visual**: Cursor changes to grab/grabbing

#### **Individual Popup Dragging** 🎯
1. Click and drag popup header (without modifiers)
2. **Expected**: Individual popup moves
3. **Visual**: Header background changes color

### 4. Layer Independence Test

1. **With Popups Layer Active**:
   - Space+drag → Popups move
   - Notes canvas stays still
   
2. **Switch to Notes Layer** (Tab or layer controls):
   - Space+drag → Notes canvas moves
   - Popups stay still

3. **Alt+Drag Always Moves Popups**:
   - Works regardless of active layer
   - Demonstrates true layer independence

### 5. Transform Synchronization

1. Enable "Sync Pan" in layer controls
2. Pan one layer
3. **Expected**: Both layers move together

## Technical Details

### What Changed
1. **LayerProvider**: Fixed `updateTransform` to properly apply deltas
2. **Notes Explorer**: Added canvas position tracking for popups
3. **Coordinate Bridge**: Proper canvas/screen coordinate conversion

### Key Bindings
- **Alt+Drag**: Pan popup layer only
- **Space+Drag**: Pan active layer
- **Tab**: Toggle between layers
- **Cmd/Ctrl+1**: Focus notes layer
- **Cmd/Ctrl+2**: Focus popup layer
- **Cmd/Ctrl+0**: Reset view

## Success Criteria

✅ **Canvas Panning Works**: Alt+drag moves entire popup layer
✅ **Layer Independence**: Each layer transforms independently
✅ **Coordinate System**: Popups maintain relative positions during pan
✅ **Visual Feedback**: Cursor changes appropriately
✅ **No Conflicts**: Individual drag vs canvas pan work correctly

## Troubleshooting

If panning doesn't work:
1. Ensure feature flag is enabled
2. Check that popups are open
3. Verify layer indicator shows correct active layer
4. Try resetting view (Cmd/Ctrl+0)

## Why This Matters

This demonstrates that the multi-layer canvas system is **truly functional**:
- Each layer has independent transform state
- Layers can be panned/zoomed separately
- The coordinate system properly handles transformations
- True spatial navigation is possible

The system is now ready for advanced workflows like:
- Comparing notes side-by-side
- Navigating large folder structures
- Maintaining context while exploring
- Professional-grade spatial navigation