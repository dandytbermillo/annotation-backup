# Stage 6 Slice 6.3: Shadow Loop Wiring — Implementation Report

**Date**: 2026-03-11
**Status**: CLOSED (runtime-proven)

## Summary

Wired the Stage 6 Agent Tool Loop into the routing dispatcher in shadow mode. The loop fires when Stage 4 abstains (`need_more_info`) or times out, runs a Gemini multi-turn inspect→decide cycle, and writes durable telemetry — all without affecting user-facing behavior.

## Changes

### Files Created

| File | Purpose |
|------|---------|
| `app/api/chat/stage6-loop/route.ts` | Server route: Gemini multi-turn loop with inspect/action/clarify/abort |
| `lib/chat/stage6-loop-controller.ts` | Client controller: fire-and-forget shadow wrapper + durable telemetry |
| `__tests__/unit/chat/stage6-loop-route.test.ts` | Server route tests (10 tests) |
| `__tests__/unit/chat/stage6-loop-controller.test.ts` | Controller tests (8 tests) |

### Files Modified

| File | Change |
|------|--------|
| `lib/chat/routing-dispatcher.ts` | Import + two `void runS6ShadowLoop()` call sites (stage4_abstain, stage4_timeout) |
| `lib/chat/routing-log/payload.ts` | Added `s6_*` fields to `RoutingLogPayload` |
| `app/api/chat/routing-log/route.ts` | Wired `s6_*` fields through `semantic_hint_metadata` JSONB |
| `.env.local` | Added `STAGE6_SHADOW_ENABLED=true`, `NEXT_PUBLIC_STAGE6_SHADOW_ENABLED=true` |

## Architecture

```
User Input → Stage 4 abstain/timeout
  → dispatchRoutingInner fires void runS6ShadowLoop(...)
    → Client controller pre-computes 3 snapshots (dashboard, active widget, visible items)
    → POST /api/chat/stage6-loop with loopInput + clientSnapshots
      → Server runs Gemini multi-turn loop (inspect → decide → inspect → ...)
      → Returns S6LoopResult
    → Controller logs via debugLog (ephemeral)
    → Controller writes via recordRoutingLog (durable, log_phase='execution_outcome')
```

### Key Design Decisions

1. **Pre-computed snapshots**: Client computes dashboard/activeWidget/visibleItems before calling server, avoiding client-server bouncing during the loop.
2. **Server-side DB inspects**: `inspect_recent_items` and `inspect_search` query Postgres directly via `serverPool` with `resolveNoteWorkspaceUserId`.
3. **interaction_id suffix**: Shadow log rows use `${interactionId}:s6` to avoid unique constraint conflict with `fireOutcomeLog` execution_outcome rows for the same turn.
4. **Escalation scope**: Only `stage4_abstain` and `stage4_timeout` are wired. `stage4_low_confidence` remains future-only (per design note).

## Feature Flags

| Flag | Side | Purpose |
|------|------|---------|
| `STAGE6_SHADOW_ENABLED` | Server | Gates the loop route |
| `NEXT_PUBLIC_STAGE6_SHADOW_ENABLED` | Client | Gates the controller |

## Test Results

```
PASS __tests__/unit/chat/stage6-loop-route.test.ts (10 tests)
PASS __tests__/unit/chat/stage6-loop-controller.test.ts (8 tests)
PASS __tests__/unit/chat/stage6-inspect-handlers.test.ts (12 tests)

Test Suites: 3 passed, 3 total
Tests:       30 passed, 30 total
```

Type-check: clean (only pre-existing `use-panel-close-handler.test.tsx:87` error).

## Runtime Validation

### Stage 6 Loop Route (Gemini)

```bash
curl -X POST http://localhost:3001/api/chat/stage6-loop -H 'Content-Type: application/json' -d '...'
```

Response:
```json
{
  "outcome": "action_executed",
  "inspectRoundsUsed": 0,
  "durationMs": 1256,
  "telemetry": {
    "s6_loop_entered": true,
    "s6_escalation_reason": "stage4_abstain",
    "s6_outcome": "action_executed",
    "s6_tool_trace": ["action"],
    "s6_action_type": "open_panel",
    "s6_action_target_id": "c1"
  }
}
```

Gemini resolved "open budget report" → `open_panel` targeting grounding candidate `c1` in 1.26s with zero inspect rounds.

### Durable Log Persistence

```sql
SELECT interaction_id, log_phase, provenance, result_status,
       semantic_hint_metadata->>'s6_loop_entered' AS s6_loop_entered,
       semantic_hint_metadata->>'s6_outcome' AS s6_outcome,
       semantic_hint_metadata->>'s6_tool_trace' AS s6_tool_trace,
       semantic_hint_metadata->>'s6_action_type' AS s6_action_type
FROM chat_routing_durable_log
WHERE interaction_id LIKE '%s6-runtime-test%';
```

Result:
```
 interaction_id          | log_phase         | provenance                | s6_loop_entered | s6_outcome      | s6_tool_trace  | s6_action_type
 s6-runtime-test-001:s6  | execution_outcome | s6_shadow:action_executed | true            | action_executed | ["action"]     | open_panel
```

All `s6_*` fields stored correctly in `semantic_hint_metadata` JSONB column.

## Next Steps

- **Slice 6.4**: Implement action tools with validation (next unblocked slice)
- **Slice 6.6**: Telemetry + eval pipeline (partially covered by durable `s6_*` fields; eval queries, analysis, and promotion criteria remain)
