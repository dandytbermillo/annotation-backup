# Fix Report: Edit-Mode Hover Icon Reliability (Attempt/Reverted)

Date: 2025-09-11  
Severity: **High** (core UX feature broken in primary workflow)  
Editors impacted: Plain mode (edit mode)  
Status: Attempted & Reverted — issue not fixed

---

## Summary

Attempted to fix the hover icon not appearing over annotated text in edit mode (editor focused). The approach implemented capture‑phase event handling and in‑pipeline detection, but the user reported “not working”, and the changes were reverted. The issue remains open.

## Changes (Attempted; then reverted)

No runtime changes remain after reversion. The attempted changes included:
- Switching to capture‑phase listeners on the editor root and/or document
- Adding ProseMirror `handleDOMEvents.mousemove` detection
- Using `elementFromPoint(...)` hit‑testing for robustness
- Adjusting icon z‑index and visibility toggles

## Rationale (Still plausible)

TipTap/ProseMirror may consume or alter mouse events in edit mode. Capture‑phase handlers or plugin `handleDOMEvents` typically restore reliability, but the attempted change did not produce the expected result in this environment.

## Validation (Result: Not fixed)

- User re-tested and reported: icon did not show in edit mode; changes were reverted.
- Follow‑up: add runtime instrumentation to confirm event delivery and hit‑testing before the next attempt.

Recommended DevTools test (no code changes): see `docs/proposal/hover_annotation_icon/test_scripts/test-hover-edit-mode.js`.

## Risks/Limitations (for next attempt)

- Capture‑phase listeners can conflict with other plugins if misused
- Hit‑testing and stacking contexts can vary by layout; ensure z‑index above tooltips and editor
- Touch devices: use long‑press or disable hover affordance

## Next Steps

1) Add temporary debug (DevTools script) to confirm:
   - Events received in edit mode (editor root and document capture)
   - Annotated spans present and detected via `elementFromPoint`
2) If events/spans are present:
   - Re‑implement minimal detection via `handleDOMEvents.mousemove` with a single shared icon element appended to `body`, z‑index ≥ tooltip
3) Add a Playwright E2E for edit‑mode hover (a spec file exists at `e2e/hover-annotation-edit-mode.spec.ts`)

---

## Related Links

- [TOOLTIP_REFERENCE.md](../../TOOLTIP_REFERENCE.md) - Tooltip implementation details
- [IMPLEMENTATION_PLAN.md](../../IMPLEMENTATION_PLAN.md) - Original feature plan
- [Main Report](../../reports/2025-09-09-implementation-report.md) - Full implementation overview
- [Fixes Index](../README.md) - All post-implementation fixes
