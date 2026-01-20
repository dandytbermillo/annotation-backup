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

### Prerequisite 2: Permissions + Visibility — Partial

- Schema includes `user_id` column for scoping
- Indexing function accepts `userId` parameter
- **TODO:** Integrate with auth context to auto-populate user_id
- **TODO:** Add server-side permission filter before scoring

### Prerequisite 3: Unified Retrieval API — Not Started

**TODO:**
- Create `POST /api/retrieve` endpoint
- Add corpus parameter handling
- Merge docs + items results

### Prerequisite 4: Cross-Corpus Ambiguity UX — Not Started

**TODO:**
- Define corpus signal patterns
- Implement docs vs notes pills

### Prerequisite 5: Safety + Fallback — Not Started

**TODO:**
- Add fallback when items index unavailable
- Error handling in unified API
