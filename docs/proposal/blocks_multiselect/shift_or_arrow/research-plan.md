# Plain Mode: Multi-Block Range Expansion Fails

## Background
Plain mode(without yjs) now highlights a single collapsible block when Shift+Click is used, yet the expected range never expands. Holding Shift while pressing Arrow Up/Down or clicking additional blocks moves focus but does not grow the highlight (NodeSelection range). Repeated fixes to event propagation and command invocation have not restored the intended behavior, suggesting deeper issues in the selection plugin state or its anchor/head logic.

## Objectives
- Capture precise block-selection state transitions (anchor, head, mode, blocks) during Shift+Click and Shift+Arrow interactions in plain mode.
- Determine whether the node view or plugin ultimately clears or remaps the anchor/head after the first Shift gesture.
- Identify why `setCollapsibleBlockRange` / `extendCollapsibleBlockSelection` collapse to a single highlighted block instead of preserving ranges.

## Key Questions
1. When Shift+Click fires, does the plugin’s `CMD_SET_RANGE` log show multiple positions, or is the range immediately reduced to a single block?
2. Does the plugin state (`storage.snapshot`) reset to mode `single` after each transaction? If so, which transaction clears it (e.g., plain-click handler, NodeView follow-up, selection remap)?
3. Are the node-view-invoked commands (`setCollapsibleBlockRange`) using the same document position offsets as the plugin’s `findCollapsibleBlockPos`? (e.g., `nodePos` vs. `resolved.pos` differences)
4. Are keyboard commands (`Shift-ArrowUp/Down`) routed before the node view re-selects text or DOM focus moves to inputs, causing the plugin to see a text selection instead of the NodeSelection?
5. Does the plugin’s `handleDOMEvents.mousedown` return `true` to consume the event, and does the NodeView also prevent default, leading to duplicate or conflicting transactions?

## Investigation Steps
1. **Enable Debug Instrumentation**
   - Set `NEXT_PUBLIC_DEBUG_COLLAPSIBLE_SELECTION=true` before running `npm run dev`.
   - Confirm console logs (from `logCollapsibleSelectionDebug` & `logSelectionDebug`) appear for `CMD_SET_RANGE`, `CMD_EXTEND_RANGE`, and `STATE_APPLY` events.
   - Inspect `/api/debug-log` output for each step via browser network panel or database debug viewer.

2. **Baseline Reproduction + Logging**
   - Insert 3+ collapsible blocks.
   - Interact: plain click -> Shift+Click block A -> Shift+ArrowDown -> Shift+Click block C.
   - Capture log entries for each action: note anchor/head values, selection mode, and block arrays.

3. **Transaction Audit**
   - For each Shift action, confirm whether multiple transactions fire: NodeView command (range), plugin mousedown handler, and plain-click handler. Verify if any `STATE_APPLY` log shows meta `clear` immediately after `set`.
   - Check whether the plugin’s `handleClick` fires after the NodeView command (should be suppressed). If it still runs, it may reset to single selection.

4. **Keyboard Path Trace**
   - Press Shift+ArrowDown/Up while logs are enabled; ensure `CMD_EXTEND_RANGE` appears. If not, verify the keymap’s precedence (maybe another plugin consumes arrow keys).
   - Compare selection state before/after the keyboard command. If it remains `single`, capture `STATE_APPLY` logs to identify which meta triggered the reset.

5. **Node Position Consistency**
   - Compare `nodePos` used in NodeView (getPos) to `resolved.pos` from the plugin logs. Ensure both refer to the block’s start; differences (e.g. nodePos+1) may cause mismatched anchors.

6. **Isolation Checks**
   - Temporarily disable inline title editing (comment out `shouldEditTitleOnClickRef` logic) to see if focus changes clear the selection.
   - Repeat tests after removing NodeView command dispatch (letting plugin handle everything) to isolate whether the double command path is at fault.

7. **Anchor Persistence**
   - Manually set `editor.storage.collapsibleBlockSelection.snapshot` via devtools to confirm the plugin updates anchor/head correctly; monitor logs for divergence when performing user gestures.

## Affected Files / Modules
- `lib/extensions/collapsible-block.tsx` (NodeView event capture, selection command triggers, debug logs)
- `lib/extensions/collapsible-block-selection.ts` (commands, state apply logic, debug logs)
- `components/canvas/tiptap-editor-plain.tsx` (editor setup, extension order, keyboard shortcuts)
- Potentially `components/canvas/canvas-panel.tsx` or other wrappers that may refocus the editor

## Deliverables
- Sequence log (with timestamps) showing the selection state after each Shift interaction.
- Analysis identifying the transaction or handler that collapses the range.
- Recommendations to ensure the plugin retains anchor/head across sequential Shift actions (potential fixes may include deferring NodeView title-edit focus or preventing subsequent plain-click handlers).

## Notes
- Keep instrumentation behind `NEXT_PUBLIC_DEBUG_COLLAPSIBLE_SELECTION` so production builds remain unaffected.
- Record browser, OS, and modifier keys for each test run to rule out platform-specific quirks.
- If logs show the range is correct in commands but incorrect after `STATE_APPLY`, focus on the apply step or subsequent transactions; otherwise, revisit command arguments.
