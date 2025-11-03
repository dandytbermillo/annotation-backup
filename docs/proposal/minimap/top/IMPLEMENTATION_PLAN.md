# Annotation Minimap Layering — Implementation Plan

## 1. Objective
- Ensure the annotation minimap renders above all note-canvas UI (panels, controls, HUD) while staying below higher-order canvases (overlay canvas, constellation canvas, global HUD layers).
- Preserve existing interaction contracts: no new provider APIs, no z-index hacks that would break dragging/hover interactions, and no constellation regressions.

## 2. Constraints & Guardrails
- **Isolation Anti-Patterns:** Stay within the current provider contracts; only adjust presentation-layer tokens and styling. No new hooks, context fields, or UI gating logic.
- **Positioning:** Minimap remains `position: fixed` so it does not inherit transformed canvas stacking contexts.
- **Design Tokens:** All stacking changes must flow through `lib/constants/z-index.ts` to avoid ad-hoc Tailwind literals (`z-[…]`).
- **Regression Risk:** Popup overlays and constellation layers must still eclipse the minimap; draggable panel overrides should remain temporary.

## 3. Current State Snapshot
- Minimap root (`components/canvas/enhanced-minimap.tsx`) hardcodes `z-[900]`, which places it above most note canvas UI but unintentionally above overlay and constellation surfaces.
- `lib/constants/z-index.ts` defines base tokens (`NOTES_CANVAS`, `POPUP_OVERLAY`, `CANVAS_UI`, `DROPDOWN`, etc.) but lacks dedicated entries for minimap tiers.
- Overlay host and constellation components use a mix of shared tokens and Tailwind classes (`z-40`, `z-50`), leading to ambiguous layering.
- Canvas panels occasionally bump to very high z-indices (`999999`) during drag interactions.

## 4. Proposed Layering Tokens
1. Update `lib/constants/z-index.ts`:
   - Reserve a dedicated tier for note-canvas minimap/UI (e.g. `CANVAS_MINIMAP = 320`), slightly above `CANVAS_UI`.
   - Elevate overlay canvas and related HUD (e.g. `OVERLAY_CANVAS = 600`) and set a placeholder `OVERLAY_MINIMAP = 620` for future overlay minimap.
   - Assign constellation/global canvas tier (`CONSTELLATION = 700`) plus existing HUD tokens (`DROPDOWN`, `SIDEBAR`, etc.).
2. Export type-safe helpers if needed (optional) to keep future minimap variants consistent.

## 5. Implementation Steps
1. **Token Update**
   - Modify `lib/constants/z-index.ts` with the new layering constants and inline documentation.
   - Verify other consumers (e.g. `getLayerZIndex`) continue to map to appropriate tiers.
2. **Minimap Integration**
   - Replace hard-coded `z-[900]` on the minimap wrapper(s) in `components/canvas/enhanced-minimap.tsx` with `style={{ zIndex: Z_INDEX.CANVAS_MINIMAP }}` or a Tailwind class sourced from the token.
   - Audit other note-canvas fixed controls (e.g. control toggle button in `components/annotation-canvas-modern.tsx`) to align with the same tier if they must appear above panels but below overlay.
3. **Overlay & Constellation Alignment**
   - Ensure overlay host (`components/canvas/popup-overlay.tsx`) uses the updated `Z_INDEX.OVERLAY_CANVAS`.
   - Swap constellation wrappers (e.g. `components/constellation/constellation-panel.tsx`, `ConstellationMinimap`, `StatusPanel`) to use `Z_INDEX.CONSTELLATION` instead of literal Tailwind z-indices.
4. **Drag/Interaction Safeguards**
   - Review `components/canvas/canvas-panel.tsx` for persistent z-index overrides; constrain any non-temporary values to stay below `CANVAS_MINIMAP`.
   - Confirm drag-time boosts still apply via temporary inline styles without leaking into normal state.
5. **Future Overlay Minimap Hook**
   - Add a short comment noting `Z_INDEX.OVERLAY_MINIMAP` is reserved; when implemented, the overlay minimap should follow the same fixed-position + token pattern.

## 6. Verification
- Manual QA flow:
  - Load a dense annotation canvas: confirm panels, toolbars, and minimap stack correctly.
  - Trigger overlay popups and constellation view; verify both appear above the minimap.
  - Drag a panel while observing minimap visibility.
- Automated checks:
  - `npm run lint` to catch unused imports or style regressions.
  - Optional smoke test screenshot or Playwright scenario to confirm stacking (if existing test suite covers UI layering).

## 7. Rollout & Follow-Up
- Document the new tokens in engineering notes / design system docs.
- Communicate layering tiers to teams working on overlay or constellation features to prevent future literal z-index regressions.
- Timebox a follow-up task to migrate any remaining legacy Tailwind `z-*` classes on canvas HUD components to the shared tokens.

