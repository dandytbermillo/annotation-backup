# Interface Weak-Match Fix Plan

**Date:** 2026-01-19
**Status:** Implemented
**Scope:** Doc retrieval quality (weak match handling)  
**Related:** `general-doc-retrieval-routing-plan.md`

---

## Problem

Queries like “tell me about the interface” route to docs via the semantic fallback,
but retrieval returns weak matches (e.g., “Dashboard > Example questions”). This is
mechanically correct but low‑quality for users.

---

## Goal

Avoid low‑quality doc responses for vague UI terms like “interface” when no strong
doc match exists.

---

## Non‑Goals

- No changes to semantic fallback gating or timeouts.
- No changes to HS1/HS2 snippet selection logic.
- No new embeddings or unified retrieval work.

---

## Investigation (Before Implementation)

- Query real retrieval scores for strong vs weak matches.
- Verify that “explain interface” returns `weak` with low score.

---

## Options

### Option A — Confidence Threshold for Weak Matches (Preferred)

If retrieval confidence is below a threshold for doc results:
- show a clarification (“Do you mean Dashboard or Navigation?”), or
- fall back to app‑help LLM response.

**Initial rule:** when `status === 'weak'` **and** `score < 2`, trigger clarification/fallback.

**Pros:** Low risk, predictable behavior.  
**Cons:** Requires an explicit threshold decision.

---

### Option B — Alias Mapping for “interface” (Only if real doc target exists)

Map “interface” → a specific doc section (e.g., `dashboard` or `home`).

**Pros:** Fast, deterministic.  
**Cons:** Brittle if docs don’t actually describe “interface.”  
**Note:** Defer unless docs explicitly add “interface” content.

---

### Option C — Treat “interface” as app‑help (No doc retrieval)

If no strong doc match exists, route to LLM response (app‑help) instead of weak doc.

**Pros:** Avoids weak matches entirely.  
**Cons:** Less grounded if a doc exists but is missed.

---

## Recommendation

Start with **Option A** (threshold + clarify), then add Option B only if docs
explicitly define “interface.”

---

## Implementation Approach (Preferred)

- After doc retrieval, check `status` and top result `score`.
- If `status === 'weak'` **and** `score < 2`, show clarification instead of returning the weak doc.
- Clarification UX: two pills preferred (e.g., “Dashboard”, “Navigation”) plus an implicit “Other” via free input.

---

## Threshold Calibration (Optional)

- Revisit the `score < 2` threshold after collecting real score distributions.
- Adjust upward if weak matches still pass, or downward if too many good results are blocked.

---

## Acceptance Tests

1) **Interface query**
   - Input: “tell me about the interface”
   - Expected: clarification or app‑help response; no “Example questions” doc.
   - Retrieval status should be `no_match` or `weak` with `score < 2`.

2) **Dashboard query**
   - Input: “tell me about the dashboard”
   - Expected: doc response with “Dashboard > Overview”.

3) **Navigation query**
   - Input: “how does navigation work”
   - Expected: doc response with “Navigation Actions > Overview”.

---

## Open Questions

- ~~What is the minimum confidence threshold for "weak" doc responses?~~ → Resolved: Using `score < 2` instead of confidence
- ~~Should clarification provide 2 pills (Dashboard vs Navigation), or a free‑form question?~~ → Resolved: Free-form clarification for rejected weak matches

---

## Implementation Notes (2026-01-19)

**File:** `lib/chat/doc-routing.ts` (lines 1195-1214)

**Change:** Added weak-match quality gate:
```typescript
const WEAK_SCORE_MIN = 2
if (topResult.score < WEAK_SCORE_MIN) {
  // Show clarification message instead of weak doc result
}
```

**Behavior:** When `status === 'weak'` AND `score < 2`, rejects the weak match and shows a clarification prompt instead of the low-quality doc result.

---

## Follow‑Up (Optional)

**Problem:** After aliasing “interface → dashboard,” `Entry > Overview` can still compete because it contains “dashboard.”

**Potential fix:** Add a small score boost when a query term is replaced by an alias target (e.g., +1 to the alias target doc).

**Expected effect:** Keeps the primary doc (Dashboard) at the top without changing global scoring.
