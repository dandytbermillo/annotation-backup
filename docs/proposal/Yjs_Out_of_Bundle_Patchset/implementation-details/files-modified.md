# Files Modified — Yjs Out of Bundle Patchset

This list summarizes source changes for this feature. Keep synchronized with actual PRs/commits.

Core runtime and provider changes
- lib/collab-mode.ts (new)
- lib/provider-switcher.ts (updated for fail‑closed guardrails)
- app/providers/plain-mode-provider.tsx (plain-mode lock + mode read)
- lib/lazy-yjs.ts (new; guarded dynamic imports)

Canvas/editor changes
- components/canvas/canvas-panel.tsx (lazy Y.Doc + dynamic collab editor)
- components/canvas/tiptap-editor-collab.tsx (new; collab-only)
- components/canvas/tiptap-editor.tsx (removed unused yjs-provider import)

UnifiedProvider import-only swaps
- components/debug-branches.tsx
- components/canvas/annotation-decorations.ts
- components/canvas/branch-item.tsx
- components/canvas/branches-section.tsx
- components/canvas/minimap.tsx
- components/canvas/connection-lines.tsx
- components/canvas/annotation-toolbar.tsx

Docs
- docs/proposal/Yjs_Out_of_Bundle_Patchset/* (initial.md, implementation.md, reports/, implementation-details/, post-implementation-fixes/)

