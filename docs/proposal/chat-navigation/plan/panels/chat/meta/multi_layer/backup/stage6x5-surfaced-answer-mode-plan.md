# Stage 6x.5: Surfaced Answer Mode — Plan

**Parent**: `stage6-content-retrieval-and-explanation-design.md`
**Depends on**: 6x.4 (grounded answer policy, runtime-proven)
**Current state**: Partial surfacing already implemented during 6x.4 runtime hardening. This plan formalizes that behavior and closes the remaining gaps.

---

## Problem

The system already surfaces content answers in the chat UI, but the implementation was wired ad-hoc during 6x.4 runtime testing. Several aspects remain informal:

1. The surfaced-answer path is not documented as a product contract
2. Citation auto-fill silently overstates model compliance without telemetry signal
3. No integration tests prove the full dispatcher → message → durable log path
4. Provenance and analytics were patched reactively — no audit confirms end-to-end coherence
5. User-facing answer presentation has no design contract (raw snippet IDs visible, no "based on note content" label, no truncation warning)

## What 6x.5 locks

### 1. Surfaced-answer contract

The content-answer path is no longer shadow-only. It is a product path with defined behavior:

| Condition | Behavior |
|-----------|----------|
| Content-intent classified + loop returns `content_answered` | Answer displayed in chat, durable log written from this result |
| Content-intent classified + loop returns `abort` | Durable log written from this result (not rerun), fall through to normal routing (Safe Clarifier) |
| Content-intent classified + loop returns `timeout` | Durable log written from this result (not rerun), fall through to normal routing |
| Content-intent classified + loop throws | Caught, fall through to normal routing, warning logged (no durable row — no result to log) |
| Not content-intent | No change — existing routing tiers handle normally |

**Single-execution rule**: The loop runs exactly once per content-intent turn. The awaited result is used for both surfacing and durable logging. On non-answer outcomes (`abort`, `timeout`, `max_rounds_exhausted`), the durable row is written from the existing result via `writeDurableEnforcementLog` — the loop is NOT rerun via `runS6ShadowLoop`. This eliminates the current behavior where a non-answer turn executes Stage 6 twice.

**Gating**: No feature flag. The path activates whenever `NEXT_PUBLIC_STAGE6_SHADOW_ENABLED=true` and the content-intent classifier matches. This is the same flag that gates the existing shadow loop. A separate `NEXT_PUBLIC_STAGE6_CONTENT_ANSWER_ENABLED` flag may be added if rollback granularity is needed, but is not required for initial 6x.5.

### 2. Answer-repair policy

The 6x.4 auto-fills were Gemini compatibility shims. 6x.5 formalizes which are permanent and which need telemetry markers.

| Auto-fill | Keep? | Rationale |
|-----------|-------|-----------|
| `itemId` from `contentContext.noteItemId` | **Yes, permanent** | Server already knows the anchored note. The model omitting it is a structured-output limitation, not a grounding failure. No telemetry marker needed. |
| `citedSnippetIds` from session registry | **Yes, with telemetry marker** | The model produced the answer text FROM the snippets but didn't list them. Auto-filling all registry entries is a reasonable proxy but overstates precision. Add `s6_citations_autofilled: true` to telemetry when this fires. |
| `grounded` defaulting to `true` | **Yes, with telemetry marker** | Only fires when `citedSnippetIds` were also auto-filled and snippet evidence exists. Add `s6_grounded_autofilled: true` to telemetry when this fires. |

### 3. Telemetry markers for auto-fill

New fields defined in `S6ContentTelemetry` (`stage6-content-tool-contracts.ts`, source of truth), then mirrored onto `S6LoopTelemetry` (`stage6-tool-contracts.ts`) and `RoutingLogPayload`:

| Field | Type | When emitted |
|-------|------|--------------|
| `s6_citations_autofilled` | `boolean` | When `citedSnippetIds` was server-filled |
| `s6_grounded_autofilled` | `boolean` | When `grounded` was server-filled |

These thread through the existing pipeline: `S6LoopTelemetry` → `RoutingLogPayload` → `semantic_hint_metadata` JSONB.

### 4. Provenance contract

Finalized provenance values for content-answer paths:

| Path | `_devProvenanceHint` | Durable `provenance` | `result_status` | `decision_source` |
|------|---------------------|---------------------|-----------------|-------------------|
| Content answer surfaced | `content_answered` | `s6_enforced:content_answered` | `executed` | `llm` |
| Content-intent loop aborts | (falls through) | `s6_enforced:fallback` (durable row from awaited result) | `failed` | `llm` |
| Content-intent loop not triggered | (normal routing) | (normal routing provenance) | (normal) | (normal) |

