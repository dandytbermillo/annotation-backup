# Dev-Only Chat Provenance Debug Overlay — Implementation Report

**Date:** 2026-02-11
**Feature slug:** `chat-navigation`
**Governing plan:** `/Users/dandy/.claude/plans/wiggly-juggling-haven.md`

---

## Summary

Added a dev-only visual overlay showing the routing provenance of each assistant response in the chat UI. Each assistant message gets a colored badge indicating whether it was resolved deterministically, auto-executed by LLM, or LLM-influenced (safe clarifier with reorder).

Gated behind `NEXT_PUBLIC_CHAT_PROVENANCE_DEBUG=true` AND `NODE_ENV !== 'production'`. Zero production leakage.

---

## Changes

### 1. `lib/chat/chat-navigation-context.tsx` (+30 lines)

- Added `ChatProvenance` type: `'deterministic' | 'llm_executed' | 'llm_influenced'`
- Added `isProvenanceDebugEnabled()` function (hard dev-only gate: flag + non-production)
- Added `provenanceMap` state (`Map<string, ChatProvenance>`)
- Added `setProvenance`, `clearProvenanceMap` callbacks
- Added `lastAddedAssistantIdRef` (context-level ref for atomic attribution)
- Augmented `addMessage` to track last assistant message ID when debug enabled
- All exposed in `ChatNavigationContextValue` interface and provider value

### 2. `lib/chat/index.ts` (+2 lines)

- Exported `isProvenanceDebugEnabled` function and `ChatProvenance` type

### 3. `lib/chat/chat-routing.ts` (+5 lines)

- Imported `ChatProvenance` type
- Added `_devProvenanceHint?: ChatProvenance` to `ClarificationInterceptResult`
- Annotated 4 LLM-specific return paths:
  - Tier 1b.3 auto-execute: `'llm_executed'`
  - Tier 1b.3 safe clarifier: `llmResult.suggestedId ? 'llm_influenced' : undefined`
  - Scope-cue auto-execute: `'llm_executed'`
  - Scope-cue safe clarifier: `llmResult.suggestedId ? 'llm_influenced' : undefined`

### 4. `lib/chat/routing-dispatcher.ts` (+10 lines)

- Imported `ChatProvenance` type
- Added `_devProvenanceHint?: ChatProvenance` to `RoutingDispatcherResult`
- Passed through from `clarificationResult._devProvenanceHint`
- Annotated grounding LLM tiers:
  - `grounding_llm_select`: `'llm_executed'`
  - `grounding_llm_select_message_fallback`: `'llm_executed'`
  - `grounding_llm_referent_execute`: `'llm_executed'`
  - `grounding_llm_widget_item_execute`: `'llm_executed'`
  - `grounding_llm_need_more_info`: `'llm_influenced'`
  - `grounding_llm_fallback_clarifier`: `'llm_influenced'`

### 5. `components/chat/chat-navigation-panel.tsx` (+15 lines)

- Imported `isProvenanceDebugEnabled`
- Destructured `provenanceMap`, `setProvenance`, `clearProvenanceMap`, `lastAddedAssistantIdRef` from context
- Before `dispatchRouting`: reset `lastAddedAssistantIdRef.current = null`
- After `dispatchRouting` returns (handled): tag `lastAddedAssistantIdRef.current` with `routingResult._devProvenanceHint ?? 'deterministic'`
- After LLM API fallthrough: tag with `'llm_executed'`
- `clearChat`: added `clearProvenanceMap()` call
- `ChatMessageList` render: pass `provenanceMap` when debug enabled

### 6. `components/chat/ChatMessageList.tsx` (+25 lines)

- Added `provenanceMap?: Map<string, ChatProvenance>` prop
- Added inline `ProvenanceBadge` component with 3 styles:
  - Green: `Deterministic`
  - Blue: `Auto-Executed`
  - Yellow: `LLM-Influenced`
- Badge renders after message bubble for assistant messages when provenance is known

### 7. `__tests__/unit/chat/selection-vs-command-arbitration.test.ts` (+8 lines)

