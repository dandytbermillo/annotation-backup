# Cursor-Style Doc Retrieval Plan (Phased)

## Goal
Adopt a Cursor‑style retrieval pipeline for app documentation so the LLM receives the **right context** (short, relevant chunks + UI state) instead of generic fallback responses.

## Principles (from Cursor)
- **Index once** (startup or on install)
- **Retrieve per query** (top‑K relevant docs)
- **Assemble context** (core concepts + retrieved docs + UI state)
- **Respond concisely** (1–3 sentences for explanations)

---

## Incorporation Matrix (Phase 1 vs Later)

| Suggestion | Incorporate now? | Why |
|---|---|---|
| Scoring formula | ✅ Yes | Phase 1 won’t work without it |
| Confidence calculation | ✅ Yes | Prevents inconsistent UX |
| Thin confidence guard | ✅ Yes | Avoids weak matches |
| Evidence objects | ✅ Yes | Cheap to add, huge debugging value |
| Expanded tests | ✅ Yes | Catches real failures |
| Chunk hierarchy | ⏳ Phase 2 | Not needed for Phase 1 |
| Max chunks per doc | ⏳ Phase 4 | Not needed until context builder |
| Vector store details | ⏳ Phase 3 | Defer until needed |
| Additional metrics | ✅ Yes | Instrument from start |
| Operational rollback | ✅ Yes | Safety before shipping |

---

## Phase 0 — Prerequisites (Docs in DB)
(Linked to `db-docs-seeding-plan.md`)
- Seed documentation into Postgres (`docs_knowledge`).
- Store: slug, category, title, content, content_hash, version.
- Idempotent seed on startup.

---

## Phase 1 — Keyword Retrieval (Simple, Fast)
**Purpose**: Immediate improvement without embeddings.

### Known Terms Source (Required)
Define the canonical “known terms” list used to avoid over‑stemming:
- Doc titles from `docs_knowledge`
- Keywords from `docs_knowledge.keywords[]`
- Widget names from registry
- Core concept list (Home, Dashboard, Workspace, Notes, Recent, Widget, Panel)

Regenerate on seed/index changes; cache in memory.

### Query Normalization
- Lowercase
- Strip punctuation
- Remove stopwords (a, an, the, is, what, how, my, do)
- **Conservative stemming**:
  - only strip plurals: s, es, ies → y
  - do not stem tokens < 4 characters
  - do not stem known terms

### Synonyms (Updated)
```ts
const SYNONYMS: Record<string, string> = {
  shortcuts: 'quick links',
  homepage: 'home',
  dashboard: 'home',
  // Removed: docs → notes (ambiguous with documentation)
}
```
Apply phrase rewrites before tokenization; single‑word rewrites after.

### Scoring Formula (Required)
| Match Type | Score |
|---|---|
| Exact phrase in title | +5 |
| Token in title | +3 |
| Token in keywords[] | +2 |
| Token in content | +1 |

Normalize: `final_score = raw_score / sqrt(doc_token_count)`
Notes:
- Normalize by content length only (exclude title/keywords).
- If exact phrase match in title, reduce normalization penalty by 50%.

### Confidence Thresholds (Defaults)
- `MIN_SCORE = 3`
- `MIN_CONF = 0.3`
- `MIN_GAP = 2`
- `MIN_MATCHED_TERMS = 2`

Confidence formula:
```
confidence = (top_score - second_score) / top_score
```

### Matched Terms Definition (Required)
`matched_terms` are **unique** tokens after:
- stopword removal
- synonym rewrite
- conservative stemming  
If an **exact phrase** match in title exists, count it as **2 matched terms**.

### Confidence Rules (Final)
```
if top_score == 0 → no-match
if only 1 result → second_score = 0
if matched_terms.length < MIN_MATCHED_TERMS → weak, ask clarification
if no title/keyword hit and no exact phrase match → weak, ask clarification
if top_score < MIN_SCORE → weak match, ask clarification
if (top_score - second_score) < MIN_GAP → ambiguous, ask clarification
if confidence < MIN_CONF → ambiguous, ask clarification
else → answer normally
```

