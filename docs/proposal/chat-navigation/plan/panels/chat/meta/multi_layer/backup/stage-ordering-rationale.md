# Stage Ordering Rationale: Stage 4 → 5 → 6

**Date**: 2026-03-09
**Status**: Design decision — captures the cross-stage architectural ordering rationale.

---

## Context

The product target is ChatGPT-web + Cursor-AI behavior: a chat assistant that can inspect active context, gather information independently, and act to fulfill user requests — not just select from a candidate list.

That target requires an agent/tool-use architecture. But jumping directly to agentic behavior from the current bounded selector is premature. The correct path is incremental: harden the selector, then reuse its outcomes semantically, then add independent tool access as a last resort.

---

## Stage Ordering

### Stage 4: Bounded Selector Hardening (current)

**Scope**: Harden Tier 4.5 grounding LLM against the plan's Lane D contract.

**What it produces**:
- Reliable select/clarify decisions with confidence scores
- Validated candidate pipeline (cap, trim, validator gate)
- Durable telemetry: `llm_decision`, `llm_confidence`, `llm_latency_ms`, `llm_choice_id`, `llm_candidate_count`, `llm_rejection_reason`
- Structured resolution metadata in the durable log

**Why it comes first**:
- You need a reliable selector before reusing its outcomes.
- Telemetry from Stage 4 is the data foundation for Stage 5 semantic reuse.
- The durable log fields being added now (`llm_*` telemetry) are exactly the structured resolution metadata that Stage 5 will consume.

**Design note**: `stage4-bounded-llm-optimize-design.md`

---

### Stage 5: Semantic Memory as a Resolution Layer

**Scope**: Upgrade B2 semantic memory from clarifier-assist (reorder hints) to validated resolution reuse.

**Current state of B2**:
- Embeds only the normalized user query text
- Used only for clarifier reorder hints (Phase 3c)
- Does not resolve queries independently
- Does not store or recall what a prior query resolved to

**What Stage 5 adds**:
- Semantic recall of prior successful resolutions by query similarity
- Structured resolution metadata attached to each memory entry:
  - Resolved action type
  - Target IDs
  - Slots/context
  - Validation fingerprint
- Strict staleness/target validation before replay:
  - Do targets still exist?
  - Is the context compatible?
  - Is the resolution still valid?
- Safe replay only if all checks pass; otherwise fall through to Stage 4 (Tier 4.5 LLM)

**What Stage 5 does NOT do**:
- Does not embed response text (the natural-language reply is generated output, not semantic intent)
- Does not embed raw state metadata (state stays structured: context fingerprint, target IDs, widget IDs, candidate set summary)
- Does not auto-execute with weak checks ("semantic auto-exec" without validation is unsafe)

**Why it comes before agentic behavior**:
1. **Cost**: Embedding similarity lookup is sub-100ms vs 800-1200ms for an LLM call
2. **Latency**: Vector search is cheaper than tool-calling round-trips
3. **Safety**: Replaying a known-good, validated outcome is inherently safer than letting the LLM explore
4. **Coverage**: Users repeat similar requests with varied phrasing; semantic matching captures that variation without exact normalization
5. **Unnecessary clarifier reduction**: If "open budget100" succeeded before, "take me to budget100" should resolve by semantic similarity without hitting the LLM at all

**Fallback chain after Stage 5**:
```
B1 exact memory → (miss) → B2 semantic resolution reuse → (miss or validation fail) → Tier 4.5 LLM selector → clarifier or select
```

---

### Stage 6: Agentic Widget-Aware Tool Loop

**Scope**: For genuinely novel requests where neither memory nor selector can resolve, give the LLM bounded tool access to inspect context and act independently.

**What Stage 6 adds**:
- Tool interface the LLM can call:
  - Inspect active widget
  - Inspect dashboard/workspace structure
  - Read visible items
  - Request focused snapshots
  - Execute validated actions
- Strict observation model: typed, scoped snapshots — never raw uncontrolled app state
- Bounded action model: validated tool calls, reversible/safe actions, app-side guards
- Agent loop: user asks → model inspects → model requests info → app returns structured results → model decides or clarifies only when truly necessary
- Exit condition: model must resolve within N tool calls or fall back to clarifier

**Why it comes last**:
- Agent behavior is the most expensive path (multi-turn LLM calls + tool execution)
- It is the least predictable path (model-driven exploration)
- It is the hardest to test and validate
- Stages 4 and 5 should handle the majority of queries before Stage 6 is needed
- Stage 6 only gets invoked for genuinely novel requests where no prior interaction pattern exists

---

## Key Design Principle

Each stage reduces unnecessary clarifiers through a progressively more capable mechanism:

| Stage | Mechanism | Cost | Clarifier reduction |
|-------|-----------|------|-------------------|
| 4 | Better select/clarify decisions | 1 LLM call | Fewer wrong clarifiers |
| 5 | Replay prior validated resolutions | Vector lookup | Skip LLM entirely for known patterns |
| 6 | Independent tool-assisted resolution | N LLM calls + tools | Handle genuinely novel cases |

The agentic architecture (Stage 6) is the last resort, not the next step. Most user interactions should be resolved by Stages 4-5 before reaching Stage 6.

---

## Eval Requirements Per Stage

Each stage adds its own automated eval layer:

- **Stage 4**: Selector accuracy, confidence distribution, latency, rejection rates
- **Stage 5**: Semantic recall precision, staleness validation accuracy, replay success rate, false-positive replay rate
- **Stage 6**: Unnecessary clarifier rate, tool-call efficiency, wrong-action rate, latency, recovery behavior

Manual testing transitions to sampling; automation becomes the backbone.

---

## Relationship to Existing Plans

- Stage 4 design: `stage4-bounded-llm-optimize-design.md`
- Phase 3c (B2 clarifier assist): `semantic-memory-clarifier-assist-plan.md`
- Multi-layer routing plan: `multi-layer-routing-reliability-plan-v3_5.md`
- This note does not modify any existing stage contracts. It captures the ordering rationale only.
