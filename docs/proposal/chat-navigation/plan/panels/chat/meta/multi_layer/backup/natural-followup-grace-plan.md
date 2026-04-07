# Chat Navigation Plan: Natural Follow-up Grace Window

## Problem

After a user selects an option, the system clears pending options immediately.
If the user then types a label like "Sprint 66", it is treated as a new request
and may resolve to "unsupported," which feels unnatural.

## Goal

Make follow-up selections feel conversational:
- Allow one extra turn after a selection to reuse the last options.
- Auto-select when the user types an exact option label.
- Reduce "unsupported" responses for obvious follow-ups.

## Non-Goals

- No changes to selection pill UI.
- No changes to option generation.
- No changes to database schema.

## Proposed Behavior (Hybrid + Grace)

### 1) Keep a one-turn grace window

After a selection is made, keep the last `pendingOptions` for **one more user
message**. If the next message matches an option label/sublabel, select it.

### 2) Exact label match before LLM

If the user input matches an option label (case-insensitive), immediately
select it without calling the LLM.

### 3) Fallback to normal flow

If no match is found, clear the grace window and proceed with the normal LLM
intent flow.

### 4) Clarification-first when ambiguous

If matching is ambiguous (e.g., multiple options partially match), do **not**
auto-select. Ask a clarification question instead and keep `pendingOptions`
for the next reply.

### 5) Guardrail: Skip grace window on explicit action verbs

If the user input includes explicit action verbs like "create", "rename",
"delete", or "remove", do **not** apply the grace window. Treat it as a new
intent to avoid intercepting deliberate commands.

## Data Model Changes

Add to chat state:
- `pendingOptions` (existing)
- `pendingOptionsGraceCount`: number of remaining turns to allow reuse (0/1)

## Client Flow (sendMessage)

1) If `pendingOptions` exist:
   - Check ordinal (existing).
   - Check exact label/sublabel match (new).
   - If multiple matches: ask clarification and keep options.
   - If action verb present: skip grace logic and proceed to LLM.
2) If a match is found:
   - Execute `selectOption`.
   - Decrement `pendingOptionsGraceCount`.
   - If count reaches 0, clear `pendingOptions`.
3) If no match:
   - If grace count > 0, decrement and clear after this turn.
   - Continue with normal LLM flow.

## Matching Rules

Normalize input:
- Trim, lowercase, collapse spaces.
- Strip filler prefixes like "the one", "that one", "open", "show".

Match priority:
1) Exact label match
2) Exact sublabel match
3) Label contains input (optional, only if safe)
4) If multiple matches at any step → ask clarification (no auto-select)

## Prompt Enhancement (Optional)

Add a rule for bare workspace names:
- If the message is just a workspace label from pending options,
  treat it as selecting that option.

## UX Copy

If the user types an option label and it matches:
- No extra text; just perform the selection.

If multiple options match:
- "I found more than one match. Which one did you mean?"

If no match and grace window expired:
- Normal unsupported or clarification response.

## Safety

- Only options previously shown can be selected.
- No new data exposure.

## Manual Test Checklist

1) Disambiguation → select option → type another option label
   - Expected: second option opens (grace window).
2) Disambiguation → select option → unrelated request
   - Expected: normal LLM flow.
3) Disambiguation → type label without clicking pill
   - Expected: immediate selection.
4) Disambiguation → type label after grace window expired
   - Expected: normal LLM flow (unsupported if not a valid intent).
