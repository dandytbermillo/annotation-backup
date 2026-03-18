# Stage 6x.8 Phase 3 (a+b+c) — Complete Session Implementation Report

**Date**: 2026-03-14 to 2026-03-17
**Scope**: Cross-surface semantic routing for note families — arbiter, follow-up context, immediate metadata
**Status**: Complete — all phases runtime-proven
**Plan**: `stage6x8-cross-surface-semantic-routing-plan.md`

---

## Session Summary

This session implemented the full Stage 6 content-answer pipeline (6x.4–6x.6), the anchored-note intent resolver (6x.7), and the cross-surface semantic routing architecture (6x.8 Phase 3). The work spans infrastructure fixes, Gemini compatibility, content surfacing, citation display, and cross-surface routing with follow-up context.

---

## Part 1: Infrastructure Fixes (2026-03-14)

Fixed systemic schema mismatches blocking note creation and editing in entry workspaces.

| Fix | Problem | Files |
|-----|---------|-------|
| Control Center toggle | Empty workspace had no "+ Note" button | `annotation-app-shell.tsx` |
| Knowledge Base root | Entry workspaces couldn't find KB root | `app/api/items/route.ts` |
| Entry workspace FK | `note_workspaces` IDs not in `workspaces` table | `app/api/items/route.ts` |
| Phantom `notes.workspace_id` | 7 routes referenced non-existent column | 7 API route files |
| Phantom `panels.workspace_id` | 3 routes referenced non-existent column | 3 API route files |
| `document_saves` trigger | `search_vector` → `search_tsv` column name | SQL function |

---

## Part 2: Stage 6x.4 — Grounded Answer Policy (2026-03-13)

Added `answer` terminal type to the Stage 6 loop with server-enforced citation validation.

- Session snippet registry with session-scoped IDs (`c{call}_{id}`)
- Anchored-note enforcement, cross-note rejection
- 15 new tests, all pass

---

## Part 3: Stage 6x.5 — Surfaced Answer Mode (2026-03-14)

Changed from shadow-only to surfaced product path.

- Single-execution rule: loop runs once, result used for display + durable log
- Citation markers stripped, truncation warning, "Content Answer" provenance badge
- ShowMoreButton gated on `contentTruncated`
- Auto-fill transparency telemetry (`s6_citations_autofilled`, `s6_grounded_autofilled`)
- Per-attempt auto-fill scoping (not stale from earlier failed attempts)

---

## Part 4: Stage 6x.6 — Citation & Snippet Surfacing (2026-03-14)

Collapsible "Sources" section below content answers.

- Snippet registry extended to store text + truncation + section heading
- `CitedSnippet` type on `ChatMessage`, persisted/hydrated through chat history
- `CitationSnippets.tsx` component — collapsed by default
- Only model-cited snippets shown (uncited evidence excluded)

---

## Part 5: Stage 6x.7 Phase A — Anchored-Note Intent Resolver (2026-03-15)

Bounded LLM resolver for classifier-miss cases when active note exists.

- Client helper + server API route following grounding-llm pattern
- Hard-guard helper (`isAnchoredNoteResolverHardExcluded`) with non-read verb exclusion
- Three outcome paths: content → Stage 6, navigation → fallthrough, ambiguous → safe clarifier
- Resolver telemetry wired through all log paths

---

## Part 6: Stage 6x.8 Phase 1 — Deterministic Tier Audit (2026-03-15)

Audited 63 early routing decision points across 6 files.

- 37 exact deterministic wins (59%)
- 17 hard safety exclusions (27%)
- 5 should-escalate to semantic routing (8%)
- 2 mixed rules (greeting guard needs splitting)

---

## Part 7: Stage 6x.8 Phase 3 — Cross-Surface Arbiter (2026-03-15)

Replaced the 6x.7 resolver with a cross-surface semantic arbiter.

### Phase 3 core (2026-03-15)

- **Cross-surface arbiter**: `surface × intentFamily × confidence` classification
- **Greeting-prefix fix**: `DASHBOARD_META_PATTERN` split into `META_ONLY_PATTERN` + `GREETING_PATTERN`
- **New `isArbiterHardExcluded`**: input-level guards without `activeNoteId` requirement
- **Migrated-family gate**: `note:read_content` → Stage 6, `note:state_info` → deterministic resolver
- **Mutate policy**: classified but not executed, immediate bounded response
- **State-info resolver**: `resolveNoteStateInfo()` — deterministic from live UI state
- **Note-reference detection**: `/\b(this|that|the|my|which|what|any|a)\s+(note|document|page)\b/i`

### Phase 3a — Imperative Note-Read Bugfix (2026-03-16)

- Arbiter prompt strengthened with imperative note-read examples
- Bounded fallback when S6 aborts after arbiter `note.read_content` classification
- "show me the content of that note" no longer falls through to entry disambiguation

### Phase 3b — Shared Recent-Turn Routing Context (2026-03-16)

- `RecentRoutingContext` + `PreviousRoutingMetadata` types
- `addMessage` signature updated to accept optional `{ tierLabel }` routing metadata
- Dispatcher builds bounded context with turn-alignment check (`assistantMessageId`)
- Arbiter prompt includes prior-turn context for referential follow-up resolution
- Workspace/note switch clears note-scoped metadata
- Chat reset clears all metadata
- Mismatch guard: omit entire context if assistant ID doesn't align

