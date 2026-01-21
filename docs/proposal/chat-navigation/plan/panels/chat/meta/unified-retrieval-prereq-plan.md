# Unified Retrieval Prerequisites Plan

**Date:** 2026-01-19 (updated 2026-01-20)
**Status:** In Progress
**Scope:** Notes/files indexing + permissions prerequisites
**Related:** `general-doc-retrieval-routing-plan.md`

---

## Goal

Define the minimum prerequisites required before implementing unified retrieval
across docs + notes/files.

---

## Non‑Goals

- No retrieval logic changes.
- No UI changes.
- No embeddings rollout in this phase.

---

## Prerequisites Checklist

### 1) Indexing Strategy

- **Notes/files indexing approach**
  - Full‑text indexing (title + body)
  - Optional metadata fields (tags, modified_at, owner)
- **Schema hint**
  - Keep naming parallel to docs chunks (e.g., `notes_knowledge_chunks` or `items_chunks`)
- **Chunking rules**
  - Max chunk size (e.g., 500–900 chars)
  - Preserve headings/sections where possible
  - Extract TipTap/JSON → plain text before indexing
- **Refresh policy**
  - Trigger on create/update/delete
  - Background reindex for large batches

### 2) Permissions + Visibility

- **Access control rules**
  - Only show items the user can read
  - Enforce org/workspace boundaries
- **User scoping (critical)**
  - Notes/files queries must filter by `user_id`
  - Never return User A’s notes/files to User B
- **Server‑side filters**
  - Apply before scoring
- **Audit expectations**
  - Log access to private notes/files

### 3) Unified Retrieval API Contract

- **Single endpoint**
  - `POST /api/retrieve`
- **Request fields**
  - `corpus: "docs" | "notes" | "files" | "auto"`
  - `mode: "explain" | "search"`
  - `query`, optional `docSlug/resourceId`
  - `excludeChunkIds`, optional `cursor`
- **Response fields**
  - `docSlug`, `chunkId`, `header_path`
  - `isHeadingOnly`, `bodyCharCount`, `nextChunkId`
  - `corpus`, `score`, `status`

### 4) Cross‑Corpus Ambiguity UX

- If top candidates are from different corpora and close in score:
  - Show two pills (Docs vs Notes)
  - Require user confirmation before opening
- Corpus signal patterns:
  - “my notes”, “search notes”, “find in files” → notes/files corpus
  - Known doc terms → docs corpus

### 5) Safety + Fallback

- If notes/files index is unavailable:
  - Fall back to docs retrieval only
  - Or ask a clarifying question

---

## Acceptance Tests (Prereq Readiness)

1) Notes/files index exists and returns results with chunk metadata.
2) Permissions enforced server‑side (no leakage).
3) Query using `corpus=auto` returns docs vs notes with ambiguity pills when close
   (e.g., score_gap < MIN_GAP).
4) Missing notes index triggers fallback (no errors).

---

## Decision Gate

Unified Retrieval can start when **all** are true:

- Notes/files indexing implemented and stable.
- Permissions filter applied before scoring.
- Unified API contract agreed.
- Ambiguity UX defined.

---

## Implementation Notes (2026-01-20)

### Prerequisite 1: Indexing Strategy — Implemented ✅

**Schema:**
- Created `items_knowledge_chunks` table (migration 064)
- Parallel structure to `docs_knowledge_chunks`
- Fields: `item_id`, `user_id`, `item_name`, `item_path`, `header_path`, `chunk_index`, `content`, `keywords`, `chunk_hash`
- Indexes: FTS on content + item_name, GIN on keywords, user_id composite index

**Chunking:**
- Target: 400 tokens (~1600 chars), max 500 tokens
- Uses `extractFullText` from `lib/utils/branch-preview.ts` for TipTap → plain text
- Section detection: markdown headers, ALL-CAPS titles, underlined headers

**Files added:**
- `migrations/064_create_items_knowledge_chunks.up.sql`
- `migrations/064_create_items_knowledge_chunks.down.sql`
- `lib/docs/items-indexing.ts`

**Key functions:**
- `chunkItem(item)` — Chunk a single item into pieces
- `indexItem(item)` — Index a single item into the chunks table
- `indexAllItems(userId?)` — Bulk index all notes
- `removeItemChunks(itemId, client?)` — Remove chunks when item deleted (transaction-safe)

**Lifecycle Wiring (2026-01-20):**
- **Create hook**: `app/api/items/route.ts` — fire-and-forget indexing on note creation
- **Content save hook**: `app/api/postgres-offline/documents/batch/route.ts` — fire-and-forget re-indexing on save
- **Delete hook**: `lib/server/note-deletion.ts` — removes chunks inside transaction (both soft/hard delete)

**Known Limitation:**
Fire-and-forget indexing runs outside the transaction. If the main transaction rolls back, the chunk INSERT will fail with an FK violation (item_id references items.id). This is safe — no orphan chunks possible, just logged errors. For stronger consistency guarantees, a post-commit outbox pattern would be needed.

**Backfill CLI:**
- `scripts/index-items.ts` — run via `npm run index:items`
- Supports `--dry-run` and `--user-id` flags
- Initial run: 2871 notes → 1357 indexed → 1454 chunks (0.98s)

