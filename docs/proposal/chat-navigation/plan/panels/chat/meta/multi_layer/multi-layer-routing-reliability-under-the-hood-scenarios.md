# Multi-Layer Routing Reliability: Under-the-Hood Behavior and Scenarios

## Purpose

This document explains how the v3.5 routing plan behaves at runtime, why each layer exists, and how the safety rules interact in real situations.

Core policy remains:
- Not exact -> never deterministic execute.
- Non-exact -> bounded LLM; if unresolved -> safe clarifier.

## Mental Model

Think of the system as five lanes plus guardrails:
- Lane A: tiny deterministic fast lane for provable exact matches only.
- Lane B: memory retrieval lane (B1 exact memory, B2 semantic memory).
- Lane C: validator gate (scope, drift, permissions, ambiguity, idempotency).
- Lane D: bounded selector over validated candidates only.
- Lane E: safe clarifier (prefer clickable options with stable payload IDs).

Lane D has two bounded modes:
- selector mode: choose among validated candidates only
- planner mode: produce multi-intent proposal-only plan (execution still requires per-step validation and normal commit guards)

Execution authority is never given to retrieval or free-form model output. Execution happens only after validation and commit-time freshness checks.

## What the System Stores and Why

The system stores two classes of records:
1. Durable audit log (full trace): useful for incident analysis and policy verification.
2. Serving index (minimal retrieval payload): optimized for fast reuse.

For safety and replay correctness, each decision uses:
- Query fingerprints (raw + normalized, versioned).
- Context fingerprint from a compact snapshot.
- Risk tier and provenance metadata.
- Effective model/config versions used during that turn.

For performance, embeddings can be reused from a session cache keyed by tenant/user/session/query/model/normalization version.

## Runtime Flow (Operational)

1. Build current snapshot and context fingerprint.
2. Try Lane A exact checks.
3. If unresolved, query Lane B:
   - B1 exact memory lookup.
   - B2 semantic retrieval (capped topK).
4. Run Lane C validator on candidate set.
5. If exact-source candidate is uniquely valid, proceed toward execution.
6. If source is non-exact, call Lane D bounded selector.
7. Before commit, run TOCTOU revalidation against freshest snapshot.
8. Execute through idempotent executor (mutation intents at-most-once).
9. If unresolved anywhere, use Lane E clarifier.

## Determinism Boundaries

Deterministic execution is intentionally narrow:
- Allowed: strict exact label/ID, strict whole-input ordinal, exact-memory key with strict compatibility.
- Disallowed: fuzzy/partial/semantic matches, embedded ordinals in noisy sentences, canonicalization-only matches.

This keeps deterministic behavior predictable and prevents accidental overreach.

## Scenario 1: Exact Command (Fast Path)

User input: exact item label with stable scope.

Behavior:
- Lane A matches exactly.
- Lane C confirms scope/permissions/target existence.
- TOCTOU check passes.
- Execute once via idempotent executor.

Expected outcome:
- Fast response.
- Deterministic provenance.

## Scenario 2: Non-Exact Query with Reusable Memory

User input: paraphrased command that previously succeeded.

Behavior:
- Lane A fails (not exact).
- Lane B finds memory candidates (exact or semantic).
- Lane C validates candidates in current snapshot.
- If semantic/non-exact source remains, Lane D selects from bounded candidates.
- TOCTOU check then execution.

Expected outcome:
- Reuse benefit without violating non-exact policy.
- If Lane D cannot decide, safe clarifier appears.

## Scenario 3: Semantic Near-Tie (Wrong-Pick Prevention)

User input maps closely to two similar candidates.

Behavior:
- Lane B2 returns top candidates with close scores.
- Near-tie margin rule triggers ambiguity.
- No auto-select.
- Lane E clarifier asks user to choose.

Expected outcome:
- Avoids silent wrong execution.
- User resolves ambiguity through clickable options.

## Scenario 4: Clarifier Reply Handling (No "yes" Misrouting)

User gets clarifier with option pills and replies next turn.

