# Shift+Click Range Regression Research Plan (Plain Mode)

## Background
After reverting the previous NodeView changes, plain-mode editors again highlight only the most recent collapsible block when the user holds Shift and clicks another block header. The expected behavior is a growing range highlight, but the selection snaps to the newly clicked block instead. Keyboard range extension through `Shift+Arrow` also fails once the range collapses.

## Goals
- Reproduce the regression reliably in plain mode and capture the plugin state before and after each Shift interaction.
- Determine why `CollapsibleBlockSelection` falls back to a single-block snapshot instead of maintaining the prior anchor.
- Isolate whether the NodeView, the selection plugin, or focus/transaction ordering clears the range metadata.
- Provide an evidence-backed root cause summary that can guide a safe fix.

## Affected Files / Modules
- `lib/extensions/collapsible-block-selection.ts`
- `lib/extensions/collapsible-block.tsx`
- `components/canvas/tiptap-editor-plain.tsx`
- `lib/providers/plain-offline-provider.ts` (for focus/save side effects)
- Debug logging helpers: `lib/debug-logger.ts`, `/app/api/debug/log/route.ts`

## Key Questions
1. Does `pluginKey.getState` ever stay in `mode: 'range'`, or does another transaction immediately replace it with `mode: 'single'` after each Shift click?
2. Which transaction or meta update clears the stored `anchor`—plugin command, NodeView side effect, or an external plugin (history, navigation fixes)?
3. Does the NodeView still dispatch `selectCollapsibleBlock` on plain clicks, overriding the range set by the plugin?
4. Are focus changes (title input, other widgets) causing `setSelection` calls that drop the NodeSelection and collapse the range?
5. Do the debug-log entries from `CollapsibleBlockSelection` show `set_range` followed by another command (e.g., `toggle_selection`) for the same block immediately afterward?

## Investigation Steps
1. **Reproduction Script**: Hard-refresh, ensure plain mode banner is present, insert three collapsible blocks, Shift+Click block A, then Shift+Click block C. Capture screenshots and copy the console logs.
2. **Debug Logging Review**: Query `/api/debug/log` (or the Postgres table) for `component='CollapsibleBlockSelection'` to inspect the sequence of `set_range`, `toggle_selection`, `extend_range`, or `toggle_cleared` events around each interaction.
3. **Plugin State Snapshot**: Temporarily expose `window.__TIPTAP__?.collapsibleSelection` by instrumenting `collapsible-block-selection.ts` (guarded by `NEXT_PUBLIC_DEBUG_COLLAPSIBLE_SELECTION`) to log the snapshot on every transaction.
4. **Trace NodeView Events**: Add console or debug-log hooks in `collapsible-block.tsx` capture handlers to confirm whether they still call `selectCollapsibleBlock` after the plugin executes `setCollapsibleBlockRange`.
5. **Transaction History**: Use `state.tr.steps` inspection inside a debugging build to see if a second transaction fires after the range command, replacing the NodeSelection.
6. **Keyboard Path**: While the range is active, press `Shift+ArrowDown` and confirm whether the plugin logs `extend_range`; if not, identify which handler intercepts the key before the plugin executes.
7. **Cross-Mode Comparison**: Repeat the same gestures in collaborative mode (Yjs) to determine whether the issue is unique to plain mode’s extension stack.

## Deliverables
- Timeline of plugin state snapshots (anchor/head/mode) for each interaction.
- Annotated transaction log showing which command resets the selection.
- Updated research_result document summarizing findings and pointing to any offending handlers.
- Recommendation list outlining code paths to adjust while staying within isolation reactivity guidance.

## Isolation Reactivity Compliance
Follow the anti-pattern guidance (no provider shape changes, no simultaneous UI+provider hook swaps). Instrumentation should be feature-flagged and removed after diagnosis. Any proposed fix must preserve backward-compatible provider contracts and keep gating inside the plugin rather than the UI.
