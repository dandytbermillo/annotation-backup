## SUMMARY

Introduce a shared layering model for the canvas so panels (TipTap editors) and lightweight component widgets use the same stacking rules. This builds on the unified camera/drag work: dragging is now smooth, but z-index is still per-component. The goal is to move `zIndex`, ordering, and “bring-to-front” logic into a single data model driven by `CanvasProvider` so resets, persistence, and future component types stay predictable.

---

## OBJECTIVES

- New nodes (panel or widget) should appear above existing ones unless explicitly pinned.
- Focusing, dragging, or otherwise activating a node should update its stacking order consistently.
- Allow exceptions (`pinned`, `pinnedPriority`) so certain UI chrome (minimap, overlays) never lose their slot.
- Persist stacking order alongside camera state in plain-mode storage (and eventually in Yjs when collaboration returns).
- Remove ad-hoc `setTimeout`/global refs for z-index so React re-renders no longer snap nodes back.

---

## ACCEPTANCE CRITERIA

- All canvas nodes (panels, component widgets) expose unified metadata:
  ```ts
  interface CanvasNode {
    id: string;
    type: 'panel' | 'component' | string;
    position: { x: number; y: number };
    size?: { width: number; height: number };
    zIndex: number;
    createdAt: number;
    lastFocusedAt: number;
    pinned?: boolean;
    pinnedPriority?: number;
  }
  ```
- React render paths derive `style.left/top/zIndex` from this model; no manual inline overrides.
- On focus/drag/drop, dispatch a LayerManager action that updates `zIndex` and timestamps for the target node.
- New nodes get `createdAt = Date.now()` and `zIndex = (highest zIndex among non-pinned nodes) + 1`.
- Layer order survives save/load via plain-mode persistence (flag future Yjs integration).
- Pinned nodes remain unmoved regardless of other interactions.

---

## IMPLEMENTATION TASKS

1. **Normalize node state:** extend `CanvasProvider` (or a dedicated store) with a normalized `CanvasNode` map; populate it during hydration using existing panel/component data.
2. **LayerManager utilities:** add helpers to register nodes, bring to front, update focus timestamps, and serialize/deserialize the layer order. Decide on absolute vs. timestamp-based z-index strategy.
3. **Update drag/focus code:** replace local z-index state in panels/components with LayerManager calls; render styles read from the shared node metadata.
4. **Persistence:** include node metadata in plain-mode save/load (and plan for Yjs), reconciling new vs. existing nodes deterministically.
5. **Testing:** verify new component creation, drag/focus order changes, pinned node behavior, and persistence across reloads.

---

## RISKS & MITIGATIONS

- **State drift:** use React state for active drag position so the DOM and data model stay in sync.
- **Persistence conflicts:** timestamp nodes (createdAt/lastFocusedAt) to merge saved order with new nodes.
- **Pinned ordering:** define clear ranges or priorities so overlays/minimap coexist with node ordering.

---

## DEPENDENCIES

- Unified camera/drag refactor (already gated by `NEXT_PUBLIC_CANVAS_CAMERA`).
- TipTap performance mode (already available) to avoid editor jank when bring-to-front triggers.

---

## FOLLOW-UPS

- Debug overlay showing current layer order.
- Keyboard shortcuts to cycle through nodes.
- “Panel Lite” experiments using the same metadata but simplified rendering.

