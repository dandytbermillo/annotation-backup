# Phase 1 Ownership Plumbing - Testing Guide

**Purpose**: Verify that runtime-first writes and stale write rejection work correctly.

## Prerequisites

1. **Enable the feature flag**:
   - Phase 1 only activates when `NOTE_WORKSPACES_LIVE_STATE` flag is enabled
   - Check how to enable this flag in your environment

2. **Development mode**:
   - Run `npm run dev` to see dev-mode console warnings
   - Dev assertions only fire in development mode

## Test Scenarios

### Test 1: Verify Runtime-First Writes

**Goal**: Confirm that runtime is written to BEFORE ref when flag is enabled.

**Steps**:
1. Enable `NOTE_WORKSPACES_LIVE_STATE` flag
2. Open browser dev console
3. Create a new workspace or switch to an existing one
4. Add a note to the workspace
5. Check console logs

**Expected Output**:
```
[WorkspaceRuntime] Created new runtime for workspace: <workspace-id>
{
  totalRuntimes: 1,
  runtimeIds: ['<workspace-id>']
}
```

**Verification**:
- Open browser console and run:
  ```javascript
  // Check if runtime exists and has data
  // This requires exposing runtime-manager functions for debugging
  // Or check the Network tab for API calls showing correct data
  ```

---

### Test 2: Verify Stale Write Rejection

**Goal**: Confirm that stale snapshot writes are rejected.

**Setup**:
This is harder to test directly without simulating stale snapshot restores. Here's a manual simulation approach:

**Steps**:
1. Enable `NOTE_WORKSPACES_LIVE_STATE` flag
2. Add a breakpoint or temporary code in `use-note-workspaces.ts:commitWorkspaceOpenNotes`
3. Simulate a stale write by calling it with an old timestamp:
   ```typescript
   // Add temporary test code
   if (workspaceId === 'test-workspace') {
     console.log('[TEST] Simulating stale write');
     setRuntimeOpenNotes(workspaceId, normalized, Date.now() - 10000); // 10 seconds ago
   }
   ```
4. Create/switch to 'test-workspace'
5. Add a note
6. Check console

**Expected Output**:
```
[WorkspaceRuntime] Rejected stale openNotes write for workspace test-workspace
{
  attemptedTimestamp: <old-timestamp>,
  currentTimestamp: <current-timestamp>,
  staleness: 10000,
  attemptedSlots: [...],
  currentSlots: [...]
}
```

---

### Test 3: Verify Backward Compatibility

**Goal**: Confirm that when flag is disabled, old behavior works.

**Steps**:
1. **Disable** `NOTE_WORKSPACES_LIVE_STATE` flag
2. Create a workspace
3. Add notes
4. Switch between workspaces
5. Verify no errors in console

**Expected Behavior**:
- No runtime-related console logs
- Workspace switching works as before
- No errors or warnings

---

### Test 4: Multiple Workspace Runtime Creation

**Goal**: Verify that multiple runtimes can coexist.

**Steps**:
1. Enable `NOTE_WORKSPACES_LIVE_STATE` flag
2. Open dev console
3. Create workspace A
4. Create workspace B
5. Add notes to both
6. Switch between A and B multiple times

**Expected Console Output**:
```
[WorkspaceRuntime] Created new runtime for workspace: workspace-a
{ totalRuntimes: 1, runtimeIds: ['workspace-a'] }

[WorkspaceRuntime] Created new runtime for workspace: workspace-b
{ totalRuntimes: 2, runtimeIds: ['workspace-a', 'workspace-b'] }
```

**Verification**:
- Both workspaces maintain their notes when switching
- No data loss
- No stale write warnings (unless actually occurring)

---

### Test 5: Rapid Workspace Switching (Stress Test)

**Goal**: Verify ownership data integrity under rapid switches.

**Steps**:
1. Enable `NOTE_WORKSPACES_LIVE_STATE` flag
2. Create 3 workspaces with different notes in each:
   - Workspace A: note1, note2
   - Workspace B: note3
   - Workspace C: note4, note5, note6
3. Rapidly switch between them: A → B → C → A → B → C → A
4. After switches complete, verify each workspace shows correct notes

**Expected Behavior**:
- Each workspace retains its notes
- No notes missing or duplicated
- No stale write warnings
- No empty workspaces

**Previously Failed** (before Phase 1):
- Workspace B would sometimes show default content
- Notes would disappear after rapid switches
- See: `note-workspace-live-state-plan-documentation.md`

---

## Automated Test Script (Optional)

You can create a test script to verify the runtime behavior:

**File**: `docs/proposal/components/workspace/note/plan/test_scripts/test-phase1-ownership.js`

