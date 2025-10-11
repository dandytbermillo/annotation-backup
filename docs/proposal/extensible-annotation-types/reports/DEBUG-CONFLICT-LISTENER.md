# Debug: Conflict Listener Investigation

**Date**: 2025-10-10
**Issue**: Conflict listener not firing in Firefox when Chrome edits

---

## Debug Logging Added

### Provider Side (`lib/providers/plain-offline-provider.ts:644-650`)

```
[🔍 PROVIDER-CONFLICT] Emitting document:conflict event
```

Logs when provider detects conflict and emits the event.

### Editor Side (`components/canvas/tiptap-editor-plain.tsx`)

**Listener Registration (Line 1097)**:
```
[🔍 CONFLICT-RESOLUTION] Registering conflict listener for {panelId}
```

**Event Reception (Line 1111)**:
```
[🔍 CONFLICT-RESOLUTION] Conflict event received
```

**Event Handling (Line 1122)**:
```
[🔍 CONFLICT-RESOLUTION] Handling conflict for {panelId}
```

---

## Test Procedure

### Step 1: Fresh Start
1. Rebuild the app: `npm run dev`
2. Clear browser cache in both Chrome and Firefox
3. Open DevTools console in both browsers

### Step 2: Setup
1. **Chrome**: Open the note with branch panel
2. **Firefox**: Open the same note with same branch panel
3. Check both consoles for registration logs:
   ```
   [🔍 CONFLICT-RESOLUTION] Registering conflict listener for {branch-id}
   ```

### Step 3: Create Conflict - Chrome Edits First
1. **Chrome**: Type "Chrome version A" in branch panel
2. **Chrome**: Wait 500ms for autosave
3. **Chrome console**: Check for save success (no conflict yet)
4. **Firefox**: Type "Firefox version A" in branch panel
5. **Firefox**: Wait 500ms for autosave
6. **Firefox console**: Look for these logs in order:
   ```
   [PlainOfflineProvider] Failed to persist document for {key}: Error: stale document save...
   [🔍 PROVIDER-CONFLICT] Emitting document:conflict event
   [🔍 CONFLICT-RESOLUTION] Conflict event received
   [🔍 CONFLICT-RESOLUTION] Handling conflict for {panelId}
   [🔍 CONFLICT-RESOLUTION] Updating editor with fresh content
   [Editor] Content updated to latest version (conflict resolved)
   ```

### Step 4: What You Observed
> **User report**: "the [🔍 CONFLICT-RESOLUTION] did not appear in the firefox after made some changes"

**Possible causes**:
1. **Provider never detected conflict** → No `[🔍 PROVIDER-CONFLICT]` log
2. **Provider emitted but listener not registered** → Has `[🔍 PROVIDER-CONFLICT]` but no `[🔍 CONFLICT-RESOLUTION]`
3. **Event received but filtered out** → Has "received" log but not "handling" log
4. **Firefox not saving** → No autosave triggered, no conflict to detect

---

## Diagnostic Questions

### Q1: Do you see the registration log in Firefox console?
```
[🔍 CONFLICT-RESOLUTION] Registering conflict listener for {branch-id}
```

- **YES** → Listener is registered, proceed to Q2
- **NO** → Editor useEffect not running, check if Firefox panel is actually mounted

### Q2: Do you see the provider conflict log in Firefox console?
```
[🔍 PROVIDER-CONFLICT] Emitting document:conflict event
```

- **YES** → Provider detected conflict, proceed to Q3
- **NO** → No conflict detected by provider. Possible reasons:
  - Firefox didn't actually save (check for autosave logs)
  - Save succeeded without conflict (check database versions)
  - Error happened but wasn't recognized as conflict

### Q3: Do you see "Conflict event received" in Firefox console?
```
[🔍 CONFLICT-RESOLUTION] Conflict event received
```

- **YES** → Event was emitted and received, proceed to Q4
- **NO** → Event not reaching listener. Possible reasons:
  - Provider instance mismatch (editor has different provider than the one that emitted)
  - Event emitted before listener registered (timing issue)

### Q4: Do you see "willHandle: true" in the event received log?

```
[🔍 CONFLICT-RESOLUTION] Conflict event received {
  eventNoteId: "...",
  eventPanelId: "...",
  myNoteId: "...",
  myPanelId: "...",
  willHandle: ??? <- Check this
}
```

- **willHandle: true** → Should proceed to handling, check for next log
- **willHandle: false** → noteId/panelId mismatch, different panel is handling

---

## Expected Behavior Based on User Report

> "the only time i keep seeing the error in the browser when editing on the same browser and just viewing the branch panel content in the other browser"

**This suggests**:
1. Conflict happens when BOTH browsers are in the SAME browser (e.g., Chrome tab 1 vs Chrome tab 2)
2. No conflict when editing in Chrome while just viewing in Firefox

**Hypothesis**:
- **Firefox might not be autosaving** (panel not focused, editor not triggering save)
- Or **Firefox loads stale version** but doesn't try to save over it

---

## Next Steps

1. **Run the test** with new logging
2. **Share Firefox console output** showing:
   - Registration logs
   - Any provider logs
   - Any conflict logs
3. **Also share Chrome console output** for comparison
4. **Describe exact actions**:
   - Did you click/focus Firefox editor?
   - Did you actually type in Firefox?
   - How long did you wait between edits?

---

## Simplified Test

Try this simpler test to isolate the issue:

### Test A: Same Browser Tabs (Known to show error)
1. Chrome Tab 1: Edit branch panel
2. Chrome Tab 2: Edit same branch panel
3. **Expected**: Conflict error appears ← You said this works
4. **Check**: Do you see `[🔍 PROVIDER-CONFLICT]` in console?

### Test B: Different Browsers (Not showing error)
1. Chrome: Edit branch panel, wait for save
2. Firefox: Edit same branch panel
3. **Expected**: Conflict error appears ← You said this doesn't happen
4. **Check**:
   - Does Firefox show registration log?
   - Does Firefox actually autosave? (check for save logs)
   - Does Firefox console show ANY error?

---

## Key Files for Reference

- `lib/providers/plain-offline-provider.ts:644` - Provider emits event
- `components/canvas/tiptap-editor-plain.tsx:1097` - Listener registration
- `components/canvas/tiptap-editor-plain.tsx:1111` - Event reception
- `components/canvas/tiptap-editor-plain.tsx:1122` - Event handling

---

**Status**: Waiting for console output from test run with new debug logging
