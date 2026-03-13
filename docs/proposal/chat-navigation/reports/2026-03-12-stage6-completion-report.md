# Stage 6: Agent Tool Loop — Completion Report

**Date**: 2026-03-12
**Design note**: `stage6-agent-tool-loop-design.md`
**Predecessor**: Stage 5 (Semantic Resolution Reuse) — closed 2026-03-11
**Status**: CLOSED. All slices (6.1–6.7) complete. Phase 1 (`open_panel`) runtime-proven.

---

## 1) What Was Built

A structured agent/tool loop that replaces single-shot LLM routing for ambiguous queries. When Stage 4 (bounded LLM selector) abstains or times out, Stage 6 gives the model multi-turn access to inspect app state, then act, clarify, or abort — all through typed tool contracts with app-authoritative execution.

**Product behavior**: User says "open the budget report I was looking at yesterday" → model inspects recent items, finds the match, executes — no clarifier needed.

### Architecture

```
User query → Tier 0-3 (deterministic) → Stage 5 (replay) → Stage 4 (bounded LLM)
                                                                    ↓ abstain/timeout
                                                              Stage 6 (agent loop)
                                                                    ↓
                                                         inspect → decide → act
```

- **Server**: `app/api/chat/stage6-loop/route.ts` — Gemini multi-turn loop with structured JSON output
- **Client controller**: `lib/chat/stage6-loop-controller.ts` — snapshot pre-computation, fetch orchestration, durable telemetry
- **Inspect handlers**: `lib/chat/stage6-inspect-handlers.ts` — 5 read-only tools
- **Contracts**: `lib/chat/stage6-tool-contracts.ts` — typed schemas, validation limits, telemetry types
- **Dispatcher integration**: `lib/chat/routing-dispatcher.ts` — two call sites (`stage4_abstain`, `stage4_timeout`)

### Escalation Triggers

| Trigger | When S6 fires |
|---------|---------------|
| `stage4_abstain` | Bounded LLM returns `need_more_info` |
| `stage4_timeout` | Bounded LLM call exceeds timeout |
| `stage4_low_confidence` | Reserved for future G1 enforcement (not wired) |

---

## 2) Slice Status

| Slice | Scope | Status |
|-------|-------|--------|
| 6.1 | Tool contracts (TypeScript schemas) | LOCKED |
| 6.2 | Inspect handlers (5 read-only tools) | CLOSED |
| 6.3 | Shadow loop wiring (fire-and-forget + durable telemetry) | CLOSED |
| 6.4 | Action validators (3 action types, rejection path proven) | CLOSED |
| 6.5 Phase 1 | Enforcement mode (`open_panel` only) | CLOSED, runtime-proven |
| 6.6 | Monitoring SQL (7 queries, validated on 6 shadow rows) | CLOSED |
| 6.7 | Tuning (prompt, structured output, evidence gate, efficiency) | CLOSED |

---

## 3) What Is Production-Ready

### Inspect Tools (all 5)

| Tool | Implementation | Data source |
|------|---------------|-------------|
| `inspect_dashboard` | Client-side snapshot | Widget registry |
| `inspect_active_widget` | Client-side snapshot | Widget registry |
| `inspect_visible_items` | Client-side snapshot | Widget registry (viewport-filtered) |
| `inspect_recent_items` | Server-side | `/api/panels/recent/list` |
| `inspect_search` | Server-side | `/api/items` (name/label index, 80-char snippet cap) |

### Action Types

| Action | Validator | Enforcement | Runtime-proven |
|--------|-----------|-------------|----------------|
| `open_panel` | `validateOpenPanel` (slug in dashboard) | Yes (Phase 1) | Yes — fixture test |
| `open_widget_item` | `validateOpenWidgetItem` (widget + item exist) | Contracted, not wired | No |
| `navigate_entry` | `validateNavigateEntry` (entry exists + ownership) | Contracted, not wired | No |

### Safety Mechanisms

- **TOCTOU revalidation**: Fresh `inspect_dashboard` at commit point before executing enforced actions
- **Evidence gate** (`open_panel` only): Badge-sibling detection — if multiple panels share a base name (e.g., "Links Panel A/B/C"), model's `open_panel` is downgraded to clarification
- **Structured output**: `responseMimeType: 'application/json'` + typed schema on Gemini. Single structural retry on parse failure; double failure → immediate abort
- **Dedup guard**: `isDuplicateAction()` prevents re-execution of same action within a dispatch cycle
- **Reversibility**: Read + navigate only. No content mutation, no delete
- **Loop bounds**: Max 3 inspect rounds (ceiling 5), 5s timeout (ceiling 10s)

### Gemini Configuration

- Model: `gemini-2.0-flash`
- Temperature: 0.1
- Max output: 500 tokens
- 8-rule system prompt (ID accuracy, act/clarify/abort thresholds, badge-variant awareness)

---

## 4) What Remains Shadow-Only

### Shadow mode (default)

