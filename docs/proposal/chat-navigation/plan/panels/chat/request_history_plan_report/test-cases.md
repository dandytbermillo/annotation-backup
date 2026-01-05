# Request History Test Cases

## Prerequisites

1. Start the dev server: `npm run dev`
2. Open the application in browser
3. Open the chat panel

---

## Test Suite 1: Panel Request Tracking

### TR-1.1: Track Recent Panel Request
**Steps**:
1. In chat, type: "show recents" or "show my recents"
2. Verify the Recent panel opens
3. In chat, type: "did I ask you to open recent?"

**Expected Result**:
```
Yes, you asked me to open "Recent" this session.
```

**Status**: PASS (2026-01-04)

---

### TR-1.2: Track Quick Links Panel Request
**Steps**:
1. In chat, type: "show quick links D" or "show my quick link d"
2. Verify Quick Links D panel opens
3. In chat, type: "did I ask you to open quick links D?"

**Expected Result**:
```
Yes, you asked me to open "Quick Links D" this session.
```

**Status**: PASS (2026-01-04)

---

### TR-1.3: Request Phrasing Variations
**Steps**:
1. Open Quick Links D via chat
2. Test various phrasings:
   - "did I ask you to open quick links D?"
   - "did I tell you to open quick links D?"
   - "did I request you to open quick links D?"
   - "did i request you to open my quick link D"

**Expected Result**:
All phrasings should return:
```
Yes, you asked me to open "Quick Links D" this session.
```

**Status**: PASS (2026-01-04)

---

### TR-1.4: Negative Panel Request Query
**Steps**:
1. Do NOT open any panels
2. Ask: "did I ask you to open recent?"

**Expected Result**:
```
No, I have no record of you asking me to open a panel "Recent" this session.
```

**Status**: PASS (Verified via test flow)

---

## Test Suite 2: Distinction from Action History

### TR-2.1: Request Query vs Action Query
**Steps**:
1. In chat, type: "show quick links D"
2. Ask: "did I ask you to open quick links D?" (request query)
3. Ask: "did I open quick links D?" (action query)

**Expected Results**:
- Request query → Uses `requestHistory`, returns "Yes, you asked me to open..."
- Action query → Uses `actionHistory`, returns "Yes, you opened..."

**Status**: PASS (Both systems work independently)

---

### TR-2.2: Request-Only Tracking
**Steps**:
1. Clear session (refresh page)
2. Type: "show quick links D" (but cancel before it opens, if possible)
3. Ask: "did I ask you to open quick links D?"
4. Ask: "did I open quick links D?"

**Expected Results**:
- Request query → "Yes" (request was tracked when command was sent)
- Action query → Depends on whether action completed

**Note**: In practice, tracking happens after resolution, so both track if command succeeds.

---

## Test Suite 3: Case Sensitivity and Normalization

### TR-3.1: Case Insensitive Matching
**Steps**:
1. Open Quick Links D via chat
2. Ask: "did I ask you to open QUICK LINKS D?"
3. Ask: "did I ask you to open quick links d?"

**Expected Result**:
Both should return:
```
Yes, you asked me to open "Quick Links D" this session.
```

**Status**: PASS (ID-based matching is case-insensitive)

---

### TR-3.2: Panel Name Normalization
**Steps**:
1. Open Quick Links D via chat using "show my quick link d"
2. Ask: "did I ask you to open links D?"
3. Ask: "did I ask you to open quick links D?"

**Expected Result**:
Both should match due to ID-based matching ("quick-links-d")

**Status**: PASS (toPanelIdPattern handles variations)

---

## Test Suite 4: Multiple Requests

### TR-4.1: Multiple Panel Requests
**Steps**:
1. Open Recent panel via chat
2. Open Quick Links A via chat
3. Open Quick Links D via chat
4. Ask: "did I ask you to open recent?"

