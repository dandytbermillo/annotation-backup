# Multi‑Layer Canvas — Comprehensive Proposal (Option A)

## Summary
- Introduce a multi‑layer canvas model that separates sidebar (fixed UI), notes canvas (world space), and a popup overlay (folder exploration) into distinct layers.
- Target Option A only: offline, single‑user, no Yjs at runtime. Maintain future compatibility without introducing CRDTs.
- Implement with a React‑first approach, a single container transform for the overlay, and a runtime feature flag to gate rollout.

## Scope
- In‑scope: popup overlay layer, layer switching, independent/sync pan behaviors, coordinate bridge, z‑index tokens, accessibility and performance basics, tests and rollout via feature flag.
- Out‑of‑scope: Yjs/live collaboration (Option B), minimap redesign, global UI overhaul, server‑driven realtime cursors.

## Constraints (CLAUDE.md)
- Option A persistence model: PostgreSQL‑only. No IndexedDB. UI state that does not require persistence stays ephemeral.
- Validation gates must be documented and run: lint, type‑check, unit, Postgres integration (if applicable), plain‑mode script, E2E.
- Honesty requirements apply: clearly separate implemented vs planned; no fabricated results.

## Desired Outcomes
- Layered model: clear separation of concerns between sidebar, notes canvas, and popup overlay.
- Robust coordinate system: single source of truth with no double scaling.
- Smooth UX: auto‑switch to popups when first opens; return to notes when last closes; intuitive keys and drag behavior.
- Option A compliance: persistence only when backed by Postgres; otherwise UI‑ephemeral.

## Architecture Overview
- Layers
  - Sidebar: fixed, non‑pannable, z‑index high enough to sit above canvas; can be hidden/shown without moving (remains fixed in place).
  - Notes Canvas: pannable + zoomable world space where panels render.
  - Popup Overlay: separate layer for cascading folder popups and their connection lines.
- Transform strategy
  - Exactly one transform (translate + scale) at the overlay container level.
  - Popups and connection lines are stored/rendered in canvas coordinates; no per‑popup scaling.
- Rendering
  - Overlay root: `position: fixed; inset: 0; pointer-events: none; z-index: Z_INDEX.POPUP_OVERLAY`.
  - Popups: `position: absolute; pointer-events: auto` under the overlay container; coordinates in canvas space.
  - Connection lines: SVG paths computed from canvas coords; inherit container scale.

## Layer Model In Depth

### Visual Layering (Z‑Order and Responsibilities)

```
[Top of Stack]
┌───────────────────────────────────────────────────────────────┐
│  Toasts / Modals (z: 2000+)                                   │
└───────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────┐
│  Sidebar (fixed UI)                 │  Popup Overlay (z: 100) │
│  - Fixed at left/top                │  - Covers entire viewport
│  - Not transformed                  │  - pointer-events: none on root
│  - z: 1000                          │  - Transformed once (translate+scale)
└─────────────────────────────────────┴─────────────────────────┘
┌───────────────────────────────────────────────────────────────┐
│  Notes Canvas (z: 1)                                          │
│  - World space (pan/zoom)                                     │
│  - Panels render here (world coords)                          │
└───────────────────────────────────────────────────────────────┘
[Bottom of Stack]
```

Key rules:
- Exactly one transform applies to each space:
  - Notes canvas uses its own transform (translate/scale) for panels.
  - Overlay root uses its own transform to align popups and lines to the same world.
  - Popups and lines do not apply additional scales (avoid double scaling).
- Event handling:
  - Overlay root has `pointer-events: none` so it doesn’t block canvas/side UI.
  - Individual popup nodes enable `pointer-events: auto` to be interactive.

### Coordinate Spaces and Conversion

We operate with two spaces:
- Screen space: browser pixel coordinates relative to viewport.
- Canvas space: world coordinates transformed by the layer (translate/scale).

Formulas (CoordinateBridge):

```ts
// screen -> canvas (remove translate, then divide by scale)
canvas.x = (screen.x - T.x) / T.scale
canvas.y = (screen.y - T.y) / T.scale

// canvas -> screen (apply scale, then translate)
screen.x = canvas.x * T.scale + T.x
screen.y = canvas.y * T.scale + T.y

// Overlay root style (single container transform)
style = {
  transform: `translate(${T.x}px, ${T.y}px) scale(${T.scale})`,
  transformOrigin: '0 0'
}
```

