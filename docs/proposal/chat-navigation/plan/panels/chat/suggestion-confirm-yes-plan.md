# Suggestion Confirm "Yes" Plan

**Status:** IMPLEMENTED
**Implementation Date:** 2026-01-05

## Purpose
Handle user confirmations like “yes” when a suggestion is active, so the user can
accept a suggestion without clicking a pill.

## Goals
- If a single suggestion is active, “yes” executes its primary action.
- If multiple suggestions are active, “yes” asks “Which one?”
- Avoid sending “yes” to the LLM when a suggestion is active.

## Non-Goals
- Natural language confirmation parsing beyond simple affirmative words.
- Persistent confirmation state across sessions.

## Detection Rules
Treat as confirmation when:
- Input is one of: “yes”, “yeah”, “yep”, “sure”, “ok”, “okay”
- `lastSuggestion` exists

## Behavior
1) Single candidate
   - Execute primary action (Open/List) immediately.
2) Multiple candidates
   - Respond: “Which one?” and re-display candidates.

## Primary Action Mapping
Use `candidate.primaryAction` to determine what “yes” does:
- open → open panel / navigate to target
- list → list in chat (preview)
- navigate → go_home / go_to_dashboard
- create → create workspace
- info → run informational intent

## Implementation Steps
1) In `components/chat/chat-navigation-panel.tsx`
   - Add a guard before API call:
     - If `lastSuggestion` exists AND input is affirmative:
       - If 1 candidate → invoke the suggestion directly without synthetic user messages.
       - If >1 → respond “Which one?” and re-display candidates.
         - IMPORTANT: set `pendingOptions` so the UI renders pills and follow-ups work.
2) Keep `lastSuggestion` until resolved.

## Avoid Synthetic Messages
Do not reuse the pill click helper (it injects a fake user message).
Instead:
- Build the API request directly using the candidate’s intent metadata.
- Add only the assistant response.

## Test Checklist
- [x] "quik links" → suggestion shown
- [x] "yes" → opens Quick Links (single candidate)
- [x] "qk lk" → multiple suggestions
- [x] "yes" → "Which one?" + candidates

## Rollback
Remove the affirmative guard and revert to current behavior.

## Isolation Reactivity Anti-Patterns
Not applicable.
