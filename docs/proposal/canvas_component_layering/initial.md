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

1. Normalize node state in `CanvasProvider` so panels and components share a `CanvasNode` map.
2. Build LayerManager utilities to register/remove nodes, bring selections to front, apply ordering rules, and expose debug helpers.
3. Update panels/components to read/write through LayerManager (register on mount, remove on unmount, use shared z-index/position).
4. Persist `{ schemaVersion, nodes, maxZ }`, clamp invalid values on load, keep pinned nodes in reserved band, prepare for Yjs integration.
5. Test multi-select ordering, pinned band protection, undo/redo of bring-to-front, persistence, and debug helper output across camera modes.
6. The shared layer model now ships permanently enabled; legacy fallback requires reverting the feature rather than toggling an env flag.
