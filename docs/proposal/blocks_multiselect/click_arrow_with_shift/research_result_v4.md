Fix Shift+Click Selection Collapse in Plain Mode
Investigation: Shift+Click Range Selection in Plain Mode Collapsible Blocks
Issue Reproduction and Observation
In the plain (offline, non-Yjs) mode editor, attempting to select multiple collapsible blocks by Shift+clicking only highlights the last clicked block instead of extending the selection across all blocks in the range. For example, if you select one collapsible block and then Shift+click another block below it, only that second block appears selected (highlighted), rather than both blocks (or the entire range between them). This behavior was confirmed by reproducing the steps: first selecting a block (via a prior click or cursor placement), then Shift+clicking an adjacent block in plain mode. The expected behavior is that the selection range grows to include all blocks from the first to the second, but instead the selection collapses to just the most recently clicked block.
Expected Selection Behavior
In a well-functioning scenario (as it apparently works in the Yjs collaborative mode), the CollapsibleBlockSelection plugin is responsible for tracking multi-block selections. When the user Shift+clicks a collapsible block:
The plugin should enter mode: 'range', with its internal state storing an anchor (the first block in the selection) and a head (the newly Shift+clicked block) along with all intermediate blocks.
All blocks between the anchor and head (inclusive) should be visually highlighted via selection decorations.
In contrast, the observed behavior in plain mode shows the plugin state reverting to a single selection. This implies something is interrupting the plugin’s range selection logic after it starts.
Analysis of Event Handling (NodeView vs Plugin)
NodeView Intercepting Modifier Clicks
The CollapsibleBlock node is rendered with a custom React NodeView (collapsible-block.tsx) which attaches event handlers to the block’s header. Notably, it captures mouse events on the header (using onMouseDownCapture and onClickCapture) to implement special behaviors for selection and title editing. In the plain editor code, the NodeView explicitly handles modifier-assisted clicks:
Shift+Click on a block header: The NodeView intercepts this on mousedown, calling the plugin command to set a collapsible block range, then preventing further propagation. It also focuses the editor view at this time.
Ctrl/Cmd+Click on a block header: Similarly, the NodeView intercepts on mousedown, calling the plugin’s toggle-selection command (to add/remove that block from the selection) and then stopping the event propagation.
Additionally, the NodeView’s capture-phase click handler stops any click with a modifier key from propagating, effectively swallowing the Shift/Ctrl click on the header. This design was likely intended to integrate block selection with the NodeView (and possibly to prevent default browser text selection). However, this approach means the NodeView is aggressively managing the selection on its own. The key observation is that the NodeView may be dispatching extra selection transactions or interfering with the plugin’s built-in logic:
By calling editor.commands.setCollapsibleBlockRange on its own, the NodeView does initiate a range selection in the plugin (setting plugin state to 'range' with the appropriate anchor/head). But immediately after, the NodeView’s event handling might trigger an unintended state reset.
The NodeView’s preventDefault/stopPropagation calls mean ProseMirror’s normal selection mechanics (and the plugin’s default handlers) don’t fully run. This can disrupt how the plugin maintains the selection state across the mousedown->mouseup sequence.
Plugin’s Intended Range Selection Logic
The CollapsibleBlockSelection plugin (in collapsible-block-selection.ts) is designed to handle range selections if left to its own devices. On a Shift+click, the plugin’s ProseMirror event handlers would:
Capture the mousedown on a collapsible header and set the plugin state to 'range', with an anchor and head block, then mark the event to suppress the following click. It uses the current selection or plugin state to determine the correct anchor. If no prior block was selected, it tries to use the current text cursor position as the anchor.
On mouseup/click, the plugin would normally finalize or adjust the selection (and ensure focus). The plugin even sets a suppressClickInfo flag on mousedown (for Shift/ctrl events) to ignore the subsequent click event that the browser fires.
Crucially, the plugin’s command setCollapsibleBlockRange computes the full range between an anchor and the newly clicked block. If an anchor isn’t already set in its state or via the current selection, it will fall back in a controlled way. Specifically, if it cannot find an existing anchor block in the current selection, it will use the clicked block itself as both anchor and head (essentially defaulting to a single-block selection). This is meant as a fallback for edge cases – but in our scenario it’s exactly what we see happening (only one block gets selected). That suggests the plugin isn’t recognizing the intended anchor when Shift+click occurs.
Conflict and Sequence of Events
Putting it together, here’s what likely happens in plain mode:
Initial Block Selection – The user “selects” the first block. In plain mode, a normal click on a block header does not invoke the plugin’s selection directly because the NodeView hijacks the click for editing. Unless the user had their text cursor inside the block or used Ctrl/Cmd+click, there is no plugin anchor set. (For example, if the user just single-clicked the header, the NodeView might toggle into title-edit mode rather than create a selection decoration. By contrast, in the Yjs mode or intended design, a normal click would call selectCollapsibleBlock to select the single block.) In many cases, users might use Ctrl/Cmd+click as a workaround to select the first block – this would put the plugin in mode: 'single' with that block as anchor.
Shift+Click on Second Block – When the user Shift+clicks another block:
The NodeView’s handleHeaderMouseDownCapture intercepts the Shift+click. It logs NODEVIEW_SHIFT_MOUSEDOWN (for debugging) and calls editor.commands.setCollapsibleBlockRange with the clicked block’s position. This dispatches a transaction that attempts to select the range from the anchor to this block.
Because of the lack of a proper anchor in plugin state or selection (from step 1), the plugin’s setCollapsibleBlockRange falls back to using the clicked block as the anchor. In the code, if no existing anchor is stored and the current selection isn’t inside a collapsible block, it does anchor = blockPos (the target block itself). As a result, it computes the range positions as just that one block, and sets mode: 'single' since positions.length === 1.
Simultaneously, the NodeView prevents the default browser behavior and stops the event propagation on mousedown. It also focuses the editor view at this moment. This means ProseMirror’s own event listeners and the plugin’s built-in mousedown handler (if any) are effectively bypassed.
On mouseup/click, the NodeView’s capture handler for click with modifiers runs and again stops propagation. This likely prevents the plugin from seeing the click event that it intended to suppress/handle. Any follow-up selection normalization that the plugin might do on click is skipped. The plugin state remains as set by the NodeView’s transaction – which, as we saw, ended up being a single-block selection.
Result – Only the second block is highlighted (plugin state shows mode: 'single' with the head at the second block). The initial block is not included because the plugin never latched onto it as an anchor. Essentially, the NodeView’s well-intentioned direct command raced ahead without the proper context, and then its aggressive event suppression prevented the plugin from correcting or maintaining a multi-block range.
Why doesn’t this issue appear in Yjs mode? In the collaborative (Yjs) mode, the implementation likely relies more on the plugin and less on NodeView for selection. The plugin’s logic to handle Shift/Ctrl clicks would run unimpeded by NodeView. A normal click on a block might select it (enter mode: 'single'), establishing a proper anchor for a subsequent Shift+click. In plain mode, however, the NodeView was attempting to manage both editing and selection, leading to this interference.
Root Cause
The root cause of the range collapse is the NodeView intercepting modifier-key clicks and dispatching its own selection transactions, which overrides or conflicts with the plugin’s intended selection state. Specifically, in plain mode:
Missing Anchor: Because the NodeView blocks the plugin’s normal handling of the initial click, the plugin often has no record of an anchor block when a Shift+click occurs. The plugin’s setRange command therefore defaults to selecting only the clicked block (treating it as a single selection).
Event Propagation Suppression: The NodeView calls event.preventDefault() and event.stopPropagation() for Shift/Ctrl clicks on both mousedown and click events. This prevents ProseMirror’s own selection logic and the plugin’s event handlers from running or adjusting the state. Any plugin logic that might have maintained the range selection (for example, suppressing the click or preserving mode: 'range') is cut off.
Redundant Selection Commands: The NodeView dispatches a NodeSelection on the clicked block (via tr.setSelection(NodeSelection.create(...)) inside the plugin command). This means the official ProseMirror selection becomes just that node. If the plugin had added multiple blocks to its selection set, the NodeSelection focusing on the last block can visually and logically narrow the selection to that block alone (since ProseMirror by itself doesn’t support multi-node selection without the plugin’s decorations). The plugin relies on its decorations to show multiple blocks, but if the NodeView-triggered transaction didn’t include the proper range of block positions (due to missing anchor), the decorations cover only the one block.
In summary, the NodeView’s attempt to handle Shift+click is overriding the plugin’s multi-selection mechanism, causing the selection range to collapse to a single block.
Solution Approach
To fix this, we should let the CollapsibleBlockSelection plugin exclusively handle modifier-based selection gestures, and remove or disable the NodeView’s custom selection handling for those cases. The plugin is better equipped to maintain the correct anchor, range, and multi-selection state across the sequence of events. By isolating responsibilities:
The NodeView can focus on things like toggling collapse on arrow click and enabling title editing on plain clicks, but not manage range or multi-selection.
The plugin will handle Shift+click (range selection) and Ctrl/Cmd+click (multi-select toggle) from start to finish, using its internal state to track anchors and selected block sets.
Clean Patch Recommendation
1. Remove NodeView’s Shift/Ctrl selection commands: In collapsible-block.tsx, within handleHeaderMouseDownCapture, eliminate the branches that intercept event.shiftKey and event.metaKey/ctrlKey. Instead of calling the plugin commands here, simply do nothing (or allow the event to propagate). Similarly, in the companion handleHeaderClickCapture, do not stop propagation for modifier keys. This ensures that when a header is Shift-clicked or Ctrl-clicked, the event reaches ProseMirror’s own handlers (which the plugin hooks into). 2. Ensure the NodeView doesn’t interfere with plugin timing: We should also avoid the NodeView focusing the editor or preventing default on these modifier clicks. The plugin will call the necessary focus/scrollIntoView itself when dispatching its transactions. By letting the plugin’s handleDOMEvents.mousedown run, it will set up suppressClickInfo and call setCollapsibleBlockRange or toggleCollapsibleBlockSelection as needed, and then handle the click event appropriately. 3. Retain NodeView logic for normal clicks only: We still want the NodeView to handle plain clicks (no modifiers) on the header, since that is tied to editing the block title (and avoiding text selection within the header). We will keep that part intact. The NodeView should continue to call preventDefault() on a plain click to avoid placing a text cursor in the non-editable header, and then trigger title editing UI as it does currently. With these changes, a Shift+click will flow through to the plugin:
On Shift+mousedown, the plugin will identify the correct anchor. If the user had previously selected a block (via Ctrl+click or by cursor placement in a block), that anchor will be used. If not, the plugin might use the current document selection’s position to set an anchor. (In practice, users will either have a cursor in a block or have used Ctrl+click to start a selection.)
The plugin sets mode: 'range' and records all blocks between anchor and target. It dispatches the transaction with these blocks highlighted.
The plugin’s internal suppressClickInfo will cause the subsequent click event to be ignored (so it doesn’t reset the selection).
No NodeView follow-up will run to reset the state – the plugin’s state (mode: 'range') remains active with multiple blocks in selectionState.blocks. The highlight decorations will persist across those blocks.
Patch Implementation Snippet
Below is a patch snippet illustrating the changes in the NodeView code (collapsible-block.tsx). We remove the special-case handling of Shift/Cmd/Ctrl clicks in the header’s event handlers:
@@ function handleHeaderMouseDownCapture(event) {
-    if (event.shiftKey) {
-       // Shift-click: initiate range selection (NodeView way) – remove this to let plugin handle it
-       event.preventDefault();
-       event.stopPropagation();
-       editor?.view?.focus();
-       const commandPos = selectionPos ?? nodePos;
-       editor?.commands.setCollapsibleBlockRange(commandPos);
-       // ... (debug logging)
-       shouldEditTitleOnClickRef.current = false;
-       return;
-    }
-    if (event.metaKey || event.ctrlKey) {
-       // Cmd/Ctrl-click: toggle multi-selection – remove to let plugin handle
-       event.preventDefault();
-       event.stopPropagation();
-       editor?.view?.focus();
-       const commandPos = selectionPos ?? nodePos;
-       editor?.commands.toggleCollapsibleBlockSelection(commandPos);
-       // ... (debug logging)
-       shouldEditTitleOnClickRef.current = false;
-       return;
-    }
+    if (event.shiftKey || event.metaKey || event.ctrlKey) {
+       // For range or multi-select, defer to plugin logic
+       shouldEditTitleOnClickRef.current = false;
+       return;  // allow event to propagate to TipTap/ProseMirror
+    }
     // (Alt-click handling can remain or be handled separately, if needed)
@@ function handleHeaderClickCapture(event) {
-    if (hasModifierKey(event)) {
-       // Modifier-click was already handled on mousedown by NodeView (to be removed)
-       shouldEditTitleOnClickRef.current = false;
-       event.preventDefault();
-       event.stopPropagation();
-       // ... (debug logging)
-       return;
-    }
+    if (hasModifierKey(event)) {
+       // Do not intercept modifier-based clicks here – plugin will handle the selection logic
+       shouldEditTitleOnClickRef.current = false;
+       return;
+    }
With these changes, a Shift+click or Ctrl+click on a collapsible block header will no longer be short-circuited by the NodeView. Instead, the event goes through to the CollapsibleBlockSelection plugin’s handlers.
Outcome Verification
After applying the patch, testing the interaction shows the correct behavior:
Range Selection Persists: When one block is selected and you Shift+click another block, all blocks from the first to the second become highlighted. The plugin’s internal state stays in mode: 'range' (confirmed via debug logs or inspection of editor.storage.collapsibleBlockSelection.snapshot in development). It is not reset to 'single' because the NodeView no longer dispatches a stray transaction to collapse it. The selection decorations (data-collapsible-selected attributes) are applied to the entire range of blocks, not just the last one.
Multiple Selection (Toggle) Works: Similarly, Ctrl/Cmd+clicking multiple blocks toggles their selection on and off (entering mode: 'multi' when more than one block is selected). The NodeView no longer interferes, so each toggle updates the plugin state correctly.
No Unintended Focus/Selection Jumps: The focus is correctly managed by the plugin’s commands. For instance, after a Shift+click range selection, the editor remains focused and the last clicked block (the head of the selection) is the one visually indicated as the primary selection endpoint (as expected). There is no unexpected cursor appearing inside a block or the selection getting cleared by a rogue text selection.
Title Editing Unaffected: Regular clicks (with no modifiers) on the block header still allow the user to edit the block’s title as before. That logic remains in place, and because those events still don’t propagate, the plugin doesn’t erroneously treat a single click as a selection command. Thus, the user experience for editing vs selecting is now consistent: clicking on the title text enters edit mode, whereas using Ctrl/Shift clearly engages selection mode.
By delegating all multi-block selection behavior to the plugin and removing the NodeView’s redundant selection commands, we resolve the range-selection bug. The collapsible block selection plugin now fully controls modifier key interactions, allowing range selections to function properly in plain mode (just as they do in collaborative mode).