Strong match (for multi‑intent policy):
- `score >= MIN_SCORE`
- `confidence >= MIN_CONF`
- passes matched‑terms + title/keyword guard

### Evidence Object (Required)
```ts
interface RetrievalResult {
  doc_slug: string
  title: string
  category: string
  snippet: string
  score: number
  header_path?: string
  content_hash: string
  matched_terms: string[]
  source: 'keyword' | 'hybrid' | 'embedding'
  match_explain?: string[]
}
```

### No‑Match Handling
- If all scores are 0 → “Which part should I explain?”
- If a single low‑confidence match → “I think you mean … Is that right?”

### Clarification UX Templates (During Implementation)
- Weak match (low confidence overall):  
  “I’m not sure which feature you mean. Are you asking about {Top A}? If not, tell me the feature name.”
- Ambiguous (two strong contenders):  
  “Do you mean {Top A} ({Category A}) or {Top B} ({Category B})?”
- No match:  
  “Which part should I explain?”

### Context Assembly
- Always include `CORE_CONCEPTS` (tiny glossary).
- Inject retrieved docs under “Relevant Documentation”.
- Include UI context + widget states.

### Acceptance Tests (Expanded)
- “explain workspace” → returns workspace doc summary.
- “what is home” → returns home doc summary.
- “explain calendar” → no match → “Which part should I explain?”
- “tell me about panels” (content‑only match) → clarification (title/keyword guard)
- Ambiguous: “home” → asks which meaning
- Synonym: “shortcuts” → quick links
- Typo: “wrkspace” → workspace
- Multi‑intent: “workspace and widgets” → both
- False positive: “how do I do it” → no match
- False positive: “the thing” → no match

### Multi‑Intent Response Policy (New)
If 2+ strong matches and the query is clearly multi‑intent:
- Return **up to 2** short summaries
- Ask: “Which one should I go deeper on?”

---

## Phase 2 — Chunking + Metadata (Better Precision)
**Purpose**: Higher relevance without embeddings.

### Chunking Strategy
- Split markdown by headers (`##`), then paragraphs.
- Cap chunks at ~400–500 tokens.
- Preserve header hierarchy for context (`header_path`).

### Stable IDs (Required)
- Chunk ID format: `{doc_slug}#chunk-{index}` (or hash of header_path + index).
- Include `chunk_hash` for change detection (MD5 of chunk content).
- Maintain `chunk_index` for deterministic ordering within a doc.

### Metadata
- `title`, `category`, `keywords`, `source`.
- `header_path` (e.g., `Widgets > Quick Links > Editing`).
- `chunk_index`, `chunk_hash`, `doc_slug`.
- Use `category` for scoped retrieval (concepts/widgets/actions).

### Storage (Phase 2 Schema)
Add a chunk table (suggested):
```
docs_knowledge_chunks(
  id uuid pk,
  doc_slug text,
  category text,
  title text,
  header_path text,
  chunk_index int,
  content text,
  keywords text[],
  chunk_hash text,
  created_at timestamptz,
  updated_at timestamptz
)
```
Seed pipeline should upsert chunks by `(doc_slug, chunk_index)` and update if `chunk_hash` changes.

### Retrieval Rules (Phase 2)
- Score **chunks**, not whole docs.
- Return top K chunks (default 3–5).
- **De‑dupe**: avoid returning >2 chunks from the same doc unless the query is multi‑intent.
- Keep `header_path` in evidence for explanation clarity.

### Acceptance Tests
- “explain notes” returns note‑specific chunk.
- “what is quick links” returns widget chunk.
 - “open notes + quick links” returns two chunks from different docs (multi‑intent).
 - “explain workspace” returns chunk with `header_path` in response evidence.

### Phase 2 Implementation Checklist
- [ ] Add `docs_knowledge_chunks` migration (schema above).
- [ ] Update seed/index pipeline to chunk docs and compute `chunk_hash`, `chunk_index`, `header_path`.
- [ ] Upsert chunks by `(doc_slug, chunk_index)`; update rows when `chunk_hash` changes.
- [ ] Add cleanup for removed chunks (doc sections deleted/renamed).
- [ ] Update retrieval to score chunks (not whole docs), then de‑dupe per doc.
- [ ] Include `doc_slug`, `chunk_index`, `header_path`, `chunk_hash` in evidence objects.
- [ ] Gate with `DOC_RETRIEVAL_PHASE=2` (fallback to Phase 1 on errors).
- [ ] Log retrieval metrics: latency p50/p95, match counts, top scores, phase.
- [ ] Add tests: header_path present, de‑dupe per doc, multi‑intent, no‑match.

