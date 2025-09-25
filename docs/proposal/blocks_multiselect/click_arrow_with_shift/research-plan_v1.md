# Plain-Mode Block Range Expansion Research Plan

## Background
Plain mode now highlights a single collapsible block when the user Shift+Clicks its header, but the expected range expansion never occurs. Holding Shift while pressing Arrow Up/Down or Shift+Clicking additional blocks moves the selection focus instead of extending the highlighted set. Keyboard-driven multi-select and mouse-based range selection remain unreliable, creating friction for annotation workflows that require grouping neighboring blocks.

## Objectives
- Reproduce the inconsistent range behaviour in plain mode and capture the editor state before/after Shift interactions.
- Determine whether `CollapsibleBlockSelection` records anchor/head positions when Shift gestures start and whether those values persist across subsequent events.
- Identify why the extend commands (`setCollapsibleBlockRange`, `extendCollapsibleBlockSelection`) fail to accumulate multiple blocks despite modifier input.

## Key Questions
1. Does the plugin’s state (`pluginKey.getState`) ever transition to `mode: 'range'` after Shift+Click, or does it stay in `single`?
2. Are the anchor/head positions remapped or cleared by another transaction (e.g., cursor movement, DOM focus changes) immediately after selection?
3. Do the header capture handlers dispatch commands with positions that match ProseMirror’s expectations, or are offsets drifting (e.g., using NodeView getPos vs `posAtCoords`)?
4. Are keyboard shortcuts (`Shift-ArrowUp/Down`) intercepted by another extension (annotation navigation fixes, default keymaps) before the collapsible selection plugin sees them?
5. Is the editor losing focus to the title input or another NodeView element between events, resetting the active selection state?

## Investigation Steps
1. **Baseline Reproduction**
   - Start `npm run dev`, ensure plain mode banner is visible.
   - Insert three collapsible blocks; Shift+Click block A, then Shift+ArrowDown and Shift+Click block C. Record what highlights.
   - Inspect `window.__TIPTAP__?.collapsibleSelection` (add temporary logging) to confirm plugin mode/anchor/head after each interaction.

2. **Plugin State Instrumentation**
   - Add debug logging inside `CollapsibleBlockSelection` commands (`setCollapsibleBlockRange`, `extendCollapsibleBlockSelection`) to dump anchor/head/blocks.
   - Verify `collectRangeBetween` output and whether transactions are dispatched with the expected positions.
   - Check if another transaction immediately follows, clearing plugin meta via `tr.setMeta(pluginKey, { type: 'clear' })`.

3. **Keyboard Event Flow**
   - Use DevTools event listener breakpoints on `keydown` for Shift+Arrow to confirm handlers fire.
   - Trace through plugins added after `CollapsibleBlockSelection` to see if any `handleKeyDown` returns true.
   - Ensure the editor retains focus (no title input active) when issuing Shift+Arrow.

4. **Mouse Range Logic**
   - Compare `targetPos` derived from `posAtCoords` vs. `getPos()`; confirm both map to the same block start via `findCollapsibleBlockPos`.
   - Ensure Shift+Click on a different block triggers the plugin’s `mousedown` handler (no `stopPropagation` in NodeView) and produces a `NodeSelection` for the new head.

5. **Cross-Mode Comparison**
   - If possible, repeat in collaborative mode to identify differences in extension stacks or focus management.

6. **Regression / Hot Reload Checks**
   - Hard refresh after each change; confirm behaviour persists across sessions and isn’t affected by cached plugin state.

## Hypotheses
- The anchor is never set because the plugin sees an empty selection when the NodeView steals focus, so `extendCollapsibleBlockSelection` defaults to a single block.
- Range collection fails due to mismatched positions (NodeView-derived pos vs. document offset), resulting in `collectRangeBetween` returning just the head block.
- Another plugin (annotation navigation fixes) captures Shift+Arrow, preventing the collapsible selection command from running, so range size never updates.

## Affected Files / Modules
- `lib/extensions/collapsible-block-selection.ts`
- `lib/extensions/collapsible-block.tsx`
- `components/canvas/tiptap-editor-plain.tsx`
- `lib/extensions/annotation-arrow-navigation-fix.ts` (if present)
- Related keyboard/selection utilities under `lib/extensions`

## Deliverables
- Reproduction log (steps + screenshots or console traces) showing failure to extend selection.
- Command/transaction trace illustrating how anchor/head/blocks change (or fail to change) during Shift interactions.
- Root cause summary with recommended fixes (e.g., event ordering, anchor preservation, keymap priority).

## Notes
- Keep instrumentation temporary; gate logs behind a debug flag (`process.env.NEXT_PUBLIC_DEBUG_COLLAPSIBLE_SELECTION`).
- Verify behaviour in Firefox and Safari to rule out browser-specific event ordering.
- Ensure plain-mode editor is the active focus target during all modifier tests.