Implications:
- Store popup positions in canvas coordinates once (e.g., when a hover anchor is read from a screen rect, convert it using the current transform).
- Render popups at those canvas coordinates as `position: absolute` children of the overlay container; the container’s transform handles visual alignment to the viewport.

### Interaction Modes and Layer Switching

Auto‑switch rules:
- When first popup opens → active layer becomes “popups”.
- When last popup closes → active layer becomes “notes” (+toast).

Pan/zoom behavior:
- Notes layer: default mouse drag pans canvas; wheel zoom recentering uses mouse position.
- Popup layer: `Alt+Drag` to pan overlay only (when enabled); respect sync toggles.
- Sync pan/zoom: if enabled, both notes and overlay move together.

Illustration (independent vs sync pan):

```
Sync OFF:
  Drag canvas  → panels move, popups stay
  Alt+Drag     → popups move, panels stay

Sync ON:
  Drag canvas  → both move together
  Alt+Drag     → popups only (overrides sync)
```

### Event Flow (High Level)

1) User hovers a folder in the sidebar tree
- Get `getBoundingClientRect()` of the anchor (screen).
- Convert to canvas with `screenToCanvas(anchorRect, overlayTransform)`.
- Add a popup with `canvasPosition` at that point.

2) Popup renders in overlay
- Overlay container applies translate/scale.
- Popup element uses `left/top` = `canvasPosition.x/y` (no per‑popup scale).

3) Drawing connections
- Use `canvasPosition` of parent/child popups to compute bezier path.
- Append SVG path to overlay; it scales automatically with the container.

4) Panning/zooming
- Update the transform in provider state.
- Both canvas or overlay re‑render using new transforms; positions remain correct.

### Minimal Diagram (Mermaid)

```mermaid
flowchart TD
  A[Notes Canvas<br/>(world space)] -->|Panels| B(Panels in world coords)
  C[Popup Overlay<br/>(container transform)] -->|Popups| D[Popup nodes in canvas coords]
  C -->|SVG| E[Connection lines in canvas coords]
  F[Sidebar (fixed)] -. hover .-> C
```

Notes:
- Dashed edge shows the sidebar driving popup creation via hover.
- Two parallel spaces (A and C) share the same world via matched transforms.


## Integration With Existing Code
- Modern canvas (`components/annotation-canvas-modern.tsx`)
  - Mount a `PopupOverlay` sibling above `#infinite-canvas` in the visual stacking order.
  - Use `CanvasProvider` state (zoom, translate) to compute overlay transform with `CoordinateBridge.containerTransformStyle`.
- Canvas provider (`components/canvas/canvas-context.tsx`)
  - Continue as source of canvas transform state; expose transform via context selector/hook for overlay.
- Notes explorer (`components/notes-explorer-phase1.tsx`)
  - Continue to source cascading popup content. When multi‑layer is enabled, convert hover positions to canvas coords using `CoordinateBridge.screenToCanvas` and store `canvasPosition` on popovers.
  - Keep the in‑component screen‑space SVG for legacy mode; when multi‑layer is ON, prefer the shared overlay.
- Connection lines
  - Panel connection lines in world space are separate (`components/canvas/connection-lines.tsx`). Do not reuse for popup overlay; the overlay maintains its own SVG using canvas coords under the overlay transform.

## Feature Flags (Runtime‑Togglable)
- Reuse `lib/offline/feature-flags.ts` and add a key `ui.multiLayerCanvas`.
- Gate overlay mount and behaviors with `useFeatureFlag('ui.multiLayerCanvas')`.
- Do not rely on `process.env` mutation at runtime or mid‑test.

## State & Persistence Policy (Option A)
- UI‑ephemeral: layer UI state is in React state; no `localStorage`.
- Optional future persistence: introduce a small Postgres‑backed preferences API (`user_preferences` table) if long‑term preferences are needed.

## Coordinates & Bridge
- Use a single `CoordinateBridge` with static helpers everywhere to avoid drift:
  - `screenToCanvas(point, transform)` and `canvasToScreen(point, transform)`
  - `containerTransformStyle(transform)` for the overlay root style
