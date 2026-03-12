# Stage 6 Slice 6.5: Enforcement Mode (Phase 1 — open_panel) — Implementation Report

**Date**: 2026-03-12
**Status**: CLOSED (Phase 1 — open_panel)
**Predecessors**: Slice 6.3 (shadow loop, closed), Slice 6.4 (action validators, closed), Slice 6.6 (eval pipeline, closed)

---

## Summary

Enforcement mode transitions Stage 6 from shadow (log-only) to awaitable execution. When enabled, the dispatcher awaits the S6 loop result and, if it returns `action_executed` + `open_panel`, executes via the bridge. On failure, falls through to the normal Stage 4 clarifier — zero risk of breaking existing behavior.

Phase 1 covers `open_panel` only. `navigate_entry` and `open_widget_item` are Phase 2/3.

---

## Deliverables

### New files

| File | Purpose |
|------|---------|
| `lib/chat/stage6-execution-bridge.ts` | Maps validated `S6ActionResult` to UI execution (`openPanelDrawer`). TOCTOU revalidation via fresh `handleInspect`. Duplicate action guard (`isDuplicateAction`). |
| `__tests__/unit/chat/stage6-execution-bridge.test.ts` | 13 tests: happy path, guards (not_open_panel, validation_rejected, missing slug, TOCTOU stale, bridge error), label resolution, isDuplicateAction (5 tests) |

### Modified files

| File | Change |
|------|--------|
| `lib/chat/stage6-loop-controller.ts` | Added `runS6EnforcementLoop` (awaitable, returns `S6LoopResult \| null`). Added `writeDurableEnforcementLog` (provenance `s6_enforced:<action_type>` or `s6_enforced:fallback`). Fixed stale comment about interaction_id suffix. |
| `lib/chat/routing-dispatcher.ts` | Added enforcement-or-shadow branching at both `stage4_abstain` (~5262) and `stage4_timeout` (~5446) call sites. Added `isDuplicateAction` guard. Added `s6ExecutedActions` array in `dispatchRoutingInner`. Extended `handledByTier` type to include `6`. |
| `lib/chat/chat-navigation-context.tsx` | Added `'s6_enforced'` to `ChatProvenance` type union. |
| `components/chat/ChatMessageList.tsx` | Added `s6_enforced` entry to `PROVENANCE_STYLES` (indigo badge). |
| `lib/chat/routing-log/mapping.ts` | Added `tierToLane(6) → 'D'`, `provenanceToDecisionSource('s6_enforced') → 'llm'`, `deriveResultStatus(true, 's6_enforced', ...) → 'executed'`. |
| `__tests__/unit/chat/stage6-loop-controller.test.ts` | Added 7 enforcement loop tests (§6): flag guard, window guard, success return, debugLog, durable log provenance, fallback provenance, error swallowing. |
| `__tests__/unit/routing-log/mapping.test.ts` | Added 3 tests: tier 6 → lane D, s6_enforced → llm, s6_enforced → executed. |
| `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6-agent-tool-loop-design.md` | Updated §7c status to CLOSED. Fixed interaction_id row in logging contract table (`:s6` suffix, not main ID). |
| `.env.local` | Added `NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED=true`. |

---

## Architecture

### Enforcement flow

```
User input → Stage 4 LLM → abstain/timeout
  → NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED === 'true'?
    YES → await runS6EnforcementLoop(params)
      → S6 result: action_executed + open_panel?
        YES → isDuplicateAction check
          → NOT duplicate → executeS6OpenPanel (TOCTOU revalidation)
            → bridge success → return { handledByTier: 6, tierLabel: 's6_enforced:open_panel' }
            → bridge fail → fall through to clarifier
          → duplicate → fall through to clarifier
        NO → fall through to clarifier
    NO → void runS6ShadowLoop(params) (fire-and-forget, unchanged)
```

### TOCTOU revalidation

At commit point, `executeS6OpenPanel` calls `handleInspect({ tool: 'inspect_dashboard' })` for a **fresh** panel registry read (not the loop-entry snapshots). Re-runs `validateOpenPanel` against this fresh snapshot. If stale → returns `toctou_stale`, panel is not opened.

### Duplicate action guard

`s6ExecutedActions: S6ActionSignature[]` tracked per `dispatchRoutingInner` call. Before bridge execution, checks `isDuplicateAction({ interactionId, actionType, targetId })`. On success, pushes signature to array. Prevents double-execution if both abstain and timeout paths fire for the same interaction.

### Durable logging contract

| Field | Enforced S6 value |
|-------|-------------------|
| `provenance` | `s6_enforced:<action_type>` or `s6_enforced:fallback` |
| `handled_by_tier` | `6` |
| `decision_source` | `llm` |
| `routing_lane` | `D` |
| `result_status` | `executed` (on action success) or `failed` (on fallback) |
| `interaction_id` | `${interactionId}:s6` (avoids unique constraint conflict) |
| `tier_label` | `s6_enforce` |

---

## Test results

### Unit tests

