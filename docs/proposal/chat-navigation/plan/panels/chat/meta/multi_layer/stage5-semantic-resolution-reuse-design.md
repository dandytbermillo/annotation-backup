# Stage 5: Semantic Resolution Reuse — Design Note

**Date**: 2026-03-10
**Parent plan**: `multi-layer-routing-reliability-plan-v3_5.md`
**Predecessor**: Stage 4 (Bounded Selector Hardening) — implementation complete, enforcement deferred 2026-03-10
**Ordering rationale**: `stage-ordering-rationale.md`
**Status**: Slice 1 (shadow mode) implemented and runtime-validated 2026-03-10. Slice 2 (enforcement) not started.

---

## 1) Goal

Upgrade B2 semantic memory from clarifier-assist (Phase 3c: reorder hints) to **validated resolution reuse**: when a semantically similar query was previously resolved successfully, replay that resolution without hitting the LLM — if and only if safety validation passes.

**Product behavior**: "open budget100" succeeded last session → "take me to budget100" resolves by semantic match without LLM call or clarifier.

---

## 2) What gets embedded

**User query text only.** Same as current B2.

Not embedded:
- Response text (generated output, not semantic intent)
- Raw state metadata (stays structured: context fingerprint, target IDs, widget IDs)
- Candidate labels (resolved outcome is structured, not prose)

Embedding model: `openai:text-embedding-3-small@v1` (1536 dimensions). No change from current.

---

## 3) What gets stored structurally

Each resolution entry (in `chat_routing_memory_index`) already stores:

| Field | Source | Purpose |
|-------|--------|---------|
| `normalized_query_text` | User input | Exact dedup + debug |
| `semantic_embedding` | Computed async | Similarity lookup |
| `intent_id` | Routing result | e.g., `execute_widget_item`, `execute_referent` |
| `intent_class` | Routing result | `action_intent` / `info_intent` |
| `slots_json` | Routing result | `{ action_type, widgetId, segmentId, itemId, itemLabel, action }` |
| `target_ids` | Routing result | Target entity IDs for validation |
| `context_fingerprint` | SHA-256 of snapshot | Context compatibility check |
| `risk_tier` | Routing result | Safety classification |
| `success_count` | Incremented on reuse | Reuse confidence signal |
| `last_success_at` | Timestamp | Recency for eviction |
| `schema_version`, `tool_version` | Constants | Compatibility versioning |
| `permission_signature` | Hardcoded `'default'` | Placeholder — not currently meaningful. Server write route inserts literal `'default'`. Not usable for validation until real permission data is stored. |

**New field needed for Stage 5**: None in `chat_routing_memory_index`. The existing schema is sufficient.

**`chat_routing_resolution_memory` (migration 069)**: Exists but has no write logic. Stage 5 first implementation slice uses `chat_routing_memory_index` directly (it already has `slots_json` + `target_ids`). The `resolution_memory` table with `condition_json` is available for future enrichment if structural validation conditions need to be stored separately.

---

## 4) Write contract (what gets written, when)

**No change to current write logic.** `recordMemoryEntry()` already writes to `chat_routing_memory_index` only on confirmed successful execution (`result.handled === true`, `result_status === 'executed'`, has `groundingAction`).

**Not written on:**
- Clarifier-only turns (`result_status === 'clarified'`)
- Failed turns (`result_status === 'failed'`)
- Blocked turns (`result_status === 'blocked'`)
- Non-grounding paths (question intent, workspace navigation, etc.)

This is already correct for Stage 5. No new write paths needed.

---

## 5) Replay eligibility

A B2 semantic match is eligible for replay only when ALL of the following hold:

1. **Similarity threshold**: `similarity_score >= S5_REPLAY_THRESHOLD` (proposed: 0.92, higher than Phase 3c reorder which has no threshold gate)
2. **Action type allowed**: `slots_json.action_type` is in the replay allowlist: `execute_widget_item`, `execute_referent`. Note: `intent_id` stores `result.tierLabel` (e.g., tier label string), not the action type. The action type lives in `slots_json.action_type` (see `memory-write-payload.ts:101`).
3. **Risk tier safe**: `risk_tier === 'low'` (no replay for medium/high risk actions)
4. **Not expired**: `ttl_expires_at IS NULL OR ttl_expires_at > now()`
5. **Schema compatible**: `schema_version` and `tool_version` match current constants

If any check fails, the match is ineligible and falls through to Stage 4.

---

## 6) Safety gates (validation at lookup time)

After a candidate passes replay eligibility, it must pass live validation before execution:

| Gate | Check | Fail action |
|------|-------|-------------|
| **Target exists** | `target_ids` entries exist in current grounding set or widget snapshot registry | Reject → fall through |
| **Target visible** | For `execute_widget_item`: target item ID in `buildTurnSnapshot().openWidgets` options. For `execute_referent`: referent target exists in grounding set. | Reject → fall through |
| **Context compatible** | Current `context_fingerprint` matches or is compatible with stored fingerprint | Reject → fall through |
| **Single match** | Exactly one candidate passes all gates. If multiple pass, treat as ambiguous. | Reject (`rejected_ambiguous`) → fall through to Stage 4 |

