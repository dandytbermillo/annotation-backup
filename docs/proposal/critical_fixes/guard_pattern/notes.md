# Collapsible Block Delete Guard (Critical Fix)

## Context
- **Feature area**: TipTap collapsible blocks in the branch editor.
- **Mode**: Option A (plain, offline) per `claude.md`.
- **Symptom**: Pressing Delete/Backspace while the caret sat in the empty spacer paragraph at the end of the block stack immediately removed the preceding collapsible block(s) and occasionally collapsed the entire stack.
- **Error surfaced**: `Cannot destructure property 'selection' of 'state' as it is undefined` when the editor keymap delivered a payload without the expected `state` object.

## Root Cause
- The `insertCollapsibleBlock` command inserts a trailing empty paragraph and moves the selection there so users can keep typing. When that caret is at offset 0 of an empty paragraph, ProseMirror’s default `deleteBarrier`/`joinBackward` logic collapses the boundary with the previous isolating node, effectively replacing the block with the spacer. Because no guard was in place, a single Delete removed the block stack.
- The first guard attempt relied on destructuring `{ state }` and `{ selection }` directly from the handler arguments. TipTap sometimes invokes keyboard shortcuts with `{ editor }` but no `state`, producing the runtime error.

## Fix
1. **Keyboard Guard** (`lib/extensions/collapsible-block.tsx:877`)
   - Added `addKeyboardShortcuts()` to the collapsible block extension.
   - Guard checks that:
     - The handler received an `editor` with both `state` and `view`.
     - Selection is empty and inside an empty paragraph whose parent offset is 0.
     - The paragraph’s previous sibling is a `collapsibleBlock` node.
   - When all conditions are true, the guard re-applies the selection inside the spacer, flags the transaction `addToHistory: false`, scrolls into view, and refocuses the editor. Returning `true` cancels ProseMirror’s destructive delete path while keeping the caret visible.
2. **Safety**
   - If any prerequisite is missing (non-empty paragraph, no preceding block, handler invoked without `editor`), the guard returns `false` and the default keymap executes as usual.

## Affected Files
- `lib/extensions/collapsible-block.tsx`
  - Added `addKeyboardShortcuts` guard logic immediately before `addCommands`.

## Verification
- Manual: Insert multiple collapsible blocks, place the caret in the empty spacer below them, and press Delete/Backspace. The caret should remain in the spacer and blocks stay intact. Additional Deletes should no longer cascade through the stack.
- Future regression coverage recommendation: Add an integration test that simulates the keypress at a spacer paragraph to ensure the guard path returns `true` and preserves the block node.

## Notes
- Implementation aligns with `isolation-reactivity-anti-patterns.md`: changes are constrained to the extension itself, with no provider contract changes or cross-context hooks.

## Spacer Removal Enhancement (Follow-up)
- Added an inline “Delete spacer” action that appears whenever the caret is in an empty paragraph sandwiched between two collapsible blocks.
- Implemented as a ProseMirror plugin via `addProseMirrorPlugins()` (see `lib/extensions/collapsible-block.tsx:721`) to render a lightweight floating button; clicking it deletes the spacer paragraph and repositions the caret safely without touching the blocks themselves.
- Keeps the guard behavior intact while giving users an explicit, low-risk way to clear accidental blank lines between blocks.
