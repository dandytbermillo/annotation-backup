# Popup Overlay Panning Verification Guide

## Test URL
http://localhost:3001

## Setup Steps
1. Open the application in browser
2. Create or open a note
3. Open the folder explorer (sidebar)
4. Hover over folders and click the eye icon to open popups
5. Open at least 2-3 popups to see the panning effect

## Test Cases

### ✅ 1. Plain Click+Drag Panning (PRIMARY TEST)
**Steps:**
1. Click on empty space in the popup overlay (not on a popup card)
2. Hold mouse button and drag
3. **Expected:** All popups move together smoothly
4. **No Space key required** - just click and drag

### ✅ 2. Individual Popup Dragging
**Steps:**
1. Click on a popup header (title bar area)
2. Drag the popup
3. **Expected:** Only that specific popup moves
4. Other popups stay in place

### ✅ 3. Zoom with Mouse Wheel
**Steps:**
1. Position mouse over popup area
2. Use scroll wheel (up to zoom in, down to zoom out)
3. **Expected:** All popups scale together around mouse position

### ✅ 4. Space Bar in Text Editors
**Steps:**
1. Click in any text field or note editor
2. Type text with spaces
3. **Expected:** Space bar works normally for typing
4. **No interference** from pan handlers

### ✅ 5. Connection Lines
**Steps:**
1. Open nested popups (parent and child)
2. Pan the view
3. **Expected:** Connection lines stay attached to popups
4. Lines move with the popups during pan

## Visual Indicators

### During Pan
- Cursor changes to grabbing hand
- Popups move smoothly together
- No visual jumping or cancellation

### Transform State
- Open DevTools Console
- Run: `document.querySelector('#popup-overlay .absolute.inset-0').style.transform`
- Should show: `translate3d(Xpx, Ypx, 0) scale(S)`
- Values update during pan/zoom

## Performance Check
1. Open 10+ popups
2. Pan rapidly
3. **Expected:** Smooth 60fps motion
4. No lag or stuttering

## Debug Verification
Check PostgreSQL debug_logs:
```sql
SELECT * FROM debug_logs 
WHERE context = 'PopupOverlay' 
ORDER BY timestamp DESC 
LIMIT 10;
```

Should see entries for:
- `pan_start`
- `pan_move` 
- `pan_end`
- `zoom` (if tested)

## Common Issues Fixed
- ❌ ~~Space key required for panning~~ → Fixed: Plain click+drag works
- ❌ ~~Space key blocks typing~~ → Fixed: Removed interference
- ❌ ~~Popups jump back after pan~~ → Fixed: Canvas positions stored once
- ❌ ~~Transform doesn't accumulate~~ → Fixed: Self-contained state

## Implementation Details
- Uses self-contained transform state (not LayerProvider)
- GPU-accelerated with `translate3d()`
- Container-based transform (all children move together)
- Canvas coordinates stored, not recalculated