When `NEXT_PUBLIC_STAGE6_SHADOW_ENABLED=true` (current default):
- S6 loop fires on Stage 4 abstain/timeout
- Result is logged to durable telemetry but **not executed**
- Fire-and-forget — does not block the user's interaction
- Provenance: `s6_shadow:<outcome>`

### Enforcement mode (opt-in)

When `NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED=true`:
- S6 loop is **awaitable** — dispatcher waits for result
- If outcome is `action_executed` + `open_panel` → panel drawer opens in UI
- Falls back to normal clarifier on any other outcome
- Provenance: `s6_enforced:<action_type>` or `s6_enforced:fallback`

### Phase 1 scope limitation

Enforcement currently handles `open_panel` only. The other two action types (`open_widget_item`, `navigate_entry`) have validators and contracts but are not wired into the enforcement bridge. They will execute in shadow mode (logged, not acted on).

---

## 5) Durable Telemetry

All S6 loop results are written to `chat_routing_durable_log` via the existing routing-log pipeline.

### Telemetry Fields (in `semantic_hint_metadata` JSONB)

| Field | Type | Description |
|-------|------|-------------|
| `s6_loop_entered` | boolean | Always `true` for S6 rows |
| `s6_escalation_reason` | string | `stage4_abstain` / `stage4_timeout` |
| `s6_inspect_rounds` | number | How many inspect rounds used |
| `s6_outcome` | string | `action_executed` / `action_rejected` / `clarification_accepted` / `abort` / `timeout` / `max_rounds_exhausted` |
| `s6_duration_ms` | number | Total loop wall-clock time |
| `s6_tool_trace` | string[] | Tools called in order |
| `s6_action_type` | string | `open_panel` / `open_widget_item` / `navigate_entry` |
| `s6_action_target_id` | string | Target panel slug or item ID |
| `s6_action_status` | string | `executed` / `rejected` |
| `s6_action_rejection_reason` | string | e.g., `panel_not_registered`, `toctou_stale` |
| `s6_clarify_candidate_count` | number | Candidates in clarification request |
| `s6_abort_reason` | string | Model's stated abort reason |
| `s6_evidence_gate` | string | `allowed` / `ambiguous_siblings` |
| `s6_evidence_sibling_count` | number | Badge-sibling count when ambiguous |

### Correlation

- Shadow rows: `interaction_id = <original>:s6`, `log_phase = 'execution_outcome'`
- Enforcement rows: same suffix and phase
- Join on `interaction_id` prefix to correlate with the original routing attempt

---

## 6) Metrics to Watch

### Health indicators

| Metric | Query | Healthy signal |
|--------|-------|----------------|
| S6 fire rate | `WHERE s6_loop_entered = true` / total routing rows | Low (< 5%) — most queries resolve at Tiers 0-4 |
| Action success rate | `s6_outcome = 'action_executed'` / S6 rows | Rising over time as prompt/evidence gate improve |
| Abort rate | `s6_outcome = 'abort'` / S6 rows | Declining — aborts indicate model confusion |
| Evidence gate downgrades | `s6_evidence_gate = 'ambiguous_siblings'` / `open_panel` actions | Low — prompt hardening should prevent most |
| Latency P50/P95 | `s6_duration_ms` distribution | P50 < 2s, P95 < 5s |
| Inspect round distribution | `s6_inspect_rounds` histogram | Mostly 1 round for panel requests |

### Warning signals

- **Abort rate > 30%**: Model is confused — review prompt rules or escalation triggers
- **P95 latency > 8s**: Loop is churning — investigate tool trace patterns
- **Evidence gate firing frequently**: Prompt Rule 6 may be regressing — check model version changes
- **Structural retries increasing**: Gemini schema enforcement may be drifting — check `invalid_*` in tool trace

### Monitoring SQL

7 validated queries in `stage6-agent-tool-loop-design.md` §6.6, covering:
1. Shadow-loop summary (outcome distribution)
2. Escalation reason breakdown
3. Tool trace analysis (most common paths)
4. Action type distribution
5. Latency percentiles
6. Evidence gate stats
7. Failure analysis (rejections + aborts)

---

## 7) Test Coverage

| Test file | Tests | Scope |
|-----------|-------|-------|
| `stage6-loop-route.test.ts` | 38 | Server route: feature flags, input validation, multi-turn loop, action validation, structural retry, evidence gate |
| `stage6-loop-controller.test.ts` | 22 | Client controller: guards, fire-and-forget, durable telemetry, enforcement mode, error handling |
| `stage6-inspect-handlers.test.ts` | 17 | Inspect tools: all 5 tools, fail-open, viewport filtering, scoring, parameter clamping |
| **Total** | **77** | |

Type-check: clean (pre-existing unrelated test syntax error only).

---

## 8) Runtime Validation

### Shadow mode (6 production rows)

Validated via monitoring SQL on 6 durable log rows from shadow mode. All `s6_*` fields populated. Outcomes observed: `action_executed`, `clarification_accepted`, `abort`.

