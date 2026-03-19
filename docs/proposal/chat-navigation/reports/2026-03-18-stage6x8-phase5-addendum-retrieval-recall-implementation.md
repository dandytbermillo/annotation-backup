# Stage 6x.8 Phase 5 Addendum — Retrieval Recall + LLM Fallback Implementation Report

**Date:** 2026-03-18
**Status:** Implemented and runtime-verified

## Summary

Extended Phase 5 retrieval-backed semantic memory with three improvements:

1. **Multi-pass retrieval** — raw-query embedding + normalized-query embedding, merged and deduped
2. **Lowered navigation floor** — 0.92 → 0.85 based on measured cosine similarity data
3. **LLM fallback** — when retrieval doesn't confidently resolve, the panel-normalized query reaches the navigate API's bounded LLM instead of being blocked by the tier chain

The key behavioral shift: retrieval is now hinting evidence, not a gate. The bounded LLM is the fallback for conversational phrasing that retrieval doesn't capture. Retrieval saves LLM calls when it's confident; the LLM handles everything else.

**Design doc:** `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-wrapper-heavy-retrieval-recall-addendum.md`

## Changes

### 1. Multi-Pass Retrieval (`semantic-lookup/route.ts`)

After exact-hit misses, the route now runs two embedding passes:

- **Pass 1 (raw):** Embeds the storage-normalized query text against learned + curated seed pools
- **Pass 2 (normalized):** Only when wrapper normalization changed the text — embeds the retrieval-normalized text

Results are merged, deduped by `matched_row_id` (learned) or `(intent_id, target_ids)` (curated), and ranked by best score. Clarified-exemplar penalty (0.85×) applied. Near-tie detection (0.03 threshold) applied after merge.

### 2. Lowered Navigation Floor (`semantic-lookup/route.ts`)

```typescript
const NAVIGATION_SIMILARITY_FLOOR = 0.85  // was 0.92
const HISTORY_INFO_SIMILARITY_FLOOR = 0.80  // unchanged
```

Based on measured data:
- "pls take me home" → 0.9021 against "take me home" seed (now passes 0.85)
- "hey take me home" → 0.8942 (now passes)
- "take me home now pls" → 0.8543 (now passes)

### 3. Retrieval-Only Normalization (`semantic-lookup/route.ts`)

`normalizeForRetrieval()` strips harmless leading wrappers (`hey`, `hi`, `hello`, `please`, `pls`, `ok`, `um`, etc.) and trailing fillers (`thanks`, `thx`, `now pls`, `now please`, etc.). Bare "now" is NOT removable. Punctuation collapsed without cross-type conversion.

### 4. Exact-Hit Shortcut (`semantic-lookup/route.ts`)

Before any embedding, fingerprint-based exact match against learned + curated seed pools. Learned wins over curated. Context-compat rules: navigation learned hits require fingerprint match; history_info and curated seeds don't.

### 5. LLM Fallback — Scope-Based Override (`routing-dispatcher.ts`)

**The main behavioral change.** The Phase 5 pre-tier-chain override now fires based on `detectHintScope()` identifying the scope — regardless of retrieval confidence:

```typescript
if (hintScope) {
  if (hasConfidentHint && phase5NearTie) {
    // Near-tie → clarify directly
  } else {
    // Skip tier chain → panel-normalized query reaches navigate API's LLM
    // Hints attached when available, but not required
    phase5SkippedTierChain = true
  }
}
```

**Before:** Override only fired when retrieval returned a confident candidate above the similarity floor. Wrapper-heavy variants that missed retrieval went through the tier chain → arbiter → clarifier.

**After:** Override fires when scope is detected. The navigate API's LLM classifies the query with or without hints. `normalizeUserMessage` in the panel strips "can you", "i want to", etc. before the LLM sees it, which helps classification.

### 6. Near-Tie Handling (`routing-dispatcher.ts`)

When retrieval returns a confident candidate but the server detects a near-tie (top-2 within 0.03), the dispatcher returns a synthetic clarifier directly — no LLM fallback, no tier chain.

### 7. History_Info Arbiter Exclusion (`routing-dispatcher.ts`)

`detectHintScope() === 'history_info'` inputs skip the cross-surface arbiter. History/info queries resolve from committed session state, not cross-surface UI state.

### 8. Navigate Post-LLM Rescue (`navigate/route.ts`)

When the LLM returns `unsupported` but `phase5_hint_intent` is a v1 intent, remaps to the structured resolver. Also, `detectLocalSemanticIntent` catches "what did I just do?" on `unsupported`.

### 9. Typo Fallback Fix (`navigate/route.ts`)

Second typo-fallback branch now requires `intent.intent === 'unsupported'` — structured resolver errors like "You're already on the Home dashboard" are no longer overwritten by typo suggestions.

### 10. Provenance Badge Fix (`chat-navigation-panel.tsx`)

Recognized-intent errors (e.g., `go_home` → "already home") show **LLM-Influenced** (yellow) instead of **Safe Clarifier** (grey).

### 11. Telemetry