### Prerequisite 2: Permissions + Visibility — Implemented (Option A)

**Workspace scoping (2026-01-20):**
- Added `workspace_id` column to `items_knowledge_chunks` (migration 065)
- Indexed for efficient filtering
- Backfilled all 1454 existing chunks
- Lifecycle hooks now populate workspace_id on create/save

**Schema includes:**
- `user_id` column (NULL in Option A single-user mode)
- `workspace_id` column (primary isolation for Option A)
- Composite index `(workspace_id, user_id)` for scoped queries

**Ready for unified API:**
- Retrieval can filter by `workspace_id` without joins
- user_id filter available for future multi-user (Option B)

**Remaining (Option B / multi-user):**
- Integrate with auth context to auto-populate user_id
- Add server-side permission filter before scoring

### Prerequisite 3: Unified Retrieval API — Implemented (Phase 1)

**Endpoint (2026-01-20):**
- Created `POST /api/retrieve` unified endpoint
- Routes by `corpus` parameter: `"docs"` or `"notes"`
- `corpus="auto"` deferred to Prereq 4 (cross-corpus ambiguity UX)

**Files added:**
- `app/api/retrieve/route.ts` — unified routing endpoint
- `lib/docs/items-retrieval.ts` — notes retrieval service (mirrors docs retrieval)

**Request contract:**
```json
{
  "corpus": "docs" | "notes",
  "query": "search terms",
  "resourceId": "docSlug or itemId (for direct lookup)",
  "excludeChunkIds": [],
  "topK": 5,
  "fullContent": false
}
```

**Response contract:**
```json
{
  "success": true,
  "corpus": "docs" | "notes",
  "status": "found" | "ambiguous" | "weak" | "no_match",
  "results": [{
    "corpus": "docs" | "notes",
    "resourceId": "docSlug or itemId",
    "chunkId": "...",
    "title": "...",
    "path": "item path (notes only)",
    "headerPath": "...",
    "snippet": "...",
    "score": 5.2,
    "matchedTerms": []
  }],
  "confidence": 0.8,
  "metrics": { ... }
}
```

**Key design decisions:**
- `workspaceId` is server-derived via `withWorkspaceClient` (not client input)
- Notes retrieval requires workspace scoping
- Docs retrieval is workspace-agnostic (shared knowledge base)
- Adapters normalize corpus-specific results to unified format

**Verified (2026-01-20):**
- Docs query: ✅ returns docs results
- Notes query: ✅ returns notes results (workspace-scoped)
- Docs direct lookup: ✅ by docSlug
- Notes direct lookup: ✅ by itemId

### Prerequisite 4: Cross-Corpus Ambiguity UX — Draft

**Goal:**
When a query could refer to both docs and notes, present a clear, two-option choice
instead of guessing. This keeps the experience “human” and avoids wrong-corpus answers.

**Non-goals:**
- Do not change retrieval scoring logic in this prereq.
- Do not introduce cross-corpus merging or ranking beyond a simple top-candidate check.

**Trigger conditions (show cross-corpus pills):**
1) Both corpora return a viable result (status in {found, weak, ambiguous} and passes existing weak rejection rules).
2) Score gap between top doc and top note is within MIN_GAP (reuse existing doc threshold), OR
3) Query contains explicit corpus signals for both.

**Corpus signal patterns:**
- Notes intent: "my notes", "in my notes", "search notes", "find in notes", "note titled",
  "in my files", "find in files", "search files".
- Docs intent: known doc terms, UI components, and doc concepts.

**Decision logic:**
- If notes intent is explicit and docs intent is not: show notes results directly.
- If docs intent is explicit and notes intent is not: show docs results directly.
- If both intents are present or scores are close: show two pills (Docs vs Notes).

**UX behavior (pills):**
- Render two pills max (top doc result + top note result):
  - "Docs: <doc title>"
  - "Notes: <note title>"
- Selecting a pill:
  - Docs → call `/api/retrieve` with corpus="docs", resourceId=docSlug.
  - Notes → call `/api/retrieve` with corpus="notes", resourceId=itemId.
  - Do not auto-select when pills are shown; user must choose.

**State updates:**
- Store `lastRetrievalCorpus` to keep follow-ups in the same corpus.
- Store `lastResourceId` to support "tell me more" on notes as well as docs.

**Fallback rules:**
- If one corpus returns no_match, show results from the other corpus (no pills).
- If both return no_match, fall back to existing LLM response policy.

**Telemetry to add:**
- `cross_corpus_ambiguity_shown` (boolean)
- `cross_corpus_choice` ("docs" | "notes")
- `cross_corpus_score_gap`

**Acceptance tests:**
1) "search my notes for workspace" → notes result, no pills.
2) "what is workspace" with a note titled "Workspace" → pills (Docs vs Notes).
3) "tell me about my notes" → notes result only.
4) Notes selected → follow-up "tell me more" continues within notes corpus.

### Prerequisite 5: Safety + Fallback — Not Started

**TODO:**
- Add fallback when items index unavailable
- Error handling in unified API
