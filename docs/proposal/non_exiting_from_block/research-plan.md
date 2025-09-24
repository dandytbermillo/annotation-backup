# Research Plan: Enter Key Does Not Exit Collapsible Block

## Problem Summary
After setting `isolating: true` on the collapsible block node to prevent block merges, pressing Enter at the end of a block no longer exits the block. Instead, the editor inserts another blank line within the block. We need to understand how `isolating` interacts with ProseMirror’s default key handling and determine the safest way to restore “exit on Enter” while keeping block merges disabled.

## Key Questions
1. How does `isolating: true` affect ProseMirror’s join/split logic for block nodes, especially in combination with the block’s internal list template? Does it alter the default keymap behavior for Enter? (Files: `lib/extensions/collapsible-block.tsx`)
2. When Enter is pressed in the last paragraph of the block, where does the selection sit? Does ProseMirror still see an empty paragraph, or is it moving the caret to the block boundary? (Instrumented via `components/canvas/tiptap-editor-plain.tsx` if needed.)
3. What built-in commands (e.g., `Command`, `splitBlock`, `exitCode`, `createParagraphNear`) could we reuse to exit the block cleanly? Are there existing ProseMirror patterns for exit behavior in isolating nodes?
4. Can we create a single-transaction Enter handler that removes an empty trailing paragraph, inserts an external paragraph, and sets the selection without breaking undo/redo semantics? (Primary file: `lib/extensions/collapsible-block.tsx`)
5. How does collaborative (Yjs) mode respond to the isolating flag plus any custom key handling? Do we produce consistent updates and selections?

## Investigation Tasks
1. **Selection/Transaction Logging**
   - Temporarily instrument Enter key events to capture `$from`, `$to`, node types, and transaction shapes when the block is isolating vs not isolating.
   - Inspect doc JSON (before and after) to confirm where paragraphs reside.

2. **Reference Behavior**
   - Review ProseMirror discussions on isolating nodes and keymaps (e.g., `exitCode`, `liftListItem`).
   - Examine how code block or toggle block extensions manage exit behavior with isolating semantics.

3. **Command Prototyping**
   - Prototype multiple approaches: customized `addKeyboardShortcuts`, reuse of ProseMirror commands, or auto-insertion of trailing paragraphs.
   - Ensure prototypes run in one transaction to keep undo atomic.

4. **Mode Parity**
   - Verify anything we test in plain mode behaves identically in collab mode.

5. **UX Validation**
   - Confirm the chosen approach lets users exit with a single Enter while still preventing block merges, and doesn’t produce double blank lines or extra undo steps.

## Affected Files
- `lib/extensions/collapsible-block.tsx`: node spec (`isolating: true`), insertion logic, potential Enter handler.
- `components/canvas/tiptap-editor-plain.tsx`: command wiring and potential instrumentation for state/selection logging.
- (Optionally) `components/canvas/editor-toolbar.tsx` / `format-toolbar.tsx`: locations where the block insert is triggered, if behavior differs.

## Deliverables
- Detailed findings on ProseMirror’s handling of isolating blocks and Enter key.
- Recommended solution (with prototype notes) that preserves `isolating: true` while enabling Enter-to-exit.
- Risk assessment for collaborative mode and undo/redo.

