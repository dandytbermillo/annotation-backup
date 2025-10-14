# Debug Investigation: Connection Lines Missing After Reload

**Date**: 2025-10-13
**Issue**: Connection lines between panels don't appear after app reload despite timing fix being applied
**Fix Applied**: Gate connection rendering on `hydrationStatus.success` in plain mode (line 1697 of annotation-canvas-modern.tsx)
**Status**: Fix not working - need to investigate timing

## Debug Logs Added

I've added comprehensive timing debug logs to trace the exact sequence of events during hydration and connection rendering. These logs will help us understand WHY the fix isn't working.

### 1. Hydration Success Timing (annotation-canvas-modern.tsx:233-262)

**Action**: `TIMING_hydration_success_true`
**Component**: AnnotationCanvas
**When**: Fires when `hydrationStatus.success` becomes true
**What it logs**:
- `hydrationPanelsCount`: Number of panels hydrated from database
- `canvasItemsPanelsCount`: Number of panels in canvasItems array at this moment
- `dataStoreSize`: Number of entries in dataStore
- `dataStoreKeys`: Array of all panel IDs in dataStore
- `dataStoreParentIds`: Array of objects showing parentId and branches for each panel
- `timestamp`: Exact millisecond timestamp

**What to look for**:
- Is `hydrationStatus.success` true BEFORE panels are added to `canvasItems`?
- Are parentIds present in dataStore when hydration succeeds?
- Do panel IDs in dataStore match the hydrated panels?

### 2. Connection Render Gate (annotation-canvas-modern.tsx:1724-1749)

**Action**: `TIMING_connection_render_gate`
**Component**: AnnotationCanvas
**When**: Fires on every render cycle when deciding whether to render WidgetStudioConnections
**What it logs**:
- `shouldRender`: Boolean - will connections component mount?
- `showConnections`: Is connection toggle on?
- `isPlainMode`: Are we in plain mode?
- `hydrationSuccess`: Has hydration completed?
- `panelsCount`: Number of panels in canvasItems
- `timestamp`: Exact millisecond timestamp

**What to look for**:
- Does `shouldRender` become true at the right time?
- Is `hydrationSuccess` true but `panelsCount` still 0?
- What's the time gap between hydration success and first render gate check?

### 3. WidgetStudioConnections Mount (widget-studio-connections.tsx:47-84)

**Action**: `TIMING_component_mounted`
**Component**: WidgetStudioConnections
**When**: Fires once when component mounts
**What it logs**:
- `isPlainMode`: Plain mode flag
- `panelsCount`: Number of panels in canvasItems prop
- `dataStoreSize`: Number of entries in dataStore
- `dataStoreKeys`: Array of panel IDs in dataStore
- `dataStoreParentIds`: ParentId and branches data for each panel
- `branchVersion`: Branch version number
- `dataStoreVersion`: DataStore version number
- `timestamp`: Exact millisecond timestamp

**What to look for**:
- When component mounts, are panels in canvasItems?
- Are parentIds present in dataStore when component mounts?
- Is dataStore populated with branch data?

**Action**: `TIMING_component_unmounted`
**When**: Fires when component unmounts (e.g., on remount due to key change)

### 4. Connection Computation (widget-studio-connections.tsx:120-253)

**Action**: `TIMING_computing_connections_start`
**Component**: WidgetStudioConnections
**When**: Fires at start of useMemo connection computation
**What it logs**:
- `panelsCount`: Number of panels
- `branchesSize`: Size of branches map/dataStore
- `branchVersion`: Branch version
- `dataStoreVersion`: DataStore version
- `timestamp`: Exact millisecond timestamp

**Action**: `panel_missing_branch_data`
**When**: A panel in canvasItems has no corresponding branch data in dataStore
**What it logs**: `panelId`

**Action**: `found_parentId`
**When**: A branch has explicit parentId field
**What it logs**: `panelId`, `parentId`

**Action**: `found_in_parent_branches`
**When**: Parent panel's branches array includes this child
**What it logs**: `parentId`, `childId`

**Action**: `connection_missing_panel`
**When**: Trying to create connection but panel not in panelMap
**What it logs**: `parentId`, `childId`, `hasParentPanel`, `hasChildPanel`

**Action**: `connection_missing_branch`
**When**: Trying to create connection but branch not in dataStore
**What it logs**: `parentId`, `childId`, `hasParentBranch`, `hasChildBranch`

**Action**: `connection_missing_position`
**When**: Branch exists but has no position data
**What it logs**: `parentId`, `childId`, `parentPos`, `childPos`

**Action**: `connection_added`
**When**: Connection successfully created
**What it logs**: `parentId`, `childId`, `from`, `to`

