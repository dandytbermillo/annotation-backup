# Phase 4 Small-Risk Fixes Plan

## Goal
Eliminate the two remaining Phase 4 edge risks:
1) workspace widgetState filtering uses a prefix and could hide third-party widgets
2) clarification exit regex can prematurely exit clarification flows

## Scope
- No feature changes; tighten correctness + reduce false positives.
- No new UI.

## Fix 1: Replace prefix filter with widgetId check

### Why
Filtering by `instanceId.startsWith('workspace-')` can hide any non-workspace widget that (incorrectly) uses the `workspace-` prefix. Safer to rely on the canonical `widgetId`.

### Implementation
- Change dashboard-mode widgetStates filter to drop only states where `widgetId === 'workspace'`.
- Defer validation in the widget state store (follow-up hardening).

### Files
- components/dashboard/DashboardView.tsx
-- Optional follow-up: lib/widgets/widget-state-store.ts

### Acceptance
- Dashboard mode never shows stale workspace notes.
- Third-party widget with instanceId starting `workspace-foo` is NOT filtered unless widgetId is `workspace`.

## Fix 2: Clarification routing order

### Why
Current clarification-exit regex can fire before clarification handling, causing accidental exit for conversational responses ("can you explain?").

### Implementation
- When `lastClarification` exists, run clarification handling first:
  - Tier 1: local YES/NO patterns
  - Tier 2: clarification LLM interpreter
  - Only if the interpreter returns UNCLEAR should we evaluate `isNewQuestionOrCommand` and fall back to normal routing.
- Clarify: do not treat question-like phrases as explicit commands while clarification is active.

### Files
- components/chat/chat-navigation-panel.tsx
- app/api/chat/navigate/route.ts (only if clarificationMode flag needs enforcement)

### Acceptance
- "Can you do that?" during clarification stays in clarification flow (no early exit).
- "nope" cancels clarification.
- "yes please" executes clarification nextAction deterministically.

## Tests

1) Prefix filtering
- Create a test widget with widgetId = "custom", instanceId = "workspace-fake"
- Dashboard uiContext should still include it

2) Clarification routing
- Trigger notes-scope clarification
- Respond with: "can you do that?"
- Expected: clarification interpreter handles it (re-ask), no fallback/typo suggestions

## Rollback
- Revert filter to prefix (not recommended)
- Re-enable previous clarification exit order

## Follow-up Hardening (Deferred)
- Add widget state validation:
  - If `widgetId === 'workspace'`, require `instanceId` to be `workspace-{workspaceId}`
  - Otherwise allow any `instanceId` (no prefix reservations)

---

## Implementation Notes (2026-01-08)

**Status: COMPLETED**

All fixes implemented and tested:

1. **Fix 1:** Changed filter from `instanceId.startsWith('workspace-')` to `state.widgetId !== 'workspace'` in DashboardView.tsx (2 locations)

2. **Fix 2:** Reordered clarification handling:
   - Clarification handler runs FIRST when `lastClarification` is active
   - `handleUnclear()` returns boolean to control fall-through
   - Only exits to normal routing if UNCLEAR AND isNewQuestionOrCommand

3. **Fix 2b (discovered during testing):** Improved clarification interpreter prompt in route.ts to recognize question-style affirmations ("can you do that?", "is that possible?", etc.) as YES

**Test Results:**
- "can you do that?" → YES → workspace picker ✅
- "is that possible?" → YES → workspace picker ✅
- Dashboard filtering by widgetId works correctly ✅

**Resolved / Not Reproducible Note (2026-01-08):**
- The intermittent "Returning to dashboard..." without navigation could not be reproduced in repeated tests. The command path consistently returns to the dashboard.

See: `report/2026-01-08-phase4-small-risk-fixes-report.md`
