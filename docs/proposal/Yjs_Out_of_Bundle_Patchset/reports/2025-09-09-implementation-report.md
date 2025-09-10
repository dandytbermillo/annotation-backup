**Main Implementation Report for**: [implementation.md](../implementation.md)

# Yjs Out of Bundle Patchset — Implementation Report

Status: 🚧 IN PROGRESS
Owner: <assign>
Date: 2025-09-09

## Executive Summary
Option A is now fail‑closed by default and collaboration code is loaded on demand. Plain mode ships without Yjs in initial bundles; Yjs mode dynamically loads the collab editor and Y.Doc. Provider switching remains synchronous to avoid timing risks in Phase 1.

---

## Scope of Implementation
- Fail‑closed mode helpers & guardrails
- UnifiedProvider import swaps in canvas/aux components
- Collab‑only editor (dynamic) and lazy Y.Doc per panel
- Provider switching kept synchronous (Phase 2 optional)

## Key Metrics
- Plain-mode initial JS: expected reduction (no Yjs/TipTap collab)
- Collab chunk: loads on demand in Yjs mode
- Functional parity: cursors/persistence intact in Yjs mode

## Code Changes (counts + links)
- New files: `lib/collab-mode.ts`, `lib/lazy-yjs.ts`, `components/canvas/tiptap-editor-collab.tsx`
- Updated: `lib/provider-switcher.ts`, `app/providers/plain-mode-provider.tsx`, `components/canvas/canvas-panel.tsx`
- Import-only swaps (7 files): `debug-branches.tsx`, `annotation-decorations.ts`, `branch-item.tsx`, `branches-section.tsx`, `minimap.tsx`, `connection-lines.tsx`, `annotation-toolbar.tsx`
- Removed unused import: `components/canvas/tiptap-editor.tsx`

---

## Acceptance Criteria (Checklist)
- [ ] Plain: fail‑closed default; no Yjs init; no Yjs in initial bundles
- [ ] Yjs: collab editor + Y.Doc load dynamically; cursors/persistence OK
- [ ] No regressions in annotation flows

---

## Post-Implementation Fixes
[→ View all fixes and statistics](../post-implementation-fixes/README.md)

