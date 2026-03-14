# Stage 6x.4 — Grounded Answer Policy Implementation Report

**Date**: 2026-03-13
**Slice**: 6x.4
**Status**: Code-complete, unit-tested, shadow-ready
**Policy plan**: `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x4-grounded-answer-policy-plan.md`

---

## Summary

Stage 6x.4 adds a grounded `answer` terminal type to the Stage 6 Agent Tool Loop. Previously, the loop could only produce navigation actions (`action`), clarifications (`clarify`), or aborts (`abort`). Content-intent queries like "summarize this note" would abort even when the loop had sufficient evidence from `inspect_note_content`.

With 6x.4, the loop can now produce text answers grounded in retrieved note content, with server-enforced citation validation.

**Scope**: Note content only (Slice 1). Links panels and other widget types are deferred to a future slice.

---

## Changes

### 1. Contract Extension — `lib/chat/stage6-tool-contracts.ts`

| Change | Details |
|--------|---------|
| `S6LoopOutcome` | Added `'content_answered'` to union type |
| `S6LoopResult` | Added `contentAnswerResult?: S6ContentAnswerResult` field |
| `S6LoopTelemetry` | Added 4 answer telemetry fields: `s6_answer_outcome`, `s6_answer_grounded`, `s6_answer_cited_count`, `s6_answer_reason` |
| Imports | `S6ContentAnswerResult`, `S6ContentAnswerOutcome` from `./stage6-content-tool-contracts` |

### 2. Loop Route — `app/api/chat/stage6-loop/route.ts`

#### 2a. Gemini Schema & Parsing

- Extended `ParsedLLMResponse` with `text`, `citedSnippetIds`, `grounded` fields
- Added `'answer'` to Gemini response schema enum
- Added `text`, `citedSnippetIds`, `grounded` as optional schema properties
- Added `'answer'` to `VALID_TYPES` array

#### 2b. Structural Validation (`validateResponseStructure()`)

Added validation for `type=answer`:
- Non-empty `text` field required
- Text max 2000 characters
- Non-empty `citedSnippetIds` array required
- `grounded` must be boolean and must be `true` (ungrounded answers rejected — model must abort instead)

#### 2c. Session Snippet Registry

- `Map<string, string>` at loop scope mapping session-scoped snippet IDs → source item IDs
- Solves snippet ID collision: `stage6-content-handlers.ts:196` generates per-call IDs (`s0`, `s1`). Two calls both produce `s0`.
- Route rewrites snippet IDs to `c{callIndex}_{originalId}` (e.g., `c0_s0`, `c1_s0`) before the model sees the response
- Registry populated during `inspect_note_content` result processing

#### 2d. Anchored-Note Enforcement

Server rejects `inspect_note_content` calls targeting a different item than `contentContext.noteItemId`. Defense in depth — the prompt also instructs the model to use the anchored note.

#### 2e. Answer Terminal Handler

Five server-enforced gates before accepting an answer:

| Gate | Rejection behavior |
|------|-------------------|
| Content-intent-only | `type=answer` rejected when `contentContext` absent or `escalationReason !== 'content_intent'` → abort |
| Empty registry | Answer rejected when no `inspect_note_content` was called → abort |
| Invalid citations | `citedSnippetIds` checked against session registry. Invalid IDs → retry once, then abort |
| Cross-note citations | All cited snippets must come from same source item. Mixed sources → retry once, then abort |
| Success | Builds `S6ContentAnswerResult` with `outcome: 'answered'`, `grounded: true`, unique citation count |

#### 2f. Answer Telemetry on Abort Paths

All answer-related abort exits set `s6_answer_outcome='abort'` and `s6_answer_reason`:

- Not-content-intent abort
- No-evidence abort
- Invalid citations abort (after retry)
- Cross-note citations abort (after retry)
- Structural validation abort when `parsed.type === 'answer'`
- Normal `type: "abort"` terminal in content-intent loops (model voluntarily aborts due to insufficient evidence)

#### 2g. Prompt Updates

- Updated rule 10 to reference session-scoped IDs (`c0_s0`, `c0_s1`)
- Added rule 11: CONTENT ANSWER RULES (grounding requirements, single-note scope, negative findings allowed, max 2000 chars)
- Added answer terminal example to TERMINAL ACTIONS section
- Added content-intent guidance in `buildUserMessage()`: prefer `type=answer` over `type=action` for content queries

### 3. Telemetry Pipeline

#### 3a. `lib/chat/routing-log/payload.ts`

Added 4 fields:
```
s6_answer_outcome?: string
s6_answer_grounded?: boolean
s6_answer_cited_count?: number
s6_answer_reason?: string
```

#### 3b. `app/api/chat/routing-log/route.ts`

Serialized 4 `s6_answer_*` fields into `semantic_hint_metadata` JSONB column.

#### 3c. `lib/chat/stage6-loop-controller.ts`

Threaded 4 `s6_answer_*` telemetry fields into both `writeDurableShadowLog()` and `writeDurableEnforcementLog()`.