- Do not mix both coordinate systems for the same element.

## Z‑Index Tokens (Design Tokens)
- Define in `lib/constants/z-index.ts` and reference consistently:
  - `NOTES_CANVAS: 1`
  - `POPUP_OVERLAY: 100`
  - `SIDEBAR: 1000`
  - `TOAST: 2000`
  - Optional popup specifics: `POPUP_BASE`, `POPUP_LEVEL_INCREMENT`, `POPUP_DRAGGING_BOOST` for finer ordering.

## Input & Shortcuts
- Pointer events: overlay root `pointer-events: none`; popups `pointer-events: auto`.
- Wheel zoom: listener with `{ passive: false }` if calling `preventDefault()`.
- Cross‑platform shortcuts: `mod+1`, `mod+2`, `mod+b`, `mod+0`, `Tab`, `Esc`. Detect Meta on macOS, Ctrl elsewhere.
- Drag behavior: `Alt+Drag` → popup layer only; `Space+Drag` → active layer; middle‑mouse → both if sync pan enabled.

Sidebar overlap and pointer-events policy:
- Overlay root uses `pointer-events: none` so sidebar/canvas interactions are never blocked.
- Popup nodes enable `pointer-events: auto` to receive interactions only where visible.
- Sidebar’s higher z-index means it takes precedence when visually overlapping the overlay; popups beneath do not capture events.

## Accessibility
- Layer switcher: `role="tablist"`, proper focus states.
- Toast: `aria-live="polite"` with non‑blocking display.
- Popups: ensure keyboard focus management and escape behavior to close/return to notes.

## Performance
- Viewport culling for off‑screen popups.
- Instrumentation via `performance.mark/measure` or a small monitor; avoid FPS assertions in Jest/JSdom.
- Debounce/throttle pan where needed for 60fps target on typical hardware.

Viewport culling implementation notes:
- Compute popup screen rect via `CoordinateBridge.canvasToScreen(popover.canvasPosition, overlayTransform)` and compare with viewport.
- Evaluate culling in `requestAnimationFrame` when transforms change; avoid per-event synchronous scans.
- Use an expanded viewport (e.g., +200px margins) to mitigate pop-in during fast pans.
- Cull connection lines for off-screen popups; consider path simplification if FPS dips.

## Testing & Validation (CLAUDE‑Aligned)
- Lint: `npm run lint`
- Type check: `npm run type-check`
- Unit tests:
  - `CoordinateBridge` math
  - z‑index manager
  - Optional adapters (popup connections path data)
- Integration tests (only if preferences API is added):
  - `docker compose up -d postgres && npm run test:integration`
- Plain mode script: `./scripts/test-plain-mode.sh` (if present)
- E2E (Playwright): `npx playwright test`
  - Open first popup → active layer becomes popups and indicator updates
  - Alt+Drag moves popup layer only (when sync off)
  - Close last popup → toast and return to notes

## Rollout & Rollback
- Rollout: enable `ui.multiLayerCanvas` for dev, then limited canary.
- Rollback: disable the feature flag; overlay is not mounted; legacy behavior remains.
- No schema migrations required for UI‑ephemeral mode.

## Risks & Mitigations
- Double scaling: prevented by a single container transform and canvas‑coord rendering.
- Pointer‑event traps: root has `pointer-events: none`; only popups enable events.
- Z‑index collisions: tokens ensure overlay sits below header/toasts but above canvas content.
- SSR drift: guard all browser globals; initialize clients in `useEffect`.

## Acceptance Criteria
- Behavior
  - First popup switches to popups layer; last popup closes return to notes with toast.
  - Alt+Drag pans popup layer only; with sync off, layers pan independently.
  - No double scaling; click targets align under all zooms.
- Performance
  - 50 popups: smooth pan and interaction; off‑screen popups culled.
- Quality
  - Lint, type‑check clean; unit tests for coordinates/z‑index passing.
  - E2E core flows pass; integration tests pass if preferences API is added.
  - Sidebar overlap acceptance: with overlay visible, sidebar hover/click works; popups under sidebar do not capture events.

