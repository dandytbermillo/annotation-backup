# TD-7: Stricter App-Relevance Fallback (High-Ambiguity Terms)

**Date:** 2026-01-16
**Status:** Implemented
**Scope:** Routing only (no retrieval changes)
**Related:** `2026-01-14-doc-retrieval-routing-debt-paydown-plan.md`
**Implementation Report:** `reports/2026-01-16-td7-implementation-report.md`

---

## Goal

Reduce false positives for ambiguous terms by asking a single clarifying question
instead of routing straight to doc retrieval when intent is unclear.

---

## Non-Goals

- No changes to retrieval ranking or snippet selection.
- No always-on LLM intent classifier.
- No notes/files routing in this phase.

---

## Preconditions

- TD-1 completed (knownTerms only, SSR snapshot).
- TD-4 telemetry enabled (route decision logging).

---

## High-Ambiguity Term List (Initial)

Start small and feature-flagged:

- `home`
- `notes`
- `note`
- `action`
- `actions`

This list should be revised from telemetry after rollout.

---

## Decision Rule

Apply stricter app-relevance only when **all** are true:

1) Input contains a **high-ambiguity term** (above list).
2) No explicit doc-style cues (no "what is", "explain", "how do I", etc.).
3) No action command-like intent.
4) No active clarification state.

If triggered:
- Show a single clarification question with **2 options max**.

---

## Trigger Point in Routing

TD-7 clarification applies at:

- **Step 6 (bare noun route):** single high-ambiguity term like `home` or `notes`
- **Step 7 (app-relevant fallback):** longer queries that only match high-ambiguity terms

Does **not** apply to:

- **Step 5 (doc-style):** explicit intent cues (e.g., "what is", "explain")
- **Steps 2–4 (action routes):** command-like or action intent

---

## Clarification UX

Example for "home":

```
Do you mean Home (dashboard) in this app, or something else?
[Home (Dashboard)] [Something else]
```

Example for "notes":

```
Are you asking about Notes in this app?
[Notes (App)] [Something else]
```

Behavior:
- If user selects the app option → proceed with doc retrieval.
- If user selects "Something else" → route to LLM/general chat.

---

## Feature Flag

Gate behind a flag for safe rollout:

- `STRICT_APP_RELEVANCE_HIGH_AMBIGUITY=true`

Rollout plan:
1) Enable in dev/staging
2) Monitor correction rate + clarification success
3) Enable in prod if metrics improve

---

## Telemetry Additions

Add to routing telemetry:

- `strict_app_relevance_triggered` (boolean)
- `strict_term` (string)
- `clarification_option_count`
- `clarification_selected` (string or null)

Track success:
- `clarification_success_rate`
- `correction_rate` after clarification

---

## Acceptance Tests

1) **Ambiguous term (home)**
   - Input: `home`
   - Output: clarification with 2 options

2) **Doc-style query bypass**
   - Input: `what is home`
   - Output: doc retrieval (no clarification)

3) **Action command bypass**
   - Input: `open notes`
   - Output: action route (no clarification)

4) **User selects app option**
   - Input: `notes` → select "Notes (App)"
   - Output: doc retrieval response

5) **User selects something else**
   - Input: `notes` → select "Something else"
   - Output: LLM/general response

---

## Risks and Mitigations

- **Risk:** Under-routing real app queries  
  **Mitigation:** Small term list + feature flag + telemetry monitoring.

- **Risk:** Extra friction  
  **Mitigation:** One question max, two options max, only for high-ambiguity terms.
