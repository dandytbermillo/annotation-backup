# Multi-Layer Routing Reliability Plan v3.5 — Completion Report

**Date**: 2026-03-12
**Plan**: `multi-layer-routing-reliability-plan-v3_5.md`
**Status**: CLOSED. All 6 rollout stages complete. Core acceptance criteria met.

---

## 1) Rollout Stages — All Complete

| Stage | Name | Status | Key deliverable |
|-------|------|--------|-----------------|
| 1 | Observe-only | CLOSED | Durable log pipeline (`chat_routing_durable_log`), routing-log API route, normalization/hashing/redaction |
| 2 | Exact-memory assist | CLOSED | B1 exact memory lookup by `(tenant, query_fingerprint, compatible context)`, stable key profile (§5.2.1) |
| 3 | Semantic assist | CLOSED | B2 semantic retrieval (Phase 3a shadow → 3b hint injection → 3c clarifier assist with reorder) |
| 4 | Bounded LLM optimize | CLOSED | Stage 4 grounding LLM fallback, G1-G7 validator gates, TOCTOU revalidation |
| 5 | Resolution memory reuse | CLOSED | Stage 5 semantic resolution reuse, replay-hit accounting (Slice 3a), enforcement |
| 6 | Verified semantic reuse | CLOSED | Stage 6 agent tool loop — contracts, inspect tools, shadow/enforcement, evidence gate, tuning |

Feature flags and kill switches maintained throughout per §12 requirement.

---

## 2) Architecture Delivered vs Planned

### Lanes implemented

| Lane | Plan | Implemented | Notes |
|------|------|-------------|-------|
| A — Deterministic Fast Lane | Strict exact label/id, whole-input ordinal | Yes | `isStrictExactMatch` gate, known-noun routing, Tier 0-3 |
| B1 — Exact Memory | Query fingerprint + compatible context | Yes | `chat_routing_memory_index`, stable key profile excluding volatile fields |
| B2 — Semantic Memory | Semantic retrieval with scope/risk filtering | Yes | Cosine similarity, Phase 3a-3c, clarifier assist |
| C — Validation Gate | Target exists, scope, permissions, schema, ambiguity | Yes | Commit-time revalidation (TOCTOU), G4/G5 gates |
| D — Bounded LLM | LLM sees validated candidates only, `select`/`need_more_info` | Yes | `grounding-llm-fallback.ts`, Gemini via API route |
| E — Safe Clarifier | Scoped clarifier with clickable options | Yes | Option-based clarifiers, ordinal binding, off-menu handling |

### Additional capabilities beyond original plan

| Capability | Source |
|------------|--------|
| Stage 6 agent tool loop (multi-turn inspect → act) | Stage 6 design note |
| Evidence gate for badge-sibling disambiguation | Slice 6.7.3 |
| Structured JSON output enforcement (Gemini schema) | Slice 6.7.2 |
| Selection intent arbitration (focus latch model) | `SELECTION_INTENT_ARBITRATION_V1` |
| Scope-cue system ("in chat", "from chat") | `input-classifiers.ts` |
| Selection continuity lane | Semantic answer lane |

---

## 3) What Remains Shadow-Only or Deferred

### Shadow-only (logging, no behavioral impact)

| Item | Status | Flag |
|------|--------|------|
| G1 shadow confidence threshold (0.75) | Logging would-be rejections at 0.4→0.75 | Hardcoded in `grounding-llm-fallback.ts` |
| Stage 6 shadow loop | Fire-and-forget telemetry on Stage 4 abstain/timeout | `NEXT_PUBLIC_STAGE6_SHADOW_ENABLED` |
| B2 semantic hint injection | Shadow reads + logs, no LLM influence | `CHAT_ROUTING_SEMANTIC_HINT_INJECTION_ENABLED=false` |

### Deferred (designed but not implemented)

