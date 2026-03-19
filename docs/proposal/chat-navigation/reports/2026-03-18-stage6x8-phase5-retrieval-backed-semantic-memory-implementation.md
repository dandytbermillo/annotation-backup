# Stage 6x.8 Phase 5 — Retrieval-Backed Semantic Memory Implementation Report

**Date:** 2026-03-18
**Status:** Implemented, unit-tested, not yet runtime-verified

## Summary

Phase 5 adds retrieval-backed semantic hinting to the routing pipeline for two scopes:
- **History/info**: `last_action`, `explain_last_action`, `verify_action`
- **Navigation**: `go_home`, `open_entry`, `open_workspace`, `open_panel`

Retrieval supplies intent hints to the bounded LLM but never directly authorizes execution. Final truth comes from current UI/session state and existing validators. Successful resolutions produce pending exemplar writes via one-turn delayed promotion with correction suppression.

**Design doc:** `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-retrieval-backed-semantic-memory-plan.md`

## Implementation Slices

### Slice 1: Types, Constants, Telemetry Fields

| File | Change |
|------|--------|
| `lib/chat/routing-log/types.ts:39` | Added `ROUTING_MEMORY_CURATED_SEED_USER_ID = '__curated_seed__'` |
| `lib/chat/routing-log/payload.ts:162-170` | Added `h1_*` telemetry fields: `h1_lookup_attempted`, `h1_lookup_status`, `h1_candidate_count`, `h1_top_similarity`, `h1_scope`, `h1_hint_accepted_by_llm`, `h1_retrieved_intent_id`, `h1_latency_ms`, `h1_from_curated_seed` |
| `app/api/chat/routing-log/route.ts:172-180` | Added `h1_*` fields to `semanticHintMeta` JSON builder |

### Slice 2: Extended Semantic Lookup Route

| File | Change |
|------|--------|
| `app/api/chat/routing-memory/semantic-lookup/route.ts` | Full rewrite with Phase 5 support |

**Key changes:**
- Body parsed before flag branching (fixes Stage 5 flag blocking Phase 5 requests)
- Flag branching: no `intent_scope` → Stage 5 flag; with `intent_scope` → Phase 5 flag (`CHAT_ROUTING_MEMORY_HINT_READ_ENABLED`)
- Two new SQL queries for learned exemplars: `PHASE5_LEARNED_HISTORY_SQL` (no context fingerprint filter) and `PHASE5_LEARNED_NAVIGATION_SQL` (strict context fingerprint)
- `PHASE5_SEED_LOOKUP_SQL` for curated seeds via sentinel `user_id`
- Scope-dependent similarity floors: 0.92 for navigation, 0.80 for history_info
- Clarified-exemplar down-ranking: `resolution_required_clarification` → score × 0.85
- Backward-compat: requests without `intent_scope` use existing `SEMANTIC_LOOKUP_SQL` unchanged

### Slice 3: Phase 5 Client Reader

| File | Change |
|------|--------|
| `lib/chat/routing-log/memory-semantic-reader.ts:47-127` | Added `lookupSemanticHints()`, `SemanticHintCandidate`, `SemanticHintLookupResult` |

Separate function from `lookupSemanticMemory` — gated by `NEXT_PUBLIC_CHAT_ROUTING_MEMORY_HINT_READ`. Same bounded-await pattern (2000ms timeout, fail-open).

### Slice 4: Info-Intent Write Builder

| File | Change |
|------|--------|
| `lib/chat/routing-log/memory-write-payload.ts:162-185` | Added `buildInfoIntentMemoryWritePayload()` |

Produces `info_intent` rows with:
- `intent_class: 'info_intent'`
- `answerSource` constrained to `'session_state' | 'action_history'` (truth source, never routing mechanism)
- `risk_tier: 'low'`
- Optional `resolution_required_clarification` marker
- No `groundingAction` (unlike `action_intent` writes)

### Slice 5: Pending Write Promotion + Correction Suppression

| File | Change |
|------|--------|
| `lib/chat/routing-log/pending-phase5-write.ts` | **NEW** — `PendingPhase5Write` type |
| `lib/chat/chat-navigation-context.tsx:835,555,1067,1905` | Added `pendingPhase5Write` / `setPendingPhase5Write` state; cleared on `clearMessages` and conversation reset |
| `lib/chat/routing-dispatcher.ts:402,609,1332-1348` | Added context fields, result type field, turn-entry promotion/suppression |
| `components/chat/chat-navigation-panel.tsx:549,1477,2194-2210` | Destructures from context, passes to dispatcher, consumes server `phase5_pending_write`, enriches `h1_hint_accepted_by_llm` |

