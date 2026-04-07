# Pending Options Guard Plan

**Status:** IMPLEMENTED
**Implementation Date:** 2026-01-05

## Purpose
Prevent users from re-triggering typo suggestions while a disambiguation list (pending options)
is already shown. This avoids loops like:
“quick links” → suggestion → yes → options → “quick links” → suggestion again.

## Goals
- If pending options exist, prioritize selection flow over typo suggestions.
- Provide a clear prompt to pick one of the visible options.

## Non-Goals
- Changing how disambiguation options are generated.
- Auto-selecting without user confirmation.

## Behavior Rules
1) When `pendingOptions.length > 0`:
   - If user input matches a pending option label/sublabel → select it.
   - Else respond: “You already have options shown. Please choose one.”
   - Do not run typo suggestions in this state.

## Implementation Steps
1) In `components/chat/chat-navigation-panel.tsx`
   - Add a guard before typo suggestion flow:
     - If `pendingOptions.length > 0` and input doesn’t match any option:
       - Respond with a short instruction
       - Return early (skip API/typo).

## Dependency
This guard assumes `pendingOptions` is set when options are shown (e.g., from “yes” confirmation).
Ensure the “yes” handler sets pendingOptions before enabling this guard.

## UX Copy
“You already have options shown. Please choose one.”

## Test Checklist
- [x] "quik links" → suggestion → "yes" → options appear.
- [x] User types "quick links" again → see instruction, no new suggestion.
- [x] User clicks or types "Quick Links D" → selection resolves.

## Rollback
Remove pending-options guard and revert to current behavior.

## Isolation Reactivity Anti-Patterns
Not applicable.
