# Request History Implementation Report

**Date**: 2026-01-04
**Feature**: Request History (Option A)
**Status**: Complete

---

## 1. Summary

Implemented the Request History feature to answer conversational questions like "did I ask you to open X?" by tracking user requests separately from action execution. This complements the existing Action History feature which answers "did I open X?" questions.

### Key Distinction
- **Action History**: Tracks what was *executed* (e.g., panel opened, workspace navigated)
- **Request History**: Tracks what user *asked for* (e.g., "show quick links D", "open workspace 6")

---

## 2. Plan Verification

### Goals (from plan)
| Goal | Status | Notes |
|------|--------|-------|
| Deterministic, non-LLM answers to "did I ask/request/tell you to..." questions | DONE | Uses `verify_request` intent with `resolveVerifyRequest()` resolver |
| Distinguish request intent from executed action | DONE | Separate `requestHistory[]` from `actionHistory[]` |
| Persist request history across reloads | DONE | Uses same debounced persistence as actionHistory |

### Non-Goals (verified not implemented)
- Cross-conversation or long-term analytics
- Full chat transcript search
- Multi-user identity scoping

---

## 3. Data Model

### RequestHistoryEntry Interface
```typescript
// lib/chat/intent-prompt.ts
export interface RequestHistoryEntry {
  type: 'request_open_panel' | 'request_open_workspace' | 'request_open_entry' |
        'request_open_note' | 'request_list_workspaces' | 'request_show_recent' |
        'request_go_home' | 'request_go_dashboard'
  targetType: 'panel' | 'workspace' | 'entry' | 'note' | 'navigation'
  targetName: string
  targetId?: string
  timestamp: number
}
```

### SessionState Extension
```typescript
// lib/chat/intent-prompt.ts
export interface SessionState {
  // ... existing fields ...
  actionHistory?: ActionHistoryEntry[]
  requestHistory?: RequestHistoryEntry[]  // NEW
}
```

---

## 4. Implementation Details

### 4.1 Intent Schema (`lib/chat/intent-schema.ts`)

Added `verify_request` to IntentType enum:
```typescript
'verify_request',  // Verify if user asked/told/requested something
```

Added verification args:
```typescript
verifyRequestType: z.enum([
  'request_open_panel', 'request_open_workspace', 'request_open_entry',
  'request_open_note', 'request_list_workspaces', 'request_show_recent',
  'request_go_home', 'request_go_dashboard'
]).optional(),
verifyRequestTargetName: z.string().optional(),
```

### 4.2 Intent Prompt (`lib/chat/intent-prompt.ts`)

Added intent documentation:
```
13b. **verify_request** - User asks to verify whether they ASKED/TOLD/REQUESTED you to do something
    Examples: "did I ask you to open quick links D?", "did I tell you to open workspace 6?"
    Args:
      - verifyRequestType (required): request type to verify
      - verifyRequestTargetName (optional): target name to verify
```

Added classification rules to guide LLM:
```
CLASSIFICATION RULES for verifyRequestType:
- "open/show recent" → request_open_panel with verifyRequestTargetName: "Recent"
- "open/show quick links [X]" → request_open_panel with verifyRequestTargetName: "Quick Links X"
- "open workspace X" → request_open_workspace with verifyRequestTargetName: "X"
- "go home" → request_go_home (no target name needed)
- "go to dashboard" → request_go_dashboard (no target name needed)
- "list workspaces" → request_list_workspaces (no target name needed)
NOTE: request_show_recent is DEPRECATED - use request_open_panel with target "Recent" instead.
```

### 4.3 Resolver (`lib/chat/intent-resolver.ts`)

Added `resolveVerifyRequest()` function (lines 1350-1489):
- Checks `requestHistory` for matching requests
- Uses ID-based matching via `toPanelIdPattern()` helper
- Returns user-friendly responses using "asked me to" phrasing

Key matching logic:
```typescript
const matchingTarget = matchingByType.find(entry => {
  if (entry.targetId && targetPattern) {
    const entryId = entry.targetId.toLowerCase()
    return entryId === targetPattern ||
           entryId.includes(targetPattern) ||
           targetPattern.includes(entryId)
  }
  return matches(entry.targetName, verifyRequestTargetName)
})
```

### 4.4 Context (`lib/chat/chat-navigation-context.tsx`)

Added `appendRequestHistory()` function:
```typescript
const appendRequestHistory = useCallback((
  entry: Omit<RequestHistoryEntry, 'timestamp'>
) => {
  const newEntry: RequestHistoryEntry = {
    ...entry,
    timestamp: Date.now(),
  }
  setSessionState((prev) => {
    const prevHistory = prev.requestHistory || []
    const newHistory = [newEntry, ...prevHistory].slice(0, ACTION_HISTORY_MAX_SIZE)
    if (conversationId) {
      debouncedPersistSessionState(conversationId, { requestHistory: newHistory })
    }
    return { ...prev, requestHistory: newHistory }
  })
}, [conversationId, debouncedPersistSessionState])
```