```javascript
/**
 * Phase 1 Ownership Plumbing Test
 *
 * This script tests that runtime-first writes work correctly.
 * Run with: node test-phase1-ownership.js
 */

// Note: This is a manual test script outline
// Actual implementation depends on your test framework

describe('Phase 1: Ownership Plumbing', () => {
  beforeEach(() => {
    // Enable feature flag
    process.env.NOTE_WORKSPACES_LIVE_STATE = 'true';
  });

  test('Runtime is created when workspace is accessed', () => {
    // 1. Create workspace
    // 2. Verify runtime exists
    // 3. Check totalRuntimes count
  });

  test('Stale writes are rejected', () => {
    // 1. Create workspace with notes
    // 2. Attempt write with old timestamp
    // 3. Verify write was rejected
    // 4. Verify data unchanged
  });

  test('Multiple runtimes coexist', () => {
    // 1. Create workspace A
    // 2. Create workspace B
    // 3. Verify both runtimes exist
    // 4. Verify data isolated between workspaces
  });

  test('Backward compatible when flag disabled', () => {
    // 1. Disable flag
    // 2. Create workspace
    // 3. Verify ref-based storage used
    // 4. No runtime created
  });
});
```

---

## Debugging Tools

### 1. Check Current Runtime State

Add this to browser console (requires exposing runtime-manager):

```javascript
// In development, you can temporarily expose runtime-manager functions
// by adding to window in runtime-manager.ts:

// Add at bottom of runtime-manager.ts (dev only):
if (process.env.NODE_ENV === 'development') {
  window.__DEBUG_RUNTIME__ = {
    getRuntimes: () => Array.from(runtimes.entries()).map(([id, rt]) => ({
      id,
      openNotesCount: rt.openNotes.length,
      membershipSize: rt.membership.size,
      status: rt.status,
      openNotesUpdatedAt: rt.openNotesUpdatedAt,
      membershipUpdatedAt: rt.membershipUpdatedAt,
    })),
    getRuntime: (id) => runtimes.get(id),
  };
}
```

Then in browser console:
```javascript
// Check all runtimes
window.__DEBUG_RUNTIME__.getRuntimes();

// Check specific workspace runtime
window.__DEBUG_RUNTIME__.getRuntime('workspace-a');
```

### 2. Enable Debug Logging

Check `codex/how_to/debug_logs.md` and enable debug logging:

```sql
-- Check debug logs for ownership operations
SELECT
  component,
  action,
  metadata,
  created_at
FROM debug_logs
WHERE component = 'NoteWorkspace'
  AND action IN (
    'set_workspace_membership_called',
    'set_workspace_membership_verified'
  )
ORDER BY created_at DESC
LIMIT 20;
```

---

## Success Criteria

Phase 1 is working correctly if:

- ✅ Runtime creation logs appear in dev console
- ✅ Runtime is written to BEFORE ref (verify via breakpoints)
- ✅ Stale writes are rejected (if they occur)
- ✅ Multiple workspaces maintain separate data
- ✅ No data loss during rapid workspace switching
- ✅ Backward compatible when flag is disabled

## Known Limitations (Phase 1 Only)

Phase 1 does NOT implement:
- ❌ Runtime cap/eviction (Phase 3)
- ❌ Inactive canvas persistence (Phase 2)
- ❌ Component state isolation (Phase 2)

These will be addressed in subsequent phases.

---

## Quick Test Checklist

Use this for quick validation:

```
□ Feature flag enabled
□ Dev console open
□ Create workspace A → logs "Created new runtime"
□ Add note → no errors
□ Create workspace B → logs "Created new runtime", totalRuntimes: 2
□ Switch A → B → A → B → A → no data loss
□ Check console → no unexpected warnings
□ Disable flag → old behavior works
```

---

## Troubleshooting

### Issue: No runtime creation logs

**Cause**: Flag not enabled or running in production mode

**Solution**:
1. Verify `NOTE_WORKSPACES_LIVE_STATE` is enabled
2. Verify running with `npm run dev` (not production build)
3. Check `isNoteWorkspaceLiveStateEnabled()` function

### Issue: Data still disappearing on rapid switches

**Cause**: Phase 1 only addresses ownership writes, not canvas unmounting

**Solution**: This requires Phase 2 (Keep Inactive Canvases Alive)

### Issue: Stale write warnings appearing unexpectedly

**Cause**: Snapshot restore or cache using old timestamps

**Investigation**:
1. Check console warning for `staleness` value
2. Check call stack in warning
3. Verify timestamp source in `commitWorkspaceOpenNotes` calls

---

## Next Steps After Testing

Once Phase 1 is validated:
1. Proceed to **Phase 2**: Keep inactive canvases alive
2. Or address any issues found during testing
