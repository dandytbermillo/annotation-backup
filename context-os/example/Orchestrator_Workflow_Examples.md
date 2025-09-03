# Orchestrator Agent — Worked Examples (with Context‑OS at Repo Root)
**Last Updated:** 2025-09-03

> **Note:** `context-os/` lives at the **repo root** (not inside `docs/`). Drafts may live at the root or under a root-level `drafts/` folder before scaffolding.
> the implementation.md could be the initial.md

```
/                       # repo root
├─ context-os/          # agent system lives here (NOT under docs/)
├─ drafts/              # optional root-level drafts folder
│  └─ implementation.md # draft plan before approval
└─ docs/
   └─ proposal/
      └─ <feature_slug>/  # created only after confirmation
```

---

## Example A — Happy path (plan is complete)

**Starting state**
```
drafts/
└─ implementation.md   # already has: Feature Slug, Status, Objective,
                       # Acceptance Criteria, Implementation Tasks
```

**1) User asks**  
“Create a feature to speed up annotation saves during sync conflicts. Use my draft.”

**2) Orchestrator parses + proposes slug**  
- Proposes: `faster_annotation_sync` (and 2 alternates)  
- Notifies: “Plan file will live at `docs/proposal/faster_annotation_sync/implementation.md`.”

**3) Validate plan fields**  
Checks: Feature Slug ✓, Status ✓, Objective ✓, Acceptance Criteria ✓, Tasks ✓ → **Valid**

**4) Show summary + ask to proceed**  
Actions:  
- create `docs/proposal/faster_annotation_sync/` and standard subfolders  
- move/copy `drafts/implementation.md` → `docs/proposal/faster_annotation_sync/implementation.md`  
- seed report + indexes  
Asks: “Proceed?”

**5) User confirms → Scaffold**  
Creates:
```
docs/proposal/faster_annotation_sync/
├─ implementation.md           # moved as‑is (no renaming)
├─ tech-stack.md               # (only if user asked to copy a draft)
├─ coding-style.md             # (only if user asked to copy a draft)
├─ reports/
│  └─ Faster-Annotation-Sync-Implementation-Report.md  # TOC-style stub
├─ implementation-details/
│  └─ artifacts/
│     └─ INDEX.md
└─ post-implementation-fixes/
   ├─ README.md
   ├─ critical/
   ├─ high/
   ├─ medium/
   └─ low/
```

**6) Hand‑off**  
- (Optional) set Status → `IN PROGRESS` in `implementation.md`  
- Suggest next steps (run tests via VerifierAgent, start coding in `implementation-details/`)

---

## Example B — Plan incomplete (agent helps fill gaps)

**Starting state**
```
drafts/
└─ implementation.md   # Missing: Objective, Acceptance Criteria
```

**1) User asks**  
“Create a feature for dropped updates during rapid typing. Use the draft.”

**2) Orchestrator proposes slug**  
- Proposes: `fix_rapid_typing_updates`  
- Announces target plan path under `docs/proposal/<slug>/implementation.md`

**3) Validate plan fields → FAIL**  
Missing: Objective, Acceptance Criteria → Orchestrator **stops** and reports a checklist of missing items.

**4) Offer help**  
Asks: “Fill these together?”  
- **Yes** → delegate to **PlanFillerAgent**  
- **No** → abort (user edits manually)

**5) PlanFillerAgent (interactive, focused)**  
Q1: “What’s the Objective?”  
A: “Prevent overwrites/drops during bursts of keystrokes.”  

Q2: “Acceptance Criteria (3 items)?”  
A:  
- “[ ] No lost updates with ≤300ms intervals”  
- “[ ] Conflict resolution preserves latest user intent”  
- “[ ] Test passes with 150 WPM simulated typing”  

**6) Produce a patch (you review before applying)**
```diff
--- a/drafts/implementation.md
+++ b/drafts/implementation.md
@@
 ## Objective
- (missing)
+ Prevent overwrites or dropped annotation updates during rapid typing and sync overlaps.

 ## Acceptance Criteria
-- (missing)
+ - [ ] No lost updates with ≤300ms input intervals
+ - [ ] Conflict resolution preserves latest user intent
+ - [ ] 150 WPM simulation passes without data loss
```

**7) Orchestrator re‑validates → PASS → asks to proceed**  
Same confirmation gate as in Example A.

**8) On confirm → Scaffold + move files**  
Creates standard folders and moves `implementation.md` (no renaming).

---

## Example C — Post‑implementation fix (after Status = COMPLETE)

**Starting state**  
- The feature’s Implementation Report status is `✅ COMPLETE`.  
- A new bug report arrives: “Memory spike during batch save.”

**1) Orchestrator enforces phase boundary**  
Refuses to edit `implementation-details/` (it’s locked after COMPLETE). Switches to **post‑implementation** flow.

**2) ClassifierAgent assigns severity**  
Uses objective thresholds (e.g., +35% p95 latency in prod → **High**).

**3) Orchestrator scaffolds a fix entry**  
Creates:
```
docs/proposal/<feature>/post-implementation-fixes/high/
└─ 2025-09-03-batch-save-memory-spike.md
```
…and updates the index:
```
docs/proposal/<feature>/post-implementation-fixes/README.md
```

**4) VerifierAgent guidance**  
Prepares exact commands to reproduce + capture logs into `implementation-details/artifacts/` under a **fix‑specific** subfolder.

**5) Outcome**  
Fix is documented, artifacts captured, and the main report **links** to the fix (no inline logs).

---

## What to copy/paste into Claude Code to kick off

**User message example**
```
Create a new feature to speed up annotation saves during sync conflicts.
Use my plan at drafts/implementation.md and copy drafts/tech-stack.md as well.
```

**Orchestrator’s expected behavior**
1) Propose slug(s) + show target plan path  
2) Validate plan → if missing fields, offer “Fill together” and produce a patch for review  
3) Present an action summary (dest folder, files to move, folders to create)  
4) Wait for **explicit** confirmation  
5) Scaffold + move files (never rename `implementation.md`)  
6) Seed report + indexes, set Status to `IN PROGRESS` (optional), and hand off

---

## Guardrails always on

- **Never** write outside `docs/proposal/<feature_slug>/` (and the allowed root/drafts path)
- **Never** rename `implementation.md`
- **Stop** if plan invalid or user declines
- **Do not** modify `implementation-details/` after COMPLETE
- **Fixes** always go in `post-implementation-fixes/<severity>/` with README updated
