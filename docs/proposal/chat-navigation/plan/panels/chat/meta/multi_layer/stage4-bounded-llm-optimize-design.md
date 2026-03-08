# Stage 4: Bounded LLM Optimize — Design Note

**Date**: 2026-03-08
**Parent plan**: `multi-layer-routing-reliability-plan-v3_5.md` §12 item 4
**Predecessor**: Stage 3 (Semantic Assist) — Phase 3c validated 2026-03-08
**Status**: Design audit (pre-implementation)

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

| # | Requirement (plan) | Current Tier 4.5 | Gap | Priority |
|---|---|---|---|---|
| G1 | Confidence threshold 0.75 (§8 line 323) | 0.4 (`MIN_CONFIDENCE_SELECT`) | Threshold too low | High |
| G2 | Max 8 validated candidates to LLM (§8 line 330) | No cap | Missing | High |
| G3 | Deterministic rank+trim when >8 (§8 lines 333-343) | None | Missing | High (depends on G2) |
| G4 | Validator-only input (§6 line 206) | Grounding candidates (mixed sources, no formal Lane C gate) | Partial — grounding builds candidates but no explicit validator filter | High |
| G5 | TOCTOU revalidation before commit (§7 lines 237-243) | Not present | Missing | High |
| G6 | Single-candidate: stay in Lane D (§8 lines 316-321) | Unclear — needs code audit | Audit needed | Medium |
| G7 | Near-tie guard: `top1 - top2 < 0.02` → clarifier (§7.1 line 295) | Not present | Missing | Medium |
| G8 | Risk-tier differentiation (§7.1 lines 283-289) | No differentiation — all candidates treated equally | Missing | Low (no mutation intents yet) |
| G9 | Idempotency: at-most-once for mutations (§7 lines 265-269) | Not present | Missing | Low (no mutation intents yet) |
| G10 | Provenance: explicit Lane D label (§6, §14) | `grounding_llm_*` tier labels exist | Partial — rename/formalize | Low |

### Gap classification

**Must-fix for Stage 4 (high priority):**
- G4: Formalize validator gate (Lane C) as explicit pre-LLM filter — "validated candidates only" is a core plan contract, not optional. Metrics measured on an unvalidated candidate set are less trustworthy.
- G1: Confidence threshold 0.4 → 0.75
- G2 + G3: Candidate cap (8) + deterministic rank+trim
- G5: TOCTOU revalidation before execution commit

**Should-fix (medium priority):**
- G6: Audit and enforce single-candidate Lane D behavior
- G7: Near-tie guard

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

- Raise `MIN_CONFIDENCE_SELECT` from 0.4 to 0.75 in both `grounding-llm-fallback.ts` and `route.ts`
- Add per-intent override capability (plan §8 line 324): mutation intents may use stricter threshold
- Shadow mode first: log when 0.4 < confidence < 0.75 to measure impact before enforcing

**Metrics**: Measure how many current `select` decisions would become `need_more_info` under 0.75.

### 4b) G2 + G3 — Candidate cap + rank+trim

**Scope**: Pre-LLM filter in `routing-dispatcher.ts`

Before calling `callGroundingLLM()`, if `llmCandidates.length > 8`:
1. Apply deterministic rank+trim (plan §8 lines 333-343):
   - Scope match priority
   - Exact id/label boost
   - Context compatibility score
   - Recency (`last_success_at` DESC)
   - Prior success count (`success_count` DESC)
   - Risk tier preference (lower first)
   - Tie-break: stable `candidate_id` ASC
2. Trim to top 8
3. Log trimmed count + trimmed candidate IDs

**Note**: Current grounding set rarely exceeds 8 candidates in practice. This is a safety cap, not a frequent operation.

### 4c) G5 — TOCTOU revalidation

**Scope**: New check before execution commit

After LLM returns `select(choiceId)` and before executing the action:
1. Rebuild current snapshot (latest panel state, visible items)
2. Re-check: target exists, scope membership, permission/schema compatibility
3. If drift detected:
   - Action intents: cancel → safe clarifier (no rerun)
   - Info intents: rerun Lane C once with existing candidate set → if still failing, safe clarifier
