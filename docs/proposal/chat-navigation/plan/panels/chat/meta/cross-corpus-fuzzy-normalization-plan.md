# Cross-Corpus Fuzzy Normalization (Polish)

**Date:** 2026-01-21
**Status:** Implemented
**Implementation Report:** `reports/2026-01-21-cross-corpus-fuzzy-implementation.md`
**Scope:** Cross-corpus retrieval only (docs + notes)
**Related:** `unified-retrieval-prereq-plan.md` (Prereq 4)

---

## Goal

Make cross-corpus ambiguity pills appear even when the user’s query has a typo,
so the UX is consistent with the non-typo path. The system already recovers via
meta‑explain/doc routing; this change is polish for consistency.

---

## Non‑Goals

- No changes to doc retrieval scoring/HS1/HS2/HS3.
- No new LLM calls.
- No change to meta‑explain routing.
- No changes to notes indexing or retrieval schemas.

---

## Current Behavior (Why This Exists)

- Cross-corpus retrieval uses exact tokens.
- Typos (e.g., “workaspce”) yield docs_score=0, notes_score=0 → fallthrough.
- The query then gets handled by doc routing + HS3, which is correct but inconsistent
  with the pills UI shown for the correct spelling.

---

## Proposed Behavior

- Apply a light, deterministic typo normalization **before cross-corpus retrieval**.
- Use the existing fuzzy matcher (from TD‑2) and the same guardrails:
  - Only when no exact known term match is found.
  - Token length ≥ 5.
  - Levenshtein distance ≤ 2.
  - Only for cross‑corpus path (not global routing).

If a correction is found, run cross‑corpus retrieval with the corrected query,
but keep the original user input for display/telemetry.

**Integration point:** apply normalization inside `handleCrossCorpusRetrieval()`  
**before** calling `queryCrossCorpus()`.

**Matcher reference:** reuse TD‑2 fuzzy matcher from `lib/chat/query-patterns.ts`.

**Notes handling:** normalization is based on doc known‑terms. If a correction is
found, the corrected query is sent to both corpora. Notes FTS may still miss
some typos; that is acceptable for this polish phase.

---

## Decision Rules

Apply fuzzy normalization **only when**:
1) The query is eligible for cross‑corpus evaluation (intent is term‑only or none), **and**
2) There is no exact match to known doc terms, **and**
3) A fuzzy match exists for at least one token.

Skip fuzzy normalization when:
- Explicit notes intent is present ("my notes", "search notes") AND a notes‑only
  retrieval is already going to run.
- Explicit docs intent is present ("in the docs") and notes should be skipped.

---

## Telemetry (Additions)

Log these fields in CrossCorpus telemetry:
- `cross_corpus_fuzzy_applied` (boolean)
- `cross_corpus_fuzzy_token` (string, optional)
- `cross_corpus_fuzzy_term` (string, optional)
- `cross_corpus_fuzzy_distance` (number, optional)

---

## Acceptance Tests

1) **Typo with both corpora**
   - Query: "what is workaspce"
   - Expected: pills shown (Docs vs Notes)

2) **Correct spelling**
   - Query: "what is workspace"
   - Expected: pills shown (existing behavior)

3) **Explicit notes intent**
   - Query: "search my notes for workaspce"
   - Expected: notes result (no pills), fuzzy used only if needed

4) **Short token**
   - Query: "x" or "ui"
   - Expected: no fuzzy normalization

---

## Rollout / Safety

- Feature flag: `NEXT_PUBLIC_CROSS_CORPUS_FUZZY=false` by default.
- If telemetry shows false positives or user confusion, disable quickly.

---

## Rationale

This is polish: it removes a UX inconsistency without changing core retrieval.
The fallback path already works; this simply aligns typo behavior with the
standard pills UX.
