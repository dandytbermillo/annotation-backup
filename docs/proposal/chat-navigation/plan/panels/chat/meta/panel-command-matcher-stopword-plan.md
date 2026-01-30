# Panel Command Matcher — Action Verb Stopword Plan

**Status:** Draft (await debug log capture)  
**Owner:** Chat Navigation  
**Scope:** panel command matching only (no clarification logic changes)  

## Why This Plan Exists

We’re seeing a red error (“Something went wrong. Please try again.”) after a user types **“open links panel”**.  
Debug logging was added to capture the exact non‑OK API response when this happens.  

**Hypothesis:**  
`panel-command-matcher.ts` tokenization does not strip action verbs (`open/show/go/view`), so `"open links panel"` fails to match panel titles and falls through to the LLM route (which sometimes times out).  

This plan documents a **deterministic fix** that would prevent that fallthrough.  

## Pre‑Implementation Gate (Required)

Before implementing, capture one debug log instance of the red error:

- `api_response_not_ok` event  
  - `status`, `statusText`, `body`  
  - `input` = user message  

Confirm:

1. The failing input is a command with an action verb (e.g., “open links panel”).  
2. The error response is from the LLM path (timeout/500), not panel match path.  

Only implement after this log confirms the path.  

---

## Proposed Fix (Deterministic)

### 1) Add action verbs as input stopwords (panel matcher only)

**File:** `lib/chat/panel-command-matcher.ts`  
**Change:** `normalizeToTokenSet(input)` should drop action verbs from the **input tokens** only.  

Suggested verb list:
- `open`, `show`, `go`, `view`, `close`, `launch`, `start`

**Rule:**  
Strip verbs only from **input tokens**, not option titles.  

### 2) Guard: only strip when input looks command‑like

Prevent accidental removal from non‑command queries:

```
if (inputStartsWithVerb || hasVerbToken && hasOtherTokens) {
  drop verbs
}
```

### 3) Add tests for panel matching

**New tests (examples):**
- `"open links panel"` → matches **Links Panels / Links Panel D / Links Panel E** (disambiguation)
- `"show links panel d"` → matches **Links Panel D** directly
- `"open recent"` → matches **Recent**
- `"links panel"` (no verb) still behaves as before

---

## Acceptance Criteria

- `"open links panel"` always triggers disambiguation (no LLM call, no red error).
- `"open recent"` routes directly to Recent as before.
- `"open widget demo"` routes directly to Demo Widget as before.
- Debug logs show **no LLM call** for these commands.

---

## Risks / Mitigations

**Risk:** verb stripping changes behavior for inputs like “open panel settings”.  
**Mitigation:** apply stripping only for command‑shaped inputs and only to input tokens.

**Risk:** ambiguous commands lose context.  
**Mitigation:** disambiguation should still run when multiple matches remain.

---

## Out of Scope

- LLM timeout handling (separate issue).
- Clarification flow / return‑cue logic.

