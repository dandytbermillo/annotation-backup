# Slice 3a: Replay-Hit Accounting — Runtime Proof

**Date**: 2026-03-11
**Status**: CLOSED — runtime-proven

## Summary

Stage 5 Slice 3a implements transactional replay-hit accounting: when a semantic replay writes to a different row than the matched winner, the winner's `success_count` is incremented in the same transaction. This report documents the runtime proof of that code path.

## What Slice 3a Does

- `app/api/chat/routing-memory/route.ts` — `WINNER_INCREMENT_SQL`
- When `replay_source_row_id` is present in the memory write payload:
  1. UPSERT runs inside a transaction
  2. If `writtenRowId !== replaySourceRowId` → increment winner's `success_count`
  3. COMMIT covers both the UPSERT and the increment atomically
- `success_count` semantics: "row strength as a semantic source" (direct + replay), not just "exact row executions"

## Why Natural Validation Was Blocked

Natural runtime validation was structurally blocked:

1. **Budget100 family** (many high-similarity pairs above 0.92): all `risk_tier = medium` (Tier 4 LLM resolution) — Stage 5 Gate 2 rejects medium risk
2. **Budget (non-100) family** (low risk, includes "find budget" / "get budget" at 0.924): context fingerprint `ad30e60d...` doesn't match current context `bbecb3fdf935...` — Stage 5 Gate 0 rejects
3. **Risk-tier rule** (`lib/chat/routing-log/mapping.ts:107-112`): `deriveRiskTier` assigns `medium` to Tier 4/5 (LLM-assisted), `low` to Tier 0-3 (deterministic). Stage 5 only replays `low` risk.

No natural combination of (low risk + current context + 0.92+ similarity pair) existed.

## Controlled Fixture Design

Seeded one winner row into `chat_routing_memory_index`:

| Field | Value |
|---|---|
| `normalized_query_text` | `find budget` |
| `context_fingerprint` | `bbecb3fdf935...` (current) |
| `risk_tier` | `low` |
| `success_count` | `5` (baseline) |
| `action_type` | `execute_widget_item` |
| `target_ids` | `["w_links_b", "98cec0f2-b869-412e-93a8-9162e00b9074"]` |
| `scope_source` | `slice3a_fixture` |

Cloned from existing `find budget` row (ad30e60d context), changing only context fingerprint, scope_source, and success_count.

**Replaying phrase**: `get budget` (typed in app)
**Confirmed similarity**: 0.924 (above 0.92 floor)

### Preflight Checks (all passed)

1. No current-context "get budget" row existed
2. No current-context "find budget" row existed (seeded only the winner)
3. No other low-risk current-ctx row within 0.90 of "get budget" (seeded row would be the only S5 survivor)

### B2 Simulation (pre-verified)

| Row | Similarity | Risk | Context | S5 Outcome |
|---|---|---|---|---|
| get budget (`ad30e60d`) | 1.000 | low | MISS | Gate 0 reject |
| find budget (`ad30e60d`) | 0.924 | low | MISS | Gate 0 reject |
| find budget (seeded, `bbecb3fdf935`) | 0.924 | low | MATCH | **Survivor** |

Exactly 1 survivor → `shadow_replay_eligible`.

## Runtime Results

**User typed**: `get budget` at 13:26
**App response**: "Opening entry 'budget200 B'" with badge **Memory-Semantic**

### Verification 1: New Row Created

```
id: aa195d3d-cb2a-4e85-acbf-5ceebefc82b0
normalized_query_text: get budget
context_fingerprint: bbecb3fdf935...
success_count: 1
intent_id: memory_semantic:grounding_llm_widget_item_execute
created_at: 2026-03-11T19:26:23.405Z
```

**PASS** — new row written to memory index.

### Verification 2: Winner Row Incremented

```
id: 243cc66a-9b91-467c-8651-38e876c728d8
normalized_query_text: find budget
success_count: 6 (was 5)
last_success_at: 2026-03-11T19:26:23.405Z
```

**PASS** — winner incremented by exactly 1.

### Verification 3: Durable Log Telemetry

```
provenance: memory_semantic:grounding_llm_widget_item_execute
result_status: executed
log_phase: routing_attempt
s5_validation_result: replay_executed
s5_replayed_target_id: 98cec0f2-b869-412e-93a8-9162e00b9074
s5_top_similarity: 0.9999992618839185
s5_candidate_count: 3
s5_fallback_reason: undefined
```

**PASS** — Stage 5 replay executed with correct target.

Note: `s5_top_similarity` reports 1.0 because B2 returns the existing exact-match "get budget" row (ad30e60d context) as the highest-similarity candidate. That row is rejected at Gate 0; the surviving candidate ("find budget") was at 0.924.

## What Is Proven

- A different-text Stage 5 semantic replay happened
- The new/current row was written (different row from the winner)
- The winner row's `success_count` was atomically incremented in the same transaction
- The transactional UPSERT + conditional increment code path (`route.ts:123-149`) executed correctly

## What Is Not Directly Observable

- `winner_incremented` / `winner_increment_skipped_reason` from the server response — the client (`memory-writer.ts`) uses fire-and-forget and does not persist the response body
- This is observability polish, not a correctness concern — the DB state change is stronger evidence

## Files

- Implementation: `app/api/chat/routing-memory/route.ts` (lines 49-67: `WINNER_INCREMENT_SQL`, lines 116-153: transactional path)
- Dispatcher wiring: `lib/chat/routing-dispatcher.ts` (lines 1483-1493: `replay_source_row_id` attachment)
- Stage 5 evaluator: `lib/chat/routing-log/stage5-evaluator.ts`
- Risk-tier mapping: `lib/chat/routing-log/mapping.ts:107-112`
- Unit tests: `__tests__/unit/chat/routing-memory-replay-hit.test.ts`