### 4. Tests — `__tests__/unit/chat/stage6-loop-route.test.ts`

Added §14 describe block with 15 new tests:

| Test | Verifies |
|------|----------|
| Valid answer terminal → `content_answered` outcome | Well-formed answer with valid citations accepted |
| Missing text → validation error | `type=answer` without text retried |
| Text exceeds 2000 chars → validation error | Oversized text rejected |
| Empty citedSnippetIds → validation error | `citedSnippetIds: []` retried |
| Invalid snippet ID → retry then abort | Non-existent snippet ID → retry → abort |
| `grounded: false` → validation error | Ungrounded answers rejected |
| Answer in non-content-intent loop → abort with telemetry | `type=answer` without `contentContext` → abort |
| Answer without prior inspect_note_content → abort | Empty session registry → abort |
| Wrong note itemId on inspect → rejected | Anchored-note enforcement for non-matching itemId |
| Cross-note cited snippets → retry then abort | Snippets from 2 sources → retry → abort |
| Answer telemetry uses unique count | Duplicate IDs → `s6_answer_cited_count` deduped |
| Session-scoped snippet IDs: two calls produce unique IDs | `c0_s0`, `c1_s0` — no collision |
| Structural validation abort sets answer telemetry | `grounded: false` twice → abort with answer telemetry |
| No answer telemetry for non-content loops | Answer fields absent for navigation-only loops |
| Content-intent abort after inspect sets answer telemetry | Model aborts voluntarily → `s6_answer_outcome='abort'` |

---

## Design Decisions

1. **Answer is a terminal type, not an action.** Actions mutate UI. Answers produce text. Different execution pipelines.
2. **Content-intent-only gate.** Server rejects `type=answer` outside content-intent loops. Navigation loops cannot produce answers.
3. **Non-empty citations required.** Closes the grounding loophole where `citedSnippetIds: []` + `grounded: true` would pass all checks.
4. **`grounded: false` rejected.** Forces the model to ground answers or abort. Prevents hallucinated content.
5. **Session-scoped snippet IDs.** Route rewrites `s0` → `c0_s0` to prevent cross-call collisions. Model cites session-scoped IDs.
6. **Single retry budget.** Shared `structRetried` flag gives the loop ONE retry for any model error (structural, invalid citations, or cross-note). Intentional — prevents infinite retry loops.
7. **Cross-note citation check.** Registry maps snippets to source items. Multi-source answers rejected.
8. **Unique citation count.** `new Set(citedSnippetIds).size` avoids overcounting duplicates in telemetry.
9. **Shadow-only in 6x.4.** Answers are logged in telemetry but not displayed to users. Surfacing is 6x.5 scope.
10. **Abort-path telemetry completeness.** Every answer-related abort sets `s6_answer_outcome='abort'` and `s6_answer_reason`. Exit paths for operational failures (timeout, unparseable JSON, max rounds) intentionally omit answer telemetry — they are not content resolution outcomes.

---

## Verification Results

```
$ npm run type-check
→ zero errors

$ npx jest --testPathPattern stage6-loop-route
→ 40/40 pass (25 existing + 15 new)

$ npx jest --testPathPattern stage6-loop-controller
→ 17/17 pass

$ npx jest --testPathPattern content-intent
→ 70/70 pass (3 suites)
```

No regressions. No new circular imports.

---

## Exit Path Analysis

### Paths that set answer telemetry (7)
1. Normal `type: "abort"` in content-intent loop
2. Answer in non-content-intent loop → abort
3. Answer with empty snippet registry → abort
4. Answer with invalid citations (after retry) → abort
5. Answer with cross-note citations (after retry) → abort
6. Answer success → `content_answered`
7. Structural validation abort when `parsed.type === 'answer'`

### Paths that intentionally omit answer telemetry (7)
- Timeout — operational failure
- Unparseable JSON — model failure
- Action terminal — prompt forbids for content-intent
- Clarify terminal — separate telemetry
- Max rounds exhausted — operational exhaustion
- Unknown type — model error
- Catch block — server error

---

## Files Modified

| File | Lines changed (approx) |
|------|----------------------|
| `lib/chat/stage6-tool-contracts.ts` | +15 |
| `app/api/chat/stage6-loop/route.ts` | +150 |
| `lib/chat/routing-log/payload.ts` | +5 |
| `app/api/chat/routing-log/route.ts` | +5 |
| `lib/chat/stage6-loop-controller.ts` | +10 |
| `__tests__/unit/chat/stage6-loop-route.test.ts` | +350 |

No new files. No new feature flags. No new database migrations.

---

## Current Limitation

Content-intent is scoped to **notes only** (Slice 1). Links panels and other widget types are not yet supported. The user has requested links panel support as a follow-up.

---

## Addendum: Infrastructure Fixes (2026-03-14)

During runtime testing of 6x.4, note creation and editing inside entry workspaces failed. Investigation revealed systemic schema mismatches across the persistence layer — multiple API routes referenced columns that do not exist on their target tables.

### Root Cause

