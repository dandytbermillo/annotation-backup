# Plan: Stage 6x.7 — Anchored-Note Read-Intent Entry Recovery

## Context

`6x.3` through `6x.6` successfully built the Stage 6 content-answer pipeline:

- content-intent dispatcher entry
- grounded note-content answer generation
- surfaced answer mode
- inline citation snippet surfacing

However, the trigger into that **read-only** pipeline is still too brittle for natural anchored-note requests. The deterministic classifier in `lib/chat/content-intent-classifier.ts` handles obvious forms like `summarize this note`, but misses natural phrasing such as:

- `explain about that note content`
- `tell me about that note`
- `show the text of that note`
- `read this note`

This is not a Stage 6 content-answer failure. It is a **read-intent entry failure**: the router cannot robustly decide whether an anchored-note utterance is asking to read the note or navigate elsewhere.

The long-term product goal for this area is to behave more like ChatGPT web + Cursor AI:

- natural language should work without teaching the user magic phrasing
- successful turns should strengthen future recall
- the system should use semantic understanding before asking the user to clarify
- clarification should happen only when intent is genuinely ambiguous

## Decision

`6x.7` will be delivered in **three steps**:

1. **Ship Option A now**
   - add a bounded anchored-note LLM resolver for the narrow current gap
   - no semantic-memory dependency
   - fixes the immediate user-visible failure
2. **Build the content-intent exemplar pool**
   - extend memory write/index support so successful `content_answered` turns become reusable semantic exemplars
3. **Then go for Option B**
   - semantic recall first for anchored-note non-exact turns
   - bounded LLM fallback for cold start and unresolved cases

This keeps the immediate fix small while still preserving Option B as the target architecture.

## Why this sequence

### Why not stay deterministic-only

The current classifier was intentionally narrow to ship `6x.3`–`6x.6` safely. That succeeded for the Stage 6 content pipeline, but left a known gap:

- the app can answer note-content questions once they enter Stage 6
- many natural anchored-note phrasings never enter that path

That is the current bug.

### Why Option A first

Option A is the smallest fix that directly addresses the current failure:

- no regex-sprawl as the primary fix
- no user training
- no semantic-memory bootstrap dependency
- bounded LLM only for anchored-note ambiguous turns

This matches the existing routing philosophy:

- deterministic obvious wins
- bounded LLM for unresolved non-exact cases
- safe clarifier when still ambiguous

### Why Option B is still the goal

Option B is closer to the agreed ChatGPT/Cursor-like end state because it:

- lets natural language benefit from semantic recall the same way navigation does
- improves over time as successful content-answer turns accumulate
- reduces repeated dependence on one-off LLM arbitration

But Option B is broader than it first appears because the current semantic memory index stores only action-style rows:

- `buildMemoryWritePayload(...)` requires `groundingAction`
- content-answered results have no `groundingAction`
- content-answer turns are durably logged but **not** written to `chat_routing_memory_index`

So the content-intent exemplar pool must be built first.

## Non-goals

This slice does **not**:

- redesign the full router
- replace the existing Stage 6 answer loop
- broaden regex coverage as the primary fix
- teach users a special phrasing contract
- let semantic memory directly execute content answers without the existing Stage 6 validation path
- introduce broader cross-surface capability intents such as `edit`, `add`, `remove`, `highlight`, or other mutations across notes, widgets, dashboard, or workspace

## Forward compatibility

`6x.7` is intentionally scoped to **anchored-note read intent** only.

If future slices add capabilities that can target multiple surfaces, such as:

- notes
- widgets (for example `Recent` or `Links`)
- dashboard
- workspace

and capabilities such as:

- `read` / `explain`
- `navigate` / `open`
- `edit`
- `add`
- `remove`
- `annotate`
- `highlight`

then the top-level model will need to expand from simple `content vs navigation` recovery to a broader **anchored-surface capability routing** layer.

That later model should likely separate two decisions:

1. **target surface**
   - `note`
   - `widget`
   - `dashboard`
   - `workspace`
   - `unknown`
2. **capability intent**
   - `read_content`
   - `navigate`
   - `edit_content`
   - `add_content`
   - `remove_content`
   - `annotate_content`
   - `highlight_content`
   - `ambiguous`

That broader cross-surface capability taxonomy is **out of scope for 6x.7** and should land as a later slice after read-intent entry recovery is stable.

## Design constraints

