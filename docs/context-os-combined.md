# context-os System Overview + Orchestration Workflow

**Last Updated**: 2025-09-03

---

## Part 1: 📦 context-os System Overview

`context-os/` is the lightweight agent-based orchestration layer that powers compliant, safe, and intelligent documentation workflows.

---

### 📁 Purpose

To enable and manage automation of documentation processes for feature planning, testing, verification, and post-implementation fixes.

---

### 📂 Directory Structure

```plaintext
context-os/
├── implementation.md       # This file (how the system works)
├── tech-stack.md           # Global stack used by generated features
├── coding-style.md         # System-wide coding conventions
├── agents/
│   ├── orchestrator.ts
│   ├── plan-filler.ts
│   └── verifier.ts
```

---

### 📄 Key Files

- `implementation.md` – Explains how the orchestrator and agents collaborate
- `tech-stack.md` – Defines tech choices used in scaffolding and prompts
- `coding-style.md` – Provides conventions for LLM-generated and human code
- `agents/` – Contains code modules for each agent role

---

### 🧠 Agent Roles

#### Orchestrator Agent
- Parses user requests
- Proposes feature slugs
- Validates `implementation.md`
- Asks for confirmation
- Initiates scaffold process

#### PlanFillerAgent
- Assists user in filling missing fields in `implementation.md`

#### VerifierAgent
- Handles test commands, logs, and verification artifacts

---

### 🔒 Rules

- `context-os/` is **not** a feature
- It must **not** be placed under `docs/proposal/`
- Files here are **never renamed or moved** into feature folders

---

### ✅ Summary

The `context-os/` system is the backbone of intelligent documentation in compliance with the Documentation Process Guide v1.4.5. It ensures that all actions are:

- Safe
- User-approved
- Traceable
- Well-structured

---

# Orchestration Workflow — End‑to‑End Process (Agent-Based)

**Last Updated:** 2025-09-03

This document explains **exactly how the orchestration works** from a user's request to a fully scaffolded, compliant feature workspace, including validations, branching, confirmations, and error handling. It is designed to align with the Documentation Process Guide v1.4.5 and your `context-os/` agent platform.

---

## 1) Goals

- Turn **messy inputs** (ideas, logs, drafts) into a **validated plan** and a **proper feature folder**.
- Keep humans **in control** (confirmation gates) and **prevent bad docs** from propagating.
- Produce **consistent outputs** that downstream agents (Classifier, Fix, Verifier, Doc Writer) can trust.

---

## 2) Roles (Agents)

- **Orchestrator** (router/owner): coordinates the flow, enforces rules, asks for confirmation.
- **PlanFillerAgent** (optional): asks focused questions and patches missing sections in `implementation.md`.
- **VerifierAgent** (optional): executes verification commands and stores text artifacts.
- **DocWriterAgent** (optional): writes fix docs and indexes **after** the implementation is COMPLETE.
- **ClassifierAgent** (optional): classifies severity for post-implementation issues.

> Only the **Orchestrator** is required for the core workflow. Others are called as needed.

---

## 3) Inputs

- **User request** (free text or command, e.g., “Fix dropped updates during rapid typing”).
- **Draft files** (optional):  
  - `drafts/implementation.md` (feature plan – final name stays **implementation.md**)  
  - `drafts/tech-stack.md` (optional)  
  - `drafts/coding-style.md` (optional)
- **Context‑OS config** (paths, naming rules).

---

## 4) Output (Success Criteria)

A feature workspace at `docs/proposal/<feature_slug>/` with:
- `implementation.md` (validated; copied/moved from draft or generated).
- Optional: `tech-stack.md`, `coding-style.md`.
- Folders: `reports/`, `implementation-details/artifacts/`, `post-implementation-fixes/{critical,high,medium,low}/`.
- Main report stub under `reports/` (navigation hub template).
- Post-implementation fixes index stub (`post-implementation-fixes/README.md`).

---

## 5) End‑to‑End Process (Step‑By‑Step)

### Step A — Parse & Propose
1. Parse the user’s description.
2. Generate a **feature_slug** (`kebab_or_snake_case`).
3. Announce:  
   > “Plan file will be: `docs/proposal/<feature_slug>/implementation.md`.”

### Step B — Locate Draft Plan
4. Look for **`drafts/implementation.md`** (or a user-specified path).
5. If found, mark as **source plan**. If not, create a **minimal plan** (see Step C) and continue.

### Step C — Validate Plan
6. Validate the following **required fields** in `implementation.md`:
   - **Feature Slug**
   - **Status** (PLANNED / IN PROGRESS / TESTING / COMPLETE / BLOCKED / ROLLBACK)
   - **Objective** (clear goal)
   - **Acceptance Criteria** (checkbox list)
   - **Implementation Tasks** (bullet list)
7. If **missing or vague**, **STOP** and show a **Missing Checklist**.
8. Ask the user:
   - **“Fix together?”** → Call **PlanFillerAgent** to collect and insert missing sections.
   - **“I’ll fix manually.”** → Abort until user provides an updated plan.

### Step D — Confirmation Gate
9. Once the plan validates, show a short **action summary**:
   - Destination folder
   - Files to copy/move
   - Folders to scaffold
10. Ask for explicit **user confirmation**:
    - ✅ Proceed → go to Step E
    - ❌ Cancel → stop with no changes