**Action**: `TIMING_computing_connections_end`
**When**: Fires at end of useMemo connection computation
**What it logs**:
- `connectionsCount`: Number of connections computed
- `panelsCount`: Number of panels processed
- `branchesSize`: Size of branches map
- `timestamp`: Exact millisecond timestamp

## How to Use These Logs

### Step 1: Reproduce the Issue
1. Open the app at http://localhost:3000
2. Create a new note
3. Create a branch panel from the main panel
4. Verify connection lines are visible
5. **Reload the page**
6. Check if connection lines are missing

### Step 2: Query Debug Logs
Run this SQL query to see the timing sequence:

```sql
PGPASSWORD=postgres psql -h localhost -U postgres -d annotation_dev -c "
SELECT
  created_at,
  component,
  action,
  metadata->>'timestamp' as timestamp_ms,
  metadata
FROM debug_logs
WHERE component IN ('AnnotationCanvas', 'WidgetStudioConnections')
  AND action LIKE 'TIMING_%' OR action IN (
    'found_parentId',
    'panel_missing_branch_data',
    'connection_missing_branch',
    'connection_added'
  )
ORDER BY created_at DESC
LIMIT 50;
"
```

### Step 3: Analyze the Sequence

Look for these patterns:

**Pattern 1: Hydration completes but dataStore empty**
```
TIMING_hydration_success_true -> dataStoreSize: 0, dataStoreParentIds: []
```
This means hydration succeeded but dataStore wasn't populated yet.

**Pattern 2: Component mounts before panels added**
```
TIMING_component_mounted -> panelsCount: 1 (only main)
TIMING_computing_connections_start -> panelsCount: 1
```
This means WidgetStudioConnections mounted before branch panels were added to canvasItems.

**Pattern 3: DataStore missing parentId**
```
TIMING_component_mounted -> dataStoreParentIds: [{ id: 'main', parentId: null }, { id: 'note_123', parentId: null }]
panel_missing_branch_data OR found_parentId with parentId: null
```
This means branch data exists but parentId field is null/missing.

**Pattern 4: Render gate timing issue**
```
TIMING_connection_render_gate -> shouldRender: true, panelsCount: 1
TIMING_component_mounted -> panelsCount: 1
[later...]
TIMING_hydration_success_true -> canvasItemsPanelsCount: 2
```
This means connections component mounted before panels were added to canvasItems, even though the gate was supposed to wait for hydration.

### Step 4: Check Timestamps

Calculate time differences:
1. Time between `hydrationStatus.success` and `connection_render_gate`
2. Time between `hydration_success` and `component_mounted`
3. Time between `component_mounted` and `computing_connections_start`

If these are all happening in the same millisecond, it's a synchronous timing issue.
If there's a delay, it's an async race condition.

## Expected Correct Sequence

1. `TIMING_hydration_success_true` - Hydration completes with panels loaded
   - dataStoreSize > 1 (at least main + one branch)
   - dataStoreParentIds shows parentId fields populated

2. `TIMING_connection_render_gate` - Render gate checks conditions
   - shouldRender: true
   - hydrationSuccess: true
   - panelsCount > 1 (main + branches)

3. `TIMING_component_mounted` - WidgetStudioConnections mounts
   - panelsCount > 1
   - dataStoreSize > 1
   - dataStoreParentIds shows parentId populated

4. `TIMING_computing_connections_start` - Connection computation begins
   - panelsCount > 1
   - branchesSize > 1

5. `found_parentId` - For each branch panel with parentId

6. `connection_added` - For each successfully created connection

7. `TIMING_computing_connections_end`
   - connectionsCount > 0

## Possible Root Causes to Investigate

Based on the logs, we'll determine:

### Cause A: Hydration Success Too Early
- `hydrationStatus.success` becomes true BEFORE panels are actually added to canvasItems
- **Fix**: Delay setting success status until after panels are added

### Cause B: DataStore Not Populated
- DataStore exists but doesn't have parentId data when component mounts
- **Fix**: Ensure branch loader sets parentId in dataStore, or modify connection computation to handle missing parentId

### Cause C: React Rendering Timing
- All state is correct but React hasn't re-rendered with new panels yet
- **Fix**: Force a synchronous render with flushSync, or trigger re-render when hydration completes

### Cause D: Component Remounting
- Component mounts, then unmounts/remounts, losing the dataStore context
- **Fix**: Stabilize component key or prevent unnecessary remounts

## Next Steps

1. User should reload the app to reproduce the issue
2. Query the debug logs with the SQL above
3. Share the timing sequence
4. I'll analyze the pattern and identify the exact root cause
5. Apply the correct fix based on the evidence

---

**Important**: These debug logs are VERY verbose. They should be removed or gated behind a flag once we've identified and fixed the issue.
