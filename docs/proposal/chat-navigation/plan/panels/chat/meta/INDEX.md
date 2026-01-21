# Doc Retrieval Plans — Index

**Last Updated:** 2026-01-20

This index documents the plan timeline for the doc retrieval feature in chat navigation.

---

## Plan Timeline (Execution Order)

### 1. Cursor-Style Doc Retrieval Plan (Foundation)
**File:** `cursor-style-doc-retrieval-plan.md`
**Purpose:** Retrieval pipeline foundation — indexing, scoring, `/api/docs/retrieve` API

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Prerequisites (docs in DB) | ✅ Complete |
| Phase 1 | Keyword retrieval | ✅ Complete |
| Phase 2 | Chunk-level retrieval | ✅ Complete (2026-01-11) |
| Phase 3 | Embeddings | ⏸️ Deferred |
| Phase 4 | Context builder | ⏸️ Deferred |

**Key Deliverables:**
- `lib/docs/keyword-retrieval.ts` — Retrieval service
- `lib/docs/seed-docs.ts` — Seeding service
- `app/api/docs/retrieve/route.ts` — Retrieve API
- `migrations/062_create_docs_knowledge.up.sql` — Docs table
- `migrations/063_create_docs_knowledge_chunks.up.sql` — Chunks table

---

### 2. General Doc Retrieval Routing Plan (v5)
**File:** `general-doc-retrieval-routing-plan.md`
**Purpose:** UI/router integration — routing queries to retrieval API, response selection

**Prerequisite:** Cursor-Style Plan Phase 1-2 complete

| Section | Description | Status |
|---------|-------------|--------|
| v5 Core | Routing + HS1/HS2 response selection | ✅ Complete (2026-01-13) |
| Semantic classifier | LLM fallback for borderline cases | ⏸️ Optional (not implemented; follow-up classifier only; gated on unknown doc terms) |
| Unified retrieval | Notes/files corpus | ⏸️ Future (blocked on remaining prereqs) |
| Unified retrieval prerequisites | Notes/files indexing + permissions checklist | 🔄 In Progress (`unified-retrieval-prereq-plan.md`) |

**Key Deliverables:**
- Routing order in `chat-navigation-panel.tsx`
- HS1/HS2 snippet quality selection
- Follow-up expansion (`excludeChunkIds`)
- Disambiguation UX (option pills)

---

### 3. Doc Retrieval Routing Debt Paydown Plan
**File:** `2026-01-14-doc-retrieval-routing-debt-paydown-plan.md`
**Debt Doc:** `technical-debt/2026-01-14-doc-retrieval-routing-debt.md`
**Purpose:** Address technical debt discovered during v5 implementation

| Item | Description | Status |
|------|-------------|--------|
| TD-1 | Remove CORE_APP_TERMS duplication | ✅ Complete (2026-01-16) |
| TD-2 | Gated fuzzy matching for typos | ✅ Complete (2026-01-15) |
| TD-3 | Consolidate pattern matching | ✅ Complete (2026-01-14) |
| TD-4 | Durable routing telemetry | ✅ Complete (2026-01-15) |
| TD-5 | Polite follow-up guard | ✅ Complete (2026-01-16) |
| TD-6 | LLM intent extraction | ⏸️ Deferred (optional) |
| TD-7 | Stricter app-relevance fallback | ✅ Complete (2026-01-16) |
| TD-8 | Don't lock state on weak results | ✅ Complete (2026-01-15) |
| TD-9 | Cross-doc ambiguity override | ✅ Complete (pre-existing) |

**Key Deliverables:**
- `lib/chat/query-patterns.ts` — Consolidated pattern module
- `lib/chat/routing-telemetry.ts` — Telemetry events
- `lib/docs/known-terms-client.ts` — SSR snapshot for knownTerms
- `__tests__/chat/query-patterns.test.ts` — Regression tests (20+ cases)

---

### 4. Unified Retrieval Prerequisites Plan
**File:** `unified-retrieval-prereq-plan.md`
**Purpose:** Define prerequisites before implementing unified retrieval across docs + notes/files