**Promotion logic (dispatcher turn entry):**
1. Check if pending write exists from previous turn
2. Current input is correction phrase (`isCorrectionPhrase`) → drop
3. Current input is non-correction → promote (`recordMemoryEntry`)
4. Clear pending state

### Slice 6: Curated Seed Ingest Script

| File | Change |
|------|--------|
| `scripts/seed-phase5-curated-exemplars.ts` | **NEW** — seeding script |

9 curated seeds (4 history, 5 navigation). Uses runtime normalization + embedding pipeline (imported from `lib/chat/routing-log/`). Writes under `ROUTING_MEMORY_CURATED_SEED_USER_ID` with `scope_source = 'curated_seed'`.

Supports `--dry-run`, `--verify`, `--cleanup` flags.

### Slice 7: Pipeline Wiring

| File | Change |
|------|--------|
| `lib/chat/routing-dispatcher.ts:627-643` | Added `detectHintScope()` — returns `'history_info'` or `'navigation'` based on input patterns |
| `lib/chat/routing-dispatcher.ts:2051-2079` | Phase 5 hint retrieval after Stage 5 miss, before normal tier chain |
| `lib/chat/routing-dispatcher.ts:2093-2098` | Attached `_phase5HintIntent` / `_phase5HintScope` to result |
| `lib/chat/routing-dispatcher.ts:2215-2231` | Emitted all `h1_*` telemetry fields |
| `components/chat/chat-navigation-panel.tsx:2122-2123` | Passes `phase5_hint_intent` / `phase5_hint_scope` to navigate API |
| `app/api/chat/navigate/route.ts:604,684-696,1246-1267` | Parses hint fields, injects into LLM prompt via `semanticHintContext`, builds `phase5_pending_write` for successful v1 info-intent resolutions |

**Hint consumption flow:**
1. Dispatcher retrieves hints after Stage 5 miss
2. Attaches hint intent to result
3. Panel passes hint to navigate API request body
4. Navigate route injects hint into LLM prompt context
5. LLM classification is biased toward hinted intent
6. Successful v1 info-intent resolution returns `phase5_pending_write`
7. Panel sets pending write in context state
8. Next turn promotes or drops