- Auto-execute test: assert `_devProvenanceHint === 'llm_executed'`
- Kill-switch OFF test: assert `_devProvenanceHint === 'llm_influenced'`
- Below threshold test: assert `_devProvenanceHint === 'llm_influenced'`
- LLM disabled test: assert `_devProvenanceHint === undefined`

### 8. `__tests__/unit/chat/provenance-badge.test.tsx` (new, 74 lines)

- Badge renders with correct class when provenanceMap contains message ID
- No badge when provenanceMap is undefined (production gate)
- No badge when message ID not in map
- Correct style for each of 3 provenance types

---

## Key Design Decision: Context-Level Ref

The critical design choice was using a **context-level `lastAddedAssistantIdRef`** instead of a local `addMessageWithTracking` wrapper around `dispatchRouting`.

**Problem:** `handleSelectOption` is a `useCallback` that captures `addMessage` from the context provider's closure. Auto-execute calls `handleSelectOption` → `addMessage(assistantMsg)` INSIDE `dispatchRouting`, before it returns. A local wrapper passed to `dispatchRouting` would never be seen by `handleSelectOption`.

**Solution:** Track the last assistant message ID inside the context provider's `addMessage` itself (via `lastAddedAssistantIdRef`). Then tag post-hoc using the routing result's `_devProvenanceHint`. This catches ALL `addMessage` calls regardless of call site.

---

## Migrations/Scripts/CI

None. No database changes. Feature gated by client-side env var + build-time NODE_ENV.

---

## Commands

```bash
# Type check
npx tsc --noEmit

# Unit + integration + badge tests
npx jest __tests__/unit/chat/selection-vs-command-arbitration.test.ts __tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts __tests__/unit/chat/provenance-badge.test.tsx --no-coverage --runInBand

# Enable overlay (add to .env.local, dev mode only)
NEXT_PUBLIC_CHAT_PROVENANCE_DEBUG=true
```

---

## Test Results

```
Type-check:
$ npx tsc --noEmit
__tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005: ')' expected.
(Pre-existing, unrelated — documented in MEMORY.md)

Unit + Integration + Badge:
$ npx jest [...] --no-coverage --runInBand
PASS __tests__/unit/chat/selection-vs-command-arbitration.test.ts
PASS __tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts
PASS __tests__/unit/chat/provenance-badge.test.tsx
Test Suites: 3 passed, 3 total
Tests:       83 passed, 83 total
```

---

## Safety Summary

| Gate | Check | Fail behavior |
|------|-------|---------------|
| Env flag | `NEXT_PUBLIC_CHAT_PROVENANCE_DEBUG === 'true'` | No badges, no tracking |
| NODE_ENV | `!== 'production'` | No badges, no tracking |
| Message not in map | `provenanceMap.has(id)` check | No badge for that message |
| Clear chat | `clearProvenanceMap()` | Map cleared, no stale badges |

**Production safety:** `isProvenanceDebugEnabled()` returns `false` in production builds regardless of flag value. The `provenanceMap` state is never populated and the `lastAddedAssistantIdRef` tracking is skipped entirely.

---

## Errors Encountered

None. Implementation was clean — all tests passed on first run.

---

## Risks/Limitations

1. **Sidecar map is not persisted** — provenance badges are lost on page reload. This is by design (dev-only, ephemeral).
2. **Multiple assistant messages per routing cycle** — `lastAddedAssistantIdRef` tracks the LAST one only. In practice, each routing path adds exactly one assistant message, so this is not an issue.
3. **Badge test uses `ReactDOMServer.renderToStaticMarkup`** instead of `@testing-library/react` (not available in project). Functionally equivalent for static render assertions.

---

## Next Steps

1. Manual verification with `NEXT_PUBLIC_CHAT_PROVENANCE_DEBUG=true`:
   - `open links panel` → disambiguation → badge: `Deterministic`
   - `can you ope panel d pls` (auto-execute ON) → badge: `Auto-Executed`
   - `can you ope panel d pls` (auto-execute OFF) → clarifier → badge: `LLM-Influenced`
   - Remove flag → no badges
   - Clear chat → no stale badges
2. Schedule flag removal when no longer needed for debugging
