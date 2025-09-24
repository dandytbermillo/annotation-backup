# Blocks Multi-Select: Field Failures Research Plan

## Background
Latest plain-mode builds are expected to highlight a collapsible block as soon as the user clicks its header/handle. In practice, users still see a caret (no highlight), and subsequent `Shift` + `Arrow` attempts either do nothing (Chrome/Safari) or highlight the wrong range (Firefox). We need to isolate why the click handler and range-extension commands are not taking effect.

## Objectives
- Reproduce the missing-highlight behaviour across browsers and confirm whether the ProseMirror selection state ever becomes a `NodeSelection`.
- Determine why `Shift` + `Arrow` does not extend the selection, and whether the command chain is being bypassed.
- Identify any gating conditions (mode detection, extension ordering, stale build) that prevent the `CollapsibleBlockSelection` extension from applying.

## Key Questions
1. Does the compiled bundle include the latest `handleDOMEvents` + `handleClick` overrides in `CollapsibleBlockSelection`?
2. Are we failing to register the selection extension in the plain TipTap editor (`components/canvas/tiptap-editor-plain.tsx`)?
3. Is another plugin/DOM listener swallowing the click or resetting the selection after our command runs?
4. Are keyboard shortcuts being shadowed by TipTap defaults or browser-level behaviour?
5. Does plain vs collab mode load different editor compositions or feature flags that disable the extension?

## Investigation Steps
1. **Baseline Reproduction**
   - Launch `npm run dev`, force plain mode (`NEXT_PUBLIC_COLLAB_MODE=plain`), open Chrome, Firefox, Safari.
   - Use DevTools to inspect the event log while clicking headers; confirm whether `collapsible-selection-change` fires.
   - Observe `editor.state.selection` via the console to see if it changes to a `NodeSelection`.

2. **Verify Extension Registration**
   - Set breakpoints in `CollapsibleBlockSelection.addProseMirrorPlugins` and `components/canvas/tiptap-editor-plain.tsx` during editor init.
   - Check `editor.extensions` at runtime to ensure the selection extension is present and not overridden.

3. **DOM/Event Tracing**
   - Attach temporary instrumentation to `handleDOMEvents.mousedown` / `handleClick` to confirm they are triggered.
   - Verify the header element in the live DOM carries `data-collapsible-header`/`data-collapsible-block`.
   - Inspect whether downstream handlers (e.g., the React node-view `onClick`, menu buttons) call `stopPropagation` or mutate selection post-dispatch.

4. **Keyboard Shortcut Diagnostics**
   - Log invocation of `extendCollapsibleBlockSelection` and `setCollapsibleBlockRange` commands upon `Shift` + `Arrow`.
   - Compare `editor.registerPlugin` ordering to ensure our keymap precedes TipTap defaults.
   - Confirm no OS/browser accessibility features intercept the key events.

5. **Regression / Build Artifacts**
   - Delete `.next`, restart the dev server to rule out stale bundles.
   - Cross-check production bundle (if applicable) to confirm the code path survives minification.

6. **Hypothesis Testing**
   - Temporarily force `handleDOMEvents` to return `true` always to see if the selection still reverts.
   - Disable other custom plugins (hover icon, read-only guard) to isolate conflicts.
   - Evaluate whether selection fails only when other decorations are active (annotations, template menus).

## Affected Files / Modules
- `lib/extensions/collapsible-block-selection.ts`
- `lib/extensions/collapsible-block.tsx`
- `components/canvas/tiptap-editor-plain.tsx`
- `components/canvas/canvas-panel.tsx`
- `components/canvas/format-toolbar.tsx`

## Deliverables
- Event/selection logs demonstrating the failure mode per browser.
- Root cause analysis: either conflicting listeners, incorrect extension ordering, or unmet selector attributes.
- Recommended fixes (code or configuration) plus validation steps.

## Notes
- Capture browser versions and ensure plain mode is confirmed via console banner (`📝 Using Plain Mode (no collaboration)`).
- If the issue reproduces only after hot reload, include that in the findings.

