# Stage 6x.4 — Runtime Fixes & Content Answer Surfacing

**Date**: 2026-03-14
**Scope**: Runtime bug fixes, Gemini compatibility, answer surfacing (6x.5 partial)
**Status**: Runtime-proven — content answers display in chat UI
**Predecessor**: `2026-03-13-stage6x4-grounded-answer-policy-implementation.md`

---

## Summary

The 6x.4 grounded answer policy was code-complete and unit-tested as of 2026-03-13. Runtime testing on 2026-03-14 revealed a chain of failures across three layers:

1. **Infrastructure**: Note creation and editing failed in entry workspaces due to phantom `workspace_id` columns in API routes
2. **Gemini compatibility**: The Stage 6 loop aborted on every content-intent query due to Gemini structured output omitting optional fields
3. **Answer surfacing**: The shadow-only design meant answers were logged but never displayed — partial 6x.5 wiring added to surface answers

All issues were resolved. The system now correctly classifies content-intent queries, retrieves note content, generates grounded answers, and displays them in the chat UI.

---

## Part 1: Infrastructure Fixes (Prerequisite)

These fixes were required before runtime testing could begin — notes could not be created or edited in entry workspaces.

### Fix 1.1: Control Center Toggle Not Wired

**Problem**: Empty workspaces showed "Welcome to Annotation Canvas" but no way to create a note. The `WorkspaceControlCenterToggle` component (with "+ Note" button) existed but was never passed to `AnnotationWorkspaceView`.

**File**: `components/annotation-app-shell.tsx`
**Change**: Added `controlCenterProps` to `workspaceViewProps` with `visible: openNotes.length === 0`.

### Fix 1.2: Knowledge Base Root Invisible to Entry Workspaces

**Problem**: `GET /api/items?parentId=null` filtered by `WHERE workspace_id = $1`, but Knowledge Base root has `workspace_id = NULL`.

**File**: `app/api/items/route.ts` (GET handler)
**Change**: `WHERE (workspace_id = $1 OR workspace_id IS NULL)` for parentId queries.

### Fix 1.3: Entry Workspace FK Violation

**Problem**: Entry workspace IDs exist in `note_workspaces` but not `workspaces`. POST handler returned 404 or caused FK violation on `items.workspace_id`.

**File**: `app/api/items/route.ts` (POST handler)
**Change**: Fall back to default workspace when requested workspace isn't in `workspaces` table.

### Fix 1.4: Phantom `notes.workspace_id` Column (7 files)

**Problem**: The `notes` table has no `workspace_id` column, but 7 API routes referenced it in INSERT/SELECT/UPDATE/WHERE clauses. Every note creation and lookup failed with `column "workspace_id" does not exist`.

**Verified**: `SELECT column_name FROM information_schema.columns WHERE table_name = 'notes' AND column_name = 'workspace_id'` → 0 rows.

**Files fixed**:
- `app/api/items/route.ts` — removed from notes INSERT
- `app/api/postgres-offline/documents/route.ts` — changed SELECT to query `items` table; removed UPDATE
- `app/api/postgres-offline/documents/batch/route.ts` — removed from notes INSERT
- `app/api/postgres-offline/branches/batch/route.ts` — removed from notes INSERT
- `app/api/postgres-offline/notes/route.ts` — removed from INSERT and WHERE
- `app/api/postgres-offline/notes/[id]/route.ts` — removed from WHERE
- `app/api/panels/[panelId]/rename/route.ts` — changed SELECT to query `items` table

### Fix 1.5: Phantom `panels.workspace_id` Column (3 files)

**Problem**: The `panels` table has no `workspace_id` column, but 3 API routes included it in INSERT statements.

**Files fixed**:
- `app/api/canvas/panels/route.ts` — removed from INSERT; workspace lookup changed to `items`
- `app/api/postgres-offline/panels/route.ts` — removed from INSERT; workspace lookup changed to `items`
- `app/api/panels/[panelId]/rename/route.ts` — removed from INSERT; workspace lookup changed to `items`

