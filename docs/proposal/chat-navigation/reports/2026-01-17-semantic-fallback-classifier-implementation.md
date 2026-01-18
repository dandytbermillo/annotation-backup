# Semantic Fallback Classifier Implementation Report

**Date:** 2026-01-17
**Feature:** Semantic Fallback Classifier (General Doc Retrieval Routing Plan v5)
**Status:** Complete and Verified
**Commit:** `ed58805e`

---

## Overview

Implemented and tuned the semantic fallback classifier for doc-style queries that fail the deterministic app relevance gate. The classifier enables routing of borderline queries (e.g., "describe the settings") to appropriate handling based on LLM classification of intent and domain.

### Related Documents

- Plan: `docs/proposal/chat-navigation/plan/panels/chat/meta/general-doc-retrieval-routing-plan.md` (v5)
- Classifier endpoint: `app/api/chat/classify-route/route.ts`
- Routing logic: `lib/chat/doc-routing.ts`

---

## Problem Statement

Doc-style queries like "describe the settings" were incorrectly routed to the LLM fallback path instead of doc retrieval because:

1. **App relevance gate failure:** `routeDocInput()` returns `'llm'` early when query tokens don't match `knownTerms` (e.g., "settings" is not a known doc term)
2. **Timeout too aggressive:** The semantic classifier was timing out before OpenAI could respond
3. **Missed doc-style detection:** The doc-style gate (`isDocStyle`) relied on `docRoute === 'doc'`, which was already `'llm'` due to the app relevance gate

### User-Visible Symptom

Query "describe the settings" returned generic LLM redirect message instead of attempting doc retrieval or asking clarifying questions.

---

## Solution

### 1. Split Timeout Strategy

Introduced separate timeout budgets for different query types:

| Path | Timeout | Rationale |
|------|---------|-----------|
| General LLM fallback | 800ms | Quick fallback for clearly non-app queries |
| Doc-style queries | 1500ms | Higher budget for queries with doc intent patterns |

### 2. Doc-Style Pattern Detection

Added independent doc-style pattern detection in the LLM fallback path:

```typescript
const isDocStylePattern = isDocStyleQuery(trimmedInput, uiContext)
const classifierResult = await runSemanticClassifier(
  trimmedInput,
  docRetrievalState?.lastDocSlug,
  docRetrievalState?.lastTopicTokens,
  isDocStylePattern ? SEMANTIC_FALLBACK_TIMEOUT_DOC_STYLE_MS : SEMANTIC_FALLBACK_TIMEOUT_MS
)
```

This ensures queries with doc-style patterns (e.g., "describe X", "explain X", "what is X") get the higher timeout even when they fail the app relevance gate.

---

## Changes Made

### File: `lib/chat/doc-routing.ts`

| Location | Change |
|----------|--------|
| Lines 45-46 | Added split timeout constants |
| Line 67 | Modified `runSemanticClassifier()` to accept `timeoutMs` parameter |
| Lines 534-541 | Added doc-style pattern detection and conditional timeout selection |

#### Code Changes

**Timeout Constants (lines 45-46):**
```typescript
const SEMANTIC_FALLBACK_TIMEOUT_MS = Number(
  process.env.NEXT_PUBLIC_SEMANTIC_FALLBACK_TIMEOUT_MS ?? 800
)
const SEMANTIC_FALLBACK_TIMEOUT_DOC_STYLE_MS = Number(
  process.env.NEXT_PUBLIC_SEMANTIC_FALLBACK_TIMEOUT_DOC_STYLE_MS ?? 1500
)
```

**Parameterized Classifier Function (line 67):**
```typescript
async function runSemanticClassifier(
  userMessage: string,
  lastDocSlug?: string,
  lastTopicTokens?: string[],
  timeoutMs: number = SEMANTIC_FALLBACK_TIMEOUT_MS
): Promise<{...}>
```

**Conditional Timeout in LLM Fallback Path (lines 534-541):**
```typescript
// Use higher timeout for doc-style queries that failed app relevance gate
// (e.g., "describe the settings" has doc-style pattern but "settings" not in knownTerms)
const isDocStylePattern = isDocStyleQuery(trimmedInput, uiContext)
const classifierResult = await runSemanticClassifier(
  trimmedInput,
  docRetrievalState?.lastDocSlug,
  docRetrievalState?.lastTopicTokens,
  isDocStylePattern ? SEMANTIC_FALLBACK_TIMEOUT_DOC_STYLE_MS : SEMANTIC_FALLBACK_TIMEOUT_MS
)
```

