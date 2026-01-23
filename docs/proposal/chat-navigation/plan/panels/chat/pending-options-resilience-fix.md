# Pending Options Resilience Fix

**Status:** Complete
**Completed:** 2026-01-22
**Implementation Report:** `meta/reports/2026-01-22-pending-options-resilience-implementation-report.md`

---

## Goal
Keep disambiguation usable after a user typo or off‑list message, so the chat doesn’t fall back to generic suggestions when options are already visible or were just shown.

## Problem
After options are shown, a non‑matching input (e.g., “ffrs”) can trigger the generic fallback flow. This can make the disambiguation state fragile if options are not re‑shown and the user tries to recover with an ordinal (“first one”).

## Fix Summary (Updated)
1) ✅ **Do not clear `pendingOptions` on unsupported/typo inputs** *(already implemented)*
2) ✅ **Allow ordinal selection against `lastOptions` when `pendingOptions` is empty** *(already implemented)*
3) ⏳ **If user input doesn’t match any option, re‑show options instead of fallback** *(remaining work)*

## Detailed Changes

### 1) Preserve pending options on unsupported inputs (Already Implemented)
- Only clear `pendingOptions` when:
  - user selects an option
  - a new explicit command is detected (create/rename/delete/open workspace, etc.)
  - grace window expires (see below)
- Do **not** clear just because a fallback response is triggered.

### 2) Ordinal matching should use `lastOptions` (Already Implemented)
- If `pendingOptions` is empty but `lastOptions` is within grace window:
  - allow ordinal parsing (“first”, “second”, “last”) against `lastOptions`
  - treat as valid selection

### 3) Re‑show options on no‑match (Remaining Work)
- **Trigger condition** (all must be true):
  - input does **not** match any option
  - `pendingOptions` exists **or** `lastOptions` is within grace window
  - input is **not** a cancel/exit phrase (see below)
- **Action**:
  - show “Please choose one of the options:” + re‑render the last options
  - skip generic fallback list

### Cancel/Exit Bypass (Required)
If user input matches a cancel/exit phrase, **do not** re‑show options.  
Examples: `cancel`, `never mind`, `no`, `none`, `stop`, `exit`, `quit`.

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

4) Cancel/exit does NOT re‑show
   - Show options
   - Type “cancel” or “never mind”
   - Options cleared, no re‑show

## Files to Touch (expected)
- `components/chat/chat-navigation-panel.tsx`
  - no‑match detection + re‑show behavior
  - cancel/exit bypass
- `app/api/chat/navigate/route.ts`
  - intent override if returning `reshow_options`
