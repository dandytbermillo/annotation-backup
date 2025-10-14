# Quick Debug Guide - Panel Position Persistence

## Immediate Actions

### 1. Start Fresh Test (5 min)
```bash
# Clear all branch panels
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "DELETE FROM panels WHERE type IN ('branch', 'context', 'annotation');"

# Clear debug logs (optional)
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "DELETE FROM debug_logs WHERE component IN ('AnnotationCanvas', 'CanvasHydration', 'PanelPersistence');"
```

### 2. Create & Test Panel
1. Reload app
2. Create annotation (highlight text, select type)
3. Click square icon to open branch panel
4. Note the panel ID from debug logs
5. Drag panel to a distinct position (e.g., far right)
6. Wait 2 seconds
7. Reload page

### 3. Check Results
```bash
# Get panel ID from most recent panel
PANEL_ID=$(docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -t -c \
  "SELECT panel_id FROM panels WHERE type='branch' ORDER BY created_at DESC LIMIT 1;")

echo "Panel ID: $PANEL_ID"

# Check database position
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT panel_id, position_x_world, position_y_world FROM panels WHERE panel_id='$PANEL_ID';"

# Check all debug logs for this panel
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT component, action, metadata FROM debug_logs WHERE metadata::text LIKE '%$PANEL_ID%' ORDER BY created_at ASC;"
```

## Key Questions to Answer

### Q1: Is position saved to database?
```sql
SELECT panel_id, position_x_world, position_y_world, updated_at
FROM panels
WHERE type='branch'
ORDER BY updated_at DESC
LIMIT 1;
```
**Expected:** Non-zero values that match where you dragged the panel
**If not:** Problem is in save flow (drag handler or persistence hook)

### Q2: Is position loaded during hydration?
```sql
SELECT component, action, metadata
FROM debug_logs
WHERE action IN ('loaded_panels', 'applying_panel_type')
ORDER BY created_at DESC
LIMIT 5;
```
**Expected:** `loaded_panels` shows count > 0, `applying_panel_type` has correct panel ID
**If not:** Problem is in hydration (not loading from DB)

### Q3: Does branchData have worldPosition?
Add this to `annotation-canvas-modern.tsx` line 1074:
```typescript
console.log('[DEBUG] branchData for', panelId, ':', {
  hasWorldPosition: !!branchData?.worldPosition,
  worldPosition: branchData?.worldPosition,
  position: branchData?.position,
  finalUsed: position
})
```
**Expected:** `hasWorldPosition: true`, `worldPosition: {x: number, y: number}`
**If not:** Hydration isn't storing worldPosition correctly

### Q4: Is position being used correctly?
```sql
SELECT component, action, metadata
FROM debug_logs
WHERE action = 'determining_panel_position'
ORDER BY created_at DESC
LIMIT 5;
```
**Expected:** `worldPosition` and `finalPosition` should match
**If not:** Position priority logic is wrong

## Common Issues & Fixes

### Issue 1: Position is always (2650, 1500)
**Cause:** Using screen-space instead of world-space
**Fix:** Verify `branchData.worldPosition` is being used first
**File:** `annotation-canvas-modern.tsx` line 1072

### Issue 2: Position is (0, 0) or undefined
**Cause:** Hydration not storing position
**Fix:** Check `use-canvas-hydration.ts` line 449, ensure `worldPosition: panel.position`
**File:** `use-canvas-hydration.ts` line 444-459

### Issue 3: Panel appears then jumps to default position
**Cause:** Position being overridden after creation
**Fix:** Check for duplicate `setCanvasItems` calls or position updates
**Files:** `annotation-canvas-modern.tsx`, `canvas-panel.tsx`

### Issue 4: Multiple panels created
**Cause:** Duplicate prevention not working
**Fix:** Verify check at `annotation-canvas-modern.tsx` line 1141-1156
**File:** `annotation-canvas-modern.tsx`

## Test Matrix

| Test | Action | Expected Result | Status |
|------|--------|----------------|--------|
| 1 | Create panel | Panel appears at default position | ? |
| 2 | Check DB | Position saved (3650, 2700) | ? |
| 3 | Drag panel right | Panel moves visually | ? |
| 4 | Check DB | Position updated (e.g., 4000, 2700) | ? |
| 5 | Reload page | Panel loads at dragged position | ❌ |
| 6 | Check logs | `worldPosition` exists in branchData | ? |
| 7 | Check logs | `finalPosition` equals `worldPosition` | ? |

## Data Collection Template

### Panel Creation
```
Panel ID: _________________
Database Position: x=_______ y=_______
Screen Position: x=_______ y=_______
Created At: _________________
```

### After Drag
```
New Database Position: x=_______ y=_______
Updated At: _________________
Debug Log Action: _________________
```

### After Reload
```
Loaded Position (DB): x=_______ y=_______
branchData.worldPosition: x=_______ y=_______
branchData.position: x=_______ y=_______
Final Position Used: x=_______ y=_______
Rendered Position: x=_______ y=_______
```

## Files to Check

1. **annotation-canvas-modern.tsx** (line 1072) - Position determination
2. **use-canvas-hydration.ts** (line 449) - worldPosition storage
3. **use-panel-persistence.ts** (line 124) - Coordinate conversion
4. **canvas-panel.tsx** - Position prop usage

## Quick Hypothesis Tests

### Test 1: Is worldPosition being set?
```typescript
// In use-canvas-hydration.ts after line 459
console.log('[Hydration] Stored panel:', panel.id, {
  worldPosition: panelData.worldPosition,
  position: panelData.position
})
```

### Test 2: Is position being read correctly?
```typescript
// In annotation-canvas-modern.tsx at line 1072
console.log('[CreatePanel] Position for', panelId, {
  worldPosition: branchData?.worldPosition,
  position: branchData?.position,
  parentPosition,
  finalPosition: position
})
```

### Test 3: Are coordinates converting correctly?
```typescript
// In use-panel-persistence.ts around line 200
console.log('[Persistence] Converting coordinates:', {
  screenPosition: position,
  camera,
  zoom,
  worldPosition
})
```

## Success Check

After implementing fix, verify:
```bash
# Create panel, drag to (4000, 3000), reload
# Then check:
docker exec -e PGPASSWORD=postgres annotation_postgres psql -U postgres -d annotation_dev -c \
  "SELECT panel_id, position_x_world, position_y_world FROM panels WHERE type='branch' ORDER BY updated_at DESC LIMIT 1;"

# Should show: position_x_world ≈ 4000, position_y_world ≈ 3000
# And panel should visually be at that location
```