**What "context compatible" means**: The strict interpretation is exact fingerprint match. The relaxed interpretation allows replay when the context is a superset (e.g., more panels open than before, but the target panel is still there). First implementation slice uses **strict match only**. Relaxation is a future tuning decision after telemetry.

**What validation does NOT check**:
- Permission changes (`permission_signature` is hardcoded `'default'` — not meaningful until real permission data is stored)
- Cross-session staleness (deferred — `ttl_expires_at` handles time-based eviction)

---

## 7) Lookup contract (runtime flow)

```
User input arrives at dispatchRouting()
  │
  ├── B1 exact memory → (hit) → execute
  │                     (miss) ↓
  │
  ├── Stage 5: Semantic resolution reuse
  │   ├── lookupSemanticMemory(query, contextSnapshot)
  │   ├── Filter: similarity_score >= S5_REPLAY_THRESHOLD
  │   ├── Filter: replay eligibility (§5)
  │   ├── Validate: safety gates (§6)
  │   ├── (all pass, single match) → auto-execute (skip LLM)
  │   ├── (multiple pass) → fall through (ambiguous)
  │   └── (none pass) → fall through
  │                     ↓
  ├── Stage 4: Tier 4.5 bounded LLM selector → select or clarifier
  │
  └── Tier 5: Unbounded fallback
```

**Where in code**: Between B1 exact check and Tier 4.5 LLM entry in `dispatchRoutingInner()`. Currently B2 runs at `routing-dispatcher.ts:1301-1386` — Stage 5 adds a resolution-reuse decision point after B2 lookup returns, before the tier chain.

**Execution**: When Stage 5 decides to replay, it constructs a `RoutingDispatcherResult` with:
- `handled: true`
- `decision_source: 'memory_semantic'`
- `routing_lane: 'B2'`
- `result_status: 'executed'`
- The action from `slots_json` (same as the original execution)

**Memory write on replay**: Successful replay increments `success_count` and updates `last_success_at` on the matched memory entry. No new row created.

---

## 8) Fallback chain

```
B1 exact memory → Stage 5 semantic resolution reuse → Stage 4 bounded LLM → clarifier
```

Stage 5 never blocks. On any failure (no match, validation fail, multiple matches), control falls through silently to Stage 4. The LLM selector does not know Stage 5 was attempted.

---

## 9) Telemetry

New fields in `_llmTelemetry` / `semantic_hint_metadata`:

| Field | Type | When emitted |
|-------|------|-------------|
| `s5_lookup_attempted` | `boolean` | Always when B2 returns candidates |
| `s5_candidate_count` | `number` | Count of B2 candidates above replay threshold |
| `s5_top_similarity` | `number` | Highest similarity score |
| `s5_validation_result` | `'replay_executed' \| 'rejected_target_gone' \| 'rejected_target_not_visible' \| 'rejected_context_mismatch' \| 'rejected_risk_tier' \| 'rejected_action_type' \| 'rejected_expired' \| 'rejected_schema' \| 'rejected_ambiguous' \| 'no_eligible'` | Outcome of the validation pipeline |
| `s5_replayed_intent_id` | `string` | Only on `replay_executed` |
| `s5_replayed_target_id` | `string` | Only on `replay_executed` |
| `s5_fallback_reason` | `string` | Why Stage 5 fell through to Stage 4 |

**Durable log routing_lane**: `B2` for replayed resolutions. Existing `decision_source: 'memory_semantic'` distinguishes from Phase 3c reorder.

---

## 10) What Stage 5 does NOT do

- **No new embedding model** — uses same text-embedding-3-small
- **No new write paths** — `recordMemoryEntry()` already writes the right data
- **No new tables** — uses existing `chat_routing_memory_index`
- **No agentic behavior** — no tool calls, no multi-turn loops, no independent context inspection
- **No weak auto-exec** — every replay must pass eligibility + live validation
- **No permission checks** — `permission_signature` is hardcoded `'default'`, not meaningful yet
- **No cross-user memory** — tenant/user isolation maintained
- **No visible_panels replay** — current write logic only stores `execute_widget_item` and `execute_referent` actions. Panel-level replay would require new write coverage.

---

## 11) Relationship to Phase 3c (clarifier assist)

Phase 3c and Stage 5 are **parallel consumers** of the same B2 lookup:

| Aspect | Phase 3c | Stage 5 |
|--------|----------|---------|
| Decision point | Clarifier option ordering | Pre-LLM resolution bypass |
| Similarity threshold | None (any match reorders) | High (`>= 0.92`) |
| Outcome | Reorder existing options | Auto-execute or fall through |
| Safety | No execution authority | Full validation pipeline |
| Priority | Runs only when clarifier fires | Runs before LLM/clarifier |

Both consume `lookupSemanticMemory()` output. Stage 5 checks first (higher bar). If Stage 5 doesn't replay, the B2 candidates are still available for Phase 3c reorder if a clarifier fires downstream.

