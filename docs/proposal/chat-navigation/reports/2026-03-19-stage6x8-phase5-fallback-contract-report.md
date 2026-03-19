# Stage 6x.8 Phase 5 — Fallback Contract Implementation Report

**Date:** 2026-03-19
**Status:** Implemented, targeted-test green, runtime-verified

## Summary

Phase 5 is now operating under the finalized contract:

1. **Deterministic and semantic retrieval remain first**
   - exact-hit shortcut
   - semantic retrieval hints
   - no-LLM completion when an existing validated resolver already suffices

2. **Bounded LLM is the fallback**
   - used when deterministic + semantic retrieval do not resolve sufficiently
   - receives the **panel-normalized user query**, not necessarily the literal untouched input
   - retrieval hints, when present, are optional evidence

3. **Validation remains the execution authority**
   - navigation still validates current state before executing
   - history/info still resolves from committed session state or action history

This closes the main design ambiguity from the addendum work: the product is **semantic-first for cost**, **LLM-fallback for robustness**, and **validator-led for correctness**.

**Design docs:**
- `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-retrieval-backed-semantic-memory-plan.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-wrapper-heavy-retrieval-recall-addendum.md`

## Final Runtime Contract

### 1. Default order

Phase 5 handling now follows this order:

1. deterministic / local rescue
2. exact-hit shortcut when available
3. semantic retrieval for hints
4. direct validated resolution when exact-hit or strong unambiguous retrieval is already sufficient
5. bounded LLM fallback only when the earlier steps did not resolve sufficiently
6. final validation / execution / answer

### 2. What the bounded LLM actually receives

The bounded LLM fallback currently receives the **panel-normalized user query**.

That means:
- conversational prefixes such as `can you`, `could you`, `i want to`, `hello`, `hey`
- and some trailing politeness phrases

may already be stripped by the UI-layer `normalizeUserMessage(...)` helper before the request reaches `/api/chat/navigate`.

This is intentional and accepted as the implementation contract because it improves LLM classification for conversational requests. The literal raw input is still preserved separately for:
- logs
- UI display
- telemetry
- writeback exemplars

### 3. Retrieval remains hinting, not a gate

Retrieval still matters:
- it reduces unnecessary LLM usage on exact-hit or strong retrieval cases
- it supplies optional semantic evidence to the bounded LLM
- it preserves a real no-LLM path when the resolver can already finish safely

But retrieval no longer blocks the LLM from helping on noisy conversational phrasing.

### 4. Near-tie policy

Near-ties are now closed conservatively:
- if retrieval returns a near-tie across conflicting actions or conflicting targets, the system clarifies directly
- bounded-LLM comparison for near-ties is **not currently allowed**
- the allowed near-tie comparison set is empty until a future policy explicitly defines tie classes

## Files Involved

| File | Role |
|------|------|
| `lib/chat/routing-dispatcher.ts` | Scope detection, Phase 5 override, near-tie clarifier, telemetry |
| `components/chat/chat-navigation-panel.tsx` | Forwards panel-normalized message plus Phase 5 hint metadata to navigate |
| `app/api/chat/navigate/route.ts` | Bounded-LLM interpretation, hint injection, structured rescue, validation path |
| `app/api/chat/routing-memory/semantic-lookup/route.ts` | Exact-hit shortcut, semantic hint lookup, retrieval telemetry |
| `lib/chat/routing-log/memory-semantic-reader.ts` | Parses lookup response and Phase 5 retrieval metadata |
| `lib/chat/routing-log/payload.ts` | Telemetry shape |
| `app/api/chat/routing-log/route.ts` | Telemetry persistence builder |
| `lib/chat/ui-helpers.ts` | UI-level `normalizeUserMessage(...)` contract |

## Behavioral Result

### What changed

Before this fallback contract:
- wrapper-heavy variants that missed retrieval could still fall into the tier chain
- arbiter/clarifier paths could block navigate
- the bounded LLM often never got a useful shot at the request

After this fallback contract:
- if `detectHintScope(...)` identifies `history_info` or `navigation`, the tier chain is bypassed unless a direct near-tie clarifier is required
- the navigate API gets the panel-normalized query
- hints are attached when available, but are not required
- strong exact/semantic retrieval can still finish without LLM when the existing validated resolver already knows enough

## Targeted Test Status

Targeted Phase 5 / regression suites are green:

- `8` suites passed
- `176` tests passed
- `0` failures

This covers:
- exact-hit shortcut behavior
- retrieval normalization behavior
- multi-pass retrieval and dedupe
- lowered navigation floor
- near-tie detection
- dispatcher / state-info regressions

This does **not** claim the entire repository test suite is green. It only claims the targeted Phase 5 slice and relevant regressions are green.

## Runtime Verification

Manual smoke testing showed the expected recovery behavior for previously problematic conversational variants:

### Home / Return Home
- `can you pls return home` -> correct already-home response
- `i what you to return home` -> correct already-home response
- `pls take me home now. thank you very much!` -> correct already-home response
- `can you pls take me home now` -> correct go-home execution
- `okay. can you pls take me home now?` -> correct already-home response

### Regression checks
- `open recent widget` -> unchanged auto-execute path
- `open budget100` -> unchanged memory-exact path
- `which note is open right now?` -> unchanged content answer path
- `summarize it for me` -> unchanged content answer path

These results show:
- conversational wrapper-heavy navigation recovery is materially improved
- malformed phrasing recovery is improved
- other routing lanes still behave normally

## Known Limitations

1. **Panel-normalized, not literal raw input**
   - the bounded LLM fallback sees the panel-normalized query, not the untouched user string
   - this is accepted behavior, but the terminology must stay precise in docs and reports

2. **No new full-stack seam tests for the transport contract**
   - current tests and smoke runs are strong enough for acceptance
   - but there is still room for explicit seam tests proving exactly what text reaches navigate

3. **Near-tie bounded comparison is intentionally disabled**
   - all near-ties clarify directly for now
   - future relaxation requires a separate policy, not ad hoc implementation

4. **Retrieval scope detection is still v1-narrow**
   - the fallback design improves robustness
   - but `detectHintScope(...)` remains intentionally limited to the currently approved Phase 5 intent families

## Conclusion

Phase 5 is now in a stable state:

- semantic retrieval remains the default cost-saving path
- bounded LLM acts as the fallback, not the default
- exact/strong retrieval can still complete without LLM
- near-ties clarify directly by default
- validation remains the final authority

From a behavior and contract standpoint, this slice is ready to close.
