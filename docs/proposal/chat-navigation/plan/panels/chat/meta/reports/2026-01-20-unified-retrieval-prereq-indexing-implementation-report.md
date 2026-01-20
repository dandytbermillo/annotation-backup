# Implementation Report: Unified Retrieval Prerequisites — Indexing Strategy

**Date:** 2026-01-20
**Status:** Complete
**Scope:** Prerequisite 1 (Indexing Strategy) for unified retrieval

---

## Summary

This implementation creates the infrastructure for indexing notes/files content into a searchable chunks table, parallel to the existing `docs_knowledge_chunks` table. This is the first prerequisite for unified retrieval across docs + notes.

---

## Changes Made

### 1. Database Schema: `items_knowledge_chunks`

**File:** `migrations/064_create_items_knowledge_chunks.up.sql`

Created a new table with:

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| item_id | UUID | FK to items table (CASCADE delete) |
| user_id | UUID | For access control scoping |
| item_name | TEXT | Denormalized for search display |
| item_path | TEXT | Denormalized for disambiguation |
| header_path | TEXT | Section context (e.g., "Note > Section") |
| chunk_index | INT | Position in document |
| content | TEXT | Chunk text |
| keywords | TEXT[] | Auto-extracted keywords |
| chunk_hash | TEXT | For change detection |
| created_at | TIMESTAMPTZ | Record creation |
| updated_at | TIMESTAMPTZ | Last modification |

**Indexes:**
- `ux_items_knowledge_chunks_item_index` — Unique (item_id, chunk_index) for upserts
- `idx_items_knowledge_chunks_user` — User ID for permission filtering
- `idx_items_knowledge_chunks_item` — Item lookups
- `idx_items_knowledge_chunks_keywords` — GIN on keywords array
- `idx_items_knowledge_chunks_fts` — FTS on content
- `idx_items_knowledge_chunks_name_fts` — FTS on item_name
- `idx_items_knowledge_chunks_user_item` — Composite for scoped queries

---

### 2. Indexing Service

**File:** `lib/docs/items-indexing.ts`

**Functions:**

| Function | Description |
|----------|-------------|
| `chunkItem(item)` | Chunk a single item into pieces (400-500 token chunks) |
| `indexItem(item)` | Index a single item into items_knowledge_chunks |
| `indexAllItems(userId?)` | Bulk index all notes |
| `removeItemChunks(itemId)` | Remove chunks when item deleted |
| `getChunksCount(userId?)` | Get count for verification |

**Chunking Strategy:**
- Target: 400 tokens (~1600 chars)
- Max: 500 tokens (~2000 chars)
- Preserves document structure where possible
- Detects heading patterns:
  - Markdown `#` headers
  - ALL-CAPS titles
  - Underlined headers (`===` or `---`)

**Text Extraction:**
- Uses existing `extractFullText` from `lib/utils/branch-preview.ts`
- Converts TipTap JSON → plain text preserving newlines

---

### 3. Migration Scripts

**Up migration:** `migrations/064_create_items_knowledge_chunks.up.sql`
- Creates table with all indexes
- Creates update trigger for `updated_at`
- Adds descriptive comments

**Down migration:** `migrations/064_create_items_knowledge_chunks.down.sql`
- Drops trigger
- Drops function
- Drops table

---

## Files Modified/Created

| File | Change |
|------|--------|
| `migrations/064_create_items_knowledge_chunks.up.sql` | New |
| `migrations/064_create_items_knowledge_chunks.down.sql` | New |
| `lib/docs/items-indexing.ts` | New |
| `docs/proposal/.../unified-retrieval-prereq-plan.md` | Updated status |
| `docs/proposal/.../INDEX.md` | Added Plan 4 section |

---

## Verification

### Type-Check
```bash
$ npm run type-check
# Clean - no errors
```

### Migration Forward
```bash
$ npm run db:migrate
# items_knowledge_chunks table created
```

### Migration Backward
```bash
$ cat migrations/064_create_items_knowledge_chunks.down.sql | docker exec -i annotation_postgres psql -U postgres -d annotation_dev
DROP TRIGGER
DROP FUNCTION
DROP TABLE
```

### Migration Re-Apply
```bash
$ cat migrations/064_create_items_knowledge_chunks.up.sql | docker exec -i annotation_postgres psql -U postgres -d annotation_dev
CREATE TABLE
CREATE INDEX (x7)
CREATE FUNCTION
CREATE TRIGGER
COMMENT (x4)
```

### Schema Verification
```sql
\d items_knowledge_chunks
-- Table exists with correct columns, indexes, constraints
```

---

## Design Decisions

### 1. Parallel Schema to docs_knowledge_chunks
Kept naming and structure similar for consistency and potential future merging.

### 2. user_id Column for Access Control
Added nullable `user_id` to support:
- Single-user mode (NULL or specific user)
- Future multi-user mode with scoped queries
- Shared/public items (NULL user_id)

### 3. Denormalized item_name and item_path
Avoids JOIN on items table for search result display.
Tradeoff: requires update when item is renamed (handled by `indexItem`).

### 4. Reused extractFullText
Leveraged existing TipTap extraction utility rather than duplicating code.

---

## Remaining Prerequisites

| # | Prerequisite | Status |
|---|--------------|--------|
| 1 | Indexing Strategy | ✅ Complete |
| 2 | Permissions + Visibility | 🔄 Partial (schema ready, needs auth integration) |
| 3 | Unified Retrieval API | ⏸️ Not Started |
| 4 | Cross-Corpus Ambiguity UX | ⏸️ Not Started |
| 5 | Safety + Fallback | ⏸️ Not Started |

---

## Next Steps

1. **Integrate with item lifecycle** — Call `indexItem` on create/update, `removeItemChunks` on delete
2. **Auth context integration** — Auto-populate user_id from session
3. **Unified API** — Create `/api/retrieve` with corpus parameter
4. **Cross-corpus scoring** — Merge and rank docs vs notes results

---

## Rollback Instructions

```bash
# Drop the table and related objects
cat migrations/064_create_items_knowledge_chunks.down.sql | docker exec -i annotation_postgres psql -U postgres -d annotation_dev

# Remove the indexing service
rm lib/docs/items-indexing.ts
```

---

## Related Documents

- `docs/proposal/chat-navigation/plan/panels/chat/meta/unified-retrieval-prereq-plan.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/INDEX.md`
- `lib/docs/seed-docs.ts` (parallel implementation for docs)
- `lib/utils/branch-preview.ts` (text extraction utility)
