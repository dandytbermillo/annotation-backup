# Stage 4: Bounded LLM Optimize — Design Note

**Date**: 2026-03-08
**Parent plan**: `multi-layer-routing-reliability-plan-v3_5.md` §12 item 4
**Predecessor**: Stage 3 (Semantic Assist) — Phase 3c validated 2026-03-08
**Status**: **Implementation complete, enforcement deferred** (2026-03-10). G4 + G2/G3 shipped, G1 + G5 + G7 shadow-frozen, G6 audited. G8/G9/G10 deferred. Successor: Stage 5.

---

## 1) Decision: Harden Tier 4.5, not a new lane

The existing Tier 4.5 grounding LLM (`routing-dispatcher.ts:4500-4927`) is structurally compatible with the plan's Lane D bounded selector. It already:

- Receives candidates from grounding set (not raw user input)
- Calls a bounded LLM with `{ select, need_more_info }` contract
- Validates `choiceId` against the candidate list
- Falls back to safe clarifier on failure, timeout, or low confidence
- Logs provenance per decision type (`grounding_llm_*` labels)

Stage 4 is a **contract hardening pass** over this existing path, not a parallel lane.

---

## 2) Contract gap audit

### Checked against: `multi-layer-routing-reliability-plan-v3_5.md` §6, §7, §8, §7.1

| # | Requirement (plan) | Current Tier 4.5 | Gap | Priority | Status |
|---|---|---|---|---|---|
| G1 | Confidence threshold 0.75 (§8 line 323) | 0.4 live + 0.75 shadow (observation only) | Shadow mode active; enforcement pending data | High | **Shadow mode** 2026-03-09 |
| G2 | Max 8 validated candidates to LLM (§8 line 330) | Cap at 8 post-G4 validated candidates | Implemented (minimal sort) | High | **Implemented** 2026-03-09 |
| G3 | Deterministic rank+trim when >8 (§8 lines 333-343) | Source/type/ID sort; richer signals deferred | Partial — see §4b | High (depends on G2) | **Implemented** 2026-03-09 (minimal) |
| G4 | Validator-only input (§6 line 206) | 6-check structural validator before LLM | Implemented (structural checks) | High | **Implemented** 2026-03-09 |
| G5 | TOCTOU revalidation before commit (§7 lines 237-243) | Shadow mode: pass/fail/not_revalidated logged, no behavior change. `visible_panels` upgraded to real pass/fail via fresh registry reader. | Shadow — fail path unexercised, `recent_referent`/`capability` still not_revalidated | High | **Shadow mode** 2026-03-09 |
| G6 | Single-candidate: stay in Lane D (§8 lines 316-321) | No shortcut — full LLM pipeline runs | Compliant (code audit) | Medium | **Audited** 2026-03-09 |
| G7 | Near-tie guard: `top1 - top2 < 0.02` → clarifier (§7.1 line 295) | Shadow mode: Option A (B2 scores), log-only. Runtime-unproven (0 rows with >= 2 B2-scored candidates). | Shadow — blocked on upstream B2 coverage | Medium | **Shadow mode** 2026-03-10 |
| G8 | Risk-tier differentiation (§7.1 lines 283-289) | No differentiation — all candidates treated equally | Missing | Low (no mutation intents yet) | Deferred |
| G9 | Idempotency: at-most-once for mutations (§7 lines 265-269) | Not present | Missing | Low (no mutation intents yet) | Deferred |
| G10 | Provenance: explicit Lane D label (§6, §14) | `grounding_llm_*` tier labels exist | Partial — rename/formalize | Low | Deferred |

### Gap classification

**Implemented (runtime-validated, pass-through path):**
- G4: Structural validator gate — 6 checks (empty_id, empty_label, invalid_type, invalid_source, duplicate_id, label_too_long). Zero-rejection pass-through confirmed. See §4d.
- G2 + G3: Candidate cap (8) + deterministic sort (source/type/ID). Pass-through confirmed, trim branch unexercised. Richer ranking signals deferred to Stage 5. See §4b.

**Audited (code audit, not runtime-validated):**
- G6: Single-candidate path — no shortcut exists, full LLM pipeline runs regardless of candidate count. Compliant by code audit. See §4f.