## Milestones
- Week 0.5: Feature flag, CoordinateBridge consistency, overlay skeleton.
- Week 1: React overlay integration with container transform; z‑index tokens; SSR & pointer events compliance.
- Week 2: Popup migration to canvas coords; auto‑switch logic; connections SVG under container.
- Week 3: Performance (culling), A11y/shortcuts polish; tests.
- Week 4: Validation gates, docs, canary rollout plan.

## Phasing Notes: What Lands First vs. Later

Must‑Haves First (prerequisites for a stable MVP):
- Feature flag: add `ui.multiLayerCanvas` to `lib/offline/feature-flags.ts` and gate overlay logic with `useFeatureFlag`.
- React overlay skeleton: implement `PopupOverlay` with a single container transform (translate+scale on root only).
- CoordinateBridge usage: compute `canvasPosition` on popup open; lines/popups render from canvas coords (prevents double scaling).
- SSR & pointer-events policy: guard `window/document`; overlay root `pointer-events: none`, popups `pointer-events: auto`.
- Z‑index tokens: define and use `NOTES_CANVAS=1`, `POPUP_OVERLAY=100`, `SIDEBAR=1000`, `TOAST=2000` consistently.

Risky to Defer (small but UX/operationally critical):
- Auto‑switch logic: first popup → popups layer; last popup → notes (+toast).
- Tests and CLAUDE gates: unit tests (CoordinateBridge, z‑index), basic E2E (open/close, overlap). These need to pass before broad enablement.

Safe To Defer (polish/perf that can follow MVP):
- Viewport culling & perf tuning: rAF‑batched culling, path simplification for lines when needed.
- Alt+Drag independent pan polish: after core pan/sync behavior works.
- Optional Postgres preferences: only if persisting UI prefs later; remain UI‑ephemeral for Option A.
- Additional diagrams/docs polish.

Suggested Implementation Order:
1) Add feature flag + z‑index tokens.
2) Implement `PopupOverlay` (container transform) and compute `canvasPosition` via `CoordinateBridge` on popup open.
3) Apply pointer‑events policy and auto‑switch behavior.
4) Add culling/perf enhancements and Alt+Drag independent pan.
5) Add unit/E2E tests and run CLAUDE validation gates (lint, type, unit, integration if prefs added, plain‑mode script, E2E).

## Hybrid Migration Steps (Screen → Canvas Coordinates)

1) On popup open: compute `canvasPosition = screenToCanvas(anchorRect, overlayTransform)` and store it alongside legacy screen `position`.
2) In hybrid mode: maintain both; rendering path chooses based on feature flag.
3) On pan/zoom changes: do not re-convert; rely on container transform for visuals.
4) On flag toggle: switch rendering path; data remains stable; visual position unchanged.

Validation:
- Open popup → record screen pos; enable flag → position visually unchanged.
- Toggle sync pan and pan layers; popups/panels behave as specified.

## Appendix: Key Interfaces (illustrative)
```ts
// Coordinates
type Point = { x: number; y: number }
type Transform = { x: number; y: number; scale: number }

// Layer state (UI‑ephemeral)
interface LayerState {
  id: 'sidebar' | 'notes' | 'popups'
  visible: boolean
  locked: boolean
  opacity: number
  transform: Transform
}

interface CanvasState {
  activeLayer: 'notes' | 'popups'
  layers: Map<string, LayerState>
  syncPan: boolean
  syncZoom: boolean
  migrationMode?: 'legacy' | 'hybrid' | 'new'
}

// Connection path data
interface PathData { d: string; stroke: string; strokeWidth: number; opacity: number }
```

## References
- IMPLEMENTATION_PLAN.md (refined to Option A)
- TECHNICAL_ARCHITECTURE.md (React overlay, tokens, container transform)
- CLAUDE.md (Option A policy and validation gates)

## Why These Requirements Matter

- Option A scope and constraints (Postgres‑only; no Yjs)
  - Why: Aligns with CLAUDE.md phase boundaries; prevents premature CRDT or browser‑storage coupling and keeps CI reproducible.
  - If omitted: Policy drift (IndexedDB/localStorage/Yjs leaks), harder upgrades, and unverifiable behavior in CI.

- React‑first overlay with a single container transform
  - Why: Matches React 19 architecture; enables controlled lifecycle, SSR safety, and prevents double scaling by centralizing translate/scale.
  - If omitted: Imperative DOM fights React, memory leaks from unmanaged listeners, misaligned hitboxes, blurry scaling, brittle code.