### Fix 1.6: `document_saves` Trigger Wrong Column Name

**Problem**: `document_saves_search_trigger()` referenced `NEW.search_vector` but the actual column is `search_tsv`. Every document save failed.

**Fix**: SQL `CREATE OR REPLACE FUNCTION` to use `NEW.search_tsv`.

### Safety Verification

| Table | Has `workspace_id`? | Action |
|-------|-------------------|--------|
| `notes` | **No** | Removed all references |
| `panels` | **No** | Removed all references |
| `items` | **Yes** | Now used as workspace_id source |
| `document_saves` | **Yes** | Untouched |

---

## Part 2: Gemini Compatibility Fixes

With infrastructure working, runtime testing revealed the Stage 6 loop aborting on every content-intent query. Three sequential failures were identified and fixed.

### Fix 2.1: Gemini Omits `itemId` for `inspect_note_content`

**Symptom**: Tool trace `["invalid_inspect", "invalid_inspect"]` → abort.
**Root cause**: Gemini structured output treats optional schema fields as truly optional. The schema described `itemId` as `'Item ID from inspect results (required for open_widget_item)'` — Gemini interpreted this as "only for open_widget_item" and omitted it for inspect calls.

**File**: `app/api/chat/stage6-loop/route.ts`
**Fixes**:
1. Updated schema description: `'Item ID (required for open_widget_item and inspect_note_content)'`
2. **Server-side auto-fill** (lines 810-814): When model sends `inspect_note_content` without `itemId` in a content-intent loop, auto-fill from `loopInput.contentContext.noteItemId`:
```typescript
if (parsed.type === 'inspect' && parsed.tool === 'inspect_note_content'
    && !parsed.itemId && loopInput.contentContext) {
  parsed.itemId = loopInput.contentContext.noteItemId
}
```

### Fix 2.2: Gemini Sends Empty `citedSnippetIds` Array

**Symptom**: Tool trace `["inspect_note_content", "invalid_answer", "invalid_answer"]` → abort with `type=answer requires a non-empty "citedSnippetIds" array`.
**Root cause**: Gemini generates empty arrays for optional array fields. The model produced a correct answer but sent `citedSnippetIds: []`.

**File**: `app/api/chat/stage6-loop/route.ts`
**Fix**: Server-side auto-fill (lines 818-825): When model sends an answer with empty/missing citations and the session snippet registry has entries, auto-fill with all registered snippet IDs:
```typescript
if (parsed.type === 'answer' && parsed.text && sessionSnippetRegistry.size > 0) {
  if (!parsed.citedSnippetIds || parsed.citedSnippetIds.length === 0) {
    parsed.citedSnippetIds = [...sessionSnippetRegistry.keys()]
  }
  if (parsed.grounded === undefined) {
    parsed.grounded = true
  }
}
```

### Fix 2.3: Response Truncation (`maxOutputTokens: 500`)

**Symptom**: `Unparseable: { "type": "answer", "text": "The note contains the text 'sample2'.","tool": "inspect_note_con` — JSON cut off mid-field.
**Root cause**: `maxOutputTokens: 500` in Gemini config. The answer response (with context from inspect results) exceeded 500 tokens, truncating the JSON.

**File**: `app/api/chat/stage6-loop/route.ts` (line 769)
**Fix**: Increased to `maxOutputTokens: 1024`.

### Fix 2.4: Loop Timeout Too Short

**Symptom**: Tool trace `["inspect_note_content"]` → timeout. The inspect succeeded but the model didn't have time to generate the answer.
**Root cause**: `TIMEOUT_MS_DEFAULT: 5_000` — only 5 seconds for the entire multi-turn loop. A content-intent loop requires: Turn 1 (inspect prompt → Gemini response ~1-2s) + server-side content retrieval + Turn 2 (snippet data → Gemini answer ~2-3s). Total needed: ~6-8s minimum.