1. **No regex sprawl as the main strategy.** Deterministic patterns remain only for obvious wins and cheap hard guards.
2. **No whole-router LLM.** The LLM is only a bounded arbiter for anchored-note ambiguous turns.
3. **Reuse existing Stage 6 path.** Any content decision still enters the existing `executeS6Loop(...)` path.
4. **Keep hard guards, but only the absolute exclusions.** No anchor, selection reply, dashboard/meta/greeting, semantic-session/history, and explicit non-note scope (dashboard/workspace/panel targets) still short-circuit. Generic note-referential imperative read requests such as `show the text of that note`, `read this note`, or `display that note content` must remain resolver-eligible.
5. **Single-execution rule remains true.** The Stage 6 loop still runs exactly once per content-answer turn.

## Phase A: Immediate fix — bounded anchored-note resolver

### Goal

Fix the current user-visible failure without waiting for semantic-memory support.

### Endpoint pattern

Phase A should follow the same client -> API route pattern already used by existing bounded LLM helpers.

### Phase A gating

Phase A runs **only inside the existing Stage 6 gated block**.

That means:

- when `NEXT_PUBLIC_STAGE6_SHADOW_ENABLED === 'true'`, the deterministic classifier and Phase A resolver are allowed to run
- when `NEXT_PUBLIC_STAGE6_SHADOW_ENABLED !== 'true'`, the resolver must not run and routing must remain identical to pre-6x.7 behavior

The `note_intent_resolver_result: 'disabled'` telemetry value refers to this gated-off state.

- client helper: `lib/chat/anchored-note-intent-resolver.ts`
- server route: `app/api/chat/anchored-note-resolver/route.ts`

This keeps model access, timeout enforcement, schema validation, and logging on the server side, consistent with grounding and clarification LLM helpers.

### Behavior

For anchored-note turns:

1. active note anchor resolved
2. deterministic hard exclusions run
3. deterministic obvious content wins run (`summarize this note`, etc.)
4. if the deterministic classifier misses **and** an active note anchor exists **and** the shared hard-guard exclusions do not apply, call bounded anchored-note LLM resolver
5. if resolver returns `anchored_note_content` above threshold -> set `contentIntentMatchedThisTurn = true` and enter existing Stage 6 content path
6. if resolver returns `anchored_note_navigation` above threshold -> continue normal routing
7. if ambiguous / low confidence / timeout / error -> fall through to current safe clarifier / routing

### Dispatcher insertion point

The resolver is inserted inside the existing content-intent block in `lib/chat/routing-dispatcher.ts`, specifically on the **classifier miss** branch.

Conceptually:

```ts
const contentResult = classifyContentIntent(ctx.trimmedInput, noteAnchor)

if (contentResult.isContentIntent && contentResult.noteAnchor) {
  // existing deterministic content path
  // build s6Params from classifier result
  // call executeS6Loop(...)
} else if (activeNoteId && !contentResult.isContentIntent && !isAnchoredNoteResolverHardExcluded(ctx.trimmedInput, noteAnchor)) {
  // NEW Phase A path
  const resolverResult = await callAnchoredNoteResolver(...)
  if (resolverResult.decision === 'anchored_note_content' && resolverResult.confidence >= 0.75) {
    // build s6Params from resolver result
    // set contentIntentMatchedThisTurn = true
    // call executeS6Loop(...)
  }
}
```

The key condition is: **resolver only runs when an active note anchor exists, the deterministic content classifier did not match, and the shared hard-guard exclusions do not apply**. Without an anchor, or when a hard guard already excludes note-content interpretation, the resolver must not fire.

That means turns such as `show links panel`, `1`, or `hello` must be rejected by the shared hard guards before any resolver call is attempted. By contrast, note-referential imperative read requests such as `show the text of that note` must **not** be excluded by `isAnchoredNoteResolverHardExcluded(...)` merely because they begin with a command-like verb.

### Contract

Resolver request:

```ts
type AnchoredNoteResolverRequest = {
  userInput: string
  noteAnchor: {
    itemId: string
    title: string | null
  }
  activeSurface?: 'note' | 'other'
}
```

The server route should reject malformed requests before model invocation. Phase A request shape is intentionally small and bounded; it should not depend on broad chat history or arbitrary UI state.

Resolver output:

```ts
type AnchoredNoteResolverResult =
  | {
      decision: 'anchored_note_content'
      confidence: number
      reason: string
      intentType: 'summary' | 'question' | 'find_text'
    }
  | {
      decision: 'anchored_note_navigation' | 'ambiguous'
      confidence: number
      reason: string
    }
```

When the resolver returns `anchored_note_content`, `intentType` is required. This avoids inventing a dispatcher-side default and preserves the existing `S6ContentContext` contract used by Stage 6 prompt shaping.

### Thresholds

- `>= 0.75`: authoritative for content or navigation
- `< 0.75`: treat as `ambiguous`

### Files