**Shadow mode (observation only, no behavior change):**
- G1: Confidence threshold — shadow at 0.75, live at 0.4. Absent-path validated; true-path pending sample growth. Enforcement after shadow data confirms acceptable impact. See §4a.
- G5: TOCTOU revalidation — pass/fail/not_revalidated logged on select path. `visible_panels` upgraded from `not_revalidated` to real pass/fail via fresh registry reader (2026-03-09). Pass validated for widget_list and visible_panels; fail unexercised; `recent_referent`/`capability` remain not_revalidated. Enforcement blocked until fail path fires and remaining not_revalidated sources are exempted. See §4c.
- G7: Near-tie guard — shadow mode, Option A (B2 scores). Unit-proven (8/8). Runtime-unproven: 0 Tier 4.5 rows have >= 2 validated B2-scored candidates. Blocked on upstream B2 coverage, not a G7 defect. See §4e.

**Deferred (low priority — no current use case):**
- G8: Risk-tier differentiation (requires mutation intents)
- G9: Idempotency (requires mutation intents)
- G10: Provenance label rename (cosmetic)

---

## 3) Existing code map

| Component | File | Lines | Role |
|---|---|---|---|
| LLM call orchestration | `lib/chat/routing-dispatcher.ts` | 4500-4927 | Tier 4.5 entry, candidate prep, response dispatch |
| LLM client wrapper | `lib/chat/grounding-llm-fallback.ts` | 1-268 | `callGroundingLLM()`, client-side validation, timeout (2s) |
| LLM API route | `app/api/chat/grounding-llm/route.ts` | 1-271 | Server-side Gemini call, response parsing, letter/index mapping |
| Grounding set builder | `lib/chat/grounding-set.ts` | 1-150+ | Candidate sources: active_options, visible_panels, widget_list, recent_referent, capability |
| Clarifier reorder | `lib/chat/routing-log/clarifier-reorder.ts` | 1-202 | Phase 3c B2-based candidate reorder (feeds into Tier 4.5 clarifiers) |

---

## 4) Implementation plan (proposed order)

### 4a) G1 — Confidence threshold

**Scope**: Parameter change + dual-threshold structure

**Shadow mode implemented (2026-03-09)**: No behavior change. Logs would-be rejections at 0.75 without enforcing.

- Live threshold: `MIN_CONFIDENCE_SELECT = 0.4` (unchanged)
- Shadow threshold: `G1_SHADOW_CONFIDENCE_THRESHOLD = 0.75` (observation only)
- When a `select` decision survives 0.4 but would fail 0.75, `llm_g1_shadow_rejected = true` is emitted in `semantic_hint_metadata`
- When absent: either not a select, or select that would still pass 0.75

**Files**:
- `lib/chat/grounding-llm-fallback.ts:61` — `G1_SHADOW_CONFIDENCE_THRESHOLD = 0.75`, shadow detection at line 233
- `lib/chat/routing-dispatcher.ts:4672` — wired to `_llmTelemetry.g1ShadowRejected`
- `lib/chat/routing-dispatcher.ts:1446` — serialized only when `true`
- `lib/chat/routing-log/payload.ts:96` — `llm_g1_shadow_rejected?: boolean`
- `app/api/chat/routing-log/route.ts:113` — persisted in `semantic_hint_metadata`

**Runtime validation**:
- Absent-path confirmed: 3 `need_more_info` rows and 1 Lane A row correctly omit the field.
- True-path unproven: 0 of 12 historical selects have confidence in the 0.4–0.75 band (all are 1.0). The true case will surface with continued sample growth.

**Enforcement (not yet started)**:
- Raise `MIN_CONFIDENCE_SELECT` from 0.4 to 0.75 after shadow data confirms acceptable clarifier rate increase
- Per-intent override capability (plan §8 line 324): mutation intents may use stricter threshold — deferred (no mutation intents yet)

**Metrics**: Measure how many current `select` decisions would become `need_more_info` under 0.75. Query: `WHERE semantic_hint_metadata->>'llm_g1_shadow_rejected' = 'true'`.

### 4b) G2 + G3 — Candidate cap + rank+trim

**Scope**: Pre-LLM filter in `routing-dispatcher.ts`