4. Log revalidation result (`pass` / `fail` + reason code)

**Implementation site**: Between `choiceId` resolution and the 4 execution paths (select, referent, widget_item, panel) in `routing-dispatcher.ts:4547-4766`.

### 4d) G4 — Validator gate formalization

**Scope**: Make the grounding set filter explicit

Currently, `grounding-set.ts` builds candidates from multiple sources. The validator gate (Lane C) is implicit — candidates that don't exist in the current snapshot are naturally excluded. Formalize this:
1. Add explicit `validateCandidate(candidate, currentSnapshot)` check
2. Log validation pass/fail per candidate
3. Only validated candidates reach the LLM

### 4e) G7 — Near-tie guard

**Scope**: Post-LLM check

The plan's near-tie guard (§7.1 line 295) is a general ambiguity rule: `top1_score - top2_score < 0.02` → force clarifier. The implementation must define which score governs this guard.

**Score source design decision** (must be locked before coding):

| Option | Score source | Pro | Con |
|---|---|---|---|
| A | B2 semantic similarity | Available pre-LLM; measures query-to-memory closeness | Not all candidates have B2 scores (grounding-only candidates have none) |
| B | LLM confidence | Post-LLM; measures selector certainty | Single scalar, no per-candidate ranking |
| C | Hybrid: B2 when available, skip guard otherwise | Pragmatic | Inconsistent behavior depending on B2 availability |

**Recommendation**: Option A for candidates with B2 scores. For candidates without B2 scores (pure grounding), the guard does not apply (no semantic ranking exists to compare). Log which path was taken.

If the LLM returns `select` and the top two B2-scored candidates differ by less than 0.02:
- Override to `need_more_info`
- Route to clarifier
- Log near-tie suppression

**Note**: B2 candidates are available via `semanticCandidatesForReorder` in the dispatcher. The guard only fires when B2 scores are present for at least two candidates in the validated set.

### 4f) G6 — Single-candidate audit

**Scope**: Code audit + enforcement

Verify that when exactly 1 validated candidate reaches Tier 4.5:
- The LLM is still called (default mode) OR
- The no-model shortcut fires only with full validator + TOCTOU pass
- In no case does the candidate route back to Lane A deterministic

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

### Baseline capture (before Stage 4 changes)

Before implementing any gap fix, capture current values for:
- LLM selector success rate
- Clarifier rate
- Confidence distribution at the current 0.4 threshold
- Average/P95 LLM latency

---

## 6) Rollout plan

1. **Baseline capture** — Measure current Tier 4.5 metrics (selector success rate, clarifier rate, confidence distribution, latency) before any changes
2. **Shadow metrics** — Add telemetry for G1 (would-be rejections at 0.75) and G5 (TOCTOU revalidation result) without changing behavior
3. **G4 validator gate** — Formalize validated-candidate-only input. Do this before measuring or enforcing other gaps — metrics on an unvalidated candidate set are less trustworthy.
4. **G2+G3 candidate cap** — Low risk, apply immediately (rarely triggers in practice)
5. **G1 confidence threshold** — Switch from 0.4 to 0.75 after shadow metrics confirm acceptable clarifier rate increase
6. **G5 TOCTOU** — Enable in shadow (log-only) first, then enforce
7. **G7 near-tie guard** — Enable after TOCTOU is stable

All changes behind feature flags. Kill switch: `CHAT_ROUTING_BOUNDED_LLM_STAGE4_ENABLED`.

---

## 7) Out of scope (deferred to later stages)

- G8 risk-tier differentiation (Stage 6: Verified Semantic Reuse)
- G9 idempotency for mutations (Stage 6)
- G10 provenance label rename (cosmetic, any time)
- Multi-intent decomposition (§9, §6.1 — separate stage)
- Resolution memory reuse (Stage 5)