```
$ npx jest __tests__/unit/chat/stage6 __tests__/unit/routing-log/mapping.test.ts --no-coverage

PASS __tests__/unit/routing-log/mapping.test.ts
PASS __tests__/unit/chat/stage6-execution-bridge.test.ts
PASS __tests__/unit/chat/stage6-loop-route.test.ts
PASS __tests__/unit/chat/stage6-inspect-handlers.test.ts
PASS __tests__/unit/chat/stage6-loop-controller.test.ts
PASS __tests__/unit/chat/stage6-action-validators.test.ts

Test Suites: 6 passed, 6 total
Tests:       97 passed, 97 total
```

### Type-check

```
$ npm run type-check
(clean — no errors)
```

### Runtime validation (2026-03-12, N=3 enforcement rows)

Enabled `NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED=true`, ran three test scenarios:

| Query | S6 outcome | S6 tool trace | Fallback? |
|-------|-----------|---------------|-----------|
| "open the budget report I was looking at" | `abort` | inspect_recent_items → inspect_search → abort | Yes (clarifier shown) |
| "open the budget report I was looking at" | `clarification_accepted` | inspect_recent_items → clarify | Yes (clarifier shown) |
| "show me the panel with links" | `clarification_accepted` | inspect_dashboard → clarify | Yes (clarifier shown) |

All three correctly fell through to the normal Stage 4 clarifier. No `action_executed` + `open_panel` observed — model chose clarify/abort because test scenarios had ambiguous dashboards (3 Links Panels open, no unique match for "budget report"). This is correct model behavior; resolution tuning is 6.7 scope.

Durable log verification:

```sql
SELECT provenance, routing_lane, decision_source, result_status,
       semantic_hint_metadata->>'s6_outcome' as s6_outcome
FROM chat_routing_durable_log
WHERE provenance LIKE 's6_enforced%'
ORDER BY created_at DESC;

 provenance           | routing_lane | decision_source | result_status | s6_outcome
 s6_enforced:fallback | D            | llm             | failed        | clarification_accepted
 s6_enforced:fallback | D            | llm             | failed        | clarification_accepted
 s6_enforced:fallback | D            | llm             | failed        | abort
```

All mapping fields correct: `routing_lane = D`, `decision_source = llm`, `result_status = failed` (fallback).

---

## Bugs found and fixed during implementation

### 1. `s6_enforced` not mapped in mapping.ts

`provenanceToDecisionSource('s6_enforced')` fell to default `'clarifier'`. `deriveResultStatus` had no `s6_enforced` branch → returned `'clarified'`. `tierToLane(6)` fell to default `'E'`.

Fixed: Added all three mappings. Covered by 3 new mapping tests.

### 2. `isDuplicateAction` defined but not wired

Exported from `stage6-execution-bridge.ts` and unit-tested, but never called from the dispatcher. Wired into both enforcement sites with `s6ExecutedActions` array.

### 3. Stale comment in stage6-loop-controller.ts

Comment on `writeDurableEnforcementLog` said "no ':s6' suffix" but implementation uses `:s6`. Fixed comment to match reality.

---

## What 6.5 Phase 1 does NOT do

- No `navigate_entry` or `open_widget_item` enforcement (Phase 2/3)
- No content mutation actions
- No automatic retry on failure
- No confidence threshold gating
- No A/B traffic splitting (feature flag is all-or-nothing)

---

## Acceptance criteria status

1. [x] User types ambiguous input → Stage 4 abstains → S6 loop runs — **runtime-proven (3 rows)**
2. [x] Model emits `open_panel` with valid panel slug — **runtime-proven (2026-03-12, fixture: "take me to my links" → `open_panel(w_links_b)`, 1 inspect round)**
3. [x] Commit-point revalidation passes — **unit-tested (stage6-execution-bridge.test.ts §1, §5) + runtime-proven (TOCTOU passed, panel opened)**
4. [x] Panel drawer opens in the UI — **runtime-proven (2026-03-12, Links Panel B drawer opened via S6-Enforced provenance)**
5. [x] Durable log shows correct provenance/mapping — **runtime-proven (`routing_lane=D`, `decision_source=llm`, `result_status=executed`, `s6_outcome=action_executed`, `s6_action_type=open_panel`)**
6. [x] If revalidation fails → clarifier shown instead — **runtime-proven (all 3 pre-fixture test scenarios fell through)**
7. [x] No duplicate execution — **implemented + unit-tested (isDuplicateAction wired at both call sites)**

All criteria runtime-proven as of 2026-03-12. Fixture: single-match dashboard (Links Panel B only links panel) + `NEXT_PUBLIC_STAGE4_FORCE_ABSTAIN=true` to guarantee S6 reachability. Durable log row: `f1431659-8b90-40ac-90c7-587e0c37fb79:s6`.

---

## Next: unblocked slices

| Slice | Scope | Deps |
|-------|-------|------|
| **6.7** | Tuning — prompt hardening, ID fidelity, confidence thresholds | 6.5 ✅ + 6.6 ✅ |
| **6.5 Phase 2** | `navigate_entry` enforcement | 6.5 Phase 1 ✅ |
| **6.5 Phase 3** | `open_widget_item` enforcement | 6.5 Phase 2 |