**Implemented (2026-03-09)**: Minimal, low-risk form. Cap at 8 validated candidates with deterministic sort.

Before calling `callGroundingLLM()`, if validated candidates (post-G4) exceed 8:
1. Sort by deterministic rank:
   - Source priority (`active_options` > `paused_snapshot` > `visible_panels` > `widget_list` > `recent_referent` > `capability`)
   - Type priority (`option` > `widget_option` > `referent` > `capability`)
   - Tie-break: stable `candidate.id` ASC
2. Trim to top 8
3. Log pre/post counts + trimmed candidate IDs

**Files**:
- `lib/chat/grounding-set.ts:288` — `capAndTrimCandidates()`, `LLM_CANDIDATE_CAP = 8`
- `lib/chat/routing-dispatcher.ts:4601` — integration after G4, before LLM call
- Telemetry: `llm_g23_pre_cap_count`, `llm_g23_post_cap_count`, `llm_g23_was_trimmed`, `llm_g23_trimmed_ids` in `semantic_hint_metadata`

**Runtime validation**: 2 rows confirmed G23 fields persist end-to-end (pass-through case, `pre_cap = post_cap = 2`, `was_trimmed = false`). Trim branch not yet exercised — grounding set has not exceeded 8 candidates in practice.

**Deferred ranking signals** (plan §8 lines 333-343 — not available on current `GroundingCandidate` objects):
- Scope match priority
- Exact id/label boost
- Context compatibility score
- Recency (`last_success_at` DESC)
- Prior success count (`success_count` DESC)
- Risk tier preference (lower first)

These require candidate enrichment with resolution metadata, which belongs in Stage 5 (semantic memory as resolution layer). The current source/type/ID sort is sufficient as a safety cap — the grounding set rarely exceeds 8 candidates in practice.

**Note**: Current grounding set rarely exceeds 8 candidates in practice. This is a safety cap, not a frequent operation.

### 4c) G5 — TOCTOU revalidation

**Scope**: New check before execution commit

**Shadow mode implemented (2026-03-09)**: Log-only, no behavior change. Three-outcome telemetry: `pass` / `fail` / `not_revalidated`.

After LLM returns `select(choiceId)` and the candidate is found, before executing the action:
1. Compute TOCTOU window: `Date.now() - turnSnapshot.capturedAtMs`
2. Check if the selected candidate's backing target still exists, by source:

| Source | Check | Outcome | Fail/NR reason |
|--------|-------|---------|----------------|
| `active_options` | ID in `ctx.pendingOptions` | pass/fail | `option_not_in_pending` |
| `paused_snapshot` | ID in `ctx.clarificationSnapshot?.options` | pass/fail | `snapshot_option_gone` |
| `widget_list` | ID in fresh `buildTurnSnapshot()` widget options | pass/fail | `widget_option_gone` |
| `visible_panels` | `panelId` in fresh `ctx.getVisibleSnapshots()` | pass/fail | `panel_not_visible` |
| `recent_referent` | No freshness source available | not_revalidated | `referent_no_freshness_source` |
| `capability` | No freshness source available | not_revalidated | `capability_no_freshness_source` |

3. Log result — no behavior change regardless of outcome.

**Files**:
- `lib/chat/routing-dispatcher.ts:4686-4752` — shadow check after candidate found, before execution paths
- Telemetry: `llm_g5_toctou_result`, `llm_g5_toctou_reason`, `llm_g5_toctou_window_ms` in `semantic_hint_metadata`
- `lib/chat/routing-log/payload.ts:98-100` — field definitions
- `app/api/chat/routing-log/route.ts:115-117` — persistence

**Runtime validation**:
- `pass` (widget_list): 1 row — "show me the summary100 one" (window 1621ms)
- `pass` (visible_panels): 1 row — "bring up links panel a" (window 1710ms, choice_id `9add1baf-...`, candidate_count 1)
- absent on non-select: 2 rows — "I need the budget100 entry" and "open the budget panel" (need_more_info, correctly omit G5 fields)
- `fail`: not yet exercised — no real drift detected in any test (unit-covered)
- `not_revalidated`: validated for `recent_referent` and `capability` sources (no freshness check available)

