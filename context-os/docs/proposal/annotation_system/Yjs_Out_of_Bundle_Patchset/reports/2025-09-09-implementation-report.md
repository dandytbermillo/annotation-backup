# Implementation Report — Yjs Out of Bundle Patchset

Date: 2025-09-09
Owner: <assign>
Status: in-progress

## Overview
Phase 1 landed: fail‑closed plain mode, import‑only provider swaps, collab editor split, and lazy Y.Doc load.

## Changes Landed
- Added: `lib/collab-mode.ts`, `lib/lazy-yjs.ts`, `components/canvas/tiptap-editor-collab.tsx`.
- Updated: `lib/provider-switcher.ts`, `app/providers/plain-mode-provider.tsx`, `components/canvas/canvas-panel.tsx`.
- Import swaps to `UnifiedProvider`: `debug-branches.tsx`, `annotation-decorations.ts`, `branch-item.tsx`, `branches-section.tsx`, `minimap.tsx`, `connection-lines.tsx`, `annotation-toolbar.tsx`.
- Removed unused yjs-provider import in `tiptap-editor.tsx`.

## Validations
- Plain mode:
  - Yjs init refused with warning if attempted.
  - No static yjs-provider imports remain in panel flow; lazy loader not called.
- Yjs mode:
  - Collab editor chunk loads dynamically; `ydoc` provided via lazy loader.
  - Cursors wired via `provider.getProvider()`.

## Deviations From Implementation Plan/Guide
- Provider code-splitting deferred to Phase 2 to avoid readiness races.

## Next Steps
- Optional: Code-split providers with `UnifiedProvider.ready()` gate.
- Bundle checks: run analyzer in plain mode to confirm no Yjs chunk presence.

## Notes
- CSP: ensure `connect-src` includes the collab endpoint in production.

