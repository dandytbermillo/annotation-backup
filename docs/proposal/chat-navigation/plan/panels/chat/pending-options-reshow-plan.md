# Pending Options Re‑Show Plan

**Status:** IMPLEMENTED
**Implementation Date:** 2026-01-05

## Purpose
When disambiguation options are already shown, allow the user to ask “show me the options”
and re‑display the same pills instead of repeating “Please choose one.”

## Goals
- Provide a deterministic “re‑show options” path.
- Avoid calling the LLM for this case.
- Keep UX short and clear.

## Non-Goals
- Generating new options.
- Auto-selecting without confirmation.

## Detection Rules
If `pendingOptions.length > 0` and user input matches:
- “show me the options”
- “show options”
- “provide options”
- “what are the options”
- “list the options”
→ re‑show current options and return early.

## Behavior
Response:
“Here are your options again:”
Then render the same options pills.

## Implementation Steps
1) In `components/chat/chat-navigation-panel.tsx`:
   - Add a `matchesReshowOptions()` helper.
   - In the pending options guard block, check this first:
     - If true → add assistant message with options.
     - Return early.
   - Else → fall back to “Please choose one.”

## Tests
- [x] After disambiguation, type "show me the options" → pills re‑render.
- [x] After disambiguation, type "provide options" → pills re‑render.
- [x] Type unrelated text → still "Please choose one."

## Rollback
Remove the reshow branch.

## Isolation Reactivity Anti-Patterns
Not applicable.