**Expected Result**:
```
Yes, you asked me to open "Recent" this session.
```
(Should find it in history even though it wasn't the last request)

**Status**: PASS (History is searched, not just last entry)

---

### TR-4.2: Wrong Panel Query with Suggestions
**Steps**:
1. Open Recent panel only
2. Ask: "did I ask you to open quick links D?"

**Expected Result**:
```
No, I have no record of you asking me to open a panel "Quick Links D" this session. You asked me to open "Recent".
```

**Status**: PASS (Lists what user DID ask for)

---

## Test Suite 5: Persistence

### TR-5.1: Cross-Reload Persistence
**Steps**:
1. Open Quick Links D via chat
2. Verify: "did I ask you to open quick links D?" returns "Yes"
3. Refresh the page
4. Open chat panel
5. Ask: "did I ask you to open quick links D?"

**Expected Result**:
```
Yes, you asked me to open "Quick Links D" this session.
```

**Status**: PASS (Uses same persistence as actionHistory)

---

## Test Suite 6: Other Request Types

### TR-6.1: Workspace Request
**Steps**:
1. In chat, type: "open workspace 6"
2. Ask: "did I ask you to open workspace 6?"

**Expected Result**:
```
Yes, you asked me to open "Workspace 6" this session.
```

**Status**: Expected PASS (tracking implemented)

---

### TR-6.2: Home Navigation Request
**Steps**:
1. In chat, type: "go home"
2. Ask: "did I ask you to go home?"

**Expected Result**:
```
Yes, you asked me to go home this session.
```

**Status**: Expected PASS (tracking implemented)

---

### TR-6.3: List Workspaces Request
**Steps**:
1. In chat, type: "list workspaces"
2. Ask: "did I ask you to list workspaces?"

**Expected Result**:
```
Yes, you asked me to list workspaces this session: Workspaces.
```

**Status**: Expected PASS (tracking implemented)

---

## Test Execution Log

| Test ID | Date | Tester | Result | Notes |
|---------|------|--------|--------|-------|
| TR-1.1 | 2026-01-04 | Claude | PASS | Screenshot verified |
| TR-1.2 | 2026-01-04 | Claude | PASS | Screenshot verified |
| TR-1.3 | 2026-01-04 | Claude | PASS | Multiple phrasings work |
| TR-1.4 | 2026-01-04 | Claude | PASS | Verified via test flow |
| TR-2.1 | 2026-01-04 | Claude | PASS | Both systems independent |
| TR-3.1 | 2026-01-04 | Claude | PASS | Case insensitive |
| TR-3.2 | 2026-01-04 | Claude | PASS | Normalization works |
| TR-4.1 | 2026-01-04 | Claude | PASS | History searched |
| TR-4.2 | 2026-01-04 | Claude | PASS | Suggestions work |
| TR-5.1 | 2026-01-04 | Claude | PASS | Same persistence |
| TR-6.1 | 2026-01-04 | - | Expected PASS | Not manually tested |
| TR-6.2 | 2026-01-04 | - | Expected PASS | Not manually tested |
| TR-6.3 | 2026-01-04 | - | Expected PASS | Not manually tested |

---

## Regression Tests

Ensure existing functionality still works:

- [x] "show quick links" still shows the panel
- [x] "what did I just do?" still returns last action (uses actionHistory)
- [x] "did I open quick links D?" still works (uses actionHistory)
- [x] Session state persists across page refreshes
- [x] Type-check passes

---

## Bug Found and Fixed

### Issue: "did I ask you to open recent?" returned "No"

**Cause**: LLM classified as `request_show_recent` but tracking used `request_open_panel`

**Fix**: Added classification rules to prompt:
```
CLASSIFICATION RULES for verifyRequestType:
- "open/show recent" → request_open_panel with verifyRequestTargetName: "Recent"
NOTE: request_show_recent is DEPRECATED
```

**Verification**: After fix, test TR-1.1 passes.
