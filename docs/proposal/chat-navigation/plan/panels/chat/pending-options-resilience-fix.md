# Pending Options Resilience Fix

## Goal
Keep disambiguation usable after a user typo or off‑list message, so the chat doesn’t fall back to generic suggestions when options are already visible or were just shown.

## Problem
After options are shown, a non‑matching input (e.g., “ffrs”) can trigger the generic fallback flow. This clears `pendingOptions`, so later inputs like “first one” no longer work, even though the intent is obvious.

## Fix Summary
1) **Do not clear `pendingOptions` on unsupported/typo inputs**
2) **Allow ordinal selection against `lastOptions` when `pendingOptions` is empty**
3) **If user input doesn’t match any option, re‑show options instead of fallback**

## Detailed Changes

### 1) Preserve pending options on unsupported inputs
- Only clear `pendingOptions` when:
  - user selects an option
  - a new explicit command is detected (create/rename/delete/open workspace, etc.)
  - grace window expires (see below)
- Do **not** clear just because a fallback response is triggered.

### 2) Ordinal matching should use `lastOptions`
- If `pendingOptions` is empty but `lastOptions` is within grace window:
  - allow ordinal parsing (“first”, “second”, “last”) against `lastOptions`
  - treat as valid selection

### 3) Re‑show options on no‑match
- If input doesn’t match any option and grace window is active:
  - show “Please choose one” + re‑render the last options
  - skip typo fallback list

## Grace Window (Required)
Define a concrete grace window for `lastOptions` (e.g., 30 seconds or N turns).  
The window should be stored alongside `lastOptions` (timestamp or turn index) and
checked before:
1) ordinal matching from `lastOptions`
2) re‑showing options on no‑match


## Expected Behavior

### Current (bad)
User: quick links → options shown
User: ffrs → fallback text, options cleared
User: first one → fallback text again

### After fix (good)
User: quick links → options shown
User: ffrs → “Please choose one” + options re‑shown
User: first one → selects correctly

## Acceptance Tests
1) Options remain after typo
   - Show options
   - Type garbage
   - Options still appear and are selectable

2) Ordinal works after typo
   - Show options
   - Type garbage
   - “first one” selects correctly

3) Explicit command clears options
   - Show options
   - Type “go home” → options cleared

## Files to Touch (expected)
- `lib/chat/chat-routing.ts`
  - pendingOptions clearing logic
  - ordinal selection logic
  - no‑match fallback handling
- `components/chat/chat-navigation-panel.tsx`
  - state ownership / wiring for `pendingOptions` and `lastOptions`
  - message rendering for re‑showing options