| Item | Reason | Reference |
|------|--------|-----------|
| Stage 6 `open_widget_item` enforcement | Contracted, validators exist, not wired to enforcement bridge | Phase 2 |
| Stage 6 `navigate_entry` enforcement | Same as above | Phase 2 |
| `stage4_low_confidence` → S6 escalation | Depends on G1 enforcement decision | Design note §3b |
| Session embedding cache (§5.4) | Performance optimization, not needed at current scale | §5.4 |
| Multi-intent decomposition (§9) | Full plan/step execution model designed but not built | §6.1, §9 |
| Lane D no-model shortcut | Optional optimization mode per §8 | §8 |
| Per-tenant threshold overrides | Designed with safety bands, not implemented | §7.1 |
| Semantic retrieval topK tuning | Default 15, not calibrated from production data | §8 |
| Embedding model calibration | Thresholds are model-dependent, no labeled set built | §7.1 |
| Body-text search in Stage 6 | `inspect_search` searches names/labels only | Stage 6 design |

### Not applicable (Option B only)

| Item | Reason |
|------|--------|
| Cross-user retrieval | §5.2 — disabled by default, Option B feature |
| Real-time awareness | Option B only per CLAUDE.md |

---

## 4) Feature Flags Still Active

### Production flags (behavioral)

| Flag | Value | Purpose | Removal candidate? |
|------|-------|---------|-------------------|
| `NEXT_PUBLIC_GROUNDING_LLM_FALLBACK` | `true` | Stage 4 bounded LLM | No — core feature |
| `NEXT_PUBLIC_STAGE6_SHADOW_ENABLED` | `true` | S6 shadow telemetry | Remove when S6 enforcement is default |
| `NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED` | `true` | S6 enforcement (open_panel) | Remove when stable |
| `NEXT_PUBLIC_STAGE5_RESOLUTION_REUSE_ENABLED` | `true` | Stage 5 replay | Remove when stable |
| `CHAT_ROUTING_MEMORY_WRITE_ENABLED` | `true` | B1 memory writes | No — core feature |
| `CHAT_ROUTING_MEMORY_READ_ENABLED` | `true` | B1 memory reads | No — core feature |
| `CHAT_ROUTING_MEMORY_SEMANTIC_READ_ENABLED` | `true` | B2 semantic reads | Remove when stable |
| `CHAT_ROUTING_SEMANTIC_HINT_INJECTION_ENABLED` | `false` | B2 hint injection (shadow) | Enable when shadow data supports it |
| `NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_REORDER_ACTIVE` | `true` | Phase 3c clarifier reorder | Remove when stable |
| `CHAT_ROUTING_MEMORY_KILL` | `false` | Emergency kill switch | Keep indefinitely |

### Debug/observe flags (non-behavioral)

| Flag | Value | Purpose |
|------|-------|---------|
| `NEXT_PUBLIC_CHAT_ROUTING_OBSERVE_ONLY` | `true` | Durable log writes |
| `NEXT_PUBLIC_CHAT_ROUTING_MEMORY_WRITE` | `true` | Client-side memory write signals |
| `NEXT_PUBLIC_CHAT_ROUTING_MEMORY_READ` | `true` | Client-side memory read signals |
| `NEXT_PUBLIC_CHAT_PROVENANCE_DEBUG` | `true` | Provenance badge display |

---

## 5) §13 Testing Plan Assessment

### Coverage summary

| Section | Item | Tests | Status |
|---------|------|-------|--------|
| **13.1 Safety** | | | |
| | Non-exact never deterministic execute | 106 | Fully covered (unit + integration) |
| | Semantic hit without validator pass never executes | 77 | Fully covered |
| | Stale context fingerprint blocks replay | 68 | Fully covered |
| | Commit-time drift / TOCTOU | 29 | Fully covered |
| | Near-tie guard | 10 | Partial — basic margin cases; missing edge cases (3-way ties, FP precision) |
| | Lane D no-model shortcut | 0 | Not implemented, not tested (deferred per §3 above) |
| **13.2 Reliability** | | | |
| | Repeated phrasing variants → same target | 33 | Covered (semantic reuse + dedup) |
| | Exact same command across turns (stable key) | 20 | Covered (selection continuity) |
| | Panel switch then unscoped query | 90 | Fully covered (intent arbitration) |
| | Clarifier-reply ordinal extraction | 98 | Fully covered (23 normalization + 75 off-menu) |
| **13.3 Contract** | | | |
| | LLM invalid choiceId → safe clarifier | 36 | Covered |
| | Low confidence → safe clarifier | 30 | Fully covered (confidence tier breakdown) |
| | High-risk intents require confirmation | 28 | Partial — risk tier validated; confirmation flow not tested |
| **13.4 Regression** | | | |
| | Strict exact command behavior | 38 | Fully covered (regression suite) |
| | Provenance labels preserved | 15 | Partial — badge rendering tested; not all provenance states |
| **13.5 Multi-intent** | | | |
| | Long query decomposition | 139 | Covered via arbitration + Stage 6 tool loop tests |
| | Context drift blocks stale replay | — | Covered under §13.1.3 |
| | Safe subset execution | — | Partial — Stage 6 multi-round tested; full plan/step model deferred |
| **Total** | | **620+** | **~90% of testable items covered** |