---

## Timeout Tuning History

| Iteration | Timeout | Observed Latency | Result |
|-----------|---------|------------------|--------|
| Initial | 500ms | 501ms | Timeout (100%) |
| Bump 1 | 800ms | 800-802ms | Timeout |
| Bump 2 | 1200ms | 1200-1501ms | Timeout (edge case) |
| **Final** | **1500ms** | **1461-1483ms** | **Success** |

The OpenAI API (`gpt-4o-mini`) consistently responds in ~1400-1500ms for the classifier prompt. The 1500ms budget provides minimal headroom (~2-3%).

---

## Verification

### Telemetry Evidence

Query: "describe the settings"

```
created_at                    | sc_called | sc_timeout | sc_latency | sc_intent   | sc_domain | sc_conf | route
------------------------------|-----------|------------|------------|-------------|-----------|---------|------
2026-01-17 21:57:39.607852+00 | true      | false      | 1461       | doc_explain | app       | 0.8     | doc
2026-01-17 21:57:30.662635+00 | true      | false      | 1483       | doc_explain | app       | 0.8     | doc
```

### Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Classifier called for doc-style LLM queries | Pass | `semantic_classifier_called = true` |
| Classifier completes without timeout | Pass | `semantic_classifier_timeout = false` |
| Returns valid classification | Pass | `intent=doc_explain, domain=app, confidence=0.8` |
| Routes to doc retrieval when appropriate | Pass | `route_final = doc` |
| UI shows clarifying response | Pass | "Which part would you like me to explain?" |

### Smoke Tests

| Test Case | Expected | Actual | Status |
|-----------|----------|--------|--------|
| "describe the settings" | Classifier runs, routes to doc or asks clarification | "Which part would you like me to explain?" | Pass |
| "what is workspace" | Doc retrieval (known term) | Doc content returned | Pass |
| "tell me more" | Follow-up handler | Follow-up handled | Pass |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_SEMANTIC_FALLBACK_ENABLED` | `true` | Enable/disable semantic classifier |
| `NEXT_PUBLIC_SEMANTIC_FALLBACK_TIMEOUT_MS` | `800` | Timeout for general LLM path |
| `NEXT_PUBLIC_SEMANTIC_FALLBACK_TIMEOUT_DOC_STYLE_MS` | `1500` | Timeout for doc-style queries |
| `NEXT_PUBLIC_SEMANTIC_FALLBACK_CONFIDENCE_MIN` | `0.7` | Minimum confidence threshold |

---

## Classifier Contract

The classifier endpoint (`/api/chat/classify-route`) returns:

```typescript
{
  domain: 'app' | 'general',
  intent: 'doc_explain' | 'action' | 'search_notes' | 'other',
  confidence: number,  // 0.0 - 1.0
  rewrite?: string,
  entities?: {
    docTopic?: string,
    widgetName?: string,
    noteQuery?: string
  },
  needs_clarification: boolean,
  clarify_question?: string
}
```

### Routing Logic

- `domain=app` + `intent=doc_explain` + `confidence >= 0.7` + `!needs_clarification` → Route to doc retrieval
- `domain=app` + `intent=action` → Route to action handler
- `domain=general` → Route to general LLM response
- `confidence < 0.7` or `needs_clarification=true` → Ask clarifying question

---

## Telemetry Fields

All classifier-related telemetry is logged to `debug_logs` with `action = 'route_decision'`:

| Field | Type | Description |
|-------|------|-------------|
| `semantic_classifier_called` | boolean | Whether classifier was invoked |
| `semantic_classifier_intent` | string | Classified intent |
| `semantic_classifier_domain` | string | Classified domain |
| `semantic_classifier_confidence` | number | Classification confidence |
| `semantic_classifier_needs_clarification` | boolean | Whether clarification needed |
| `semantic_classifier_timeout` | boolean | Whether classifier timed out |
| `semantic_classifier_latency_ms` | number | Classifier response time |
| `semantic_classifier_error` | boolean | Whether classifier errored |

---

## Monitoring

### Timeout Rate Query

```sql
SELECT
  COUNT(*) FILTER (WHERE metadata->>'semantic_classifier_timeout' = 'true') AS timeouts,
  COUNT(*) FILTER (WHERE metadata->>'semantic_classifier_timeout' = 'false') AS successes,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE metadata->>'semantic_classifier_timeout' = 'true') /
    NULLIF(COUNT(*), 0),
    2
  ) AS timeout_rate_pct