### Phase 2 Implementation Plan (Step‑by‑Step)
**Goal**: Switch retrieval from whole‑doc scoring to chunk‑level scoring with stable IDs and header context.

#### Step 1 — Schema + Migration
- Create migration for `docs_knowledge_chunks`.
- Include indices on `(doc_slug, chunk_index)` and `(category)` for retrieval.
- Add a unique constraint on `(doc_slug, chunk_index)` to support idempotent upserts.
- Acceptance: Migration applies cleanly and table exists.

#### Step 2 — Chunking Pipeline
- Add/extend the doc seeding pipeline to:
  - Split by `##` headers → paragraphs → chunk size ~400–500 tokens.
  - Compute `header_path`, `chunk_index`, `chunk_hash` (content hash).
  - Persist `doc_slug`, `category`, `title`, `keywords`, `content`.
- Acceptance: Each doc produces deterministic chunk IDs across runs.

#### Step 3 — Upsert + Cleanup
- Upsert chunk rows by `(doc_slug, chunk_index)`.
- Update rows when `chunk_hash` changes.
- Delete rows for chunks removed from a doc (stale `chunk_index`).
- Acceptance: Re‑seeding updates changed chunks only.

#### Step 4 — Retrieval (Chunk‑Level)
- Change retrieval to score chunks instead of whole docs.
- Return top K chunks (default 3–5).
- De‑dupe: no more than 2 chunks per doc unless query is multi‑intent.
- Acceptance: “explain notes” returns note‑specific chunk with `header_path`.

#### Step 5 — Evidence Objects
- Extend evidence objects with:
  - `doc_slug`, `chunk_index`, `header_path`, `chunk_hash`.
- Keep `score`, `matched_terms`, `category`, `title`.
- Acceptance: Evidence is emitted in logs and available to diagnostics.

#### Step 6 — Feature Flags + Fallback
- Gate with `DOC_RETRIEVAL_PHASE=2`.
- On error: fall back to Phase 1 keyword retrieval.
- Acceptance: Disabling Phase 2 reverts to Phase 1 without user‑visible errors.

#### Step 7 — Metrics + Observability
- Log retrieval latency (p50/p95), top scores, phase used, and no‑match rate.
- Track de‑dupe rate (how often multiple chunks from a single doc are trimmed).
- Acceptance: Metrics emitted for every retrieval call.

#### Step 8 — Tests
- Unit: chunker produces stable `header_path` and `chunk_index`.
- Integration: retrieval returns top chunks with evidence fields.
- Behavior: multi‑intent returns two chunks from different docs; no‑match returns clarification.

#### Rollback
- Flip `DOC_RETRIEVAL_PHASE=1` to revert to Phase 1 retrieval.
- Keep Phase 2 tables (no data loss) for later re‑enable.


---

## Phase 3 — Embeddings (Cursor‑style)
**Purpose**: Semantic search and fuzzy queries.

### Indexing
- On startup or background job:
  - Chunk docs
  - Generate embeddings
  - Store in local vector DB (pgvector or sqlite+faiss)

### Retrieval
- Embed query
- Search top‑K by cosine similarity
- Filter by category if provided

### Hybrid Search (Optional)
- Combine keyword score (30%) + embedding score (70%)
- Helps when users use exact terms from docs

### Acceptance Tests
- “how do I find my notes?” → notes + workspace chunk
- “where are my shortcuts?” → quick links chunk

---

## Phase 4 — Context Builder Integration
**Purpose**: Consistent assembly like Cursor.

### Context Stack
- Core concepts (always)
- Retrieved docs (top‑K)
- UI context (dashboard/workspace state)
- Widget state summaries
- Recent messages (last 3–5)