### Phase 3c — Immediate Routing Metadata Availability (2026-03-17)

- **Race fix**: metadata written immediately after `setMessages` (before async persistence)
- **ID reconciliation**: local assistant ID updated to persisted ID after persistence completes
- **Helper extracted**: `buildPreviousRoutingMetadataFromTierLabel` — returns null for unrecognized labels
- **First follow-up now works on first try** — no retry needed

---

## Runtime Proof (Smoke Pass)

All queries tested at 20:19 on 2026-03-17 with active note:

| Query | Result | First try? |
|-------|--------|-----------|
| "which note is open?" | "The open note is Main Document." | Yes |
| "summarize this note" | Content answer + Sources + Show more | Yes |
| "summarize that again" (follow-up) | Content answer + Sources + Show more | **Yes** |
| "which note is open?" | "Main Document is open in workspace budget100." | Yes |
| "read it" (follow-up) | Content answer + Sources + Show more | **Yes** |
| "show links panel" (override) | "Quick Links panel isn't available" (navigation) | Yes |

---

## Test Results

```
$ npm run type-check → zero errors

Test suites passing:
  stage6-loop-route: 46/46
  stage6-loop-controller: 18/18
  routing-log/mapping: 25/25
  content-intent-classifier: 53/53
  content-intent-dispatcher-integration: 39/39
  citation-snippets: 5/5
  content-answer-persistence: 3/3
  anchored-note-intent-resolver: 8/8
  routing-metadata-timing: 12/12
```

---

## All Files Created or Modified

### New files (this session)

| File | Purpose |
|------|---------|
| `lib/chat/cross-surface-arbiter.ts` | Client helper + types for cross-surface arbiter |
| `app/api/chat/cross-surface-arbiter/route.ts` | Server route (Gemini classification) |
| `lib/chat/state-info-resolvers.ts` | Deterministic note-state resolver |
| `lib/chat/anchored-note-intent-resolver.ts` | Client helper for 6x.7 resolver (superseded by arbiter) |
| `app/api/chat/anchored-note-resolver/route.ts` | Server route for 6x.7 resolver |
| `components/chat/CitationSnippets.tsx` | Collapsible citation display component |
| `__tests__/unit/chat/cross-surface-arbiter.test.ts` | Arbiter unit tests |
| `__tests__/unit/chat/routing-metadata-timing.test.ts` | Metadata helper + reconciliation tests |
| `__tests__/unit/chat/citation-snippets.test.tsx` | Citation component tests |
| `__tests__/unit/chat/content-answer-persistence.test.ts` | Persistence round-trip tests |

### Modified files (this session)

| File | Key changes |
|------|-------------|
| `lib/chat/routing-dispatcher.ts` | Arbiter wiring, recent-turn context, bounded fallback |
| `lib/chat/content-intent-classifier.ts` | Greeting split, `isArbiterHardExcluded`, `isAnchoredNoteResolverHardExcluded` |
| `lib/chat/chat-navigation-context.tsx` | `previousRoutingMetadata` state, immediate write, ID reconciliation, `addMessage` signature |
| `lib/chat/chat-routing-types.ts` | `addMessage` signature update (3 locations) |
| `components/chat/chat-navigation-panel.tsx` | Pass routing metadata to dispatcher, store metadata via `addMessage` |
| `components/chat/ChatMessageList.tsx` | CitationSnippets render, ShowMoreButton gating, `content_answered` badge |
| `lib/chat/stage6-tool-contracts.ts` | `content_answered` outcome, auto-fill telemetry fields |
| `lib/chat/stage6-content-tool-contracts.ts` | `CitedSnippet`, `contentTruncated`, auto-fill telemetry |
| `lib/chat/stage6-loop-controller.ts` | Exported functions, arbiter telemetry threading, `content_answered` provenance |
| `lib/chat/routing-log/payload.ts` | Arbiter + resolver telemetry fields |
| `app/api/chat/routing-log/route.ts` | Serialize arbiter + resolver telemetry |
| `app/api/chat/stage6-loop/route.ts` | Auto-fill, truncation tracking, `citedSnippets` builder, `maxOutputTokens` |
| `app/api/items/route.ts` | KB root visibility, workspace fallback, notes INSERT fix |
| Multiple API routes | Phantom `workspace_id` removals |

---

## Architecture Established

The session established a cross-surface semantic routing architecture:

1. **Exact deterministic** — ordinals, exact commands, safety boundaries
2. **Semantic retrieval / replay** — B1/B2 memory as advisory signals
3. **Bounded LLM arbitration** — one cross-surface arbiter call per uncertain turn
4. **Deterministic family resolution** — Stage 6 for read_content, state-info resolvers for state queries
5. **Fallback clarification** — only after semantic arbitration is still unresolved

Phase 3 migrated `note:read_content` and `note:state_info`. Phase 4 will extend to other surfaces.

---

## Known Limitations

1. Gemini structured output sometimes truncates answers — `maxOutputTokens: 2048` mitigates but doesn't eliminate
2. Provider-level `addMessage` → metadata → reconciliation flow lacks direct React context test (pure function tests cover the logic)
3. `known_noun` routing path doesn't set `_devProvenanceHint` — "Safe Clarifier" badge appears on bounded availability responses