**Resolved limitation (2026-03-09)**: `visible_panels` previously returned `not_revalidated` because `ctx.uiContext?.dashboard?.visibleWidgets` is closed over at function entry. Fixed by reading fresh panel state from the widget snapshot registry via `ctx.getVisibleSnapshots()`, matching on `snapshot.panelId === selected.id`. This mirrors the `widget_list` pattern (fresh registry read at revalidation time).

**Enforcement (not yet started)**:
- On `fail`: cancel execution → safe clarifier (action intents) or rerun with existing candidates (info intents)
- On `not_revalidated`: behavior TBD — `recent_referent` and `capability` have no reliable freshness source; may require explicit exemption
- Enforcement blocked until: (a) shadow data shows the fail path fires in practice, (b) remaining `not_revalidated` sources are explicitly exempted or upgraded

**Supporting observation**: "open Links Panel b" is the first runtime trace of a single-candidate Tier 4.5 select (candidate count 1, confidence 1.0) — confirms the G6 audit finding.

### 4d) G4 — Validator gate formalization

**Scope**: Make the grounding set filter explicit

**Implemented (2026-03-09)**: Structural validator as pure function, no snapshot dependency.

`validateGroundingCandidates(candidates)` applies 6 checks per candidate:
1. `empty_id` — reject if `id` is falsy or empty string
2. `empty_label` — reject if `label` is falsy or empty string
3. `invalid_type` — reject if `type` not in allowed set (`option`, `widget_option`, `referent`, `capability`)
4. `invalid_source` — reject if `source` not in allowed set (`active_options`, `paused_snapshot`, `visible_panels`, `widget_list`, `recent_referent`, `capability`)
5. `label_too_long` — reject if `label` exceeds 200 characters
6. `duplicate_id` — reject second+ occurrence of same `id`

**Files**:
- `lib/chat/grounding-set.ts:178` — `validateGroundingCandidates()`, `CandidateRejectionReason` type
- `lib/chat/routing-dispatcher.ts:4588` — integration before G2/G3 cap, after grounding set build
- Telemetry: `llm_g4_total_in`, `llm_g4_total_out`, `llm_g4_duplicates_removed`, `llm_g4_rejections` in `semantic_hint_metadata`

**Runtime validation**: Multiple rows confirmed G4 fields persist end-to-end. All observed rows show zero rejections (pass-through). No real-world candidate has triggered a rejection yet — the checks are a safety net against malformed candidates.

**Design note**: The original plan called for `validateCandidate(candidate, currentSnapshot)` — a snapshot-aware check. The implemented form is structural only (no snapshot dependency). Snapshot-aware validation (does this candidate still exist in current state?) is deferred to G5 TOCTOU revalidation, which is the natural site for state-freshness checks.

### 4e) G7 — Near-tie guard

**Scope**: Post-LLM check

The plan's near-tie guard (§7.1 line 295) is a general ambiguity rule: `top1_score - top2_score < 0.02` → force clarifier. The implementation must define which score governs this guard.

**Score source design decision** (must be locked before coding):

| Option | Score source | Pro | Con |
|---|---|---|---|
| A | B2 semantic similarity | Available pre-LLM; measures query-to-memory closeness | Not all candidates have B2 scores (grounding-only candidates have none) |
| B | LLM confidence | Post-LLM; measures selector certainty | Single scalar, no per-candidate ranking |
| C | Hybrid: B2 when available, skip guard otherwise | Pragmatic | Inconsistent behavior depending on B2 availability |

**Decision**: Option A — B2 semantic similarity. Locked 2026-03-10.

**Shadow mode implemented (2026-03-10)**: Log-only, no behavior change.

After LLM returns `select`, the guard computes the margin between the top-2 B2-scored candidates in the post-G4/post-G2 set (`llmCandidates`). If margin < 0.02, logs `g7_near_tie_detected`. Does not override the LLM decision in shadow mode.

**Constraints**:
- Only fires when >= 2 validated candidates have B2 scores; otherwise G7 fields are absent (no pseudo-margin invented)
- Operates on the post-G4/post-G2 candidate set — the set that actually reached the LLM
- B2 score mapping uses `slots_json.itemId`/`slots_json.candidateId` — same matching logic as `reorderClarifierCandidates`

