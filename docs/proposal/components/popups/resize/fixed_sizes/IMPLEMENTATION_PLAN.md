# Popup Auto-Resize (Initial Creation) – Implementation Plan

## Objective
Automatically size newly created overlay popups to fit their initial content (within safe min/max bounds) so dense folders do not require immediate manual resizing, while keeping manual resize overrides authoritative and maintaining today’s persistence plumbing for future database storage of popup dimensions.

> Isolation Reactivity Anti-Patterns memo: not directly applicable (overlay layer, not isolation provider). Plan still avoids coupled provider/consumer API drift by staying inside existing callbacks.

## Milestones
1. **Schema Review & Guard Rails**
   - Confirm `OverlayLayoutAdapter` already serializes `width`/`height` and note any gaps that could block future DB persistence.
   - Document the clamps (`MIN/MAX_POPUP_*`) so UI + persistence share the same expectations.
2. **Auto-Size on First Render**
   - Extend the popup overlay measurement effect to detect “fresh” popups (no manual override, not yet auto-sized).
   - After the initial child data load, measure the intrinsic height of the scroll container (`data-popup-content`) plus chrome, clamp it, and call `onResizePopup`.
   - Persist a `sizeMode` flag (`default` → `auto`/`user`) so we do not re-run creation sizing or fight manual overrides.
3. **Content Growth Hooks**
   - When `handleBulkMove` or `handleFolderCreated` adds items, mark the affected popup(s) for a one-time remeasure and let the overlay’s measurement pass adjust height.
   - Ensure drag/drop only queues remeasure after the mutation settles (post state update) to avoid flashing.
4. **Manual Override Protection**
   - When the resize handle fires, record a `userSized` flag. Auto-sizing skips any popup where this is true.
   - Provide a helper to clear `userSized` (future work) but keep defaults for now.
5. **Testing & Telemetry**
   - Manual QA: open dense vs. sparse folders, verify initial heights adjust; confirm manual resize sticks.
   - Regression guard: ensure connection lines track resized dimensions.
   - Log (dev only) when auto-sizing adjusts a popup to aid future tuning.

## Not in Scope (Follow-up)
- Database migrations or API changes; existing layout persistence already captures width/height.
- Auto-width adjustments or continuous reflow while typing inside popups.
- Bulk re-layout of child popups when parent size changes.

## Risks & Mitigations
- **DOM measurement jank** → Batch via existing RAF queue; keep measurement suspended during pan/drag.
- **User override conflicts** → `userSized` guard prevents auto-resize from fighting manual edits.
- **Persistence drift** → Schema review upfront keeps future DB storage aligned with the same clamps and flags.
- **Flex layout disguises intrinsic height** → Measure the inner scrollable region instead of the outer card to avoid reading the default `maxHeight` again.

## Fix Summary
- Cause: Initial implementation sampled the entire popup card, whose flex layout and default 400 px `maxHeight` masked the true content height, so auto-resize never fired.
- Fix: Query the scroll region (`data-popup-content`), compute its `scrollHeight` plus chrome, and feed that value through the auto-resize guardrails.