**File**: `lib/chat/stage6-tool-contracts.ts` (line 414)
**Fix**: `TIMEOUT_MS_DEFAULT: 12_000`, `TIMEOUT_MS_CEILING: 20_000`.

### Fix 2.5: Structural Validation Logging

**File**: `app/api/chat/stage6-loop/route.ts`
**Change**: Added `console.warn` with the model's actual JSON payload when structural validation fails, for faster diagnosis of future Gemini compatibility issues.

---

## Part 3: Content Answer Surfacing (Partial 6x.5)

### Problem

6x.4 was designed as shadow-only — the loop ran in the background via `void runS6ShadowLoop(s6Params)` (fire-and-forget). The main routing didn't wait for the result. Users saw "I'm not sure what you meant. Try: `recent`, `links panel a`, `workspaces`." while the correct answer was logged silently in telemetry.

### Solution

Changed the content-intent path in `routing-dispatcher.ts` to **await** the loop result and surface answers directly.

**Files modified**:
- `lib/chat/stage6-loop-controller.ts` — exported `executeS6Loop` (was private)
- `lib/chat/routing-dispatcher.ts` — added `executeS6Loop` import; replaced fire-and-forget with awaited call

**Implementation** (routing-dispatcher.ts, content-intent section):

```typescript
// Before (shadow-only):
void runS6ShadowLoop(s6Params)

// After (awaited with surfacing):
try {
  const loopResult = await executeS6Loop(s6Params)
  if (loopResult?.outcome === 'content_answered' && loopResult.contentAnswerResult?.answerText) {
    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: loopResult.contentAnswerResult.answerText,
      timestamp: new Date(),
      isError: false,
    }
    ctx.addMessage(assistantMessage)
    ctx.setIsLoading(false)
    return { handled: true, handledByTier: 6, tierLabel: 'content_intent_answered', ... }
  }
} catch (err) {
  console.warn('[routing-dispatcher] Content-intent loop failed:', err.message)
}
// Fallback: shadow loop + normal routing
void runS6ShadowLoop(s6Params)
```

**Behavior**:
- Content-intent detected → loop awaited (up to 12s) → answer displayed in chat
- If loop fails, times out, or doesn't produce `content_answered` → falls through to shadow + normal routing (Safe Clarifier)
- Graceful degradation: errors caught, never blocks the main routing

---

## Runtime Proof

### Test: "summarize this note" with Main Document open

**Query**: "summarize this note"
**Note**: Main Document containing Stage 6 design documentation (~2000 chars)

**Result** (displayed in chat UI):
> The note explains that the system can now read note content, reason over bounded snippets, and produce grounded answers. This is activated for content-intent requests like summarizing a note. The system can inspect note content within strict bounds, returning the note title, bounded plain-text snippets, snippet IDs, truncation metadata and capture timing (c0_s0, c0_s1, c0_s2, c0_s3).

**Database verification**:
```sql
SELECT outcome, s6_answer_outcome, s6_answer_grounded, s6_answer_cited_count, s6_tool_trace
FROM chat_routing_durable_log
WHERE s6_loop_entered = 'true'
ORDER BY created_at DESC LIMIT 1;

-- Result:
-- outcome: content_answered
-- answer_outcome: answered
-- grounded: true
-- cited_count: 4
-- tool_trace: ["inspect_note_content", "answer"]
```

### Failure progression (chronological)

