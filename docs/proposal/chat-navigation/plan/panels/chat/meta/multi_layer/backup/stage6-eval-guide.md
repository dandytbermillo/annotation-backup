# Stage 6 Eval Monitoring — Interpretation Guide

**Date**: 2026-03-11
**Companion file**: `stage6-eval-queries.sql`
**Design note**: `stage6-agent-tool-loop-design.md` §6, §7b

---

## How to run

All queries are in `stage6-eval-queries.sql`. Run against `annotation_dev` (or production read-replica):

```bash
docker exec annotation_postgres psql -U postgres -d annotation_dev -f stage6-eval-queries.sql
```

Or run individual queries by section (§1–§7). Each section is self-contained.

Default time window: `now() - interval '24 hours'`. Adjust as needed.

---

## Query-by-query interpretation

### §1 Coverage / Row-Pair Join

**What it tells you**: Of all interactions where Stage 4 abstained or timed out, how many actually fired a shadow loop?

- **coverage_pct < 50%**: Shadow loop is silently failing for most eligible interactions. Check: feature flag, network errors, client-side guard (`typeof window === 'undefined'`), AbortController timeouts.
- **coverage_pct > 90%**: Healthy. Most eligible interactions produce a shadow row.
- **eligible count = 0**: No Stage 4 abstains/timeouts in the time window — deterministic tiers are resolving everything.

### §2 Outcome Distribution

**What it tells you**: What does the shadow loop decide to do?

- **High `action_executed`**: S6 is confident and acting. Good signal for 6.5 enforcement readiness.
- **High `abort`**: S6 is giving up often. Check §4 for why.
- **High `action_rejected`**: S6 is emitting actions that fail validation. Check §5 for rejection reasons — likely model hallucination (6.7 tuning issue).
- **High `clarification_accepted`**: S6 is punting to clarifiers as much as Stage 4. Not adding value yet.

### §3 Inspect-Round Distribution

**What it tells you**: How many tool calls before the loop terminates.

- **0 rounds dominant**: Model decides immediately without inspecting — either fast clarify/abort, or model is not using tools.
- **1–2 rounds**: Normal. Model inspects then acts.
- **3+ rounds**: Model is looping — consider tightening `maxInspectRounds` or improving prompt.
- **Target**: Average < 2.0 (design note §6a).

### §4 Abort Reason Breakdown

**What it tells you**: Why the model gave up. Important to distinguish:

| Abort reason pattern | Meaning |
|---------------------|---------|
| `max_rounds_exhausted` (s6_outcome) | Budget exhaustion — model kept inspecting but never decided. Prompt or constraint issue. |
| Timeout-related string in s6_abort_reason | Wall-clock limit hit — Gemini API too slow or too many rounds. |
| Model-authored text (e.g., "Could not find the budget report.") | Model chose to abort — no matching data found via inspect tools. Expected for vague queries. |
| `Unparseable...` | LLM returned non-JSON. Prompt or model reliability issue. |

### §5 Action Rejection Reason Breakdown

**What it tells you**: When S6 emits an action, why does validation fail?

| Rejection reason | What it means |
|-----------------|---------------|
| `entry_not_found` | Model emitted an entry ID that doesn't exist in DB. Usually: hallucinated ID instead of copying from inspect result. |
| `permission_denied` | Entry exists but doesn't belong to user's workspace. |
| `panel_not_registered` | Panel slug doesn't match any widget in the dashboard snapshot. |
| `widget_not_open` | Widget ID not present in dashboard snapshot. |
| `target_not_found` | Item ID not present in the widget's visible items snapshot. |

**High rejection rate with `entry_not_found`**: Model ID hallucination problem. Address in 6.7 via prompt hardening or structured output constraints.

### §6 Latency

**What it tells you**: How long the shadow loop takes.

- **Targets** (design note §6a): p50 < 1s, p95 < 3s.
- **Shadow mode latency is higher than enforcement will be**: Shadow mode includes client→server round-trip + Gemini API call(s). Enforcement mode (6.5) may optimize by skipping some round-trips.
- **Latency by outcome**: Actions with inspect rounds are slower than immediate clarify/abort.

### §7 Disagreement Categories

**The core eval signal.** Read this first when evaluating S6 readiness.

| Category | Meaning | Action |
|----------|---------|--------|
| `disagree_s6_would_act` | S6 found a target and would have acted. Main routing showed a clarifier or failed. **This is where S6 adds value.** | High count = S6 is ready to reduce clarifiers in enforcement mode. |
| `disagree_s6_would_clarify` | Main routing gave up entirely (no candidates), but S6 found candidates to clarify about. S6 is better than main, but not by much — it still clarifies. | Moderate value. S6 improves UX by offering options vs dead end. |
| `agree_clarify` | Both agree clarification is needed. S6 is not worse. | Neutral. No action needed. |
| `agree_fail` | Both gave up. The query is genuinely unresolvable. | Neutral. Check if these are expected (vague queries, missing data). |
| `disagree_s6_abort` | S6 gave up, but main routing at least offered a clarifier. S6 is worse. | Concerning. Check abort reasons — may need more tools or better prompts. |
| `disagree_s6_bad_action` | S6 tried to act but picked the wrong target (validation rejected). | Model quality issue. Track in 6.7 tuning. |
| `disagree_s6_exhausted` | S6 burned its inspect budget without deciding. | Constraint or prompt issue. |
| `no_shadow_row` | Eligible interaction but no shadow loop fired. | Coverage gap. See §1. |

---

## Enforcement readiness thresholds

Before enabling 6.5 (enforcement mode), these conditions should hold:

1. **`disagree_s6_would_act` > 20%** of matched pairs — S6 is adding meaningful value.
2. **`disagree_s6_bad_action` < 5%** — model action quality is high enough.
3. **`disagree_s6_abort` < 10%** — S6 is not systematically worse than main routing.
4. **Coverage > 80%** — shadow loop fires reliably.
5. **p95 latency < 3s** — acceptable user-facing latency.

These are starting points, not hard gates. Adjust based on observed patterns.

---

## Known limitations

- **Coverage gap**: Shadow loop fires from client-side only (`typeof window !== 'undefined'` guard). Server-rendered routes or API-only calls won't produce shadow rows.
- **Stale snapshots**: Client-side validators use pre-computed snapshots from loop entry. Dashboard may change during the loop.
- **Model ID hallucination**: Model sometimes fabricates entry IDs instead of copying from inspect results. Tracked as 6.7 tuning issue.
- **Pre-fix null rejection reasons**: Rows written before `s6_action_rejection_reason` was added to the durable log pipeline have null rejection reason despite being rejected. Identifiable by older timestamps.