### 5. Answer presentation

User-facing answer formatting rules:

1. **No raw snippet IDs in answer text.** The model's answer should describe content, not cite `c0_s0`. If the model includes citation markers, strip them from the displayed text. Keep the raw `citedSnippetIds` in telemetry only.
2. **"Based on note content" label.** Add a subtle label or visual indicator on content-answered messages to distinguish them from navigation responses. This can be the `content_answered` provenance badge (already implemented as teal "Content Answer" badge).
3. **Truncation warning.** If `contentAnswerResult` indicates the content was truncated (any snippet had `truncated: true`), append a note: "This answer is based on partial note content." The loop result should carry a `contentTruncated` flag for this.
4. **No citation display in Slice 1.** Citation UI (expandable footnotes, snippet highlights) is deferred to a later slice. The cited snippet IDs remain in telemetry for eval.

---

## Files to change

| File | Change |
|------|--------|
| `lib/chat/stage6-content-tool-contracts.ts` | Add `s6_citations_autofilled`, `s6_grounded_autofilled` to `S6ContentTelemetry` (source of truth); add `contentTruncated` to `S6ContentAnswerResult` |
| `app/api/chat/stage6-loop/route.ts` | Set auto-fill telemetry flags when shims fire; track snippet truncation state; populate `contentTruncated` on answer result |
| `lib/chat/stage6-tool-contracts.ts` | Mirror auto-fill telemetry fields onto `S6LoopTelemetry` from content contracts |
| `lib/chat/routing-log/payload.ts` | Add `s6_citations_autofilled`, `s6_grounded_autofilled` fields |
| `app/api/chat/routing-log/route.ts` | Serialize new fields into `semantic_hint_metadata` |
| `lib/chat/stage6-loop-controller.ts` | Thread new telemetry fields in durable log writers |
| `lib/chat/routing-dispatcher.ts` | Strip citation markers from answer text; add truncation warning; eliminate double-loop on non-answer outcomes (write durable row from awaited result, do not call `runS6ShadowLoop`) |

No new production files. No new feature flags (unless rollback granularity is requested). Implementation report will be created under `docs/proposal/chat-navigation/reports/` (documentation, not production code).

---

## Implementation steps

### Step 1: Auto-fill telemetry markers

In `stage6-loop/route.ts`, where `citedSnippetIds` and `grounded` are auto-filled:

```typescript
// Existing auto-fill block
if (parsed.type === 'answer' && parsed.text && sessionSnippetRegistry.size > 0) {
  if (!parsed.citedSnippetIds || parsed.citedSnippetIds.length === 0) {
    parsed.citedSnippetIds = [...sessionSnippetRegistry.keys()]
    citationsAutofilled = true  // NEW
  }
  if (parsed.grounded === undefined) {
    parsed.grounded = true
    groundedAutofilled = true  // NEW
  }
}
```

Thread `citationsAutofilled` and `groundedAutofilled` into the answer result's telemetry.

### Step 2: Telemetry pipeline extension

Add `s6_citations_autofilled` and `s6_grounded_autofilled` to:
- `S6ContentTelemetry` in `stage6-content-tool-contracts.ts` (source of truth)
- `S6LoopTelemetry` in `stage6-tool-contracts.ts` (mirror)
- `RoutingLogPayload` (payload)
- `routing-log/route.ts` (serialization)
- `stage6-loop-controller.ts` (durable log threading)

Same pattern as 6x.4 Step 4. `stage6-content-tool-contracts.ts` remains the authoritative location for all content-answer telemetry fields.

### Step 3: Answer text cleanup

In `routing-dispatcher.ts`, before displaying the answer:

```typescript
// Strip citation markers like "(c0_s0, c0_s1)" or "(based on c0_s0)"
const cleanedText = answerText.replace(/\s*\((?:based on\s+)?c\d+_s\d+(?:,\s*c\d+_s\d+)*\)\.?/gi, '').trim()
```

### Step 4: Truncation warning

In `stage6-loop/route.ts`, when building the answer result:

```typescript
const contentTruncated = [...sessionSnippetRegistry.keys()].some(id => {
  // Check if any snippet in the session was truncated
  // This requires tracking truncation state alongside the registry
})
```

Add `contentTruncated` to `S6ContentAnswerResult`. In the dispatcher, if `contentTruncated` is true, append: `"\n\n_This answer is based on partial note content._"`