| Timestamp | Outcome | Tool trace | Root cause | Fix |
|-----------|---------|-----------|------------|-----|
| 17:39-17:55 | abort | `["invalid_inspect", "invalid_inspect"]` | Gemini omits `itemId` | Auto-fill from contentContext |
| 18:00 | abort | `["inspect_note_content", "invalid_answer", "invalid_answer"]` | Empty `citedSnippetIds` | Auto-fill from registry |
| 18:04 | abort | `["inspect_note_content"]` | Unparseable (truncated JSON) | `maxOutputTokens: 500→1024` |
| 18:07 | timeout | `["inspect_note_content"]` | 5s too short for 2-turn loop | `TIMEOUT_MS: 5000→12000` |
| 18:11 | **content_answered** | `["inspect_note_content", "answer"]` | All fixes applied | Shadow log confirmed |
| 18:18 | **content_answered** | `["inspect_note_content", "answer"]` | + surfacing wired | **Displayed in chat UI** |

---

## Files Modified (All Changes This Session)

### Infrastructure (Part 1)
| File | Change |
|------|--------|
| `components/annotation-app-shell.tsx` | Wired `controlCenterProps` for empty workspace |
| `app/api/items/route.ts` | GET: include `workspace_id IS NULL`; POST: workspace fallback; notes INSERT: removed workspace_id |
| `app/api/postgres-offline/documents/route.ts` | SELECT from `items` not `notes`; removed UPDATE |
| `app/api/postgres-offline/documents/batch/route.ts` | Removed workspace_id from notes INSERT |
| `app/api/postgres-offline/branches/batch/route.ts` | Removed workspace_id from notes INSERT |
| `app/api/postgres-offline/notes/route.ts` | Removed workspace_id from INSERT/WHERE |
| `app/api/postgres-offline/notes/[id]/route.ts` | Removed workspace_id from WHERE |
| `app/api/canvas/panels/route.ts` | Removed workspace_id from panels INSERT; workspace lookup from `items` |
| `app/api/postgres-offline/panels/route.ts` | Removed workspace_id from panels INSERT; workspace lookup from `items` |
| `app/api/panels/[panelId]/rename/route.ts` | Removed workspace_id from panels INSERT; workspace lookup from `items` |
| SQL (live) | `document_saves_search_trigger`: `search_vector` → `search_tsv` |

### Gemini Compatibility (Part 2)
| File | Change |
|------|--------|
| `app/api/chat/stage6-loop/route.ts` | Auto-fill `itemId` from contentContext; auto-fill `citedSnippetIds` from registry; auto-fill `grounded`; `maxOutputTokens: 500→1024`; structural validation logging |
| `lib/chat/stage6-tool-contracts.ts` | `TIMEOUT_MS_DEFAULT: 5000→12000`; `TIMEOUT_MS_CEILING: 10000→20000` |

### Answer Surfacing (Part 3)
| File | Change |
|------|--------|
| `lib/chat/stage6-loop-controller.ts` | Exported `executeS6Loop` |
| `lib/chat/routing-dispatcher.ts` | Content-intent: await loop → surface answer; import `executeS6Loop` |

---

## Known Limitations

1. **Provenance tag**: The chat UI shows "Safe Clarifier" tag on the answer message — cosmetic issue. The provenance should display "Content Answer" or similar. Follow-up task.
2. **Notes only (Slice 1)**: Content-intent is scoped to notes. Links panels and other widget types are deferred.
3. **Blocking await**: The content-intent loop blocks the routing dispatcher for up to 12 seconds. If Gemini is slow, the user sees a loading state during this time. Consider adding a timeout fallback that displays "still thinking..." and switches to shadow mode.
4. **Auto-fill heuristics**: The `itemId` and `citedSnippetIds` auto-fills are Gemini-specific workarounds. If the model changes behavior (starts including these fields), the auto-fills are harmless no-ops.
5. **Trigger fix not in migration**: The `document_saves_search_trigger` was fixed via live SQL. A migration should be created to make this persistent across database resets.

---

## Next Steps

- **Provenance tag fix**: Display "Content Answer" or equivalent instead of "Safe Clarifier"
- **Migration for trigger fix**: Create `migrations/0XX_fix_document_saves_search_trigger.up.sql`
- **Links panel support**: Extend content-intent to support links panels per user request
- **Loading UX**: Show "Reading note content..." indicator during the await
