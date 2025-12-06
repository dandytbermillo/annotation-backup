# Merge Dashboard & Workspace — Status Memo

This memo summarizes the current state of the **Merge Dashboard & Workspace** plan and how it relates to the other entry/workspace documents.

## What this plan covers (implemented / in progress)

- Dashboard and workspace share a layered view (same canvas instance, different view modes).
- `AnnotationAppShell` now supports an embedded mode (`isHidden`, `hideHomeButton`, etc.) so the dashboard can host a workspace inline without duplicating chrome.
- Navigation context tracks `viewMode` and `activeWorkspaceId`; URLs (`?view=workspace&ws=…`) restore the right mode after refresh.
- Quick Links create entries + dashboard workspace automatically; switching entries uses `setActiveEntryContext` so the right entry/workspace pair is selected.
- Runtime ledger fixes (notes + components) ensure each workspace’s state is isolated even though the dashboard and embedded canvas share the same React tree.
- Remaining work in this plan primarily involves UX polish (e.g., workspace dropdown behavior) rather than architectural changes.

## Relationship to Entry/Workspace Hierarchy plan

- The **Entry Workspace Hierarchy** plan (and its addendum) deals with database‑level ownership (adding `item_id` to `note_workspaces`, migrations, FK constraints, etc.).
- That plan is *not* strictly required to run the merged dashboard/workspace experience—it becomes important when you want entry ownership enforced in the database and per-entry defaults.
- This memo belongs in the `merge_dashboard_workspace` folder to keep that plan self-contained; the hierarchy addendum remains where it is (`entry-workspace-hierarchy-addendum.md`).

## Current takeaway

- The merged dashboard/workspace behavior is live in the codebase. Users can land on the home dashboard, click a Quick Link, get the entry’s dashboard, and drop straight into the correct workspace. Notes and components persist per workspace.
- If/when we decide to enforce the entry hierarchy in the DB schema (per-entry defaults, cascade deletes, etc.), follow the hierarchy plan + addendum for the migration steps.

_Last updated: 2025‑12‑06_