Behavior:
- Pending clarifier lock is active for one turn.
- Reply is resolved before ordinal/free-form parsing.
- Resolver accepts payload ID or ordinal mapped to active option set.
- Affirmation-only or non-mapping replies remain clarifier-only.

Expected outcome:
- No accidental treatment of "yes" as search query.
- No stale option set reuse after TTL/drift/new-command conditions.

## Scenario 5: User Starts a New Command During Clarifier

User is mid-clarifier but sends a command-shaped new imperative.

Behavior:
- New-command detector checks command shape plus non-match to clarifier payloads.
- Pending clarifier clears.
- Routing resumes normal command handling.

Expected outcome:
- Clarifier does not trap the user.
- Intent switching is explicit and safe.

## Scenario 6: Multi-Intent Request with Mixed Risk

User asks for two actions: one low risk, one high risk.

Behavior:
- Lane D bounded LLM decomposition returns structured plan proposal.
- Lane C validates each step.
- Plan preview is shown if any step is high risk.
- Low-risk subset can execute under policy mode.
- High-risk step requires explicit confirmation.

Expected outcome:
- Predictable partial execution behavior.
- No hidden high-risk auto-execution.

## Scenario 7: TOCTOU Drift at Commit Time

Target was valid during pre-check but changed before execution commit.

Behavior:
- Commit-time revalidation detects drift.
- Action intent: no rerun, go straight to clarifier.
- Info intent: one bounded Lane C rerun on existing candidates only.
- If rerun empties candidate set, no re-retrieval; clarifier.

Expected outcome:
- No stale execution.
- Bounded retry behavior, not looping behavior.

## Scenario 8: Retry or Duplicate Delivery

Same mutation decision is retried due to network/timeouts.

Behavior:
- Idempotency key (interaction + step + chosen target + tool action) is checked.
- Duplicate returns previously committed result.
- No second mutation commit.

Expected outcome:
- At-most-once mutation behavior.
- Stable user-visible result under retries.

## Scenario 9: Large Candidate Set

Semantic retrieval yields many plausible candidates.

Behavior:
- B2 topK is capped.
- Validated candidate count passed to Lane D is capped.
- Deterministic rank+trim applies canonical order and tie-break.

Expected outcome:
- Bounded prompt size.
- Reproducible candidate order for same input/snapshot.

## Scenario 10: Clarifier Enumeration Too Large

Unresolved set is too large to show directly.

Behavior:
- Clarifier option cap is enforced.
- System uses narrowing prompts in deterministic order: scope -> type -> recency.
- Each answer must reduce candidate set or escalate.

Expected outcome:
- Progressive narrowing instead of noisy option dumps.

## Configuration and Governance

Safety-sensitive configs (thresholds, margins) are versioned and logged per decision.
- Per-tenant overrides are allowlisted, clamped to safe min/max, and audited.
- Unsafe override attempts are rejected.

Thresholds are model/version dependent and calibrated using a labeled offline set.

## Privacy and Deletion Behavior

Before durable persistence:
- Sensitive values in raw query and context snapshot are redacted/hashed as required.

Retention/deletion propagates across:
- Durable logs,
- Serving index/vector store,
- Embedding/session caches (including replicas),
with auditable traces.

## Observability: How You Know It Is Working

Key signals:
- Deterministic success rate.
- Memory hit split (exact vs semantic).
- Validator rejection reasons.
- Lane D need-more-info rate.
- Clarifier loop rate.
- TOCTOU failure rate by intent class.
- Duplicate suppression rate.
- Clickable clarifier adoption vs free-text fallback.

These metrics make policy violations and drift visible quickly.

## Practical Implementation Guidance

To keep behavior consistent across engineers:
- Use one shared grammar/vocabulary module for command and affirmation parsing.
- Use one canonical ranking order for trimming candidates.
- Use one canonical ambiguity definition and near-tie margin source.
- Treat every non-exact path as Lane D/Lane E territory, never deterministic execute.

The plan is designed so reliability improves by adding validated memory and bounded disambiguation, not by expanding fragile deterministic heuristics.
