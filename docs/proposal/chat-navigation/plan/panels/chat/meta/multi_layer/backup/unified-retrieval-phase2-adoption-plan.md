# Unified Retrieval Phase 2: Adoption Plan

**Date:** 2026-01-21  
**Scope:** Wire `/api/retrieve` into main chat routing so docs + notes are both first‑class sources.

---

## Goals
- Make unified retrieval the default path for corpus‑scoped queries.
- Use cross‑corpus pills when both notes and docs are viable.
- Preserve current docs behavior for explicit docs intent.

## Non‑Goals
- Do not change scoring logic.
- Do not add new UI components beyond existing pills/messages.
- Do not enable `corpus="auto"` in the API (still deferred).

---

## Adoption Steps

### 1) Router Integration
- Insert unified retrieval in the main doc routing path:
  - If explicit notes intent → use notes corpus (no pills).
  - If explicit docs intent → use docs corpus (no notes query).
  - Otherwise → run cross‑corpus decision and show pills when close.

### 2) Follow‑Up Continuity
- Maintain `lastRetrievalCorpus`, `lastResourceId`, and `lastChunkIdsShown`.
- For follow‑ups:
  - Notes corpus uses `/api/retrieve` with `corpus="notes"` and `resourceId`.
  - Docs corpus uses existing docs follow‑up flow.

### 3) Error & Fallback
- On notes retrieval failure, fall back to docs only (per Prereq 5).
- On docs retrieval failure, return the existing LLM fallback response.

---

## Telemetry (Phase 2)
Track:
- `cross_corpus_ambiguity_shown`
- `cross_corpus_choice`
- `notes_fallback_reason`
- `last_retrieval_corpus`

Use existing `CrossCorpus` debug logs unless route‑decision telemetry is expanded.

---

## Acceptance Tests
1) Explicit notes query → notes result only.
2) Explicit docs query → docs result only.
3) Term‑only query with both corpora → pills (Docs vs Notes).
4) Notes selected → follow‑up “tell me more” continues in notes.
5) Notes failure → fallback to docs, notes unavailable message (per Prereq 5).

---

## Rollout
- Dev: enable for all queries.
- Staging: verify telemetry + acceptance tests.
- Prod: gradual rollout if needed (feature flag optional).
