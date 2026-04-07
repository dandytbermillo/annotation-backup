# Clarification META Explain Fix (Minimal Plan)

## Goal
When the user asks “explain/what do you mean?” during a clarification, return a short explanation instead of repeating the same clarification message.

## Scope
- Small, local change.
- No schema changes.
- Only affects clarification-active flows.

## Problem
The META handler currently repeats the original clarification message for notes-scope, which feels unresponsive. Users expect a brief explanation and a re-ask.

## Fix Strategy
Add a dedicated explanation branch for notes-scope META:
- Provide 1–2 sentences explaining why a workspace is needed.
- Re-ask the same question afterward.

## Implementation Steps
1) In the clarification META handler (chat-navigation-panel.tsx):
   - If `lastClarification.type === 'notes_scope'` and no options are shown, return:
     - Explanation: “Notes are grouped inside workspaces. To show open notes, I need to know which workspace to check.”
     - Re-ask: “Would you like to pick a workspace? (yes/no)”

2) Keep existing behavior for option-based META (list options + re-ask).

## Files to Touch
- `components/chat/chat-navigation-panel.tsx`

## Acceptance Tests
1) **Notes clarification explanation**
   - Bot: “Notes live inside workspaces. Would you like to open a workspace?”
   - User: “explain”
   - Expected: short explanation + same yes/no question

2) **Options clarification unchanged**
   - Bot: “Which one—D or E?” + pills
   - User: “what do you mean?”
   - Expected: list options + re-ask

## Rollback
Remove the notes-scope META explanation branch.
