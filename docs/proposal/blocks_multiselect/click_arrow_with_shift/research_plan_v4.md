# Shift+Click Range Collapse – Research Plan (v4)

## Context & Current Regression
After reverting prior experiments, the plain-editor collapsible block multi-select again fails to maintain range highlights. When a user selects one block and then Shift+clicks additional blocks, the highlight snaps back to a single block (the most recent click) instead of expanding. Logs show the plugin briefly enters `mode: 'range'`, but another transaction resets state to `mode: 'single'` immediately afterward.

## Objectives
- Reproduce the regression and capture definitive evidence of the transition from range to single.
- Identify whether the follow-up transaction originates from the NodeView, plugin, keyboard shortcut, or another extension (e.g., history, focus handlers).
- Produce a precise call/transaction timeline that isolates the component issuing the collapsing command.
- Request any patches or code snippets the team has already attempted so we can avoid repeating failed fixes.

## Key Questions
1. **Transaction Sequence**: After `setCollapsibleBlockRange`, what command reverts to single selection? (`CMD_ENSURE_SINGLE`, duplicate `setRange`, etc.)
2. **Event Ownership**: Does the NodeView still dispatch a redundant command on Shift+mousedown/arrow click, or is a plugin `handleClick` path responsible?
3. **Selection Context**: Are `selection.anchor/head` values changing unexpectedly (e.g., text selection, focus shifts) causing the range command to compute a single block?
4. **Modifier Timing**: Does the DOM click event lose the Shift modifier by the time it hits the plugin, triggering fallback single selection?
5. **External Extensions**: Are keyboard shortcuts (`extendCollapsibleBlockSelection`), history plugins, or focus hooks firing additional transactions after the range command?

## Investigation Steps
1. **Baseline Reproduction**  
   - Hard refresh with `NEXT_PUBLIC_COLLAB_MODE=plain` and `NEXT_PUBLIC_DEBUG_COLLAPSIBLE_SELECTION=true`.  
   - Create several collapsible blocks, single-select the first, then Shift+click successive blocks (header text and collapse arrow).  
   - Record screen, collect console/debug log output.

2. **Database Log Capture**  
   - Query `debug_logs` for `component = 'CollapsibleBlockSelection'` and filter actions: `CMD_SET_RANGE`, `CMD_ENSURE_SINGLE`, `PLUGIN_HANDLE_CLICK`, etc.  
   - Note the exact row IDs where the state switches back to single.

3. **Transaction Trace Review**  
   - Inspect `CMD_SET_RANGE` metadata (anchor/head, positions) to confirm the range is correct initially.  
   - Examine the subsequent transaction’s metadata to identify the culprit (e.g., `CMD_ENSURE_SINGLE` with `previousSnapshot.mode = 'range'`).

4. **NodeView Instrumentation**  
   - Audit `lib/extensions/collapsible-block.tsx` for modifier branches (`handleHeaderMouseDownCapture`, `handleArrowClick`). Confirm whether they dispatch commands and log outcomes (`shift_set_range`, etc.).

5. **Plugin Handler Review**  
   - Review `lib/extensions/collapsible-block-selection.ts` `handleDOMEvents.mousedown/click` paths to see if they call `selectCollapsibleBlock` after Shift+click (especially when Shift status may clear on click).

6. **Keyboard Shortcut Checks**  
   - Confirm whether `extendCollapsibleBlockSelection` (Shift+Arrow) is being triggered inadvertently after Shift+click.

7. **Request Existing Patches**  
   - Ask for any prior diffs or patches the team tried (e.g., NodeView deferral, plugin suppression) so we know what approaches already failed.

8. **Hypothesis Testing**  
   - Temporarily (locally) comment out either the NodeView Shift branch or the plugin click fallback to see if the range persists. Record results.

9. **Consolidate Findings**  
   - Summarize which handler fired the collapsing transaction, with log IDs for evidence.  
   - Propose a fix strategy (e.g., unify modifier handling in the plugin, guard NodeView from dispatching) with explicit code targets.

## Required Code/Artifacts
- `lib/extensions/collapsible-block.tsx` (React NodeView event handlers).  
- `lib/extensions/collapsible-block-selection.ts` (ProseMirror plugin and commands).  
- `lib/utils/debug-logger.ts` and `/app/api/debug/log/route.ts` to ensure logs reach Postgres.  
- Any existing patches or snippets previously attempted (please provide if available).  
- Migration files `migrations/007_debug_logs.up.sql` / `019_fix_debug_logs_trigger.up.sql` (already applied) for reference on debug logging.

## Deliverables
- Annotated timeline showing range command → collapse command (with log row IDs).  
- Root cause explanation identifying the exact handler issuing the collapsing transaction.  
- Proposed remediation plan (or patch preview) addressing the responsible code path.  
- Research result doc update summarizing evidence and next steps.

## Affected Files
- `lib/extensions/collapsible-block.tsx`
- `lib/extensions/collapsible-block-selection.ts`
- Supporting: `lib/utils/debug-logger.ts`, `app/api/debug/log/route.ts`

## Open Requests
- **Please share any previous patches/diffs** that tried to fix the Shift+click issue so the research can validate or build upon them.  
- **Confirm current feature flags** (e.g., `NEXT_PUBLIC_COLLAB_MODE`, selection debug flag) to align reproduction settings.