### Items not testable (deferred features)

- Lane D no-model shortcut: deferred, not implemented
- High-risk confirmation flow: no high-risk action types wired yet
- Full multi-intent plan/step execution: designed but not built (§9)

---

## 6) §14 Observability Assessment

### Per-turn log fields

| Required field | Status | Notes |
|----------------|--------|-------|
| Lane entered/exited | Implemented | `routing_lane` in durable log |
| Candidate counts by lane | Partial | B2 (`b2_raw_count`, `b2_validated_count`) and D (`llm_candidate_count`) logged; A and C counts missing |
| Validator pass/fail reasons | Partial | `commit_revalidation_result` + `reason_code` implemented; per-lane validator rejection reasons not logged |
| Chosen path provenance | Implemented | `decision_source` + `provenance` fields |
| Drift reason codes | Not implemented | Context fingerprint mismatch detection exists in logic but not logged as a distinct code |
| Idempotency key, dedupe hit/miss | Partial | `idempotency_key` field exists; dedupe hit/miss indicator not tracked |
| Commit-time revalidation result | Implemented | `commit_revalidation_result` ('passed'/'rejected') + reason code |
| Effective config/model versions | Stub only | Fields exist but all set to `'none'` placeholder constants |
| `candidate_ids_considered` | Not populated | Defined in schema, hardcoded to `[]` in API route |

### Dashboard queries

| Required dashboard | Status | Notes |
|--------------------|--------|-------|
| Deterministic success rate | Implemented | `monitor-routing-soak.sql` §1, §3 |
| Memory hit rate (exact vs semantic) | Implemented | `monitor-routing-soak.sql` §2, §2b |
| Validator rejection rate | Implemented | `monitor-routing-soak.sql` §5 (commit revalidation) |
| LLM need_more_info rate | Not implemented | Payload field `llm_decision` exists; no SQL query |
| Clarifier loop rate | Not implemented | No SQL query |
| Duplicate execution suppression rate | Not implemented | No hit/miss tracking in log |
| TOCTOU failure rate by intent class | Not implemented | Payload field `llm_g5_toctou_result` exists; no SQL query |
| Clickable-clarifier adoption rate | Not implemented | No way to distinguish clickable vs free-text in current schema |
| Free-text clarifier fallback rate | Not implemented | Same gap as above |

### Assessment

Per-turn logging is **~70% complete** — core fields (lane, source, provenance, status) are solid. Stage 4 and 5 telemetry is well-instrumented. Gaps are in lane-specific candidate counts, drift codes, and `candidate_ids_considered`.

Dashboard SQL is **~30% complete** — 3 of 9 required dashboards have queries. The remaining 6 have payload fields defined but no monitoring SQL written.

---

## 7) §17 Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Strict policy remains true (`not exact => never deterministic execute`) | Met | 106 safety tests + `isStrictExactMatch` gate enforced at all deterministic paths |
| Deterministic fast lane is small, exact, and non-fuzzy | Met | Lane A: strict exact label/id only. No fuzzy, no partial, no canonicalization-based execution |
| Memory retrieval is primary matching layer for non-exacts | Met | B1 exact memory + B2 semantic retrieval as primary candidate sources for non-deterministic paths |
| Every execution passes validator gate | Met | Lane C validation mandatory. Commit-time TOCTOU revalidation. G4/G5 gates for LLM path |
| Bounded LLM runs only on validated scoped candidates | Met | Lane D receives only validator-approved candidates. G2/G3 cap+trim. G4 dedup |
| Unresolved always returns safe clarifier | Met | Lane E fallback on all failure/low-confidence/ambiguity paths |
| Regression suite covers stale-latch, clarifier-reply, and context drift | Met | 620+ tests covering all three scenario classes |

All 7 acceptance criteria are met.

---

## 8) Risk Assessment

### Risks mitigated