### Token Budget (Example)
| Component | Budget |
|---|---|
| Core concepts | 500 |
| Retrieved docs (top 3) | 1500 |
| UI context | 300 |
| Widget states | 200 |
| Recent messages | 500 |
| **Total** | ~3000 |

If over budget: drop lowest‑scored retrieved doc first.

---

## Metrics (Cross‑Phase)
Track to decide when to advance phases:
- **Keyword match rate**: % of queries with score > 0
- **Relevance issues**: user “not what I meant” follow‑ups
- **Retrieval latency**: p50/p95
- **Fallback rate**: % hitting “Which part should I explain?”
- **Groundedness sampling**: weekly manual review of retrieved docs vs answer

### Logging (Recommended)
Log per query:
- query text
- normalized tokens
- top results (slug, score, matched_terms, confidence)
- chosen action (answer / clarify / no‑match)
- retrieval latency
- active phase

### Phase Triggers (Updated)
**Trigger Phase 2 when:**
- Keyword match rate < 70%
- Synonym/typo failures are frequent
- Manual review shows poor precision

**Trigger Phase 3 when:**
- Fuzzy queries fail frequently (“how do I…” style)
- Keyword retrieval success drops on natural language queries
- Manual relevance score falls below threshold

---

## Operational Rollback & Safety
### Feature Flags
- `DOC_RETRIEVAL_ENABLED`: master kill switch
- `DOC_RETRIEVAL_PHASE`: 1 | 2 | 3

### Error/Latency Definitions
- **Error** includes: DB timeout (>2s), DB connection failure, query exception, vector store failure (Phase 3).
- **Retrieval latency** measures from query received → evidence objects returned (excludes LLM time).

### Fallback Chain
Phase 3 → Phase 2 → Phase 1 → Tier 1 cache → Generic

### Failure Handling
- DB timeout/error → log + fall through
- Retrieval exception → log + fall through

### Kill Switch Triggers (Updated)
| Trigger | Window | Action |
|---|---|---|
| p95 > 500ms | 5 min | Drop one phase (3→2→1) |
| p95 still breached | 5 min | Disable retrieval |
| Error rate > 5% | 5 min | Disable retrieval |
| Manual override | Immediate | Disable retrieval |

Notes:
- Thresholds are **initial defaults**; tune after baseline measurements.

---

## Re‑indexing Triggers
- Doc content changes (`content_hash` mismatch)
- Doc schema version bump
- Manual admin refresh
- Embedding model upgrade (Phase 3+)

---

## Implementation Status (2026-01-10)

### Phase 0: Prerequisites ✅ COMPLETE

| Item | Status | File |
|------|--------|------|
| Migration created | ✅ | `migrations/062_create_docs_knowledge.up.sql` |
| Rollback migration | ✅ | `migrations/062_create_docs_knowledge.down.sql` |
| Migration executed | ✅ | Via Docker: `annotation_postgres` |
| Seed documentation | ✅ | `docs/proposal/chat-navigation/plan/panels/chat/meta/documentation/{concepts,widgets,actions}/*.md` |
| Seed service | ✅ | `lib/docs/seed-docs.ts` (with auto-keyword extraction) |
| Seed API | ✅ | `app/api/docs/seed/route.ts` |
| Docs seeded | ✅ | 19 documents (7 concepts, 8 widgets, 4 actions) |

### Phase 1: Keyword Retrieval ✅ COMPLETE

| Item | Status | File |
|------|--------|------|
| Query normalization | ✅ | `lib/docs/keyword-retrieval.ts` |
| Stopwords + synonyms | ✅ | `lib/docs/keyword-retrieval.ts` |
| Scoring formula | ✅ | `lib/docs/keyword-retrieval.ts` |
| Confidence thresholds | ✅ | `lib/docs/keyword-retrieval.ts` |
| Evidence objects | ✅ | `RetrievalResult` interface |
| Core concepts cache (Tier 1) | ✅ | `CORE_CONCEPTS` constant |
| Retrieve API | ✅ | `app/api/docs/retrieve/route.ts` |
| Meta-explain integration | ✅ | `components/chat/chat-navigation-panel.tsx` |

### Files Created

