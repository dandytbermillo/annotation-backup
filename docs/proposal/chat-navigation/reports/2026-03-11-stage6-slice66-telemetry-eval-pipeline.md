# Stage 6 Slice 6.6: Telemetry + Eval Pipeline — Implementation Report

**Date**: 2026-03-11
**Status**: CLOSED (query-validated against real shadow-loop data)
**Predecessor**: Slice 6.3 (shadow loop wiring) — closed 2026-03-11

---

## Summary

Query-first evaluation infrastructure for Stage 6 shadow mode. No new runtime code — all compute-on-read via SQL joins against existing durable log rows.

---

## Deliverables

### 6.6a — Monitoring SQL

**File**: `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6-eval-queries.sql`

7 query groups:

| § | Query | Purpose |
|---|-------|---------|
| 1 | Coverage / row-pair join | Eligibility count, shadow coverage %, side-by-side detail |
| 2 | Outcome distribution | Terminal S6 outcomes with percentages |
| 3 | Inspect-round distribution | Tool-call histogram |
| 4 | Abort reason breakdown | Separate: budget exhaustion, timeout, model-chosen, parse failure |
| 5 | Action rejection reason breakdown | By action type × rejection reason |
| 6 | Latency p50/p95 | Overall + by outcome |
| 7 | Disagreement categories | Main routing vs S6 shadow comparison |

### 6.6b — Interpretation guide

**File**: `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6-eval-guide.md`

- Query-by-query interpretation
- Enforcement readiness thresholds
- Known limitations

---

## Validation against real data (6 shadow-loop rows)

Initial run had a column-source bug: `provenance` and `result_status` were read from `semantic_hint_metadata` JSONB instead of top-level columns. Fixed and revalidated.

```
§1 Coverage:       50.0% (6/12 eligible)
§2 Outcomes:       2 abort, 2 action_rejected, 2 clarification_accepted
§3 Inspect rounds: 33% zero, 67% two
§4 Abort reasons:  model-chosen ("no data found") — no timeouts, no budget exhaustion
§5 Rejections:     2× navigate_entry entry_not_found
§6 Latency:        p50=1994ms, p95=2259ms
§7 Disagreement:   16.7% disagree_s6_would_clarify, 16.7% disagree_s6_bad_action,
                   16.7% agree_fail, 50.0% no_shadow_row
```

Zero uncategorized rows in §7 disagreement query.

### Known data caveat

§5 shows one historical row with null `s6_action_rejection_reason` (`navigate_entry | <null> | 1`). This is the `a11e5389` row written before the rejection-reason field was added to the durable log pipeline. The newer `e8186d77` row has `entry_not_found` correctly populated. Historical artifact, not a current bug — no backfill needed.

### Baseline numbers (2026-03-11, N=6 shadow rows)

```
Coverage:         50.0% (6/12 eligible)
Outcome split:    33% abort, 33% action_rejected, 33% clarification_accepted
Inspect rounds:   avg 1.3 (33% zero, 67% two)
Latency:          p50=1994ms, p95=2259ms (above §6a target, expected for shadow)
Disagreement:     0% disagree_s6_would_act (S6 never successfully acted)
                  16.7% disagree_s6_bad_action (model ID hallucination)
                  16.7% disagree_s6_would_clarify (S6 > main for no-candidate cases)
                  16.7% agree_fail
                  50.0% no_shadow_row (coverage gap)
```

---

## Bugs found and fixed

### 1. Column-source bug in eval queries (6.6a)

`provenance` and `result_status` are top-level columns on `chat_routing_durable_log`, not JSONB fields inside `semantic_hint_metadata`. Queries in §1a, §1b, §1c, and §7 were reading them from JSONB (returning NULL), causing incorrect eligibility counts and main outcome classification.

Fixed: all references now use top-level column access.

### 2. Missing `s6_action_rejection_reason` in durable log pipeline (found during 6.4 runtime)

`s6_action_rejection_reason` was missing from the durable log pipeline. Added to:
- `lib/chat/routing-log/payload.ts` (line 131)
- `app/api/chat/routing-log/route.ts` (line 142)
- `lib/chat/stage6-loop-controller.ts` (line 205)

---

## What 6.6 does NOT do

- No new runtime telemetry fields
- No offline replay infrastructure
- No wrong-action labeling pipeline
- No A/B feature-flag rollout
- No backfill scripts

---

## Next: unblocked slices

| Slice | Scope | Deps |
|-------|-------|------|
| **6.5** | Enforcement mode — bridge validation → existing execution mechanisms | 6.3 ✅ + 6.4 ✅ |
| **6.7** | Tuning — prompt hardening, ID fidelity, confidence thresholds | 6.5 ✅ + 6.6 ✅ |