- CoordinateBridge usage across the stack (no double scaling)
  - Why: One source of truth for screen↔canvas math eliminates rounding drift and keeps popups/lines aligned during pan/zoom.
  - If omitted: Subtle coordinate mismatches, desynced lines vs popups, broken click targets at certain zoom levels.

- Feature flag via `lib/offline/feature-flags.ts` (`ui.multiLayerCanvas`)
  - Why: Runtime toggling for canaries/tests without rebuilds; integrates with existing infra and CLAUDE validation flow.
  - If omitted: Risky big‑bang rollout, flaky tests relying on env flips, slow feedback for enabling/disabling in QA.

- UI‑ephemeral state policy; optional Postgres preferences
  - Why: Option A forbids browser persistence for app data; keeps UI state simple and compliant. Postgres prefs are available if truly needed.
  - If omitted: LocalStorage/IndexedDB usage violates policy, yields inconsistent behavior across environments, and blocks CI acceptance.

- Z‑index tokens and consistent layering
  - Why: Prevents stacking conflicts across headers, toasts, overlay, and canvas; aids audits and future changes.
  - If omitted: Hidden/unclickable UI, overlay under headers, toasts behind overlays, and brittle ad‑hoc `z-[…]` fixes.

- Input, pointer‑events, accessibility, and performance guidance
  - Why: Ensures popups are clickable (`pointer-events: auto`), overlay doesn’t block UI (`none` on root), keyboard reachable, and smooth at scale.
  - If omitted: Pointer event traps, inaccessible flows, scroll/zoom conflicts, and stutter with many popups.

- CLAUDE‑aligned validation plan with repo commands
  - Why: Enforces reproducibility and honesty gates (lint, types, unit, integration, E2E) so “done” is verifiable locally and in CI.
  - If omitted: “Works on my machine” regressions, policy violations slipping through, unclear readiness.

- Rollout/rollback, risks, acceptance criteria, and milestones
  - Why: Operational clarity for enabling, disabling, and defining “done”; improves predictability and mitigates deployment risk.
  - If omitted: Hard rollbacks, scope creep, ambiguous acceptance, and schedule slippage.

## Implementation Status (Phase 0/1)

- Phase 0 (Preparation & Migration): Complete
  - Added feature flag `ui.multiLayerCanvas` (runtime-togglable via `offlineFeatureFlags`).
  - Introduced `Z_INDEX` tokens and `CoordinateBridge` helpers (no double scaling).
  - Created React overlay skeleton and adapters (popup state, connection lines) per Option A (UI‑ephemeral state).

- Phase 1 (Foundation Integration): Complete
  - Unified state via `LayerProvider` (Explorer and PopupOverlay share the same transforms and activeLayer).
  - Keyboard interactions: Alt+Drag pans popup layer; Space+Drag pans active layer.
  - Single auto-switch (no duplicate toasts); viewport culling; rAF-batched transform updates.

Note: If a toast on layer change is desired, see “Optional Toast”.

## Unified State Notes

- Single source of truth: `LayerProvider` (React context) exposes `transforms`, `activeLayer`, and update APIs; both Explorer and PopupOverlay consume `useLayer()`.
- No duplicate auto-switch logic: handled in Explorer only to avoid double notifications and race conditions.
- Overlay container applies a single transform; popups/lines render from canvas coordinates derived via `CoordinateBridge`.

## Verification

- Script: `docs/proposal/multi_layer_canvas/test_scripts/verify-unified-state.js`
- Key checks:
  - Feature flag enables: `localStorage.setItem('offlineFeatureFlags', JSON.stringify({ 'ui.multiLayerCanvas': true }))`.
  - Alt+Drag pans popup layer; Space+Drag pans active layer (watch transforms update in DevTools).
  - Explorer and PopupOverlay read the same `transforms` object from `LayerProvider`.
  - Auto-switch triggers once (one toast if enabled; see below).
  - Viewport culling keeps only visible popups in DOM; motion is smooth due to rAF batching.

## Optional Toast

- If you want a toast when layer auto-switches (first popup → popups; last → notes), add a toast call in the Explorer’s auto-switch effect.
- Default Phase 1 behavior is silent switching (toast optional) to minimize noise while validating interactions.
