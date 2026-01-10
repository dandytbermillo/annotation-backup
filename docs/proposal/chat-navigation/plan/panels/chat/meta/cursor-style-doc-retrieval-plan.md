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

### Metadata
- `title`, `category`, `keywords`, `source`.
- Use `category` for scoped retrieval (concepts/widgets/actions).

### Acceptance Tests
- “explain notes” returns note‑specific chunk.
- “what is quick links” returns widget chunk.

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