| File | Description |
|------|-------------|
| `migrations/062_create_docs_knowledge.up.sql` | DB table for documentation (Phase 0) |
| `migrations/062_create_docs_knowledge.down.sql` | Rollback migration |
| `migrations/063_create_docs_knowledge_chunks.up.sql` | DB table for chunks (Phase 2) |
| `migrations/063_create_docs_knowledge_chunks.down.sql` | Rollback migration |
| `lib/docs/seed-docs.ts` | Seeding service (docs + chunks with auto-keyword extraction) |
| `lib/docs/keyword-retrieval.ts` | Retrieval service (Phase 1 docs + Phase 2 chunks) |
| `app/api/docs/seed/route.ts` | Seed API endpoint (seeds both docs and chunks) |
| `app/api/docs/retrieve/route.ts` | Retrieve API endpoint (supports mode=chunks, phase param) |

### Documentation Source (Existing Files)

Documentation is seeded from: `docs/proposal/chat-navigation/plan/panels/chat/meta/documentation/`

| Category | Count | Examples |
|----------|-------|----------|
| concepts | 7 | home, dashboard, workspace, entry, notes, widgets, panels |
| widgets | 8 | recent, quick-links, navigator, continue, widget-manager, links-overview, quick-capture, demo-widget |
| actions | 4 | navigation, notes, workspaces, widgets |

### Files Modified

| File | Changes |
|------|---------|
| `components/chat/chat-navigation-panel.tsx` | Added `isMetaExplainOutsideClarification()`, `extractMetaExplainConcept()`, meta-explain handler |

### Type Check

```
npm run type-check → PASS
```

### Completed Steps ✅

1. ✅ Migration executed via Docker: `docker exec -i annotation_postgres psql -U postgres -d annotation_dev < migrations/062_create_docs_knowledge.up.sql`
2. ✅ Docs seeded: `curl -X POST http://localhost:3000/api/docs/seed` → 19 documents inserted
3. ✅ Retrieval tested:
   - `home` → Tier 1 cache hit: "Home is your main entry dashboard..."
   - `workspace` → Tier 1 cache hit: "A workspace is where your notes live..."
   - `navigation` → Tier 2 DB hit: "Navigation Actions" with confidence 0.6

### Phase 2: Chunk-Level Retrieval ✅ COMPLETE (2026-01-11)

| Item | Status | File |
|------|--------|------|
| Migration (docs_knowledge_chunks) | ✅ | `migrations/063_create_docs_knowledge_chunks.up.sql` |
| Rollback migration | ✅ | `migrations/063_create_docs_knowledge_chunks.down.sql` |
| Chunking pipeline | ✅ | `lib/docs/seed-docs.ts` (chunkDocument, seedChunks) |
| Upsert + cleanup | ✅ | `lib/docs/seed-docs.ts` (seedChunks with stale chunk deletion) |
| Chunk scoring | ✅ | `lib/docs/keyword-retrieval.ts` (scoreChunk, retrieveChunks) |
| De-dupe logic | ✅ | `lib/docs/keyword-retrieval.ts` (dedupeChunks, MAX_CHUNKS_PER_DOC=2) |
| Evidence objects | ✅ | `ChunkRetrievalResult` interface with header_path, chunk_index |
| Feature flag | ✅ | `DOC_RETRIEVAL_PHASE` env var (default: 2) |
| Phase 1 fallback | ✅ | `smartRetrieve()` falls back to `retrieveDocs()` on error |
| Metrics logging | ✅ | Console log with latency, matched/total, deduped counts |
| Seed API updated | ✅ | `app/api/docs/seed/route.ts` now seeds both docs and chunks |
| Retrieve API updated | ✅ | `app/api/docs/retrieve/route.ts` supports mode=chunks, phase param |

#### Phase 2 Verification

```bash
# Seed chunks (114 chunks from 19 docs)
curl -X POST http://localhost:3000/api/docs/seed
# → {"docs":{"unchanged":19},"chunks":{"inserted":114}}

# Test chunk retrieval
curl -X POST http://localhost:3000/api/docs/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query":"home overview","mode":"chunks"}'
# → Phase 2 response with header_path, metrics, de-dupe
```

### Phase 3-4: Deferred

- Phase 3 (Embeddings): Not needed yet
- Phase 4 (Context Builder): Not needed yet
