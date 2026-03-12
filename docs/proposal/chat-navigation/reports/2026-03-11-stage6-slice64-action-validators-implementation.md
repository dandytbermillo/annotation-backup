# Stage 6 Slice 6.4: Action Validators — Implementation Report

**Date**: 2026-03-11
**Status**: CLOSED (2026-03-11, code + test + runtime-validated)
**Predecessor**: Slice 6.3 (shadow loop wiring) — closed 2026-03-11

---

## Summary

Implemented the action validation pipeline for Stage 6's three executable actions. In shadow mode, validators determine whether a model-emitted action *could* be executed, returning `executed` or `rejected` + rejection reason — but no UI side effects are dispatched (that's 6.5 enforcement).

---

## Changes

### Files created

| File | Purpose |
|------|---------|
| `lib/chat/stage6-action-validators.ts` | Three validators: `validateOpenPanel`, `validateOpenWidgetItem`, `validateNavigateEntry` |
| `__tests__/unit/chat/stage6-action-validators.test.ts` | 16 unit tests covering each validator × pass + each rejection reason |

### Files modified

| File | Change |
|------|--------|
| `app/api/chat/stage6-loop/route.ts` | Replaced unconditional `action_executed` with validated action pipeline. Added `validateAction()` dispatcher, `buildLoopResultWithAction()`, `queryEntryExists()` DB function |
| `__tests__/unit/chat/stage6-loop-route.test.ts` | Added 6 route-level validation tests (§11): 3 rejection + 1 pass + 2 additional rejection coverage for `permission_denied` and `target_not_found` |
| `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6-agent-tool-loop-design.md` | Marked §7a status as CLOSED. Clarified freshness model and `target_not_visible` deferral |

---

## Architecture

### Validation contract

```
Model emits action → parse action type → call validator → S6ActionResult (executed | rejected + reason)
```

### Freshness model

| Validator | Freshness | Source |
|-----------|-----------|--------|
| `validateNavigateEntry` | Truly fresh — DB query at validation time | `items` table with LEFT JOIN to `note_workspaces` |
| `validateOpenPanel` | Stale-by-design — pre-computed `clientSnapshots` from loop entry | Dashboard snapshot |
| `validateOpenWidgetItem` | Stale-by-design — pre-computed `clientSnapshots` from loop entry | Dashboard + visible items snapshots |

True client-side TOCTOU revalidation deferred to 6.5 enforcement.

### `target_not_visible` — deferred

Defined in `S6ActionRejectionReason` (contracts, 6.1) but **not produced by 6.4 validators**. In pre-computed snapshots, "item exists but not in snapshot" is indistinguishable from "item doesn't exist" — both map to `target_not_found`. May become meaningful in 6.5 when true fresh client state is available.

---

## Test matrix

### Validator unit tests (`stage6-action-validators.test.ts`) — 16 tests

| Action | Pass | Reject |
|--------|------|--------|
| `open_panel` | widgetId, panelId, kebab-case label | `panel_not_registered` (no match, empty slug, error dashboard) |
| `open_widget_item` | widget + item exist | `widget_not_open`, `target_not_found` (missing item, wrong widget, empty IDs) |
| `navigate_entry` | exists + belongs to user | `entry_not_found`, `permission_denied`, empty entryId |

### Route-level validation tests (`stage6-loop-route.test.ts` §11) — 6 tests

| Action | Rejection Reason | Test |
|--------|-----------------|------|
| `open_panel` | `panel_not_registered` | Nonexistent panel slug |
| `open_panel` | — (pass) | Widget in dashboard snapshot |
| `open_widget_item` | `widget_not_open` | Nonexistent widget |
| `open_widget_item` | `target_not_found` | Widget exists, item doesn't |
| `navigate_entry` | `entry_not_found` | DB returns empty rows |
| `navigate_entry` | `permission_denied` | DB returns `belongs_to_user: false` |

---

## Verification

```
Type-check:
$ npx tsc --noEmit
Only pre-existing error: use-panel-close-handler.test.tsx(87,1) — unrelated

Tests:
$ npx jest --testPathPattern='stage6' --no-coverage
PASS stage6-loop-route.test.ts
PASS stage6-loop-controller.test.ts
PASS stage6-inspect-handlers.test.ts
PASS stage6-action-validators.test.ts

Test Suites: 4 passed, 4 total
Tests:       52 passed, 52 total
```

---

## Runtime Validation (2026-03-11)

### Rejection path — proven

Input: "navigate to the sample entry" → Stage 4 abstained → S6 shadow loop fired.

```
interaction_id:          e8186d77-...:s6
s6_outcome:              action_rejected
s6_action_type:          navigate_entry
s6_action_status:        rejected
s6_action_target_id:     18890a6c-f5d3-4086-8aad-02a528fbae05
s6_action_rejection_reason: entry_not_found
s6_escalation_reason:    stage4_abstain
s6_inspect_rounds:       2
s6_tool_trace:           ["inspect_search", "inspect_visible_items", "action"]
s6_duration_ms:          2256
```

The model found an entry via inspect tools, emitted `navigate_entry`, the validator queried the DB, and rejected with `entry_not_found`. Rejection reason persisted in durable log.

### Pass path — unit-covered, not runtime-observed

The model hallucinated the entry ID (`18890a6c-...`) instead of echoing the real ID (`4f448937-...` for `sample1 C`). This caused `entry_not_found` even though the entry exists. The validator logic is correct — the gap is model output fidelity.

### Bug found and fixed during runtime validation

`s6_action_rejection_reason` was missing from the durable log pipeline (payload type, routing-log route, controller). First runtime test showed `rejection_reason: null` despite the route returning it. Fixed by adding the field to:
- `lib/chat/routing-log/payload.ts` (line 131)
- `app/api/chat/routing-log/route.ts` (line 142)
- `lib/chat/stage6-loop-controller.ts` (line 205)

Before/after confirmed: older row at 22:58 has null, newer row at 23:02 has `entry_not_found`.

### Follow-up: model ID hallucination (6.7 tuning)

The model must copy tool-returned IDs faithfully. Potential fixes:
- Prompt hardening: "You MUST use exact IDs from tool responses"
- Structured output constraints: restrict ID fields to enum of observed values
- Enforcement readiness check in 6.5

Tracked as a 6.7 (tuning) issue, not a 6.4 blocker.

---

## What 6.4 does NOT do

- No UI side effects (no `open-panel-drawer` events, no `chat-navigate-entry` events)
- No enforcement mode wiring (6.5)
- No idempotency guard (`duplicate_action` deferred)
- No `target_not_visible` rejection (deferred to 6.5)
- No true client-side TOCTOU revalidation (deferred to 6.5)

---

## Next: unblocked slices

| Slice | Scope | Deps |
|-------|-------|------|
| **6.5** | Enforcement mode — bridge validation → existing execution mechanisms | 6.3 ✅ + 6.4 ✅ |
| **6.6** | Telemetry + eval pipeline (full — beyond durable log fields) | 6.3 ✅ |