**Files**:
- `lib/chat/routing-dispatcher.ts:4701-4750` — G7 shadow check on select path, before candidate execution
- `lib/chat/routing-dispatcher.ts:526-530` — G7 fields in `_llmTelemetry` type
- `lib/chat/routing-dispatcher.ts:1467-1471` — G7 serialization to log payload
- Telemetry: `llm_g7_near_tie_detected`, `llm_g7_margin`, `llm_g7_top1_score`, `llm_g7_top2_score`, `llm_g7_candidate_basis` in `semantic_hint_metadata`
- `lib/chat/routing-log/payload.ts:103-108` — field definitions
- `app/api/chat/routing-log/route.ts:118-122` — persistence

**Unit tests**: 8/8 pass in `__tests__/unit/chat/stage4-shadow-telemetry.test.ts` — covers near-tie detected, exact tie, no near-tie, boundary (margin = 0.02), < 2 B2-scored candidates, no B2 scores, partial B2 coverage, and B2 map exclusion.

**Runtime validation**: Not yet proven. Current data has 0 Tier 4.5 rows with >= 2 validated B2-scored candidates (`max(b2_validated_count) = 1`). Some rows have B2 hits (`b2_status = discarded_handled`) but none with sufficient overlap to trigger G7. This is an upstream B2 coverage gap, not a G7 defect. Runtime validation will come when B2 produces >= 2 scored candidates on a select path.

**Enforcement (not yet started)**:
- On near-tie detected: override `select` → `need_more_info`, route to clarifier
- Enforcement blocked until: (a) runtime shadow data confirms the guard fires in practice, (b) margin threshold (0.02) is validated against real B2 score distributions

**Note**: B2 candidates are available via `semanticCandidatesForReorder` in the dispatcher. The guard only fires when B2 scores are present for at least two candidates in the validated set.

### 4f) G6 — Single-candidate audit

**Scope**: Code audit + enforcement

**Audited (2026-03-09)**: Code audit only — not runtime-validated.

Audit question: when exactly 1 validated candidate reaches Tier 4.5, does the system behave correctly?

**Findings** (from `routing-dispatcher.ts:4536-4928`):

- **LLM is always called.** No `if (candidates.length === 1)` guard or auto-select bypass before the LLM call. The LLM receives the single candidate and returns `select` or `need_more_info` like any other case.
- **On `select`**: the system executes the candidate (same as multi-candidate select).
- **On `need_more_info`**: the system shows a clarifier (same as multi-candidate need_more_info), **except** for the narrow exception below.
- **No backward path to Lane A deterministic.** No Tier 4.5 branch hands a candidate back to deterministic matchers.
- **No-model shortcut**: not implemented (depends on G5 TOCTOU, which is not started).

### §4 Exception: Single visible-panel LLM abstain override (2026-03-10)

**Approved policy change** — narrow exception to the `need_more_info` → clarifier contract.

When the bounded LLM returns `need_more_info` but **all three** conditions hold:

1. Exactly 1 candidate in the grounding set
2. That candidate has `source: 'visible_panels'`
3. The input is a command form (`isExplicitCommand(input) === true`)

...the system **overrides the LLM abstain** and auto-executes the panel open. A single-option clarifier ("Which option did you mean? Links Panel A?") adds no disambiguation value for command-form panel requests.

**What this is**: An LLM abstain override for a narrow panel-command case. The LLM ran, it said `need_more_info`, and the code overrides that decision based on a heuristic.

**What this is NOT**: A generic single-candidate auto-execute rule. The exception applies only to `visible_panels` + command form. All other `need_more_info` cases (widget items, referents, capabilities, non-command inputs) still show a clarifier.

**Provenance**: `llm_executed` (not `deterministic`). The LLM was consulted in the pipeline. The execution is a post-LLM heuristic, not a strict-exact deterministic match.

**Strict-exact compliance**: No verb stripping for deterministic authorization. The candidate was found through advisory panel evidence matching. `matchKind` remains `'partial'`, not `'registry_exact'`.

**Implementation**: `routing-dispatcher.ts:5234` — `grounding_llm_single_panel_auto_execute` branch.

**Test coverage**: `__tests__/unit/chat/single-panel-auto-execute.test.ts` — 1 positive test (auto-execute fires) + 2 negative tests (non-command input → clarifier, non-visible_panels source → clarifier).