### Step E — Scaffold & Move (No Renames)
11. Create folders under `docs/proposal/<feature_slug>/`:
    - `reports/`
    - `implementation-details/artifacts/`
    - `post-implementation-fixes/` (`critical/`, `high/`, `medium/`, `low/`)
    - `patches/` (optional)
12. **Copy/Move** files:
    - `drafts/implementation.md` → `docs/proposal/<feature_slug>/implementation.md`
    - `drafts/tech-stack.md` → `docs/proposal/<feature_slug>/tech-stack.md` (optional)
    - `drafts/coding-style.md` → `docs/proposal/<feature_slug>/coding-style.md` (optional)
    - **Never rename** `implementation.md`.
13. Seed stubs:
    - `reports/<Feature>-Implementation-Report.md` (TOC-style, links only)
    - `post-implementation-fixes/README.md` (index template)
    - `implementation-details/artifacts/INDEX.md` (empty manifest)

### Step F — Hand‑off / Continue
14. Optionally update a task system (e.g., TodoWrite).
15. Transition **Status** to `IN PROGRESS` if you’re starting immediately.
16. From here, implementation proceeds; when `COMPLETE`, use **post-implementation** flow for any fixes.

---

## 6) Branching & Stop Conditions

**The Orchestrator MUST stop** when:
- Plan fields missing (see Step C).
- User declines confirmation in Step D.
- A write would change files **outside** `docs/proposal/<feature_slug>/` or the allowed draft path.
- Someone asks to modify `implementation-details/` **after** status is `COMPLETE`.
- Severity classification is requested without measurable metrics.

On stop, the Orchestrator **explains why** and provides the next safe action.

---

## 7) State Machine

```
DRAFT → VALIDATING → { BLOCKED | READY }
READY → CONFIRMING → { ABORTED | SCAFFOLDING }
SCAFFOLDING → DONE (feature folder ready)

# Typical doc status (inside plan)
PLANNED → IN PROGRESS → TESTING → COMPLETE
(Then fixes use post-implementation workflow; no “un-complete” allowed.)
```

---

## 8) Directory & Naming Rules

- Feature workspace must be under: `docs/proposal/<feature_slug>/`.
- `implementation.md` is the plan filename (do not rename).
- Use `kebab-case` or `snake_case` for `<feature_slug>`.
- `reports/` contains one main **Implementation Report** (links only).
- `post-implementation-fixes/` contains a **README index** and **severity folders**.

---

## 9) Interfaces (How to Drive the Orchestrator)

### A) Natural language
> “Create a feature for dropped updates during rapid typing. Use my draft at drafts/implementation.md.”

### B) Command-like prompts
```
/feature create slug=fix_annotation_sync plan=./drafts/implementation.md copy=tech-stack.md,coding-style.md
```

### C) Agent JSON (example)
```json
{
  "action": "create_feature",
  "slug": "fix_annotation_sync",
  "plan_path": "drafts/implementation.md",
  "copy": ["drafts/tech-stack.md", "drafts/coding-style.md"],
  "confirm": true
}
```

---

## 10) Minimal Plan Template (if no draft exists)

```markdown
# [Feature Title]

**Feature Slug**: <feature_slug>
**Date**: YYYY-MM-DD
**Status**: 📝 PLANNED

## Objective
[Clear goal]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Implementation Tasks
- Task 1
- Task 2
- Task 3
```

---

## 11) Compliance Mapping (Why this is safe)

- **Plan-first**: Prevents blind scaffolding.
- **Confirmation gate**: Human approval before writes.
- **Phase boundary**: Implementation vs Post-Implementation is enforced.
- **Artifacts discipline**: Logs go in `implementation-details/artifacts/`.
- **Fixes discipline**: After `COMPLETE`, fixes go in `post-implementation-fixes/<severity>/` with a README index.

---

## 12) Error Handling & Recovery

- **Missing Plan**: Offer to generate Minimal Plan (Step 10) or cancel.
- **Invalid Fields**: Call **PlanFillerAgent** or ask user to edit and retry.
- **Slug Conflict**: Offer alternate slugs or confirm overwrite (never default to overwrite).
- **Permission Issues**: Stop with a filesystem path hint and no partial writes.
- **Partial Scaffold**: If interrupted, re-run is idempotent (only create missing pieces).

---

## 13) Example Walkthrough

**User**: “I need a feature to fix annotation race conditions.”  
**Orchestrator**: Proposes `fix_annotation_sync`; finds `drafts/implementation.md`; validates → Objective missing.  
**PlanFillerAgent**: Asks for objective; patches plan.  
**Orchestrator**: Shows summary + asks to proceed.  
**User**: Confirms.  
**Orchestrator**: Creates `docs/proposal/fix_annotation_sync/…`, moves files, seeds stubs.  
**Result**: Feature workspace ready; implementation can start.

---

## 14) Checklists

**Pre‑Scaffold Checklist**
- [ ] Feature slug chosen
- [ ] Plan file located
- [ ] Required fields present & non-empty
- [ ] User confirmation captured

**Post‑Scaffold Checklist**
- [ ] Folders created
- [ ] Plan moved/copied
- [ ] Reports stub created
- [ ] Fixes index stub created
- [ ] Artifacts index stub created

---

## 15) Configuration Notes (Optional)

- **Draft path**: `drafts/` (configurable)
- **Feature root**: `docs/proposal/` (required)
- **Patches dir**: `docs/proposal/<slug>/patches/` (optional)
- **Naming**: Prefer `kebab-case` slugs
- **Status default**: `PLANNED` on creation

---

**End of document.**