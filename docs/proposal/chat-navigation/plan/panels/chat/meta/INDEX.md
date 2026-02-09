# Chat Navigation Plans — Index

**Last Updated:** 2026-02-09

This index documents plan timelines for chat navigation: doc retrieval and clarification/disambiguation.

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
| 4. Cross-Corpus Ambiguity UX | Docs vs Notes pills + chat integration | ✅ Verified Complete (2026-01-20) |
| 5. Safety + Fallback | Graceful degradation | ✅ Verified (2026-01-20) |

**Key Deliverables:**
- `migrations/064_create_items_knowledge_chunks.up.sql` — Items chunks table
- `migrations/065_add_workspace_id_to_items_chunks.up.sql` — Workspace scoping
- `lib/docs/items-indexing.ts` — Indexing service for notes
- `lib/docs/items-retrieval.ts` — Retrieval service for notes
- `app/api/retrieve/route.ts` — Unified retrieval endpoint (docs/notes routing)
- `scripts/index-items.ts` — Backfill CLI (`npm run index:items`)
- Lifecycle hooks in: `app/api/items/route.ts`, `app/api/postgres-offline/documents/batch/route.ts`, `lib/server/note-deletion.ts`
- `lib/chat/query-patterns.ts` — Corpus signal detection (NOTES_CORPUS_PATTERNS, DOCS_CORPUS_PATTERNS)
- `lib/chat/cross-corpus-retrieval.ts` — Cross-corpus decision logic
- `lib/chat/cross-corpus-handler.ts` — Cross-corpus routing handler
- `lib/chat/routing-telemetry.ts` — Cross-corpus telemetry events

---

## Clarification & Disambiguation Plans

### 5. Off-Menu Handling Plan (Core)
**File:** `clarification-offmenu-handling-plan.md`
**Purpose:** Deterministic clarification tiers, hesitation/repair handling, bounded new-topic detection

**Status:** ✅ Implemented / Iterating

**Related:**
- `clarification-offmenu-handling-examples.md` — Behavioral examples
- `clarification-offmenu-handling-implementation-report.md` — Initial implementation report

---

### 6. LLM Last-Resort Fallback Plan
**File:** `clarification-llm-last-resort-plan.md`
**Purpose:** Constrained LLM selection among shown options (feature-flagged)

**Status:** ✅ Implemented / Iterating

---

### 7. Response-Fit Classifier Plan (Primary)
**File:** `clarification-response-fit-plan.md`
**Purpose:** Intent classification before selection; confidence ladder; noise handling

**Status:** 🔄 Active (current source of truth for clarification flow)

**Related:**
- `clarification-response-fit-implementation-guide.md` — Checklist-style implementation guide
- `clarification-qa-checklist.md` — Manual QA checklist

---

### 8. Interrupt / Resume Addendum
**File:** `clarification-interrupt-resume-plan.md`
**Purpose:** Pause list on new-topic interruption; resume only on explicit return cue

**Status:** 🔄 Active addendum (overrides Response-Fit where specified)

---

### 9. Stop / Cancel Scope Addendum
**File:** `clarification-stop-scope-plan.md`
**Purpose:** Scope-aware stop handling; confirmation for ambiguous stop; no auto-resume

**Status:** 🔄 Active addendum (overrides Response-Fit where specified)

---

### 10. Panel Command Matcher — Action Verb Stopword Plan
**File:** `panel-command-matcher-stopword-plan.md`
**Purpose:** Prevent “open links panel” from falling into LLM path by stripping action verbs in matcher input

**Status:** 📝 Draft (await debug log capture)

---

### 11. Known‑Noun Command Routing Plan
**File:** `known-noun-command-routing-plan.md`
**Purpose:** Deterministic routing for noun‑only commands (allowlist, question guard, unknown‑noun fallback)

**Status:** ✅ Implemented (routing dispatcher Tier 4)

---

### 12. Routing Order & Priority Plan
**File:** `routing-order-priority-plan.md`
**Purpose:** Unified routing priority chain to resolve conflicts across stop/interrupt/clarification/known‑noun/docs

**Status:** ✅ Implemented (routing dispatcher + guards)

---

### 13. Suggestion Routing Unification Plan
**File:** `suggestion-routing-unification-plan.md`
**Purpose:** Move suggestion reject/affirm flows into the unified dispatcher (single routing spine)

**Status:** ✅ Implemented (routing dispatcher Tier S)

---

### 14. Grounding‑Set Fallback Plan
**File:** `grounding-set-fallback-plan.md`
**Purpose:** General grounding fallback (lists + non‑list contexts; multi‑widget ambiguity)

**Status:** 📝 Draft

---

### 15. Selection-vs-Command Arbitration Rule Plan
**File:** `selection-vs-command-arbitration-rule-plan.md`
**Purpose:** Deterministic guardrail for active-option selection vs new-command intent conflicts

**Status:** 📝 Draft (governance guardrail)

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
| 2026-01-20 | `reports/2026-01-20-prereq4-cross-corpus-ambiguity-implementation-report.md` | Unified Retrieval Prereq 4 |
| 2026-01-20 | `reports/2026-01-20-prereq5-safety-fallback-implementation-report.md` | Unified Retrieval Prereq 5 |
| 2026-01-25 | `clarification-offmenu-handling-implementation-report.md` | Clarification off-menu |

---

## Deferred Work (Trigger Conditions)

| Item | Trigger Condition |
|------|-------------------|
| Phase 3 Embeddings | Fuzzy queries fail frequently, keyword retrieval success drops |
| Phase 4 Context Builder | Need consistent context assembly |
| Semantic classifier | If correction rate improves in staging without latency spikes |
| TD-6 LLM intent | If patterns remain too brittle after other fixes |

## Completed Milestones

| Item | Completion Date | Notes |
|------|-----------------|-------|
| Unified Retrieval Prerequisites | 2026-01-20 | All 5 prereqs verified: indexing, permissions, API, cross-corpus UX, safety fallback |
| Doc Retrieval Routing v5 | 2026-01-13 | HS1/HS2 selection, disambiguation, follow-up expansion |
| Technical Debt Paydown | 2026-01-16 | TD-1 through TD-9 (except TD-6 deferred) |

---

## Quick Reference

```
docs/proposal/chat-navigation/plan/panels/chat/meta/
├── INDEX.md                                          ← You are here
├── clarification-offmenu-handling-plan.md            ← Clarification core
├── clarification-offmenu-handling-examples.md        ← Clarification examples
├── clarification-llm-last-resort-plan.md             ← Constrained LLM fallback
├── clarification-response-fit-plan.md                ← Response-fit classifier (primary)
├── clarification-response-fit-implementation-guide.md← Implementation guide
├── clarification-qa-checklist.md                     ← Manual QA checklist
├── clarification-interrupt-resume-plan.md            ← Addendum: interrupt/resume
├── clarification-stop-scope-plan.md                  ← Addendum: stop/cancel scope
├── selection-vs-command-arbitration-rule-plan.md     ← Plan 15 (Selection vs command guardrail)
├── cursor-style-doc-retrieval-plan.md               ← Plan 1 (Foundation)
├── general-doc-retrieval-routing-plan.md            ← Plan 2 (Routing v5)
├── 2026-01-14-doc-retrieval-routing-debt-paydown-plan.md  ← Plan 3 (Debt)
├── unified-retrieval-prereq-plan.md                 ← Plan 4 (Unified Prereqs)
├── technical-debt/
│   └── 2026-01-14-doc-retrieval-routing-debt.md     ← Debt tracking doc
├── report/                                           ← Cursor-style + v5 reports
└── reports/                                          ← Debt paydown reports
```