| File | Change |
|---|---|
| `lib/chat/anchored-note-intent-resolver.ts` | **NEW** — client helper for bounded LLM resolver with strict JSON contract |
| `app/api/chat/anchored-note-resolver/route.ts` | **NEW** — server API route that calls the model and enforces resolver schema |
| `lib/chat/content-intent-classifier.ts` | Keep deterministic obvious wins + shared eligibility helpers |
| `lib/chat/routing-dispatcher.ts` | Call bounded resolver after deterministic miss, before Stage 5 replay / fallback |
| `lib/chat/routing-log/payload.ts` | Add resolver telemetry fields |
| `app/api/chat/routing-log/route.ts` | Serialize resolver telemetry into `semantic_hint_metadata` |
| `__tests__/unit/chat/anchored-note-intent-resolver.test.ts` | **NEW** — unit tests for parsing, thresholding, timeout/error behavior |
| `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts` | Add resolver-driven content routing integration tests |

### Phase A boundary rule

`content_answered` remains **ineligible for semantic memory writes in Phase A**.

No Phase A change may extend `buildMemoryWritePayload(...)`, `chat_routing_memory_index`, or semantic lookup behavior for content answers. That work is deferred entirely to Phase B so the immediate fix stays isolated to intent recovery.

### Phase A telemetry

Phase A telemetry is **resolver-only**. It must remain separate from any future semantic-recall telemetry so we can measure the direct effect of the immediate fix.

```ts
note_intent_resolver_called?: boolean
note_intent_resolver_decision?: 'anchored_note_content' | 'anchored_note_navigation' | 'ambiguous'
note_intent_resolver_confidence?: number
note_intent_resolver_reason?: string
note_intent_resolver_result?: 'content' | 'navigation' | 'ambiguous' | 'timeout' | 'error' | 'disabled'
```

### Phase A tests

1. deterministic content match still bypasses resolver
2. `explain about that note content`:
   - deterministic classifier misses
   - resolver returns `anchored_note_content`
   - `executeS6Loop(...)` called once
   - Stage 5 replay skipped
   - surfaced answer returned
3. `show the text of that note`:
   - resolver returns `anchored_note_content`
   - content path used
4. `show links panel`:
   - resolver is skipped by hard guards
   - normal navigation continues
5. `show the text of that note` remains resolver-eligible despite imperative form:
   - hard guards do not exclude it
   - resolver returns `anchored_note_content`
   - content path used
6. `show that`:
   - resolver returns `ambiguous`
   - safe clarifier path remains
7. resolver timeout/error:
   - no crash
   - no Stage 6 content run
   - existing fallback preserved
8. resolver-classified content turn provides `intentType`:
   - resolver returns `intentType`
   - dispatcher threads it into `contentContext`
   - Stage 6 receives a valid `S6ContentContext`
9. resolver-classified content turn sets `contentIntentMatchedThisTurn`:
   - Stage 5 replay is suppressed for the turn
   - later generic Stage 6 triggers are skipped even if the loop aborts or times out

## Phase B: Build the content-intent exemplar pool

### Goal

Make successful content-answer turns reusable as semantic exemplars.

### New memory model

Extend memory support to allow content-answer exemplars in addition to existing action exemplars.

Conceptually:

- `action_intent` — existing navigation/mutation memory rows
- `content_intent` — new anchored-note content exemplars

A content-intent memory row is **not** an answer cache.
It represents:

- the user's phrasing (`raw_query_text`)
- the context fingerprint
- the fact that the phrasing successfully entered the content-answer path
- minimal slots needed to classify future similar turns as note-content requests

It does **not** store rendered answer text as reusable output.

### Example slots

```ts
{
  action_type: 'content_intent',
  noteAnchorRequired: true,
  intentSubtype: 'summary' | 'question' | 'find_text',
  anchorSource: 'active_widget' | 'resolved_reference'
}
```

### Files

| File | Change |
|---|---|
| `lib/chat/routing-log/memory-write-payload.ts` | Extend writer eligibility to allow `content_answered` memory rows; add `content_intent` payload shape |
| `app/api/chat/routing-memory/route.ts` | Accept/store `content_intent` memory rows |
| `app/api/chat/routing-memory/semantic-lookup/route.ts` | Add filtered lookup mode for `content_intent` exemplars only |
| `lib/chat/routing-log/memory-reader.ts` or semantic reader seam | Add client helper for content-intent semantic lookup |
| `__tests__/unit/routing-log/memory-write-payload.test.ts` | Add content-intent memory writer coverage |
| `__tests__/unit/routing-log/semantic-lookup-route.test.ts` | Add filtered content-intent semantic lookup coverage |

### Phase B tests

