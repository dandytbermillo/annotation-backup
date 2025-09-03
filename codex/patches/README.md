Codex Patches — Advisory Diffs (Read‑Only by Default)

This folder holds advisory .patch files you can review and apply via PR. Per codex/POLICY.md, I only create previews; you decide what to merge.

TL;DR
- Review: `git diff --no-index` or open the patch files here.
- Apply: `git apply codex/patches/<file.patch>` (from repo root).
- Scope: Files here are safe to keep; applying them will modify files outside `codex/` only when you run `git apply`.

Key Patches (recent)
- 2025-09-02-refresh-readme.patch: Refreshes top‑level `README.md` with a TL;DR, quick scripts, docs links, and v1.4 documentation notes.
- 2025-09-02-doc-guide-lite-active-deprecated.patch: Minimal “ACTIVE RULES vs DEPRECATED” banner added to `docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md` to remove contradictions fast.
- 2025-09-02-item2-merged-proposal.patch: Adds `docs/proposal/temp/ITEM_2_Single_Source_of_Truth_Proposal_MERGED.md` (Item 2 merged proposal: Active Rules, optional Rule IDs, doc‑lint, rollout, governance).
- 2025-09-02-doc-guide-v1.4-section4-alignment.patch: Aligns the guide with v1.4 Section 4 (TOC/dashboard main report, fixes path, Scope of Implementation).
- 2025-09-02-docs-guide-v1.4-path-consistency.patch: Cleans up lingering `reports/.../fixes` references in the guide.

Batch Interval Cleanup (earlier set)
- api-documents-batch-no-interval.patch
- api-branches-batch-no-interval.patch
- api-panels-batch-no-interval.patch
- hybrid-sync-manager-clear-interval.patch

Notes
- Serverless caution: Prefer durable stores (DB/Redis) with TTL and scheduled cleanup over in‑memory intervals.
- Approval workflow: See codex/POLICY.md for rules on when I can apply patches vs. when I must only propose them.
