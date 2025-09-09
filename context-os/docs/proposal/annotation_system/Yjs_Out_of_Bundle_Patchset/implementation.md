# Implementation Plan — Yjs Out of Bundle Patchset

Feature: `yjs_out_of_bundle_patchset`
Folder: `context-os/docs/proposal/annotation_system/Yjs_Out_of_Bundle_Patchset/`

Status: draft
Owner: <assign>
Created: 2025-09-09

## Summary
Make plain (Option A) the fail‑closed default and fully separate Yjs from plain‑mode bundles. We introduce a collab‑only editor that loads on demand in Yjs mode, lazy‑load the Y.Doc per panel, and replace direct provider imports with a UnifiedProvider abstraction. This enhances safety on fresh machines (no accidental Yjs), reduces initial bundle size in plain mode, and preserves collaboration features when explicitly enabled.

## Goals
- Fail‑closed: default to plain when env/localStorage is absent/invalid; lock at runtime.
- No Yjs in plain bundles: avoid static imports that include Yjs code paths.
- Collab on demand: dynamically load collab editor and Y.Doc only in Yjs mode.
- Maintain behavior parity in Yjs mode (cursors, persistence, editor features).

## Out of Scope
- Backend schema/API changes (none).
- Provider transport changes (e.g., switching y-websocket to another transport).
- Refactoring unrelated ESLint/TypeScript warnings elsewhere in the repo.

---

## Approach
1) Fail‑closed collab mode with guardrails
   - Add `lib/collab-mode.ts` to centralize mode detection and locking (query/env/localStorage precedence).
   - Update `lib/provider-switcher.ts` to refuse Yjs initialization in plain mode and warn on attempted loads.
   - Update the app provider to lock plain mode at runtime when selected.

2) De‑Yjs imports in components (import‑only swaps)
   - Replace direct `@/lib/yjs-provider` imports with `UnifiedProvider` in canvas/aux components.
   - Remove unused yjs-provider import in `tiptap-editor.tsx`.

3) Collab editor split + lazy Y.Doc
   - Add `components/canvas/tiptap-editor-collab.tsx` with all Yjs/TipTap‑collab imports.
   - In `components/canvas/canvas-panel.tsx`, load collab editor via `next/dynamic` (ssr: false) only in Yjs mode.
   - Lazy‑load Y.Doc using `lib/lazy-yjs.ts` (Option A: use the returned yjs-provider module, then call `getEditorYDoc`); manage a typed loading state and guard the render.
   - Collab editor requires a shared Y.Doc prop; it never creates its own Y.Doc.

4) Keep provider switch synchronous (Phase 1)
   - Do not code‑split providers yet to avoid timing races. A Phase 2 can add dynamic provider imports and a `UnifiedProvider.ready()` gate.

---

## Changes by File

1) lib/collab-mode.ts (new)
- Implements: `getCollabMode()`, `ensureFailClosed()`, `lockPlainMode()`, `warnIfYjsLoadAttempted()`.
- Precedence: `?mode=plain` → env → localStorage → default to `plain`.
- Use in both provider-switcher and the app provider.

2) lib/provider-switcher.ts
- Import collab-mode helpers; call `ensureFailClosed()` in constructor.
- If mode is `plain`, refuse initialization of Yjs providers and return a minimal stub for `getProvider()`.
- Defensive warnings if a Yjs path is reached while in plain mode.
- `getPlainProvider()`/`initializePlainProvider()` read mode via `getCollabMode()`.

3) app/providers/plain-mode-provider.tsx
- On mount: call `ensureFailClosed()`, read `getCollabMode()`, lock plain at runtime.
- Initialize the appropriate offline adapter (Electron or Web) only when mode is `plain`.

4) lib/lazy-yjs.ts (new)
- `loadYjsProvider()` returns the yjs-provider module via dynamic import.
- Guard: refuses to load in plain mode (console warning), returning `null`.

5) components/canvas/canvas-panel.tsx
- Replaces direct `@/lib/yjs-provider` calls with a typed lazy‑load via `lib/lazy-yjs`:
  - `const [ydocState, setYdocState] = useState<{ loading: boolean; doc: Y.Doc | null; error: Error | null }>()`.
  - In Yjs mode, `import('@/lib/lazy-yjs').then(({ loadYjsProvider }) => loadYjsProvider())` → `if (yjsProvider?.getEditorYDoc) set doc`.
  - Add cancellation flag to avoid state updates after unmount.
- Introduces `TiptapEditorCollab` via `next/dynamic(..., { ssr: false })`.
- Render guards:
  - Plain: `TiptapEditorPlain` (unchanged data flow).
  - Yjs + loading: show “Loading collaborative editor…”.
  - Yjs + doc: render `TiptapEditorCollab` and pass the shared `ydoc` and provider.
- Unifies editor handle type for refs (`UnifiedEditorHandle`).

6) components/canvas/tiptap-editor-collab.tsx (new)
- Collab‑only editor; imports TipTap collab extensions, binds to shared Y.Doc.
- Accepts optional `provider` for `CollaborationCursor` (cursors preserved in Yjs mode).
- Registers `AnnotationDecorations` and `PerformanceMonitor`.