**h1_hint_accepted_by_llm:** Set in the panel from the actual server response (`!!phase5WriteFromServer`), not from the dispatcher (which can't know the navigate response at log time).

### Slice 8: Tests

| File | Tests |
|------|-------|
| `__tests__/unit/chat/phase5-semantic-hints.test.ts` | 22 |
| `__tests__/unit/chat/phase5-info-intent-write.test.ts` | 7 |
| `__tests__/unit/chat/phase5-pending-promotion.test.ts` | 16 |
| **Total** | **45** |

**Coverage level:** Unit tests covering builders, helpers, client reader, scope detection, correction detection, and type contracts. Not full integration/E2E coverage of the runtime seams.

## Test Results

```
$ npx jest --testPathPattern "phase5-"
PASS __tests__/unit/chat/phase5-info-intent-write.test.ts
PASS __tests__/unit/chat/phase5-pending-promotion.test.ts
PASS __tests__/unit/chat/phase5-semantic-hints.test.ts
Test Suites: 3 passed, 3 total
Tests:       45 passed, 45 total
```

**Regression:**
```
$ npx jest --testPathPattern "content-intent-dispatcher|state-info-resolvers|routing-metadata"
Tests: 93 passed, 93 total
```

**Type-check:**
```
$ npm run type-check
tsc --noEmit — clean
```

## Feature Flags

| Flag | Type | Purpose |
|------|------|---------|
| `CHAT_ROUTING_MEMORY_HINT_READ_ENABLED` | Server | Enable Phase 5 hint retrieval on shared route |
| `NEXT_PUBLIC_CHAT_ROUTING_MEMORY_HINT_READ` | Client | Enable Phase 5 client reader |

Phase 5 flags are independent of existing Stage 5 flags. No `intent_scope` = legacy behavior.

## Files Modified

| File | Type |
|------|------|
| `lib/chat/routing-log/types.ts` | Modified |
| `lib/chat/routing-log/payload.ts` | Modified |
| `lib/chat/routing-log/memory-write-payload.ts` | Modified |
| `lib/chat/routing-log/memory-semantic-reader.ts` | Modified |
| `lib/chat/routing-log/pending-phase5-write.ts` | **NEW** |
| `lib/chat/routing-dispatcher.ts` | Modified |
| `lib/chat/chat-navigation-context.tsx` | Modified |
| `app/api/chat/routing-memory/semantic-lookup/route.ts` | Modified |
| `app/api/chat/routing-log/route.ts` | Modified |
| `app/api/chat/navigate/route.ts` | Modified |
| `components/chat/chat-navigation-panel.tsx` | Modified |
| `scripts/seed-phase5-curated-exemplars.ts` | **NEW** |
| `__tests__/unit/chat/phase5-semantic-hints.test.ts` | **NEW** |
| `__tests__/unit/chat/phase5-info-intent-write.test.ts` | **NEW** |
| `__tests__/unit/chat/phase5-pending-promotion.test.ts` | **NEW** |

## Post-Implementation Fixes

### Fix 1: Typo fallback overwriting structured resolver errors (`navigate/route.ts`)

**Problem:** When `go_home` resolved with a structured error ("You're already on the Home dashboard"), the typo-fallback branch at line 1212 overwrote it with "Try: `recent`, `links panel a`..." because it didn't require `intent.intent === 'unsupported'`.

**Fix:** Added `intent.intent === 'unsupported'` to the second typo-fallback branch, so recognized-intent errors are preserved.

### Fix 2: History_info queries swallowed by cross-surface arbiter (`routing-dispatcher.ts`)

**Problem:** "what did I just do?" was caught by the cross-surface arbiter (line ~1618) before Phase 5 hint retrieval could run (line ~2057). The arbiter classified it as ambiguous and clarified.

**Fix:** Added `!phase5HistoryExcluded` to the arbiter entry condition. When `detectHintScope` returns `'history_info'`, the arbiter is skipped — these queries belong to the history/info lane, not the cross-surface state-info lane.

### Fix 3: Phase 5 pre-tier override prevents clarifier leakage (`routing-dispatcher.ts`)

**Problem:** The original Phase 5 override flipped `result.handled = false` AFTER `dispatchRoutingInner` returned, but clarifier paths already called `ctx.addMessage()` as a side effect. This left stale clarifier messages in the chat.

**Fix:** Moved the override to BEFORE `dispatchRoutingInner`. When Phase 5 has a confident v1 hint (gated by allowlist + similarity floor), the tier chain is skipped entirely — no `addMessage` side effects.

### Fix 4: Navigate post-LLM rescue for hinted intents (`navigate/route.ts`)

**Problem:** When Phase 5 injected a hint into the navigate prompt but the LLM still returned `unsupported`, there was no recovery path.

**Fix:** Added a post-LLM rescue for v1 intents (`go_home`, `last_action`, `explain_last_action`, `verify_action`). When the LLM returns `unsupported` and `phase5_hint_intent` is a v1 intent, the intent is remapped to the structured resolver. Additionally, `detectLocalSemanticIntent` rescue catches "what did I just do?" on `unsupported`.

## Runtime Verification (Smoke Test — 2026-03-18)

**Setup:** Curated seeds ingested (9/9), feature flags enabled, dev server restarted.

| Input | Context | Expected | Actual | Status |
|-------|---------|----------|--------|--------|
| "take me home" | already home | "You're already on the Home dashboard." | Match | ✅ |
| "take me home" | not at home | "Going home..." Auto-Executed | Match | ✅ |
| "return home" | not at home | "Going home..." Auto-Executed | Match | ✅ |
| "go home" | not at home | "Going home..." Auto-Executed | Match | ✅ |
| "what did I just do?" | after opening entry | Session state answer | "You opened entry 'Home' 8m ago..." | ✅ |
| "what did I just do?" | after more actions | Session state answer | "You opened entry 'budget100 B'..." | ✅ |
| "what was my last action?" | after actions | Session state answer | "You opened entry 'budget100 B'..." | ✅ |

All 7 smoke test queries pass. Phase 5 is runtime-verified.

## Known Limitations

1. **Unit tests only:** No integration tests covering the full dispatcher→panel→navigate→writeback chain. The new override/rescue seams are not directly test-backed.
2. **detectHintScope is v1-narrow:** Only covers "what did I / did I" for history and "go/take/return/back home" for navigation. Broader paraphrase coverage comes from curated seeds + learned exemplars over time.
3. **No v1 navigation writeback yet:** Only info-intent writeback is implemented. Navigation exemplar writeback from successful `go_home` / `open_entry` executions is deferred.
4. **Navigation hint is prompt-level + rescue:** Phase 5 navigation hints bias the LLM prompt and rescue `unsupported` to the structured resolver. The LLM may still classify correctly without the rescue.

## Next Steps

1. Add targeted regression tests for the new override/rescue seams
2. Monitor `h1_*` telemetry in routing logs for hint acceptance rates
3. Add integration tests for runtime seams (deferred)
4. Consider v1 navigation writeback for `go_home` executions