**Status**: Implemented and tested (2026-03-10). Not runtime-validated yet.

---

## 5) Metrics (lock before coding)

| Metric | Measurement | Source |
|---|---|---|
| LLM selector success rate | `grounding_llm_select` / total Tier 4.5 entries | Durable log |
| Invalid choiceId rate | Client+server `choiceId` rejections / total LLM calls | Debug log |
| Clarifier rate | `need_more_info` + `fallback_clarifier` / total Tier 4.5 | Durable log |
| Confidence distribution | Histogram of `confidence` values on `select` decisions | Durable log (new field) |
| TOCTOU failure rate | Revalidation failures / total commit attempts | Durable log (new field) |
| Latency impact | P50/P95 of LLM round-trip time | Durable log `b2_latency_ms` equivalent for LLM |
| Near-tie suppression rate | Near-tie guard triggers / total `select` decisions | Durable log (new field) |
| Candidate trim rate | Trim operations / total Tier 4.5 entries | Debug log |

### Baseline capture

Pre-Stage 4 baseline values are available in the durable log (rows before 2026-03-09). Key metrics:
- LLM selector success rate
- Clarifier rate
- Confidence distribution at the 0.4 threshold
- Average/P95 LLM latency

**Baseline exclusion**: Lane E-first rows (routing_attempt with `clarifier/E/failed/unhandled`) are excluded from Stage 4 baseline queries. These queries never traversed the Tier 4.5 bounded-selector path due to upstream question-intent classification. See `question-intent-overclassification.md` for details.

---

## 6) Rollout status

| Step | Description | Status |
|------|-------------|--------|
| 1 | **Baseline capture** — Measure Tier 4.5 metrics before changes | Done (pre-Stage 4 data in durable log) |
| 2 | **G4 validator gate** — Formalize validated-candidate-only input | **Shipped** 2026-03-09 |
| 3 | **G2+G3 candidate cap** — Cap at 8, deterministic sort when trimming | **Shipped** 2026-03-09 |
| 4 | **G1 shadow** — Log would-be rejections at 0.75 without changing live 0.4 | **Shadow active** 2026-03-09 |
| 5 | **G5 TOCTOU shadow** — Log pass/fail/not_revalidated on select path | **Shadow active** 2026-03-09. `visible_panels` upgraded to real pass/fail 2026-03-09. |
| 6 | **G6 audit** — Confirm single-candidate behavior is compliant | **Audited** 2026-03-09 |
| 7 | **G7 near-tie shadow** — Log near-tie detection using B2 scores | **Shadow active** 2026-03-10. Runtime-unproven (0 rows with >= 2 B2-scored candidates). |
| 8 | **G1 enforcement** — Raise `MIN_CONFIDENCE_SELECT` from 0.4 to 0.75 | **Shadow-frozen** 2026-03-10. 0.4 stays live, 0.75 shadow-only. Revisit after more real selects in 0.4–0.75 band. |
| 9 | **G5 enforcement** — Reject on TOCTOU fail | **Shadow-frozen** 2026-03-10. Pending fail-path evidence + exemption policy for `recent_referent`/`capability`. |
| 10 | **G7 enforcement** — Override select → clarifier on near-tie | **Shadow-frozen** 2026-03-10. Blocked on Stage 5 B2 resolution-layer coverage (0 rows with >= 2 B2-scored candidates). |

**Stage 4 completion decision (2026-03-10)**: Implementation complete, enforcement deferred. All gaps have shadow telemetry or are shipped. Enforcement requires data that does not yet exist — stalling the roadmap on sparse-data decisions is not productive. Shadow telemetry continues passively. Enforcement revisited when data thresholds are met or Stage 5 B2 upgrades produce richer candidate overlap.

All changes behind feature flags. Kill switch: `CHAT_ROUTING_BOUNDED_LLM_STAGE4_ENABLED`.

---

## 7) Out of scope (deferred to later stages)

- G8 risk-tier differentiation (Stage 6: Verified Semantic Reuse)
- G9 idempotency for mutations (Stage 6)
- G10 provenance label rename (cosmetic, any time)
- Multi-intent decomposition (§9, §6.1 — separate stage)
- Resolution memory reuse (Stage 5)
