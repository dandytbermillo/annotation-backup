# Stage 6x.6: Citation & Snippet Surfacing — Plan

**Parent**: `stage6-content-retrieval-and-explanation-design.md`
**Depends on**: 6x.5 (surfaced answer mode, complete)
**Current state**: Not started. The loop produces cited snippet IDs in telemetry but the UI shows only the answer text. Users cannot see the evidence behind the answer.

---

## Problem

The surfaced content-answer path works end-to-end: classify → inspect → answer → display. But the user sees only the synthesized answer text. The cited snippets that ground it are invisible — stored in telemetry (`citedSnippetIds`) and stripped from the display text (citation markers like `c0_s0` removed in 6x.5).

This creates a trust gap: the system claims the answer is grounded, but the user has no way to verify without opening the full note and searching for the relevant passages manually.

---

## What 6x.6 locks

### 1. Citation display model

Each surfaced content answer includes a collapsible "Sources" section below the answer text:

```
┌──────────────────────────────────────────────┐
│ The note discusses budget allocation for     │
│ Q4, with $45k split across digital ads,      │
│ events, and content creation.                │
│                                              │
│ ▶ Sources (2 snippets)                       │
└──────────────────────────────────────────────┘
```

When expanded:

```
┌──────────────────────────────────────────────┐
│ The note discusses budget allocation...      │
│                                              │
│ ▼ Sources (2 snippets)                       │
│ ┌──────────────────────────────────────────┐ │
│ │ "The Q3 budget allocation for the        │ │
│ │ marketing team was $45,000. This         │ │
│ │ included $20,000 for digital ads..."     │ │
│ └──────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────┐ │
│ │ "The ROI on digital ads was 3.2x while   │ │
│ │ events returned 1.8x."                   │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ℹ Based on partial note content              │
└──────────────────────────────────────────────┘
```

### 2. Data flow

The snippet text is already retrieved by the loop but not currently threaded to the client. The flow:

1. **Loop route** (`stage6-loop/route.ts`): `inspect_note_content` returns snippets. The session snippet registry maps `c0_s0 → sourceItemId`. The answer cites specific snippet IDs.
2. **Loop result** (`S6LoopResult`): Currently carries `contentAnswerResult.citedSnippetIds` (IDs only, no text).
3. **Dispatcher** (`routing-dispatcher.ts`): Receives loop result, builds `ChatMessage`.
4. **UI** (`ChatMessageList.tsx`): Renders the message.

**6x.6 addition**: Thread cited snippet **texts** alongside IDs from the loop result to the UI.

### 3. Snippet evidence contract

New type for surfaced citation data:

```typescript
interface CitedSnippet {
  /** Display index (1-based, for user-facing "Snippet 1", "Snippet 2") */
  index: number
  /** The snippet text (plain text, from inspect_note_content response) */
  text: string
  /** Whether this snippet was truncated at extraction time */
  truncated: boolean
  /** Section heading if available (from ProseMirror heading detection) */
  sectionHeading?: string
}
```

This is a UI display type, not a telemetry type. It lives on `ChatMessage`, not in the telemetry pipeline.

### 4. What is NOT shown to users