| Risk (from §16) | Mitigation status |
|-----------------|-------------------|
| Stale memory replay executes wrong target | Mitigated — validator gate + context fingerprint + scope isolation + TOCTOU |
| Semantic retrieval over-trust | Mitigated — B2 is candidate-only, never direct execution |
| Latency regression | Mitigated — deterministic fast lane retained, exact cache for B1 |
| Hidden behavior drift | Mitigated — provenance logging on every execution path |

### Residual risks

| Risk | Severity | Notes |
|------|----------|-------|
| Shadow-only items not exercised in production | Low | G1 shadow, B2 hint injection still shadow-only. Need production data before enabling |
| Model version change breaks thresholds | Medium | Embedding thresholds not calibrated per model. Config versions stubbed as 'none' |
| Missing dashboard coverage | Low | 6 of 9 dashboards lack SQL queries. Telemetry data exists; queries can be written on demand |
| `candidate_ids_considered` always empty | Low | Audit trail gap. Schema ready; population logic not wired |

---

## 9) Files Delivered (Summary)

### Core runtime modules

| Module | Path | Purpose |
|--------|------|---------|
| Routing dispatcher | `lib/chat/routing-dispatcher.ts` | Lane orchestration, tier system, S6 call sites |
| Chat routing | `lib/chat/chat-routing.ts` | Clarification intercept (Tiers 0, 1, 3) |
| Input classifiers | `lib/chat/input-classifiers.ts` | Shared parsers, scope cues, command detection |
| Known-noun routing | `lib/chat/known-noun-routing.ts` | Deterministic panel/widget matching |
| Grounding set | `lib/chat/grounding-set.ts` | Candidate building from visible state |
| Grounding LLM fallback | `lib/chat/grounding-llm-fallback.ts` | Stage 4 bounded LLM client |
| Grounding LLM API route | `app/api/chat/grounding-llm/route.ts` | Server-side LLM contract enforcement |
| Stage 6 contracts | `lib/chat/stage6-tool-contracts.ts` | Typed schemas, telemetry types |
| Stage 6 inspect handlers | `lib/chat/stage6-inspect-handlers.ts` | 5 read-only inspect tools |
| Stage 6 loop controller | `lib/chat/stage6-loop-controller.ts` | Client orchestrator (shadow + enforcement) |
| Stage 6 loop route | `app/api/chat/stage6-loop/route.ts` | Server-side Gemini multi-turn loop |
| Routing log payload | `lib/chat/routing-log/payload.ts` | Durable log payload definition |
| Routing log API route | `app/api/chat/routing-log/route.ts` | Server-side normalization + insertion |
| Routing log writer | `lib/chat/routing-log/writer.ts` | Client-side log submission |

### Test files

77 Stage 6 tests + 543+ tests across other stages = **620+ total tests**.

### Design and reports

All under `docs/proposal/chat-navigation/`:
- Plan: `plan/panels/chat/meta/multi_layer/multi-layer-routing-reliability-plan-v3_5.md`
- Stage ordering: `plan/panels/chat/meta/multi_layer/stage-ordering-rationale.md`
- Stage 6 design: `plan/panels/chat/meta/multi_layer/stage6-agent-tool-loop-design.md`
- 15+ implementation reports under `reports/`
- Monitoring SQL: `test_scripts/monitor-routing-soak.sql`

---

## 10) Recommendation

The v3.5 plan has achieved its stated goal: replace brittle rule-heavy matching with a retrieval-first, validator-gated, bounded-LLM architecture while preserving strict execution safety.

### Immediate actions

1. **Update plan status** from "Ready for Phase 1 (observe-only)" to "CLOSED (2026-03-12)"
2. **Schedule flag cleanup** for stable features (Stage 5 reuse, Phase 3c reorder, S6 enforcement)
3. **Write remaining dashboard SQL** for the 6 missing §14 queries (data already in durable log)

### Future work (new plan, not v3.5 continuation)

If a new routing plan is needed, define it independently. Candidates:
- Enable G1 enforcement (raise confidence threshold from 0.4 to 0.75)
- Enable B2 hint injection (shadow → active)
- Stage 6 Phase 2: `open_widget_item` and `navigate_entry` enforcement
- Multi-intent decomposition (§9 — full plan/step execution)
- Embedding model calibration with labeled data
- `candidate_ids_considered` population for complete audit trail
