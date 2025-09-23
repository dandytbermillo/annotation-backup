# Fix: Ensure Trailing Paragraph After Collapsible Block Insert

## Summary
When users inserted the “Block Based” (collapsible) section in plain mode, no paragraph was created after the block. The cursor remained inside the block (often within its list template), or worse, focus jumped back to the paragraph above once the block was collapsed. Users then had to press Enter multiple times to continue writing. Undo also behaved poorly, requiring two steps to remove the block and the manually added paragraph.

## Root Cause
`lib/extensions/collapsible-block.tsx` defined `insertCollapsibleBlock` as a thin wrapper around `commands.insertContent`. The transaction ended with the cursor inside the new block, and no follow-up paragraph was added. When inserted at the end of the document, the selection actually stayed outside the block, so any logic that relied on finding the block via selection ancestors failed. Because the block insertion and manual paragraph insertion were separate transactions, undo yielded two steps. Net effect: no guaranteed trailing paragraph and awkward focus/undo behavior.

## Fix
Reimplemented `insertCollapsibleBlock` to run the entire insert in one ProseMirror transaction:
1. Build the collapsible block and an empty paragraph via the active schema.
2. Replace the selection with the block and compute the proper insertion point using the transaction’s mapping.
3. Insert the blank paragraph only if a paragraph doesn’t already follow the block.
4. Clamp positions (`Math.min`, mapping with bias) to avoid out-of-range errors and set the selection to the first text node inside the block (falling back to the trailing paragraph when needed).
5. Dispatch the single transaction (`dispatch(tr.scrollIntoView())`).

This approach keeps undo atomic and ensures a blank paragraph immediately follows the block in every scenario.

## Affected Files
- `lib/extensions/collapsible-block.tsx` — rewrote `addCommands().insertCollapsibleBlock` to handle block + paragraph insertion and selection in one transaction.
- `components/canvas/tiptap-editor-plain.tsx` — (earlier instrumentation) confirmed the command path invoked; no persistent changes beyond logging.

## Verification Steps
1. Insert a Block Based section at the end of a note and in the middle of a paragraph.
2. Collapse the block and press Enter: the caret lands in the blank paragraph added by the command.
3. Undo once: both the block and paragraph disappear together.
4. Confirm no “mismatched transaction” errors appear in the console.