- Raw snippet IDs (`c0_s0`) — internal identifiers, meaningless to users
- Auto-fill markers (`s6_citations_autofilled`) — eval/debug only
- Source item UUID — the user already knows which note was queried (it's their active note)
- Session call index — internal loop bookkeeping

### 5. Collapsed by default

The "Sources" section is collapsed by default. Rationale:
- Most users want the answer, not the evidence
- Expanding is one click away for users who want to verify
- Keeps the chat message compact
- Avoids overwhelming users with long quoted passages

### 6. Truncation indicator

If `contentTruncated === true` on the message, show a small info line below the snippets:
> "Based on partial note content. Some sections may not be included."

This reuses the existing `contentTruncated` flag already on `ChatMessage`.

---

## Files to change

| File | Change |
|------|--------|
| `app/api/chat/stage6-loop/route.ts` | Capture cited snippet texts from session alongside IDs; attach to `contentAnswerResult`; update cross-note validation to read `registryEntry.sourceItemId` from the richer registry shape |
| `lib/chat/stage6-content-tool-contracts.ts` | Add `citedSnippets?: CitedSnippet[]` to `S6ContentAnswerResult` |
| `lib/chat/chat-navigation-context.tsx` | Add `citedSnippets?: CitedSnippet[]` to `ChatMessage`; persist/hydrate surfaced-answer display metadata through existing message `metadata` so evidence, note identity, ShowMore eligibility, and truncation state survive chat reload/history |
| `lib/chat/routing-dispatcher.ts` | Thread `citedSnippets` from loop result to `ChatMessage` |
| `components/chat/ChatMessageList.tsx` | Render collapsible "Sources" section when `citedSnippets` is present |
| `components/chat/CitationSnippets.tsx` | **New file**: collapsible snippet display component |

One new file (`CitationSnippets.tsx`). No new feature flags. No database changes. No telemetry changes.

---

## Implementation steps

### Step 1: Capture snippet texts in loop route

The session snippet registry currently maps `snippetId → sourceItemId`. Extend it to also store the snippet text:

```typescript
// Current:
const sessionSnippetRegistry = new Map<string, string>()  // id → sourceItemId

// 6x.6:
const sessionSnippetRegistry = new Map<string, { sourceItemId: string; text: string; truncated: boolean; sectionHeading?: string }>()
```

When building the answer result, look up cited snippet texts from the registry. **Only cited snippet IDs are included** — uncited registry entries (snippets the model retrieved but did not reference in its answer) are excluded. This keeps the display bounded to what the model actually used as evidence.

```typescript
// In the answer builder, after citation validation:
const citedSnippets: CitedSnippet[] = parsed.citedSnippetIds
  .map((id, i) => {
    const entry = sessionSnippetRegistry.get(id)
    if (!entry) return null
    return { index: i + 1, text: entry.text, truncated: entry.truncated, sectionHeading: entry.sectionHeading }
  })
  .filter(Boolean)
```

**Exception**: When `citedSnippetIds` was auto-filled (all registry entries), all snippets are included since auto-fill treats them all as evidence. This is accurate — the model generated its answer from all retrieved content.

Because the registry shape changes from `Map<string, string>` to a richer object map, the existing single-note validation must be updated too. The cross-note check must read `entry.sourceItemId` from the registry entry:

```typescript
const sourceItems = new Set(
  parsed.citedSnippetIds
    .map(id => sessionSnippetRegistry.get(id)?.sourceItemId)
    .filter(Boolean),
)
```

This preserves the 6x.4 single-note safety contract while adding snippet display data.

### Step 2: Extend contracts

Add `citedSnippets` to `S6ContentAnswerResult`:

```typescript
interface S6ContentAnswerResult {
  // ... existing fields
  /** Cited snippet display data for UI (6x.6). Not telemetry — display only. */
  citedSnippets?: CitedSnippet[]
}
```

Define `CitedSnippet` in `stage6-content-tool-contracts.ts`.

### Step 3: Thread to ChatMessage and persist/hydrate it

In `routing-dispatcher.ts`, when building the assistant message:

```typescript
const assistantMessage: ChatMessage = {
  // ... existing fields
  citedSnippets: loopResult.contentAnswerResult.citedSnippets,
}
```

Add `citedSnippets?: CitedSnippet[]` to `ChatMessage`.

In `chat-navigation-context.tsx`, persist surfaced-answer display metadata through the existing message `metadata` field so live-session behavior matches reloaded history:

1. `persistMessage(...)`: include the surfaced-answer display metadata in `metadata` for assistant messages when present:
   - `citedSnippets`
   - `itemId`
   - `itemName`
   - `corpus`
   - `contentTruncated`
2. `dbMessageToChatMessage(...)`: hydrate those fields back onto `ChatMessage`
3. Reuse the existing metadata persistence path; no DB schema change is required

Without this, citation evidence and related surfaced-answer behavior would appear only for the current in-memory session and disappear or degrade after history reload.

### Step 4: Build CitationSnippets component

New component `components/chat/CitationSnippets.tsx`:

- Collapsible "Sources (N snippets)" header
- Each snippet rendered as a quoted text block
- Section heading shown if available
- Truncation indicator per snippet
- Collapsed by default, toggle state local to component
- Styled to match existing chat message aesthetic (dark theme, subtle borders)

### Step 5: Render in ChatMessageList

In `ChatMessageList.tsx`, after the message content and before ShowMoreButton:

```tsx
{message.citedSnippets && message.citedSnippets.length > 0 && (
  <CitationSnippets snippets={message.citedSnippets} />
)}
```

### Step 6: Tests

| Test | What it verifies |
|------|-----------------|
| Route: cited snippet texts captured in answer result | `contentAnswerResult.citedSnippets` has correct text for each cited ID |
| Route: only cited snippets included (not all registry entries) | Uncited snippets excluded from `citedSnippets` |
| Route: auto-filled citations include all snippet texts | When citations are auto-filled, all registry snippets are included |
| Route: cross-note validation still works with richer registry entries | Single-note enforcement still reads `sourceItemId` correctly after registry shape change |
| Dispatcher: `citedSnippets` threaded to ChatMessage | `ctx.addMessage` call includes snippet data |
| Context: surfaced-answer metadata persisted and hydrated | Assistant message survives history reload with `citedSnippets`, `itemId`, `itemName`, `corpus`, and `contentTruncated` intact |
| Component: collapsed by default | Renders "Sources" header, snippets not visible |
| Component: expand/collapse toggle | Click toggles snippet visibility |
| Component: truncation indicator | Shows partial-content note when `contentTruncated` |

---

## Design decisions

1. **Collapsed by default.** The answer is the primary content. Citations are secondary evidence for users who want to verify. This mirrors how search engines show snippets — available but not dominant.

2. **Plain text snippets, not rich text.** The extraction pipeline already converts ProseMirror to plain text. Rendering rich text (bold, links, tables) would require preserving ProseMirror structure through the loop, which is out of scope for 6x.6.

3. **No snippet highlighting.** Highlighting the exact passage the model used within the snippet would require token-level attribution, which the current pipeline doesn't support. The snippet itself is the evidence boundary.

4. **Snippet text stored on ChatMessage, not fetched on demand.** The text is small (bounded by `MAX_CHARS_PER_SNIPPET`) and already retrieved during the loop. Storing it on the message avoids an extra API call when the user expands "Sources." Trade-off: slightly larger message objects in memory.

5. **One new component file.** `CitationSnippets.tsx` is the only new file. It's a self-contained display component with no business logic beyond collapse/expand state.

6. **No telemetry changes.** Citation display is a UI concern. The existing `s6_answer_cited_count` and `citedSnippetIds` telemetry is sufficient for eval. Whether the user expanded the citations is not tracked in 6x.6 (could be added later as a UX metric).

---

## Out of scope

- Rich text snippet rendering (ProseMirror preservation)
- Token-level highlight within snippets
- Citation click → scroll to position in note
- Cross-note citation display (Slice 1 is single-note)
- Citation expansion analytics / UX metrics
- Inline footnote-style citations within the answer text
