# Codex Workspace (Advisory)

Purpose
- This folder contains advisory documentation, patch previews, scripts, and session notes for the Codex CLI workflow. Per codex/POLICY.md, changes here are safe; changes outside codex are proposed as .patch files for you to apply.

Quick Links
- Policy: `codex/POLICY.md`
- Patches (advisory diffs): `codex/patches/`
- Previous sessions: `codex/previous-sessions/`
- Scripts: `codex/scripts/`

How to Use Patches
- Review: open files in `codex/patches/`.
- Apply: from repo root, run `git apply codex/patches/<file.patch>`.
- Revert: `git apply -R codex/patches/<file.patch>`.

Project TL;DR (Option A: Plain Mode)
- Prereqs: Node 18+, PostgreSQL 14+ (or Docker)
- Configure: copy `.env.example` → `.env.local`; set `NEXT_PUBLIC_COLLAB_MODE=plain`
- Database: `docker compose up -d postgres` or create DB `annotation_dev`
- Migrations: `npm run db:migrate`
- Run: `npm run dev` → open http://localhost:3000
- Switch modes: change `NEXT_PUBLIC_COLLAB_MODE` and restart the dev server

Quick Scripts
- Bench API timings: `bash codex/scripts/bench-api.sh` (outputs to `codex/benchout/`)
- E2E (if configured): `npx playwright test`

Documentation
- Process guide (v1.4 Active Rules): `docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md`
- Feature docs/proposals: `docs/proposal/`
- Item 2 (Single Source of Truth) merged proposal: see `codex/patches/2025-09-02-item2-merged-proposal.patch`
- Minimal guide fix (Active vs Deprecated): `codex/patches/2025-09-02-doc-guide-lite-active-deprecated.patch`

Conventions (v1.4)
- Main implementation reports are navigation dashboards (links-only)
- Fixes live under `post-implementation-fixes/<severity>/` with a README index
- Inline content (logs/commands/diffs) goes into `implementation-details/artifacts/` or fix-specific artifacts