7) Components switched to UnifiedProvider (import‑only)
- `components/debug-branches.tsx`
- `components/canvas/annotation-decorations.ts`
- `components/canvas/branch-item.tsx`
- `components/canvas/branches-section.tsx`
- `components/canvas/minimap.tsx`
- `components/canvas/connection-lines.tsx`
- `components/canvas/annotation-toolbar.tsx`

8) components/canvas/tiptap-editor.tsx
- Removed unused direct import of `@/lib/yjs-provider` to avoid accidental bundling.

---

## Risks and Mitigations
- Async timing (Y.Doc unavailable briefly):
  - Mitigation: typed `loading/doc/error` state with a loader guard; cancellation flag in effect.
- Provider availability (Phase 2 only):
  - Keep providers synchronous in Phase 1. If code-splitting providers later, add `UnifiedProvider.ready(): Promise<void>` and gate usage.
- Cursor/provider mismatch:
  - Provider is passed from `UnifiedProvider.getInstance().getProvider()` directly into `TiptapEditorCollab`. No new provider instance is created.
- Residual static imports:
  - Mitigation: audit components and swap remaining direct `@/lib/yjs-provider` imports to `UnifiedProvider`. One known: `annotation-toolbar.tsx` (now migrated).
- CSP/connect-src in production:
  - Ensure collab WS origin is permitted in `connect-src` when CSP is enforced.

---

## Validation
Manual (per mode):
- Plain mode (`NEXT_PUBLIC_COLLAB_MODE=plain`):
  - Launch app; verify no Yjs initialization warnings.
  - Create/edit annotations; open panels; hover tooltips; switch notes.
  - Confirm no Yjs chunks loaded (bundle analyzer or DevTools network filter for `yjs`, `y-websocket`, `y-indexeddb`).

- Yjs mode (`NEXT_PUBLIC_COLLAB_MODE=yjs`):
  - Launch app; verify collab editor loads on demand (dynamic chunk request).
  - Confirm Y.Doc created via lazy loader; editor content sync functions.
  - Collaboration cursors visible (if provider configured); no runtime warnings.

Automated sanity (optional):
- Grep for `@/lib/yjs-provider` in `components/` → no matches.
- CI step: build in plain mode and assert no Yjs chunk names appear in output (if bundle analyzer available).

---

## Acceptance Criteria
- Plain mode is fail‑closed by default; app locks plain at runtime; no Yjs init.
- Plain builds exclude Yjs libs from initial bundles; no static Yjs imports in plain paths.
- Yjs mode loads collab editor and Y.Doc dynamically; editing + cursors work.
- No regressions for annotation creation, selection, tooltip rendering, or panel flows.

---

## Deliverables
- New files:
  - `lib/collab-mode.ts`
  - `lib/lazy-yjs.ts`
  - `components/canvas/tiptap-editor-collab.tsx`
- Updated files:
  - `lib/provider-switcher.ts`
  - `app/providers/plain-mode-provider.tsx`
  - `components/canvas/canvas-panel.tsx`
  - Import‑only swaps in: `debug-branches.tsx`, `annotation-decorations.ts`, `branch-item.tsx`, `branches-section.tsx`, `minimap.tsx`, `connection-lines.tsx`, `annotation-toolbar.tsx`
  - `components/canvas/tiptap-editor.tsx` (removed unused import)
- Implementation report(s) under `reports/` (see structure below).

---

## Repository Location and Structure (Required)

Maintain the standard proposal structure:

- Feature folder: `docs/proposal/annotation_system/Yjs_Out_of_Bundle_Patchset/`
- Files:
  - `initial.md` (high‑level goals and constraints)
  - `implementation.md` (this file)
  - Subfolders:
    - `reports/` (Implementation Report, perf notes, verification logs)
    - `implementation-details/` (optional deep dives)
    - `post-implementation-fixes/` (index via `README.md`)

If any constraints prevent immediate canonical placement, record the deviation (below) and reconcile when unblocked.

---

## Deviation Logging Requirements
- Implementation Report (under `reports/`): include a “Deviations From Implementation Plan/Guide” section detailing any divergences from this plan and structure.
- `initial.md`: if canonical structure could not be followed, append an entry in `ATTEMPT HISTORY` and add an item in `ERRORS` with rationale and next steps.

---

## Rollback Plan
- Revert `components/canvas/canvas-panel.tsx` to direct collab editor import and remove lazy Y.Doc effect.
- Remove `components/canvas/tiptap-editor-collab.tsx`.
- Restore previous provider-switcher behavior if needed (guarded by mode).
- Remove `lib/collab-mode.ts` and `lib/lazy-yjs.ts` if abandoning fail‑closed and lazy paths.

---

## Timeline (suggested)
- Day 0.5: Fail‑closed guardrails + app provider lock; import-only swaps.
- Day 0.5: Collab editor split + typed lazy Y.Doc; loader guards; cursors preserved.
- Day 0.5: Validate both modes; measure bundle; draft Implementation Report.

