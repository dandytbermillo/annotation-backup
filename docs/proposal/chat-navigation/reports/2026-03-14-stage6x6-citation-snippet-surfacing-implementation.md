# Stage 6x.6 — Citation & Snippet Surfacing Implementation Report

**Date**: 2026-03-14
**Slice**: 6x.6
**Status**: Complete — all 6 plan steps implemented
**Plan**: `stage6x6-citation-snippet-surfacing-plan.md`
**Predecessor**: `2026-03-14-stage6x5-surfaced-answer-mode-implementation.md`

---

## Summary

6x.6 closes the trust gap between surfaced content answers and their evidence. Users can now expand a collapsible "Sources" section below any content answer to see the exact note snippets the answer was grounded on. The implementation threads snippet display data from the loop route through the dispatcher to the UI, with persistence so citations survive chat history reload.

---

## What Was Implemented

### Step 1: Snippet registry shape extension

The session snippet registry in `stage6-loop/route.ts` was upgraded from a simple ID→string map to a richer shape that stores display data alongside the source item ID:

```typescript
// Before (6x.4):
Map<string, string>  // snippetId → sourceItemId

// After (6x.6):
Map<string, { sourceItemId: string; text: string; truncated: boolean; sectionHeading?: string }>
```

**Downstream updates**:
- Cross-note validation at line 987 updated to read `.sourceItemId` from the registry entry (was reading the string value directly)
- Answer builder at line 1006 constructs `citedSnippets` array by looking up text from the registry, filtered to only cited snippet IDs

**File**: `app/api/chat/stage6-loop/route.ts`

### Step 2: Contract types

- `CitedSnippet` interface added to `stage6-content-tool-contracts.ts` with `index`, `text`, `truncated`, `sectionHeading?`
- `citedSnippets?: CitedSnippet[]` added to `S6ContentAnswerResult`

**File**: `lib/chat/stage6-content-tool-contracts.ts`

### Step 3: ChatMessage threading + persistence/hydration

**Threading**: `citedSnippets` threaded from loop result → dispatcher → `ChatMessage` at `routing-dispatcher.ts:1508`.

**ChatMessage type**: `citedSnippets?: CitedSnippet[]` added at `chat-navigation-context.tsx:425`.

**Persistence** (line 937): `persistMessage` now includes `citedSnippets`, `itemId`, `itemName`, `corpus`, and `contentTruncated` in the metadata object when present.

**Hydration** (line 727): `dbMessageToChatMessage` now reads those fields back from `metadata` onto `ChatMessage`.

**DbMessage type** (line 572): Extended with the same metadata fields so TypeScript can resolve them.

**Files**: `lib/chat/chat-navigation-context.tsx`, `lib/chat/routing-dispatcher.ts`

### Step 4: CitationSnippets component

New file `components/chat/CitationSnippets.tsx`:
- Collapsible "Sources (N snippets)" header with chevron icon
- Collapsed by default (`useState(false)`)
- Each snippet rendered as a bordered text block
- Optional section heading shown above snippet text
- Per-snippet "Snippet truncated" indicator when `truncated: true`
- Response-level "Based on partial note content" note when `contentTruncated: true`
- Dark theme styling matching existing chat aesthetic

### Step 5: Rendered in ChatMessageList

`CitationSnippets` imported and rendered in `ChatMessageList.tsx` after the message content, before the ShowMoreButton, when `message.citedSnippets?.length > 0`.

**File**: `components/chat/ChatMessageList.tsx`

### Step 6: Tests

**Route-level** (`stage6-loop-route.test.ts`, 3 new tests):

| Test | Verifies |
|------|----------|
| Cited snippet texts captured in answer result | `citedSnippets` has correct text for each cited ID |
| Only cited snippets included | Uncited registry entries excluded |
| Cross-note validation works with richer registry | `.sourceItemId` accessor correct after shape change |

**Dispatcher-level** (`content-intent-dispatcher-integration.test.ts`, 1 new test):

| Test | Verifies |
|------|----------|
| `citedSnippets` threaded to ChatMessage | `ctx.addMessage` call includes snippet data |

**Persistence/hydration** (`content-answer-persistence.test.ts`, 3 new tests):

| Test | Verifies |
|------|----------|
| All surfaced-answer fields survive round-trip | `citedSnippets`, `itemId`, `itemName`, `corpus`, `contentTruncated` persist and hydrate |
| Snippet truncation and sectionHeading survive | Per-snippet metadata round-trips correctly |
| Plain messages hydrate cleanly | No surfaced-answer fields on normal messages |

**Component** (`citation-snippets.test.tsx`, 5 new tests):

| Test | Verifies |
|------|----------|
| Empty snippets returns null | No render for zero citations |
| Collapsed by default | Header visible, snippet text not rendered, `aria-expanded="false"` |
| Singular label | "Sources (1 snippet)" for single citation |
| No truncation note when false | Partial-content warning absent |
| Button structure | `type="button"` and `aria-expanded` present |

---

## Test Results

```
$ npm run type-check
→ zero errors

$ npx jest --testPathPattern "stage6-loop-route|stage6-loop-controller|routing-log/mapping|content-intent-dispatcher|citation-snippets|content-answer-persistence"
→ 116/116 pass (6 suites)

Breakdown:
  stage6-loop-route: 46/46
  stage6-loop-controller: 18/18
  routing-log/mapping: 25/25
  content-intent-dispatcher-integration: 19/19
  citation-snippets: 5/5
  content-answer-persistence: 3/3
```

---

## All Files Modified

### Production code
| File | Change |
|------|--------|
| `app/api/chat/stage6-loop/route.ts` | Registry shape upgrade; cross-note validation fix; `citedSnippets` builder; `CitedSnippet` import |
| `lib/chat/stage6-content-tool-contracts.ts` | `CitedSnippet` interface; `citedSnippets` on `S6ContentAnswerResult` |
| `lib/chat/chat-navigation-context.tsx` | `citedSnippets` on `ChatMessage` and `DbMessage`; persistence in `persistMessage`; hydration in `dbMessageToChatMessage` |
| `lib/chat/routing-dispatcher.ts` | Thread `citedSnippets` to assistant message |
| `components/chat/ChatMessageList.tsx` | Import + render `CitationSnippets` component |
| `components/chat/CitationSnippets.tsx` | **New file**: collapsible citation display component |

### Test code
| File | Change |
|------|--------|
| `__tests__/unit/chat/stage6-loop-route.test.ts` | 3 new tests (cited texts, selective citation, cross-note regression) |
| `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts` | 1 new test (dispatcher threading) |
| `__tests__/unit/chat/content-answer-persistence.test.ts` | **New file**: 3 tests (persistence/hydration round-trip) |
| `__tests__/unit/chat/citation-snippets.test.tsx` | **New file**: 5 tests (component rendering) |

---

## Known Limitations

1. **Persistence test is contract-level, not integration-level.** The test simulates the persist/hydrate logic rather than calling the real internal functions (which are unexported). This covers shape regressions but not implementation-path regressions.

2. **Component tests use SSR rendering, not interactive client rendering.** `@testing-library/react` is not installed. Tests verify collapsed initial state and structure but cannot test expand/collapse click behavior or post-expansion content.

3. **No citation expansion analytics.** Whether users expand the "Sources" section is not tracked. Could be added as a UX metric in a future slice.

---

## Design Doc Update

`stage6-content-retrieval-and-explanation-design.md` §12 should be updated to mark 6x.6 as IMPLEMENTED. (Deferred to batch update with any future slices.)