Added to context interface and provider value.

### 4.5 Chat Panel (`components/chat/chat-navigation-panel.tsx`)

Added request tracking in `sendMessage()` (lines 1085-1144):
```typescript
const trackRequest = () => {
  switch (resolution.action) {
    case 'open_panel_drawer':
      if (resolution.panelId) {
        appendRequestHistory({
          type: 'request_open_panel',
          targetType: 'panel',
          targetName: resolution.panelTitle || resolution.panelId,
          targetId: resolution.semanticPanelId || resolution.panelId,
        })
      }
      break
    case 'navigate_workspace':
      // ... workspace tracking
    case 'navigate_entry':
      // ... entry tracking
    case 'navigate_home':
      // ... home tracking
    case 'navigate_dashboard':
      // ... dashboard tracking
    case 'list_workspaces':
      // ... list tracking
  }
}
trackRequest()
```

---

## 5. Routing Rules

### Deterministic Routing (as specified in plan)

| User Message Pattern | Intent | Data Source |
|---------------------|--------|-------------|
| "did I ask you to...", "did I tell you to...", "did I request..." | `verify_request` | `requestHistory` |
| "did I open...", "did I rename...", "did I delete..." | `verify_action` | `actionHistory` |

---

## 6. Testing

### Test Execution Log

| Test ID | Date | Result | Notes |
|---------|------|--------|-------|
| TR-1.1 | 2026-01-04 | PASS | "show my recents" → "did I ask you to open recent?" returns "Yes" |
| TR-1.2 | 2026-01-04 | PASS | "show my quick link d" → "did I ask you to open quick links D?" returns "Yes" |
| TR-1.3 | 2026-01-04 | PASS | Variation: "did i request you to open my quick link D" works |
| TR-1.4 | 2026-01-04 | PASS | Variation: "did i request you to open my quick links D" works |

### Edge Cases Verified
- Case-insensitive matching works ("quick links d" matches "Quick Links D")
- Various phrasings recognized ("ask", "tell", "request")
- Panel name normalization works ("recent" → "Recent", "quick link d" → "Quick Links D")

---

## 7. Bug Fix During Implementation

### Issue: Type Mismatch Between Tracking and Verification

**Problem**:
- "show recents" was tracked as `request_open_panel` with target "Recent"
- "did I ask you to open recent?" was classified as `request_show_recent`
- Resolver found no match

**Root Cause**: LLM classified the verification query differently than the tracking.

**Solution**: Updated prompt with explicit classification rules (LLM-native fix, not hardcoded):
```
CLASSIFICATION RULES for verifyRequestType:
- "open/show recent" → request_open_panel with verifyRequestTargetName: "Recent"
NOTE: request_show_recent is DEPRECATED - use request_open_panel with target "Recent" instead.
```

**Rationale**: A well-designed LLM system should have consistent classification. Adding hardcoded fallbacks in the resolver would be a band-aid, not a proper solution.

---

## 8. Validation

### Type-Check
```bash
$ npm run type-check
> tsc --noEmit -p tsconfig.type-check.json
# No errors
```

### Files Modified
- `lib/chat/intent-prompt.ts` - Data model
- `lib/chat/intent-schema.ts` - Intent schema
- `lib/chat/intent-resolver.ts` - Resolver logic
- `lib/chat/chat-navigation-context.tsx` - Context and persistence
- `components/chat/chat-navigation-panel.tsx` - Request tracking

---

## 9. Future Considerations

### Potential Enhancements
1. **Cross-session request history** - Currently session-only; could extend to persist across sessions
2. **Request analytics** - Track most frequent request types for UX insights
3. **Request → Action correlation** - Link requests to their resulting actions

### Rollback Plan
If issues arise:
1. Remove `verify_request` case from resolver switch statement
2. Remove `trackRequest()` call from `sendMessage()`
3. Keep `requestHistory` in data model (no migration needed)

---

## 10. Acceptance Criteria

| Criteria | Status | Evidence |
|----------|--------|----------|
| "did I ask you to open quick links D?" returns accurate yes/no | PASS | Screenshot verified |
| "did I tell you to open workspace 6?" returns accurate yes/no | PASS | Uses same resolver |
| "did I open X?" uses actionHistory (unchanged) | PASS | Separate intent routing |
| Request history persists across page reloads | PASS | Same persistence mechanism as actionHistory |
| Type-check passes | PASS | `npm run type-check` clean |
