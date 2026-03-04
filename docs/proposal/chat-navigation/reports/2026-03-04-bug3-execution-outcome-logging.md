# Bug #3: Execution Outcome Logging — Implementation Report

**Date:** 2026-03-04
**Status:** Implemented, tested, and validated via soak run. All 5 Phase 3 gates PASS.

## Summary

The durable log previously recorded only the **initial routing decision** before execution. Commands like "open links panel b" were logged as `E/clarifier/failed` even though the grounding LLM later successfully executed (UI shows "Auto-Executed"). This inflated Gate 4's failure rate from ~0% (real) to 30.4% (raw).

**Fix:** Two-phase logging. Each routing interaction now produces up to 2 rows:
- `routing_attempt` — written by dispatcher (existing, unchanged)
- `execution_outcome` — written after sendMessage execution completes (new)

Gate queries use `DISTINCT ON` preferring `execution_outcome` to report final user-visible outcomes.

## Changes

### New Files

| File | Purpose |
|------|---------|
| `migrations/072_chat_routing_durable_log_phase.up.sql` | Add `log_phase` column, update unique constraint |
| `migrations/072_chat_routing_durable_log_phase.down.sql` | Reversible: delete outcome rows, restore old constraint |
| `lib/chat/routing-log/outcome-logger.ts` | `fireOutcomeLog()` + `fireFailedOutcomeLog()` helpers |
| `__tests__/unit/routing-log/outcome-logger.test.ts` | 24 unit tests for outcome logger |

### Modified Files

| File | Change |
|------|--------|
| `lib/chat/routing-log/types.ts` | Added `LogPhase` type; added `log_phase` to `DurableLogRow` interface |
| `lib/chat/routing-log/payload.ts` | Added optional `log_phase` field to `RoutingLogPayload` |
| `lib/chat/routing-log/index.ts` | Barrel exports for `fireOutcomeLog`, `fireFailedOutcomeLog` |
| `app/api/chat/routing-log/route.ts` | Added `log_phase` as $27 parameter in INSERT SQL |
| `lib/chat/routing-dispatcher.ts` | Added `_routingLogPayload` to `RoutingDispatcherResult`; attached after `recordRoutingLog()` |
| `components/chat/chat-navigation-panel.tsx` | 11 outcome logging points (see below); `outcomeLogFired` + `_catchOutcomePayload` hoisted before try/catch |
| `docs/proposal/chat-navigation/test_scripts/soak-clean-run-plan.md` | Gate queries updated with dedup CTE + contract docs |
| `docs/proposal/chat-navigation/test_scripts/monitor-routing-soak.sql` | Sections 1-4 use dedup CTE; Section 5 filters to `routing_attempt`; Section 10 shows `log_phase` column |

### Outcome Logging Points (11 total)

**Grounding paths (6)** — guarded by `!routingResult._pendingMemoryLog && routingResult._routingLogPayload`:
- `execute_referent`: success, failure, exception
- `execute_widget_item`: success, failure, exception

**LLM fallthrough paths (5)** — guarded by `!outcomeLogFired && routingResult?._routingLogPayload`:
- Main success (6a), select_option matched (6b), select_option not matched (6c), reshow_options (6d), catch block errors (6e)

**Catch block scope fix:** `outcomeLogFired` and `_catchOutcomePayload` are declared before the outer try block so the catch block can access them. The catch block uses `_catchOutcomePayload` instead of `routingResult?._routingLogPayload` since `routingResult` is try-scoped.

## Key Design Decisions

1. **Lane/source semantics:** Outcome rows always use `routing_lane: 'D'`, `decision_source: 'llm'` — the actual outcome, not the original attempt's lane. The dedup view reports final user-visible results. Query `WHERE log_phase = 'routing_attempt'` for initial routing distribution analysis.

2. **`select_option` + `success=true` maps to `'executed'`**, not `'clarified'`. Early check in `fireOutcomeLog` prevents OPTION_PROMPT_ACTIONS from overriding.

3. **Grounding/LLM mutual exclusivity:** Grounding returns early when `handled=true`, LLM runs when `handled=false`. No shared fire guard needed across these blocks.