### Step 5: Integration tests

| Test | What it verifies |
|------|-----------------|
| `dispatchRouting` with content-intent → handled result | Full dispatcher path returns `handled: true, handledByTier: 6, tierLabel: 'content_intent_answered'` |
| Assistant message added with cleaned text | `ctx.addMessage` called with answer text, no raw snippet IDs |
| Provenance is `content_answered` | `_devProvenanceHint` correct on return |
| Durable log written | `writeDurableEnforcementLog` called with `provenance: 's6_enforced:content_answered'`, `result_status: 'executed'` |
| Fallback when loop aborts | Durable log written from abort result, normal routing proceeds, `runS6ShadowLoop` NOT called |
| Fallback when loop throws | Error caught, normal routing proceeds, no durable row |
| Single-execution guarantee | `executeS6Loop` called exactly once per content-intent turn (not rerun via shadow) |
| Auto-fill telemetry marker | When citations auto-filled, telemetry has `s6_citations_autofilled: true` |

### Step 6: Documentation update

- Update `stage6-content-retrieval-and-explanation-design.md` §12 to mark 6x.5 as implemented
- Update `CLAUDE.md` if any new env vars or feature flags are introduced
- Create implementation report under `docs/proposal/chat-navigation/reports/`

---

## Design decisions

1. **No separate feature flag.** The surfaced-answer path is already live behind `NEXT_PUBLIC_STAGE6_SHADOW_ENABLED`. Adding a second flag creates state-space complexity with marginal rollback benefit. If rollback is needed, disabling the shadow flag disables everything.

2. **Auto-fill is acceptable, not ideal.** The `itemId` auto-fill is semantically correct (server knows the anchor). The `citedSnippetIds` auto-fill is a pragmatic Gemini workaround that preserves the grounding guarantee (all cited snippets ARE from the anchored note) while overstating precision. Telemetry markers make this transparent for eval.

3. **Strip citation markers, not citations.** The raw `c0_s0` IDs are meaningless to users but valuable for eval. Strip from display text, keep in telemetry. Citation UI (footnotes, highlights) is a later slice.

4. **Truncation is informational, not blocking.** A truncated note can still produce a useful summary. The warning helps the user understand the answer's scope without failing the query.

5. **Integration tests at dispatcher level, not E2E.** Full E2E would require a running Gemini API. Dispatcher-level tests mock `executeS6Loop` and verify the wiring from classification through message display and durable logging.

---

## Follow-up: ShowMoreButton display policy

**Status**: IMPLEMENTED. Gated on `contentTruncated === true`.

### Current state

The surfaced content-answer message already carries `itemId`, `itemName`, and `corpus: 'notes'` (`routing-dispatcher.ts:1497`). `ChatMessageList` renders `ShowMoreButton` whenever `message.itemId` is present (`ChatMessageList.tsx:271`). Clicking it opens the full note in the View Panel via `handleShowMore` (`chat-navigation-panel.tsx:1302`).

This means the "Show more" button currently appears on **every** content-answer message, regardless of whether the answer is truncated or complete.

### Intended policy

The button should appear based on a meaningful data boundary, not unconditionally:

| Condition | Show button? |
|-----------|-------------|
| `contentTruncated === true` | **Yes** — the answer is based on partial note content |
| Answer text exceeds a UI length threshold (e.g., 500 chars) | **Optional** — long answers may benefit from "open full note" even if not truncated |
| Short answer from complete note | **No** — the answer already covers the full content |

### Implementation (when ready)

1. Thread `contentTruncated` from `loopResult.contentAnswerResult` onto the `ChatMessage` (new field or reuse existing metadata)
2. In `ChatMessageList.tsx:271`, gate the `ShowMoreButton` render on `message.contentTruncated === true` (or the chosen policy)
3. Optionally add a length threshold as a secondary condition

### Implementation

Completed as part of 6x.5 before Step 6 docs. `contentTruncated` threaded from `S6ContentAnswerResult` → `ChatMessage` → `ChatMessageList`. ShowMoreButton for `corpus='notes'` renders only when `contentTruncated === true`. Integration tests verify both truncated and non-truncated paths.

---

## Out of scope

- Citation UI (expandable footnotes, snippet highlights)
- Multi-note content queries ("compare these two notes")
- Links panel / widget content support
- Content-intent for queries without an active note ("summarize the last note I edited")
- Answer caching / deduplication
- Streaming answer display
