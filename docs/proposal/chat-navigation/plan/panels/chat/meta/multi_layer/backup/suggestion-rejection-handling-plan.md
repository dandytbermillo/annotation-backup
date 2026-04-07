# Suggestion Rejection Handling Plan

**Status:** IMPLEMENTED
**Implementation Date:** 2026-01-05

## Purpose
Prevent repetitive suggestion loops when the user says “no” after a suggestion.
The chat should treat rejection as a clear signal to stop re‑suggesting the same item.

## Goals
- Detect explicit rejection (no / not that / cancel).
- Clear current suggestion state immediately.
- Avoid re‑suggesting the same candidate unless user explicitly names it.
- Keep the response short and conversational.

## Non-Goals
- Full natural-language debate or retries.
- Rewriting user intent from rejected suggestion.
- Maintaining rejection history across sessions.

## UX Rules
1) If user rejects a suggestion:
   - Respond: “Okay — what would you like instead?”
2) Provide a short alternative list only if multiple candidates existed.
3) Do not repeat the rejected candidate in the next suggestion set.

## UI Copy (Exact)
- Rejection response:
  “Okay — what would you like instead?”
- Optional follow‑up (if >1 candidate existed):
  “You can try: <candidate list>”

## Detection Rules (Deterministic)
Consider message a rejection when:
- Exact: “no”, “nope”, “not that”, “cancel”, “never mind”
- Or it begins with “no,”

## Data Model
Add to chat state (ephemeral):
- `lastSuggestion`: { candidates[], messageId }
- `rejectedSuggestions`: set of candidate labels or panelIds

## Implementation Steps
1) Store suggestion state
   - When suggestions are shown, store candidates + messageId.

2) Detect rejection
   - On new user input, if rejection phrase and lastSuggestion exists:
     - Clear lastSuggestion
     - Add its candidates to rejectedSuggestions
     - Respond with neutral prompt.

3) Filter suggestions
   - When building new suggestions, remove candidates in rejectedSuggestions
   - Reset rejectedSuggestions when user explicitly names a target
   - Clear rejectedSuggestions after N minutes (e.g., 5 minutes) to avoid stale blocks

## Flow (Where Rejection Is Checked)
User input
  → detect rejection?
    - yes → clear lastSuggestion, mark rejected, respond with “Okay — what would you like instead?”
    - no  → continue normal LLM/typo flow

## Test Checklist
- [x] "quik links" → suggestion shown
- [x] "no" → clears suggestion and responds "Okay — what would you like instead?"
- [x] Next typo should not suggest the same target again (shows generic fallback instead)
- [x] "nope" / "not that" / "cancel" / "never mind" → same rejection behavior
- [x] "no, I meant..." → treated as rejection (begins with "no,")
- [x] Successful navigation clears rejected list (user can get same suggestion later)
- [x] Message text overridden when all suggestions filtered (no "Did you mean X?" for rejected items)

## Rollback
Remove rejection detection and suggestion filtering.

## Isolation Reactivity Anti-Patterns
Not applicable.