---

## 12) Implementation slices (proposed)

### Slice 1: Shadow mode (log-only) — **Implemented 2026-03-10**

- Stage 5 decision point added after B2 lookup, before tier chain (`routing-dispatcher.ts`)
- Pure evaluator: `evaluateStage5Replay()` in `stage5-evaluator.ts`
- Pipeline: action type allowlist → risk tier (low only) → target validation (reuses `validateMemoryCandidate`)
- `_s5Telemetry` attached separately from `_llmTelemetry` (pre-LLM stage)
- `s5_*` fields persisted into `semantic_hint_metadata` JSONB via `route.ts`
- No behavior change — always falls through to Stage 4
- No threshold duplication — B2 SQL pre-thresholds at >= 0.92, Stage 5 trusts B2 output
- Unit tests: 16/16 passing (`stage5-shadow-telemetry.test.ts`)
- **Runtime proof** (routing_attempt row, shadow scope only):
  - "review budget": `s5_lookup_attempted=true`, `s5_validation_result=shadow_replay_eligible`, `s5_replayed_target_id=98cec0f2-...` (a validated B2 candidate for budget200)
  - B2 timeout queries: no `s5_*` fields (correct — Stage 5 only runs when B2 returns validated candidates)
  - B1 hit queries: no `s5_*` fields (correct — B1 resolves before B2)
- **Proof scope**: routing_attempt row only. No replay execution path tested (shadow mode).

### Slice 2: Enforcement (gated)
- On validated replay, actually execute and return `handled: true`
- Behind feature flag: `NEXT_PUBLIC_STAGE5_RESOLUTION_REUSE_ENABLED`
- Promotion criteria:
  - Shadow data shows > X% replay candidates would have been correct
  - Zero false-positive replays on incorrect targets
  - Latency reduction measurable

### Slice 3: Tuning
- Adjust `S5_REPLAY_THRESHOLD` based on similarity score distribution
- Relax context fingerprint matching if strict match is too narrow
- Add `permission_signature` validation if needed

---

## 13) Eval requirements

Per `stage-ordering-rationale.md`:
- **Semantic recall precision**: Of replayed resolutions, what % were correct?
- **Staleness validation accuracy**: Of rejected replays, what % were correctly rejected?
- **Replay success rate**: Of eligible candidates, what % passed all gates?
- **False-positive replay rate**: Must be 0% before enforcement (wrong target executed)
- **Unnecessary clarifier reduction**: How many clarifiers were avoided by replay?

---

## 14) Current data baseline

**Initial baseline** (2026-03-10, pre-Slice 1):
- Tier 4.5 rows with `llm_decision`: 39
- B2 status `no_candidates`: 34, `discarded_handled`: 5, `timeout_or_error`: 1
- `max(b2_validated_count)` on Tier 4.5 rows: 1
- Rows with `b2_validated_count >= 2`: 0

**Post-Slice 1 baseline** (2026-03-10, after runtime validation):
- B2 status distribution (all rows): `no_candidates`: 282, `discarded_handled`: 205, `timeout_or_error`: 67, `candidates_found`: 3
- B2 `validated_count` distribution (on B2-hit rows): 0: 3, 1: 135, 2: 70
- Stage 5 shadow rows: 1 (`shadow_replay_eligible` on "review budget")
- Memory index entries with `risk_tier = 'low'`: limited (most entries are `medium`)

**Implication**: B2 coverage is now substantial (205 `discarded_handled` rows). Stage 5 replay coverage is gated primarily by `risk_tier = 'low'` requirement — most memory entries are `medium` risk. Coverage grows as low-risk executions are recorded.

---

## 15) Files map

| Component | File | Status |
|-----------|------|--------|
| B2 semantic lookup (client) | `lib/chat/routing-log/memory-semantic-reader.ts` | Exists |
| Memory write (client) | `lib/chat/routing-log/memory-write-payload.ts` | Exists |
| Memory index table | `migrations/068_chat_routing_memory_index.up.sql` | Exists |
| Resolution memory table | `migrations/069_chat_routing_resolution_memory.up.sql` | Schema only |
| Embedding service | `lib/chat/routing-log/embedding-service.ts` | Exists |
| Clarifier reorder | `lib/chat/routing-log/clarifier-reorder.ts` | Exists |
| Context snapshot | `lib/chat/routing-log/context-snapshot.ts` | Exists |
| Stage 5 evaluator (pure function) | `lib/chat/routing-log/stage5-evaluator.ts` | **Slice 1 complete** |
| Stage 5 dispatcher wiring | `lib/chat/routing-dispatcher.ts` (lines ~1376, ~1410, ~1499) | **Slice 1 complete** |
| Stage 5 telemetry fields | `lib/chat/routing-log/payload.ts` | **Slice 1 complete** |
| Stage 5 persistence | `app/api/chat/routing-log/route.ts` | **Slice 1 complete** |
| Stage 5 unit tests | `__tests__/unit/chat/stage5-shadow-telemetry.test.ts` | **16/16 passing** |
