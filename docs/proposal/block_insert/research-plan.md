# Block Insertion Behavior Research Plan

## Problem Statement
In the plain-mode editor, inserting a "Block Based" (collapsible) section does not guarantee a trailing paragraph immediately after the block. When users collapse the block or attempt to continue writing, focus jumps back to the preceding paragraph, forcing multiple Enter presses to create space. This interrupts flow and risks accidental edits above the block.

## Goals
- Understand the exact document structure and selection state immediately after block insertion in both plain and collab modes.
- Identify how TipTap/ProseMirror resolves selection and transaction mappings when commands chain (`insertContent` followed by custom `command`).
- Explore reliable patterns in other TipTap implementations for inserting trailing nodes.
- Determine guard conditions (e.g., block at doc end, pre-existing sibling cases) without breaking undo/redo semantics.

## Key Questions
1. After `insertCollapsibleBlock`, where is the selection anchored? Does it stay inside the new block or at the parent depth?
2. Does TipTap run transaction mapping the way we expect (`$from.after(collapsibleDepth)`) when multiple blocks exist or when selection starts mid-paragraph?
3. How do other TipTap extensions (e.g., callouts, toggle lists) ensure trailing paragraphs or handle Enter-to-exit behavior? Can we reuse `splitBlock`/`exitCode` patterns?
4. Are there mode differences (plain vs Yjs) in the insertion pipeline that explain the inconsistent behavior?
5. What are the undo/redo implications of auto-inserting trailing paragraphs? Does it introduce extra steps we should coalesce?

## Investigation Tasks
1. **Instrumentation**
   - Add temporary debug logs for `insertCollapsibleBlock` capturing depths, positions, and doc slices before/after insertion.
   - Export doc JSON after insertion to see the exact structure (including parent nodes).

2. **Selection Tracking**
   - Record `selection.$from` and `$to` depth/type before and immediately after the command.
   - Verify whether TipTap focuses inside the inserted block or returns to parent paragraph.

3. **Compare With Reference Implementations**
   - Review TipTap’s built-in toggle/callout node implementations.
   - Examine Notion-style community extensions to understand how they handle trailing content and Enter key behavior.

4. **Undo/Redo Audit**
   - Confirm how inserting a trailing paragraph affects history steps.
   - Evaluate whether to wrap commands in a single transaction or use `editor.commands.command({ ... })` with `tr.setMeta('addToHistory', false)`.

5. **Plain vs Collab Modes**
   - Test scenario in both plain and Yjs modes to ensure consistent behavior.
   - Note any provider-triggered re-renders that might override our inserted paragraph.

6. **User Experience Validation**
   - Prototype alternatives: automatic trailing paragraph vs. Enter handler vs. template injection.
   - Gather feedback (internal or user) on the least disruptive approach.

## Deliverables
- Debug log summaries with selection/doc snapshots for key scenarios.
- Comparison notes from other TipTap block implementations.
- Recommendation doc outlining the minimal change that ensures a trailing paragraph without breaking existing flows.
- Optional prototype patch (behind feature flag) if the research points to a clear fix.

## Files to Inspect
- `components/canvas/tiptap-editor-plain.tsx` (command wiring + debug instrumentation)
- `lib/extensions/collapsible-block.tsx` (block schema, commands, node view)
- `components/canvas/editor-toolbar.tsx` and `components/canvas/format-toolbar.tsx` (UI triggers)
- `lib/provider-switcher` and related plain-mode providers (to confirm post-insert persistence)
- Debug API route: `app/api/debug/log/route.ts` (to verify instrumentation expectations)

## Timeline & Owners
- Instrumentation & data gathering: 1–2 sessions.
- External references review: 1 session.
- Synthesis & proposal: 1 session.
