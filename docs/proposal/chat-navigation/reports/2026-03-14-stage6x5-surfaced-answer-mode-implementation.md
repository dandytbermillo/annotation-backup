# Stage 6x.5 — Surfaced Answer Mode Implementation Report

**Date**: 2026-03-14
**Slice**: 6x.5
**Status**: Complete — all 6 plan steps implemented
**Plan**: `stage6x5-surfaced-answer-mode-plan.md`
**Predecessor**: `2026-03-14-stage6x4-review-driven-fixes.md`

---

## Summary

6x.5 formalizes the content-answer surfacing that was wired ad-hoc during 6x.4 runtime testing. It establishes the surfaced-answer path as a product contract, adds auto-fill transparency telemetry, implements the single-execution rule, cleans up answer presentation, gates the ShowMoreButton on truncation, and provides full dispatcher-level integration test coverage.

---

## What Was Implemented

### Step 1: Auto-fill telemetry markers

Per-attempt flags track when the server repairs Gemini structured output gaps:

- `thisAttemptCitationsAutofilled` — set when `citedSnippetIds` is server-filled from session registry
- `thisAttemptGroundedAutofilled` — set when `grounded` is server-defaulted to `true`

Flags are scoped to the accepted answer attempt, not the whole loop. A failed first attempt that triggered auto-fill does not contaminate the telemetry of a later corrected answer.

**File**: `app/api/chat/stage6-loop/route.ts`

### Step 2: Telemetry pipeline extension

New fields defined in `S6ContentTelemetry` (source of truth), mirrored through the full pipeline:

| Field | Defined in | Mirrored to |
|-------|-----------|-------------|
| `s6_citations_autofilled` | `stage6-content-tool-contracts.ts` | `stage6-tool-contracts.ts` → `payload.ts` → `routing-log/route.ts` → `stage6-loop-controller.ts` (both shadow + enforcement writers) |
| `s6_grounded_autofilled` | `stage6-content-tool-contracts.ts` | Same pipeline |

### Step 3: Answer text cleanup

Citation markers (e.g., `(c0_s0, c0_s1)`, `(based on c0_s0)`) are stripped from the displayed answer text before adding the assistant message. Raw `citedSnippetIds` remain in telemetry for eval.

**File**: `lib/chat/routing-dispatcher.ts` — regex: `/\s*\((?:based on\s+)?c\d+_s\d+(?:,\s*c\d+_s\d+)*\)\.?/gi`

### Step 4: Truncation warning + tracking

- Response-level `truncated` flag now contributes to truncation tracking (not just per-snippet flags)
- `contentTruncated` added to `S6ContentAnswerResult`
- When `contentTruncated === true`, the dispatcher appends: `"\n\n_This answer is based on partial note content._"`

**Files**: `app/api/chat/stage6-loop/route.ts`, `lib/chat/stage6-content-tool-contracts.ts`

### Single-execution rule

The dispatcher's content-intent path now calls `executeS6Loop` directly (awaited) instead of `void runS6ShadowLoop` (fire-and-forget). The result is used for both surfacing and durable logging:

- **`content_answered`** → display answer + write durable log
- **`abort`/`timeout`** → write durable log from awaited result + fall through to normal routing. No shadow rerun.
- **`throw`** → fall through to normal routing. No durable row (no result to log).

**File**: `lib/chat/routing-dispatcher.ts`

### Durable provenance normalization

| Outcome | Durable `provenance` | `result_status` |
|---------|---------------------|-----------------|
| `content_answered` | `s6_enforced:content_answered` | `executed` |
| `action_executed` | `s6_enforced:<actionType>` | `executed` |
| Other (abort, timeout) | `s6_enforced:fallback` | `failed` |

**Files**: `lib/chat/stage6-loop-controller.ts`, `lib/chat/routing-log/mapping.ts`

### ShowMoreButton display policy

- `contentTruncated` threaded from loop result → `ChatMessage` → `ChatMessageList`
- ShowMoreButton for `corpus='notes'` messages renders only when `contentTruncated === true`
- Doc retrieval (`docSlug`) behavior unchanged — always shows

**Files**: `lib/chat/chat-navigation-context.tsx`, `lib/chat/routing-dispatcher.ts`, `components/chat/ChatMessageList.tsx`

### Content Answer provenance badge

- `'content_answered'` added to `ChatProvenance` type
- Teal "Content Answer" badge in `PROVENANCE_STYLES`
- `_devProvenanceHint: 'content_answered'` on dispatcher return

**Files**: `lib/chat/chat-navigation-context.tsx`, `components/chat/ChatMessageList.tsx`, `lib/chat/routing-dispatcher.ts`

### Step 5: Integration tests

8 new tests in `§6 Surfaced answer mode (6x.5)` of `content-intent-dispatcher-integration.test.ts`:

| Test | Verifies |
|------|----------|
| Returns handled `content_intent_answered` | Full dispatcher path with correct tier/provenance |
| Cleaned text (citation markers stripped) | `ctx.addMessage` content has no `c0_s0` references |
| `itemId`, `itemName`, `contentTruncated` on message | ShowMoreButton metadata attached correctly |
| `contentTruncated=true` when answer is from partial content | Truncation flag threaded to message |
| `writeDurableEnforcementLog` called | Awaited loop result passed to durable writer |
| Abort path: no shadow rerun, durable row written | Single-execution rule enforced |
| Throw path: error caught, no durable row | Graceful degradation |
| Truncation warning in displayed text | `_This answer is based on partial note content._` appended |
| Auto-fill telemetry marker | `s6_citations_autofilled` threaded to durable log |

3 existing tests (§2, §4, §5) updated from `runS6ShadowLoop` to `executeS6Loop`.

Test file header updated to reflect 6x.5 scope.

### Step 5 (route-level): 3 regression tests

Added to `stage6-loop-route.test.ts`:

| Test | Verifies |
|------|----------|
| Response-level `truncated` flag sets `contentTruncated` | Even when no individual snippet has `truncated: true` |
| Auto-fill flags scoped to accepted answer | First failed attempt's auto-fill doesn't contaminate later corrected answer |
| `s6_grounded_autofilled` specifically | Model omits `grounded`, auto-fill sets it, telemetry marks it |

### Step 6: Documentation

- Updated `stage6-content-retrieval-and-explanation-design.md` §12: marked 6x.3, 6x.4, 6x.5 as IMPLEMENTED with key details
- Updated test file header from "Stage 6x.3, Step 4" to "Stage 6x.3 + 6x.5"
- Updated `stage6x5-surfaced-answer-mode-plan.md` ShowMoreButton follow-up section (now implemented, no longer deferred)
- This implementation report

---

## All Files Modified

### Production code
| File | Change |
|------|--------|
| `app/api/chat/stage6-loop/route.ts` | Per-attempt auto-fill flags; response-level truncation tracking; `contentTruncated` on answer result; auto-fill telemetry on accepted answer |
| `lib/chat/stage6-content-tool-contracts.ts` | `s6_citations_autofilled`, `s6_grounded_autofilled` on `S6ContentTelemetry`; `contentTruncated` on `S6ContentAnswerResult` |
| `lib/chat/stage6-tool-contracts.ts` | Mirrored auto-fill fields on `S6LoopTelemetry` |
| `lib/chat/routing-log/payload.ts` | `s6_citations_autofilled`, `s6_grounded_autofilled` fields |
| `app/api/chat/routing-log/route.ts` | Serialized auto-fill fields into `semantic_hint_metadata` |
| `lib/chat/stage6-loop-controller.ts` | Exported `executeS6Loop` and `writeDurableEnforcementLog`; `content_answered` provenance; `result_status` fix; auto-fill fields in both durable writers |
| `lib/chat/routing-dispatcher.ts` | Single-execution rule; citation stripping; truncation warning; `contentTruncated` on message; `itemId`/`itemName`/`corpus` on message; `_devProvenanceHint: 'content_answered'`; durable log call |
| `lib/chat/chat-navigation-context.tsx` | `'content_answered'` in `ChatProvenance`; `contentTruncated` on `ChatMessage` |
| `components/chat/ChatMessageList.tsx` | `content_answered` in `PROVENANCE_STYLES`; ShowMoreButton gated on `contentTruncated` for notes corpus |
| `lib/chat/routing-log/mapping.ts` | `content_answered` → `decision_source: 'llm'`, `result_status: 'executed'` |

### Test code
| File | Change |
|------|--------|
| `__tests__/unit/chat/stage6-loop-route.test.ts` | 3 regression tests (truncation, per-attempt auto-fill, `s6_grounded_autofilled`); updated empty-citations test for auto-fill behavior |
| `__tests__/unit/chat/stage6-loop-controller.test.ts` | 1 test for `content_answered` durable row |
| `__tests__/unit/routing-log/mapping.test.ts` | 2 tests for `content_answered` mapping |
| `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts` | 9 new tests (§6 surfaced answer mode); 3 updated tests (§2, §4, §5); header updated |

### Documentation
| File | Change |
|------|--------|
| `stage6-content-retrieval-and-explanation-design.md` | §12 slices marked IMPLEMENTED |
| `stage6x5-surfaced-answer-mode-plan.md` | ShowMoreButton follow-up updated |

---

## Test Results

```
$ npx jest --testPathPattern stage6-loop-route
→ 43/43 pass

$ npx jest --testPathPattern stage6-loop-controller
→ 18/18 pass

$ npx jest --testPathPattern routing-log/mapping
→ 25/25 pass

$ npx jest --testPathPattern content-intent-dispatcher-integration
→ 18/18 pass

$ npm run type-check
→ zero errors
```

---

## What 6x.5 Closes

The content-answer system is now a complete product path:

1. Content-intent classification → note inspection → grounded answer → displayed in chat
2. Durable telemetry with correct provenance and auto-fill transparency
3. Citation markers stripped; truncation warning shown; "Content Answer" badge
4. ShowMoreButton opens full note in View Panel when content is truncated
5. Single-execution rule: no double loop runs
6. Full integration test coverage at dispatcher level
7. All design docs updated to reflect implemented state
