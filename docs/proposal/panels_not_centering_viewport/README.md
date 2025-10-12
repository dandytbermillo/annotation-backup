# Panel Centering Issue Investigation

**Date Created:** 2025-10-12
**Status:** 🔴 ACTIVE - Centering not working
**Impact:** HIGH - Affects user experience when opening notes

---

## Quick Summary

When users open notes from the Recent Notes panel or organization popup, the panel appears in the **upper-left corner** of the viewport instead of being centered. Multiple fix attempts have been made, but the centering issue persists.

### What Works
✅ Eliminated slide animation (panel appears instantly)
✅ Canvas ref retry mechanism working
✅ CSS transition successfully disabled during positioning

### What Doesn't Work
❌ Panel not centering in viewport
❌ Position varies slightly between notes
❌ Appears in upper-left corner consistently

---

## Documents in This Folder

### 📋 [RESEARCH_PLAN.md](./RESEARCH_PLAN.md)
Comprehensive research plan documenting:
- Problem statement and expected behavior
- Root causes discovered
- Investigation steps taken (6 attempts so far)
- Debug log analysis
- Next investigation steps
- Questions to answer

**Start here for complete investigation context.**

### 📄 [AFFECTED_FILES.md](./AFFECTED_FILES.md)
Detailed breakdown of affected files:
- File locations and relevant code sections
- Timeline of changes
- Debug log snapshots
- Known issues and next steps

**Reference this for code-level details.**

### 💾 [affected_files/](./affected_files/)
Backup copies of all affected files:
- `annotation-app.tsx` - Note selection and centering trigger
- `annotation-canvas-modern.tsx` - Canvas rendering and centerOnPanel logic
- `pan-animations.ts` - Viewport positioning utilities
- `canvas-storage.ts` - State persistence system

**Use these for comparison or rollback.**

---

## Current Hypothesis

The issue appears to be related to **viewport state management** and **storage system interaction**:

1. **Storage loads saved viewport positions** unique to each note
2. **Viewport reset logic** may not be executing before centering
3. **Auto-save** may be overriding centered position immediately
4. **Coordinate transformation** may have a bug in calculation

---

## How to Continue Investigation

### 1. Read the Research Plan
Start with `RESEARCH_PLAN.md` to understand:
- What we've tried
- What we've learned
- What to investigate next

### 2. Check Debug Logs
Run the app and check PostgreSQL debug logs:
```sql
SELECT component, action, metadata, timestamp
FROM debug_logs
WHERE component IN ('AnnotationApp', 'AnnotationCanvas', 'PanAnimations')
ORDER BY timestamp DESC
LIMIT 50;
```

### 3. Verify Viewport State
Add console logs to confirm:
- Is viewport reset actually applied?
- What is the viewport state when `centerOnPanel` runs?
- Does storage override the centered position?

### 4. Test Centering Math
Manually calculate expected values:
```javascript
// Given:
panelX = 2000, panelY = 1500
panelWidth = 600, panelHeight = 500
viewportWidth = 1554, viewportHeight = 892
zoom = 1

// Expected:
centerOffsetX = (1554/2 - 600/2) / 1 = 477
centerOffsetY = (892/2 - 500/2) / 1 = 196

targetX = -2000 + 477 = -1523
targetY = -1500 + 196 = -1304

// Compare with actual debug log values
```

### 5. Inspect DOM After Centering
```javascript
const canvas = document.getElementById('infinite-canvas')
console.log('Transform:', canvas.style.transform)
console.log('Transition:', canvas.style.transition)
```

---

## Key Code Locations

### Centering Trigger
**File:** `components/annotation-app.tsx`
**Lines:** 719-792
**Function:** `useEffect` that calls `centerOnPanel`

### Centering Logic
**File:** `components/annotation-canvas-modern.tsx`
**Lines:** 838-926
**Function:** `centerOnPanel` implementation

### Storage Loading
**File:** `components/annotation-canvas-modern.tsx`
**Lines:** 294-407
**Function:** `useEffect` that loads saved state

### Canvas Transform
**File:** `components/annotation-canvas-modern.tsx`
**Lines:** 1044-1059
**JSX:** `<div id="infinite-canvas" style={{...}}>`

---

## Debug Commands

### View Recent Debug Logs
```bash
docker exec -i annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT component, action, metadata, timestamp FROM debug_logs \
   WHERE component IN ('AnnotationApp', 'AnnotationCanvas', 'PanAnimations') \
   ORDER BY timestamp DESC LIMIT 50;"
```

### Check localStorage State
```javascript
// In browser console
const noteId = 'YOUR_NOTE_ID'
const key = `canvas_state_${noteId}`
const state = JSON.parse(localStorage.getItem(key))
console.log('Saved state:', state)
```

### Monitor Canvas State
```javascript
// Add to annotation-canvas-modern.tsx
useEffect(() => {
  console.log('Canvas state changed:', {
    translateX: canvasState.translateX,
    translateY: canvasState.translateY,
    zoom: canvasState.zoom
  })
}, [canvasState.translateX, canvasState.translateY, canvasState.zoom])
```

---

## Related Issues

- **Slide animation issue:** ✅ RESOLVED (using DOM manipulation + flushSync)
- **Canvas ref availability:** ✅ RESOLVED (using retry mechanism)
- **Centering calculation:** ✅ APPEARS CORRECT in logs
- **Visual result:** ❌ STILL WRONG on screen

---

## Contact

For questions or updates, refer to:
- Main debugging document: `DEBUG_PANEL_SLIDE_ISSUE.md`
- Project conventions: `CLAUDE.md`
- Debug log utilities: `codex/how_to/debug_logs.md`