| Prerequisite | Description | Status |
|--------------|-------------|--------|
| 1. Indexing Strategy | Schema + chunking + lifecycle wiring | ✅ Complete (2026-01-20) |
| 2. Permissions + Visibility | Workspace scoping (Option A) | ✅ Complete (2026-01-20) |
| 3. Unified API Contract | Single `/api/retrieve` endpoint | ✅ Complete (2026-01-20) |
| 4. Cross-Corpus Ambiguity UX | Docs vs Notes pills | ⏸️ Not Started |
| 5. Safety + Fallback | Graceful degradation | ⏸️ Not Started |

**Key Deliverables:**
- `migrations/064_create_items_knowledge_chunks.up.sql` — Items chunks table
- `migrations/065_add_workspace_id_to_items_chunks.up.sql` — Workspace scoping
- `lib/docs/items-indexing.ts` — Indexing service for notes
- `lib/docs/items-retrieval.ts` — Retrieval service for notes
- `app/api/retrieve/route.ts` — Unified retrieval endpoint (docs/notes routing)
- `scripts/index-items.ts` — Backfill CLI (`npm run index:items`)
- Lifecycle hooks in: `app/api/items/route.ts`, `app/api/postgres-offline/documents/batch/route.ts`, `lib/server/note-deletion.ts`

---

## Implementation Reports

| Date | Report | Plan |
|------|--------|------|
| 2026-01-10 | `report/2026-01-10-cursor-style-doc-retrieval-implementation-report.md` | Cursor-style |
| 2026-01-11 | `report/2026-01-11-phase2-chunk-retrieval-implementation-report.md` | Cursor-style Phase 2 |
| 2026-01-11 | `report/2026-01-11-general-doc-retrieval-routing-complete-report.md` | Routing v5 |
| 2026-01-14 | `reports/2026-01-14-definitional-query-fix-implementation-report.md` | Definitional fix |
| 2026-01-14 | `reports/2026-01-14-td3-implementation-report.md` | Debt TD-3 |
| 2026-01-15 | `reports/2026-01-15-knownterms-race-fix-report.md` | knownTerms race fix |
| 2026-01-15 | `reports/2026-01-15-td2-fuzzy-matching-implementation-report.md` | Debt TD-2 |
| 2026-01-15 | `reports/2026-01-15-td4-td8-implementation-report.md` | Debt TD-4, TD-8 |
| 2026-01-16 | `reports/2026-01-16-td7-implementation-report.md` | Debt TD-7 |
| 2026-01-20 | `reports/2026-01-20-unified-retrieval-prereq-permissions-workspace-scope-report.md` | Unified Retrieval Prereq 2 |
| 2026-01-19 | `reports/2026-01-19-interface-weak-match-fix-implementation-report.md` | Interface weak-match |
| 2026-01-20 | `reports/2026-01-20-classifier-gemini-and-alias-coverage-implementation-report.md` | Classifier Gemini + Alias coverage |
| 2026-01-20 | `reports/2026-01-20-unified-retrieval-prereq-indexing-implementation-report.md` | Unified Retrieval Prereq 1 |

---

## Deferred Work (Trigger Conditions)

| Item | Trigger Condition |
|------|-------------------|
| Phase 3 Embeddings | Fuzzy queries fail frequently, keyword retrieval success drops |
| Phase 4 Context Builder | Need consistent context assembly |
| Semantic classifier | If correction rate improves in staging without latency spikes |
| Unified retrieval | After remaining prereqs (API, UX, fallback) are ready |
| TD-6 LLM intent | If patterns remain too brittle after other fixes |

---

## Quick Reference

```
docs/proposal/chat-navigation/plan/panels/chat/meta/
├── INDEX.md                                          ← You are here
├── cursor-style-doc-retrieval-plan.md               ← Plan 1 (Foundation)
├── general-doc-retrieval-routing-plan.md            ← Plan 2 (Routing v5)
├── 2026-01-14-doc-retrieval-routing-debt-paydown-plan.md  ← Plan 3 (Debt)
├── unified-retrieval-prereq-plan.md                 ← Plan 4 (Unified Prereqs)
├── technical-debt/
│   └── 2026-01-14-doc-retrieval-routing-debt.md     ← Debt tracking doc
├── report/                                           ← Cursor-style + v5 reports
└── reports/                                          ← Debt paydown reports
```