### Enforcement mode (fixture test, 2026-03-12)

- **Setup**: `STAGE4_FORCE_ABSTAIN` flag + SQL fixture (single-match dashboard with Links Panel B as only links panel)
- **Result**: `action_executed` + `open_panel(w_links_b)` in 1 inspect round, 1.26s
- **Durable log**: Confirmed `routing_lane=D`, `decision_source=llm`, `result_status=executed`, `s6_outcome=action_executed`, `s6_action_type=open_panel`
- **UI**: Panel drawer opened successfully
- **Fixture removed**: Flag deleted from `.env.local`, fixture code removed from `grounding-llm-fallback.ts`. SQL script retained at `test_scripts/s6-enforcement-fixture.sql`.

---

## 9) Files Delivered

### Runtime code

| File | Slice | Purpose |
|------|-------|---------|
| `lib/chat/stage6-tool-contracts.ts` | 6.1 | Typed schemas, validation limits, telemetry types |
| `lib/chat/stage6-inspect-handlers.ts` | 6.2 | 5 read-only inspect tool implementations |
| `lib/chat/stage6-loop-controller.ts` | 6.3, 6.5 | Client orchestrator (shadow + enforcement) |
| `app/api/chat/stage6-loop/route.ts` | 6.3, 6.4, 6.7 | Server-side Gemini multi-turn loop |
| `lib/chat/routing-dispatcher.ts` | 6.3, 6.5 | Two S6 call sites (abstain, timeout) |
| `lib/chat/routing-log/payload.ts` | 6.3 | S6 telemetry fields in durable log payload |
| `app/api/chat/routing-log/route.ts` | 6.3 | S6 fields in `semantic_hint_metadata` serialization |

### Tests

| File | Tests |
|------|-------|
| `__tests__/unit/chat/stage6-loop-route.test.ts` | 38 |
| `__tests__/unit/chat/stage6-loop-controller.test.ts` | 22 |
| `__tests__/unit/chat/stage6-inspect-handlers.test.ts` | 17 |

### Reports

| File | Scope |
|------|-------|
| `reports/2026-03-11-stage6-slice61-contracts.md` | Slice 6.1 |
| `reports/2026-03-11-stage6-slice62-inspect-handlers.md` | Slice 6.2 |
| `reports/2026-03-11-stage6-slice63-shadow-loop.md` | Slice 6.3 |
| `reports/2026-03-12-stage6-slice65-enforcement-mode-implementation.md` | Slice 6.5 |
| `reports/2026-03-12-stage6-enforcement-runtime-fixture.md` | Runtime fixture |
| `reports/2026-03-12-stage6-slice67-prompt-hardening-slice1.md` | 6.7 Slice 1 |
| `reports/2026-03-12-stage6-slice67-structured-output-slice2.md` | 6.7 Slice 2 |
| `reports/2026-03-12-stage6-slice67-evidence-gate-slice3.md` | 6.7 Slice 3 |
| `reports/2026-03-12-stage6-completion-report.md` | This report |

---

## 10) What Is NOT In Scope

- **`open_widget_item` / `navigate_entry` enforcement**: Contracted and validated, not wired into enforcement bridge. Phase 2 work.
- **`stage4_low_confidence` escalation**: Designed (G1 shadow threshold) but not wired as an S6 trigger. Depends on G1 enforcement decision.
- **Body-text search**: `inspect_search` searches names/labels only. Full-text search deferred.
- **Cross-workspace inspect**: All tools operate within the current workspace/dashboard.
- **Content mutation actions**: By design — S6 is read + navigate only.

---

## 11) Promotion Recommendation

### Ready for production (shadow mode)

Shadow mode can run in production immediately. It is fire-and-forget, fail-open, and has no user-facing impact. It provides telemetry for evaluating whether enforcement should be enabled more broadly.

### Enforcement gating criteria

Before enabling enforcement (`NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED=true`) in production:

1. **Shadow data review**: Analyze shadow rows for action success rate, abort rate, and latency distribution. Target: > 70% `action_executed` on `open_panel` queries, P95 < 5s.
2. **Evidence gate validation**: Confirm `ambiguous_siblings` fires correctly on badge-variant panels in production data.
3. **Rollback plan**: Enforcement is flag-gated. Set `NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED=false` to revert to shadow-only instantly.
4. **Phase 2 scope**: Before wiring `open_widget_item` / `navigate_entry` enforcement, accumulate shadow telemetry on those action types to validate model accuracy.

### Feature flags

| Flag | Current | Purpose |
|------|---------|---------|
| `STAGE6_SHADOW_ENABLED` | `true` | Server-side shadow loop |
| `NEXT_PUBLIC_STAGE6_SHADOW_ENABLED` | `true` | Client-side shadow loop |
| `NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED` | `true` | Enforcement mode (Phase 1: `open_panel`) |

When Stage 6 is deemed stable in production, schedule flag removal per CLAUDE.md convention.
