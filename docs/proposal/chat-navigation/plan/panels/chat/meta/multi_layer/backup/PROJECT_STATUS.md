# Chat Navigation Project Status

**Last Updated:** 2026-01-26

This document summarizes the current implementation status, key artifacts, and active plans for the chat navigation/doc retrieval work.

---

## Index & Primary References

- **Plan Index:** `docs/proposal/chat-navigation/plan/panels/chat/meta/INDEX.md`
- **Core Plans:**
  - `docs/proposal/chat-navigation/plan/panels/chat/meta/cursor-style-doc-retrieval-plan.md`
  - `docs/proposal/chat-navigation/plan/panels/chat/meta/general-doc-retrieval-routing-plan.md`
  - `docs/proposal/chat-navigation/plan/panels/chat/meta/unified-retrieval-prereq-plan.md`

---

## Implemented Highlights (Confirmed via plans + reports)

### 1) Doc Retrieval Foundation & Routing
- **Cursor-style retrieval** (keyword + chunk retrieval) implemented.
- **Doc routing v5** with HS1/HS2 quality selection, disambiguation pills, and follow-up expansion.
- **Debt paydown** completed for routing/pattern consolidation and telemetry.

**Key References**
- Plans: `cursor-style-doc-retrieval-plan.md`, `general-doc-retrieval-routing-plan.md`, `2026-01-14-doc-retrieval-routing-debt-paydown-plan.md`
- Reports: `docs/proposal/chat-navigation/plan/panels/chat/meta/report/` and `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/`

### 2) Unified Retrieval Prerequisites (Docs + Notes)
- **Prereqs 1–5 complete**: indexing strategy, workspace scoping, unified `/api/retrieve`, cross-corpus ambiguity UX, safety/fallbacks.
- Notes indexing + retrieval services implemented.
- Cross-corpus routing handler + telemetry implemented.

**Key References**
- Plan: `unified-retrieval-prereq-plan.md`
- Reports: `reports/2026-01-20-*.md`

### 3) Clarification & Disambiguation Improvements
- **Off‑menu handling**: ordinal parsing, micro‑alias matching, ambiguity handling, hesitation/repair behaviors, escalation prompts.
- **Exit pills** integrated for late‑stage exits (when enabled by plan rules).
- **Constrained LLM fallback** (feature‑flagged) for ambiguous/off‑menu cases.
- **Prompt templates** standardized for clarification flows.

**Key References**
- Plan: `clarification-offmenu-handling-plan.md`
- Examples: `clarification-offmenu-handling-examples.md`
- LLM fallback: `clarification-llm-last-resort-plan.md`
- Exit pills: `clarification-exit-pills-plan.md`

### 4) Panel Command Routing & Naming
- Panel routing hardening + deterministic matching.
- Renames and terminology updates documented in reports (Link Notes → Links Panel).

**Key References**
- Plan: `panel-aware-command-routing-plan.md`
- Link panel fix: `link-notes-generic-disambiguation-fix.md` (now applies to “Links Panel” naming)
- Reports: `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-22-*.md`

---

## Current Active Plan (In Progress)

### A) Response‑Fit Classifier (Human‑like Clarification)
**Goal:** Ensure the system *asks* when user input doesn’t fit the current clarification context.
- Deterministic response‑fit first, optional constrained LLM only when needed.
- Confidence gates (execute / confirm / clarify).
- Negative intent precedence (avoid accidental opens).
- Noise definition + repair memory.

**Plan File:**
- `docs/proposal/chat-navigation/plan/panels/chat/meta/clarification-response-fit-plan.md`

### B) Unified Retrieval Phase 2 Adoption (Pending)
**Goal:** Adopt unified retrieval across the broader codebase now that prereqs are complete.

**Plan File:**
- `docs/proposal/chat-navigation/plan/panels/chat/meta/unified-retrieval-phase2-adoption-plan.md`

---

## Notable Addenda / Constraints

- **Zero‑Overlap Escape** logic integrated into clarification rules (as a *last‑resort* escape with guards).
- **Canonical token normalization** used for overlap checks to avoid false zero‑overlap.