FROM debug_logs
WHERE action = 'route_decision'
  AND metadata->>'semantic_classifier_called' = 'true'
  AND created_at > NOW() - INTERVAL '1 day';
```

### Latency Distribution Query

```sql
SELECT
  MIN((metadata->>'semantic_classifier_latency_ms')::int) AS min_latency,
  AVG((metadata->>'semantic_classifier_latency_ms')::int)::int AS avg_latency,
  MAX((metadata->>'semantic_classifier_latency_ms')::int) AS max_latency,
  PERCENTILE_CONT(0.95) WITHIN GROUP (
    ORDER BY (metadata->>'semantic_classifier_latency_ms')::int
  )::int AS p95_latency
FROM debug_logs
WHERE action = 'route_decision'
  AND metadata->>'semantic_classifier_called' = 'true'
  AND metadata->>'semantic_classifier_latency_ms' IS NOT NULL
  AND created_at > NOW() - INTERVAL '1 day';
```

### Recommended Actions

| Condition | Action |
|-----------|--------|
| Timeout rate > 10% | Increase `SEMANTIC_FALLBACK_TIMEOUT_DOC_STYLE_MS` to 1800ms |
| p95 latency > 1400ms | Consider 1800ms timeout proactively |
| Classifier errors increasing | Check OpenAI API status, API key validity |

---

## Risks and Limitations

1. **Latency sensitivity:** Current 1500ms timeout has ~2-3% headroom. API slowdowns may cause timeouts.
2. **Cost:** Each classifier call invokes OpenAI API (~$0.0001-0.0002 per call with gpt-4o-mini).
3. **Single point of failure:** If classifier times out, query falls back to LLM redirect (graceful degradation).

---

## Future Considerations

1. **Timeout adjustment:** Monitor and adjust to 1800ms if timeout rate increases.
2. **Caching:** Consider caching classifier results for repeated queries.
3. **Model optimization:** Evaluate faster models or prompt optimization if latency is problematic.

---

## Related Work

- **Completed:** v5 Core (HS1/HS2, routing, metrics)
- **Next recommended:** HS3 bounded formatting (LLM excerpt-only)
- **Blocked:** Unified retrieval (requires indexing/permissions)

---

## Appendix: Full Routing Flow

```
User Input: "describe the settings"
    │
    ▼
normalizeInputForRouting()
    │ normalized: "describe the settings"
    │ tokens: ["describe", "the", "settings"]
    │
    ▼
routeDocInput()
    │ Check app relevance gate
    │ → "settings" not in knownTerms
    │ → No fuzzy match
    │ → Returns 'llm'
    │
    ▼
handleDocRetrieval()
    │ docRoute = 'llm'
    │ isDocStyle = false (because docRoute !== 'doc')
    │
    ▼
LLM Fallback Path (line 527-541)
    │ Condition: docRoute === 'llm' ✓
    │
    │ isDocStylePattern = isDocStyleQuery("describe the settings")
    │ → "describe" is in DOC_VERBS
    │ → Returns true
    │
    │ Classifier called with 1500ms timeout
    │
    ▼
runSemanticClassifier()
    │ POST /api/chat/classify-route
    │ Response: { domain: "app", intent: "doc_explain", confidence: 0.8 }
    │ Latency: ~1461ms
    │
    ▼
Classifier Result Processing
    │ domain=app, intent=doc_explain, confidence=0.8, !needs_clarification
    │ → classifierSuggestedRoute = 'doc'
    │
    ▼
Doc Retrieval Attempt
    │ Query: "describe the settings"
    │ No matching docs for "settings"
    │ → status: 'no_match'
    │
    ▼
Response: "Which part would you like me to explain?"
```