All telemetry fields additive to existing Phase 5 `h1_*` set:

| Field | Purpose |
|-------|---------|
| `h1_exact_hit_used` | Exact-hit shortcut fired |
| `h1_exact_hit_source` | `'learned'` or `'curated_seed'` |
| `h1_retrieval_normalization_applied` | Wrapper normalization changed the text |
| `h1_raw_query_text` | Original user query |
| `h1_retrieval_query_text` | After wrapper normalization |
| `h1_raw_pass_used` | Raw-query embedding pass ran |
| `h1_normalized_pass_used` | Normalized-query embedding pass ran |
| `h1_near_tie` | Top-2 candidates within 0.03 |
| `h1_hints_available_to_llm` | Retrieval returned candidates for the LLM |
| `h1_llm_used_raw_query_fallback` | LLM fallback fired without confident retrieval |

## Test Results

```
$ npx jest --testPathPattern "phase5-|content-intent-dispatcher|state-info-resolvers|routing-log/semantic-lookup"
Test Suites: 8 passed, 8 total
Tests:       176 passed, 176 total
```

| Suite | Tests |
|-------|-------|
| phase5-semantic-lookup-route | 17 |
| phase5-retrieval-normalization | 36 |
| phase5-semantic-hints | 22 |
| phase5-info-intent-write | 7 |
| phase5-pending-promotion | 16 |
| routing-log/semantic-lookup-route (legacy) | 7 |
| content-intent-dispatcher (regression) | 55 |
| state-info-resolvers (regression) | 16 |

Type-check: clean.

## Runtime Verification (Smoke Test — 2026-03-18)

**Setup:** Curated seeds ingested, feature flags enabled, dev server restarted.

| Input | Context | Result | Status |
|-------|---------|--------|--------|
| "can you pls return home" | on Home | "You're already on the Home dashboard." | ✅ |
| "i wnat you to return home" | on Home | "You're already on the Home dashboard." | ✅ |
| "pls take me home now. thank you very much!" | on Home | "You're already on the Home dashboard." | ✅ |
| "can you pls take me home now" | not on Home | "Going home..." Auto-Executed | ✅ |
| "okay. can you pls take me home now?" | on Home | "You're already on the Home dashboard." | ✅ |
| "hi there take me home" | on Home | "You're already on the Home dashboard." | ✅ |
| "hey take me home now" | on Home | "You're already on the Home dashboard." | ✅ |
| "hello can you take me home?" | on Home | "You're already on the Home dashboard." | ✅ |
| "open recent widget" | — | "Opening Recent..." Auto-Executed | ✅ |
| "open budget100" | — | Opening entry (Memory-Exact) | ✅ |
| "which note is open right now?" | workspace | "The open note is Main Document." (Content Answer) | ✅ |
| "summarize it for me" | note open | Content answer with sources | ✅ |

All previously failing wrapper variants now resolve correctly via the LLM fallback path.

## Files Modified

| File | Change |
|------|--------|
| `app/api/chat/routing-memory/semantic-lookup/route.ts` | Multi-pass retrieval, normalization, exact-hit, lowered floor, near-tie, merge/dedupe |
| `lib/chat/routing-dispatcher.ts` | Scope-based override (LLM fallback), near-tie clarifier, history_info arbiter exclusion, telemetry |
| `app/api/chat/navigate/route.ts` | Post-LLM rescue, typo fallback fix, Phase 5 pending write |
| `components/chat/chat-navigation-panel.tsx` | Provenance badge fix, hint forwarding, pending write handoff |
| `lib/chat/routing-log/payload.ts` | All addendum telemetry fields |
| `app/api/chat/routing-log/route.ts` | Telemetry builder |
| `lib/chat/routing-log/memory-semantic-reader.ts` | Parse addendum telemetry from response |
| `scripts/measure-embedding-similarity.ts` | **NEW** — cosine similarity measurement tool |
| `__tests__/unit/chat/phase5-semantic-lookup-route.test.ts` | Route-level tests (exact-hit, multi-pass, dedupe, near-tie, floor) |
| `__tests__/unit/chat/phase5-retrieval-normalization.test.ts` | Normalization unit tests |
| `__tests__/unit/routing-log/semantic-lookup-route.test.ts` | Legacy test fixes (sha256Hex mock, matched_row_id) |

## Known Limitations

1. **Panel-normalized query, not literal raw input.** `normalizeUserMessage` in the panel strips conversational prefixes ("can you", "i want to", "could you") before the navigate API sees the query. This is broader than Phase 5 retrieval normalization and helps LLM classification. The bounded LLM receives the panel-normalized query, not the literal untouched user input.
2. **`detectHintScope` is v1-narrow** — only covers "what did I / did I" for history and "go/take/return/back home" for navigation. Broader scope detection would let the LLM handle more intent families.
3. **No v1 navigation writeback yet** — successful `go_home` executions don't produce pending writes for the exemplar store.
4. **Near-tie comparison classes** — currently empty set (all near-ties clarify directly). A future policy could allow bounded LLM comparison for specific tie classes.