1. `content_answered` result produces non-null memory write payload
2. payload sets `intent_class = 'content_intent'`
3. payload does not require `groundingAction`
4. semantic lookup can filter to `content_intent` only
5. navigation memory behavior remains unchanged

## Phase C: Goal-state Option B for read intent

### Goal

Align anchored-note **read-intent** entry with the broader semantic routing pattern already used in navigation.

### Behavior

For anchored-note turns:

1. active note anchor resolved
2. deterministic hard exclusions run
3. deterministic obvious content wins run
4. content-intent semantic recall runs against successful `content_intent` exemplars
5. if semantic signal is strong enough -> enter existing Stage 6 content path
6. if semantic signal is weak/mixed or exemplar pool is sparse -> call bounded anchored-note LLM fallback
7. if still unresolved -> fall through to safe clarifier / existing routing

### Key principle

This reuses the same philosophy already used in navigation for the **read-intent branch**:

- deterministic obvious wins
- semantic memory for non-exact reuse
- bounded LLM for unresolved or cold-start cases
- safe clarifier when still ambiguous

### Files

| File | Change |
|---|---|
| `lib/chat/routing-dispatcher.ts` | Call content semantic recall first, then bounded LLM fallback, then existing Stage 6 content path |
| `lib/chat/routing-log/payload.ts` | Add content semantic-recall telemetry |
| `app/api/chat/routing-log/route.ts` | Serialize semantic-recall telemetry into `semantic_hint_metadata` |
| `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts` | Add semantic-recall-first integration tests |

### Phase C telemetry

Phase C adds **semantic-recall telemetry only after Phase B lands**. These fields must remain distinct from the Phase A `note_intent_resolver_*` fields so analytics can answer both:

- did the bounded resolver fix the original miss?
- did semantic recall later reduce resolver usage?

```ts
content_semantic_recall_called?: boolean
content_semantic_recall_candidate_count?: number
content_semantic_recall_top_score?: number
content_semantic_recall_result?: 'content' | 'navigation' | 'mixed' | 'empty' | 'error' | 'disabled'
```

### Phase C tests

1. deterministic content match still bypasses semantic recall + fallback
2. semantic recall hit:
   - nearest content exemplars are strong
   - `executeS6Loop(...)` called once
   - Stage 5 replay skipped
3. cold start:
   - semantic recall empty
   - fallback LLM returns `anchored_note_content`
   - content path used
4. mixed semantic neighborhood:
   - fallback LLM decides content/navigation/ambiguous
   - correct path taken
5. semantic recall never feeds Stage 5 navigation replay directly

## Verification

### Phase A

1. `npm run type-check`
2. `npx jest __tests__/unit/chat/anchored-note-intent-resolver.test.ts --runInBand`
3. `npx jest __tests__/unit/chat/content-intent-dispatcher-integration.test.ts --runInBand`
4. existing content suites still pass:
   - `npx jest __tests__/unit/chat/stage6-loop-route.test.ts --runInBand`
   - `npx jest __tests__/unit/chat/content-intent-classifier.test.ts --runInBand`

### Phase B

1. `npx jest __tests__/unit/routing-log/memory-write-payload.test.ts --runInBand`
2. `npx jest __tests__/unit/routing-log/semantic-lookup-route.test.ts --runInBand`
3. validate content-intent rows appear in `chat_routing_memory_index`

### Phase C

1. rerun dispatcher integration suite
2. manual runtime checks:
   - `explain about that note content` on active note -> content answer
   - `show the text of that note` -> content answer
   - `show links panel` -> navigation
   - `show that` -> clarifier
3. verify semantic recall eventually reduces fallback-LMM usage on repeated content-intent phrasing

## Success criteria

### Phase A success

1. `explain about that note content` routes into the existing content-answer path when an active note is anchored
2. no user-visible requirement to guess special phrasing
3. obvious navigation requests still route normally
4. Stage 5 replay does not hijack resolver-classified content turns
5. Phase A telemetry is visible

### Phase B success

1. successful `content_answered` turns populate a reusable semantic exemplar pool
2. navigation memory behavior is unchanged
3. content exemplars remain separable from action exemplars

### Phase C success

1. semantic recall is used before bounded LLM fallback on anchored-note non-exact turns
2. cold start still works via fallback
3. the system moves closer to the agreed ChatGPT web + Cursor AI behavior goal for anchored-note **read** requests

## Summary

`6x.7` is now a staged plan:

1. **ship Option A now** — bounded anchored-note LLM resolver
2. **build the content-intent exemplar pool**
3. **then go for Option B** — semantic recall first, bounded fallback second, for the read-intent branch

This fixes the immediate failure without overclaiming the current semantic-memory capabilities, while still preserving Option B as the goal-state architecture.