The `notes` and `panels` tables never had a `workspace_id` column (no migration ever added it), but numerous API routes assumed they did. The `document_saves` table had a trigger referencing a non-existent column name. These errors were masked in default-workspace contexts but surfaced when testing from entry workspaces.

### Fix 1: Empty Workspace — Control Center Toggle Not Wired

**Problem**: When a workspace has no open notes, the canvas is hidden (`visibility: hidden`), and its built-in Control Center (with "+ Note" button) is hidden too. The `WorkspaceControlCenterToggle` component exists as a fallback but was never wired.

**File**: `components/annotation-app-shell.tsx`
**Fix**: Added `controlCenterProps` to `workspaceViewProps` with `visible: openNotes.length === 0`, connecting `handleNewNoteFromToolbar`, recent notes, and constellation toggle.

### Fix 2: Knowledge Base Root Not Found in Entry Workspaces

**Problem**: `GET /api/items?parentId=null` filtered by `WHERE workspace_id = $1`, but the Knowledge Base root has `workspace_id = NULL`. Entry workspaces could never find it.

**File**: `app/api/items/route.ts` (GET handler, parentId branch)
**Fix**: Changed to `WHERE (workspace_id = $1 OR workspace_id IS NULL)` so system-level items (Knowledge Base root) are always discoverable.

### Fix 3: Entry Workspace ID Not in `workspaces` Table

**Problem**: Entry workspaces exist in `note_workspaces` but not in `workspaces`. The POST handler returned 404 when the requested workspace wasn't found.

**File**: `app/api/items/route.ts` (POST handler)
**Fix**: When the requested workspace isn't in `workspaces`, fall back to the default workspace instead of returning 404. Logs a warning for observability.

### Fix 4: `notes` Table — Phantom `workspace_id` Column

**Problem**: The `notes` table has **no** `workspace_id` column, but 7 API routes referenced it in INSERT, SELECT, UPDATE, and WHERE clauses.

**Verified**: `SELECT column_name FROM information_schema.columns WHERE table_name = 'notes' AND column_name = 'workspace_id'` → 0 rows.

**Files fixed** (removed `workspace_id` from `notes` queries):

| File | Change |
|------|--------|
| `app/api/items/route.ts` | Removed `workspace_id` from notes INSERT |
| `app/api/postgres-offline/documents/route.ts` | Changed `SELECT workspace_id FROM notes` → `FROM items`; removed UPDATE to `notes.workspace_id` |
| `app/api/postgres-offline/documents/batch/route.ts` | Removed `workspace_id` from notes INSERT |
| `app/api/postgres-offline/branches/batch/route.ts` | Removed `workspace_id` from notes INSERT |
| `app/api/postgres-offline/notes/route.ts` | Removed `workspace_id` from INSERT and WHERE clauses |
| `app/api/postgres-offline/notes/[id]/route.ts` | Removed `workspace_id` from WHERE clause |

### Fix 5: `panels` Table — Phantom `workspace_id` Column

**Problem**: The `panels` table has **no** `workspace_id` column, but 3 API routes included it in INSERT statements.

**Verified**: `SELECT column_name FROM information_schema.columns WHERE table_name = 'panels' AND column_name = 'workspace_id'` → 0 rows.

**Files fixed** (removed `workspace_id` from `panels` INSERTs):

| File | Change |
|------|--------|
| `app/api/canvas/panels/route.ts` | Removed `workspace_id` from INSERT; changed workspace lookup from `notes` → `items` |
| `app/api/postgres-offline/panels/route.ts` | Removed `workspace_id` from INSERT; changed workspace lookup from `notes` → `items` |
| `app/api/panels/[panelId]/rename/route.ts` | Removed `workspace_id` from INSERT; changed workspace lookup from `notes` → `items` |

### Fix 6: `document_saves` Trigger — Wrong Column Name

**Problem**: The `document_saves_search_trigger()` function referenced `NEW.search_vector`, but the actual column is `search_tsv`. Every document save failed with `record "new" has no field "search_vector"`.

**Fix**: Replaced the trigger function via SQL:
```sql
CREATE OR REPLACE FUNCTION document_saves_search_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_tsv := to_tsvector('english', unaccent(coalesce(pm_extract_text(NEW.content), '')));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
```

### Safety Verification

| Table | Has `workspace_id`? | Action |
|-------|-------------------|--------|
| `notes` | **No** | Removed all references — were runtime errors |
| `panels` | **No** | Removed all references — were runtime errors |
| `items` | **Yes** | Now used as workspace_id source (replaces `notes`) |
| `document_saves` | **Yes** | Untouched — correctly uses workspace_id |
| `workspace_panels` | **Yes** | Untouched — unaffected |

All removals eliminated references to non-existent columns. No working functionality was broken.

---

## Next Steps

- **6x.5**: Surface answers to users (enforcement mode wiring)
- **Links panel support**: Extend content-intent classifier, add `inspect_widget_content` handler, generalize `S6ContentContext` beyond notes
- **Schema audit**: Consider adding `workspace_id` to `notes` and `panels` tables via migration if workspace-scoped queries are needed in the future, or remove remaining dead-code references