---

## Reports (Recent / High‑Value)

- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-20-prereq4-cross-corpus-ambiguity-implementation-report.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-20-prereq5-safety-fallback-implementation-report.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-23-clarification-llm-fallback-implementation.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-22-link-notes-rename-implementation-report.md`

---

## Implementation Status Table (Plans)

| Plan / Area | Status | Notes |
|-------------|--------|-------|
| Cursor-style doc retrieval | ✅ Complete | Keyword + chunk retrieval foundation |
| General doc routing v5 | ✅ Complete | HS1/HS2 selection, disambiguation, follow-ups |
| Unified retrieval prereqs | ✅ Complete | Indexing + workspace scoping + `/api/retrieve` |
| Unified retrieval phase 2 | ⏸️ Pending | Adoption/integration still required |
| Clarification off‑menu handling | ✅ Implemented | Ordinal, micro‑alias, hesitation/repair, prompts |
| Clarification LLM fallback | ✅ Implemented (flagged) | Constrained selection only |
| Response‑fit classifier | 🟡 Draft | Plan ready, not integrated yet |

---

## Feature Flags / Config (Known in Plans)

**Clarification LLM (constrained fallback)**  
- `CLARIFICATION_LLM_FALLBACK` (server)  
- `NEXT_PUBLIC_CLARIFICATION_LLM_FALLBACK` (client gating)  
- `CLARIFICATION_LLM_MODEL`

**Cross‑corpus fuzzy normalization**  
- `NEXT_PUBLIC_CROSS_CORPUS_FUZZY`

**Semantic fallback classifier (routing)**  
- `SEMANTIC_FALLBACK_ENABLED` (model/config depends on environment)

> Note: Flags are documented in plan/report files; enablement varies by environment.

---

## Telemetry Snapshot (Where to Look)

- **Clarification & off‑menu telemetry:** see `reports/2025-01-23-offmenu-telemetry-baseline.md` and routing debug logs.
- **Cross‑corpus telemetry:** `lib/chat/routing-telemetry.ts` events referenced in prereq reports.
- **Classifier telemetry:** see classifier implementation reports (Gemini + alias coverage).

---

## Test Coverage (Relevant Files)

- `__tests__/chat/query-patterns.test.ts` — routing patterns & known terms
- `__tests__/unit/chat/clarification-offmenu.test.ts` — off‑menu prompts, hesitation/repair, list rejection
- `__tests__/unit/chat/clarification-llm-fallback.test.ts` — constrained LLM fallback parsing

---

## User‑Facing Behaviors (Now)

- Disambiguation pills for docs/notes and panels (cross‑corpus + panel routing).
- “Show more” for docs and notes (ViewPanel opens full content).
- Follow‑up expansion using chunk exclusion.
- Clarification prompts are consistent and adaptive (hesitation/repair/rejection).
- Optional constrained LLM fallback for ambiguous choices.

---

## Open Issues / Known Gaps

- **Response‑Fit classifier not integrated** — plan ready, awaiting implementation.
- **Unified Retrieval Phase 2 adoption** — needs broader integration once response‑fit stabilizes.

---

## Recent Changes (Summary)

- Clarification off‑menu handling consolidated (prompts + hesitation/repair + list rejection).
- Constrained LLM fallback added behind flags.
- Links Panel naming consolidation across UI/typo suggestions/commands.

---

## Current Working Assumptions

- **Clarification Off‑menu** is implemented and stable; current focus is **Response‑Fit** to reduce robotic behavior and mis-execution.
- **Unified Retrieval** prereqs complete; Phase 2 adoption is blocked only by integration effort, not infrastructure.

---

## Next Suggested Actions

1. Finalize and implement **clarification-response-fit-plan.md**.
2. Re-run clarification UX tests (hesitation, repair, “not that”, ambiguous hints) with Response‑Fit enabled.
3. Begin **unified-retrieval-phase2-adoption-plan.md** integration after response‑fit stabilizes.
