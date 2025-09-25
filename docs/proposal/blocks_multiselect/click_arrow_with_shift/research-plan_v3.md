# Shift+Click Range Collapse – Follow-up Research Plan

## Context
Plain/offline mode (no Yjs) still fails to extend collapsible-block selection ranges. Shift+Click highlights only the newly clicked block, even after reverting previous experiments. We need a fresh diagnostic pass with precise instrumentation to pinpoint why the range state collapses immediately after each modifier gesture.

## Objectives
- Capture the full transaction + plugin state sequence for every Shift+Click and Shift/Cmd interaction.
- Determine whether the NodeView, the plugin, or some other extension is resetting the selection to `mode: 'single'` after the range command.
- Verify event propagation ordering between NodeView capture handlers and the plugin’s DOM handlers without altering production behavior.
- Produce a concrete root cause and remediation strategy that avoids the prior ping-pong between NodeView and plugin.

## Key Questions
1. Does `pluginKey.getState` momentarily enter `mode: 'range'` before another transaction overwrites it, or is the range never recorded?  
   – Inspect `STATE_APPLY` logs in `collapsible-block-selection.ts` and confirm anchor/head values.
2. Which command or transaction reverts the state?  
   – Is a `selectCollapsibleBlock` or `toggleCollapsibleBlockSelection` firing after `setCollapsibleBlockRange`?  
   – Does the history plugin or another keyboard fix dispatch a follow-up transaction?
3. Are modifier clicks still bubbling to the plugin despite NodeView guards?  
   – Track capture/bubble phases via `eventPhase` & custom markers (e.g., `_collapsibleHandled`).
4. Does focus change (title input, document body) trigger `setSelection` with a text selection, wiping the plugin state?
5. Is there any debounced hover/tooltip logic that triggers `clearCollapsibleBlockSelection` as a side effect (e.g., pointerleave, blur)?

## Investigation Steps
1. **Baseline Recording**  
   - Hard refresh, ensure plain mode banner (`NEXT_PUBLIC_COLLAB_MODE=plain`).  
   - Insert 3 collapsible blocks, run: select block A, Shift+Click block B, Shift+Click block C, Shift+ArrowDown, Cmd+Click toggles.  
   - Capture screen recording + console logs.

2. **Plugin Snapshot Instrumentation**  
   - Temporarily patch `collapsible-block-selection.ts` to emit `console.table` or `debugLog` entries of `toSnapshot(state)` inside `apply` whenever `meta?.type` is `'set'` or `'clear'`.  
   - Include `tr.getMeta('addToHistory')`, `tr.steps.length`, and `state.selection.constructor.name`.

3. **NodeView Event Trace**  
   - Add guarded logging in `handleHeaderMouseDownCapture`/`handleHeaderClickCapture` and the arrow handler to print: `eventPhase`, `event.defaultPrevented`, event reuse ID, and whether `_collapsibleHandled` has been set.  
   - Ensure these logs are toggled via `NEXT_PUBLIC_DEBUG_COLLAPSIBLE_SELECTION`.

4. **Transaction Chain Inspection**  
   - Within the plugin commands (`setCollapsibleBlockRange`, `toggleCollapsibleBlockSelection`, `selectCollapsibleBlock`), log stack traces (using `console.trace` gated by the debug flag) to see who invokes them.  
   - Pay special attention to calls triggered from NodeView vs plugin vs other extensions.

5. **Focus & Blur Monitoring**  
   - In `tiptap-editor-plain.tsx`, temporarily hook `editor.on('focus'/'blur')` to log focus targets and selection state to verify no blur clears the selection mid-gesture.

6. **Cross-Browser Comparison**  
   - Repeat steps 1–5 on Chrome, Safari, Firefox. Note timing differences (Safari often reorders focus).  
   - Capture timestamps to correlate transactions with DOM events.

7. **Regression Bisect (Optional)**  
   - If logs implicate a specific change, perform a local git bisect within `collapsible-block.tsx`/`collapsible-block-selection.ts` to find the commit where range extension last worked, confirming behavioral delta.

## Affected Files / Modules
- `lib/extensions/collapsible-block.tsx` (NodeView event handling)  
- `lib/extensions/collapsible-block-selection.ts` (range/toggle commands, plugin state)  
- `components/canvas/tiptap-editor-plain.tsx` (editor focus + extension stack)  
- `lib/debug-logger.ts`, `/app/api/debug/log/route.ts` (telemetry storage)  
- Potential observers: `components/canvas/annotation-arrow-navigation-fix.ts`, history/keyboard extensions under `lib/extensions`.

## Deliverables
- Annotated event/transaction timeline showing each command and resulting plugin snapshot.  
- Identification of the exact call that collapses the range, with evidence.  
- Patch proposal (or clear remediation options) that resolves the double-selection without regressing plain-mode editing.  
- Updated `research_result_v3.md` summarizing findings and recommended fix path.

## Constraints & Safeguards
- Must run entirely in offline plain mode – no Yjs dependencies.  
- Instrumentation should be gated behind `NEXT_PUBLIC_DEBUG_COLLAPSIBLE_SELECTION` and removed after diagnosis.  
- Do not alter provider contracts or introduce UI gating that hides the bug; focus on root cause.  
- Ensure telemetry writes respect existing debug-log API requirements (workspace context, no secrets).
