# Suggestion Fallback Polish Plan

**Status:** IMPLEMENTED
**Implementation Date:** 2026-01-05

## Purpose
Polish the suggestion flow after a rejection so:
- Rejected items are removed from the fallback message.
- “yes” is only accepted when an active suggestion exists.

## Goals
- Stop showing rejected labels in “Try: …” fallbacks.
- Prevent “yes” from triggering a new fallback when there is no active suggestion.
- Keep behavior deterministic and minimal.

## Non-Goals
- Changing suggestion scoring logic.
- Rewriting the typo matcher.
- Adding TTL or persistent rejection state.

## Current Behavior (Problem)
1) Rejected labels still appear in fallback:
   - “Try: recent, quick links, workspaces.”
2) “yes” with no active suggestion:
   - Falls through and triggers generic fallback.

## Desired Behavior
1) Fallback excludes rejected labels.
2) “yes” with no active suggestion:
   - Respond with “Yes to which option?”

## Implementation Steps
1) Filter fallback message labels
   - When suggestions are filtered out, recompute fallback labels
     excluding `rejectedSuggestions`.
   - If nothing remains, show a generic prompt (e.g., “Try: workspaces.”).

2) Handle “yes” without active suggestion
   - If input is affirmative (“yes”, “yep”, “sure”) AND `lastSuggestion` is null:
     - Respond: “Yes to which option?”
     - Do not call API.

## UX Copy (Exact)
- Rejection response (existing):
  “Okay — what would you like instead?”
- Affirmation without context (new):
  “Yes to which option?”

## Tests
- [x] "quik links" → suggestion shown.
- [x] "no" → rejection response.
- [x] "quik links" → fallback excludes "quick links".
- [x] "yes" → "Yes to which option?" (no API call).

## Rollback
- Remove fallback filtering and “yes” guard.

## Isolation Reactivity Anti-Patterns
Not applicable.