4. **Memory-commit-reject path:** `revalidateMemoryHit` clears `_routingLogPayload`, so LLM fallthrough within the same call has no payload and fires no outcome log. Correct behavior — the failed routing_attempt stands alone.

## Verification

### Automated (reproducible)

```
$ npm run type-check        → PASS (zero errors)
$ npm run lint              → PASS (warnings only, all pre-existing)
$ npx jest __tests__/unit/routing-log --runInBand
  → 12 suites / 144 tests PASS (includes 24 new outcome-logger tests)
$ npm run test              → 38 failures, all pre-existing in unrelated suites
```

### DB verification (self-reported, via docker exec psql)

```
$ npm run db:migrate
  → 072_chat_routing_durable_log_phase.up.sql applied successfully

$ docker exec <postgres> psql -U postgres -d annotation_dev -c "..."
  → log_phase column: TEXT, default 'routing_attempt'
  → Unique constraint: (tenant_id, user_id, interaction_id, log_phase)

Down migration tested manually:
  → DROP COLUMN log_phase, restore old UNIQUE(tenant_id, user_id, interaction_id)
  → Re-applied up migration cleanly
```

**Caveat:** DB verification was performed via `docker exec psql` in the development environment. `npm run db:migrate:rollback` is unimplemented (pre-existing: `run-migrations.js:149`).

### Soak Run Results (2026-03-04, ~03:24–03:28 UTC)

Executed the scripted scenario set from `soak-clean-run-plan.md` (Groups 1–5, 21 interactions).

**Raw log distribution:** 28 rows total — 21 `routing_attempt` + 7 `execution_outcome`.

**Dedup view (21 deduplicated interactions):**

| Lane | Source | Status | Count | Examples |
|------|--------|--------|-------|----------|
| B1 | memory_exact | executed | 10 | `open the buget100` x5, `open the budget100` x5 |
| D | llm | executed | 8 | panel opens x5, buget100 grounding, info query, panel b |
| D | llm | clarified | 2 | `open buget100` (no "the"), `open sample1 c` |
| A | clarifier | clarified | 1 | `links panel` disambiguation |
| A | deterministic | executed | 1 | ordinal `1` selection |

**Bug #3 fix confirmed:** 7 `execution_outcome` rows correctly override `E/clarifier/failed` routing_attempts with `D/llm/executed`. Gate 4 failure rate dropped from 30.4% (pre-fix) to **0.0%**.

**Gate evaluation:**

| Gate | Metric | Value | Verdict |
|------|--------|-------|---------|
| 1 | Effectiveness >= 50% (eligible subset) | **90.9%** (10/11 eligible) | **PASS** |
| 2 | Commit rejection < 5% | **0.0%** (0/10 memory attempts) | **PASS** |
| 3 | Zero v2 active drift | All 5 queries at 1 fingerprint | **PASS** |
| 4 | Failure rate < 10% (dedup view) | **0.0%** (0/21 failures) | **PASS** |
| 5 | Reuse growth >= 2 entries at 3+ | 2 entries | **PASS** |

**Decision:** All 5 gates PASS. Proceed to Phase 3 (semantic memory).

## What This Does NOT Change

- Initial `routing_attempt` log at dispatcher line ~1234 — unchanged
- Memory-served path logging (`_pendingMemoryLog`) — already correct
- Deterministic path logging (Tier 0-3) — already correct
- Table append-only semantics — preserved (two rows per interaction, not UPDATE)
- Existing rows get `log_phase = 'routing_attempt'` via column DEFAULT

## Remaining Caveats

1. **DB verification is self-reported** — Migration 072 applied and verified via `docker exec psql`. Cannot be independently confirmed without DB access.
2. **`npm run db:migrate:rollback` is unimplemented** — Pre-existing gap (`run-migrations.js:149`). Down migration SQL is correct but can only be tested manually via `psql`.

## Recommended Follow-ups

1. **Implement `npm run db:migrate:rollback`** — Currently unimplemented (`run-migrations.js:149`). Would enable reproducible down migration testing in CI.
2. **Integration test for outcome rows** — A test that fires a real HTTP request through the API route and verifies the `execution_outcome` row lands in the DB with correct `log_phase`. Requires running Postgres + `__tests__/integration/` infrastructure.
3. **Phase 3 kickoff** — All 5 gates PASS. Proceed to semantic memory design.
