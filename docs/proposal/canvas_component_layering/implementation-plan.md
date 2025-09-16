# Canvas Component Layering — Implementation Plan

> Builds on `initial.md` (shared CanvasNode model) and the existing camera/drag refactor.
> Feature work gated under `NEXT_PUBLIC_CANVAS_CAMERA` initially, then widened once stable.

---

## 1. Normalize Canvas Nodes

- Extend `CanvasProvider` (or a sibling context) with a canonical `Map<string, CanvasNode>` covering panels and component widgets.
- When hydration runs:
  - If plain-mode storage includes node metadata, load it.
  - Otherwise, bootstrap existing panels/components with defaults:
    ```ts
    {
      id,
      type: panel ? 'panel' : 'component',
      position: existing position,
      zIndex: next sequential value,
      createdAt: Date.now(),
      lastFocusedAt: Date.now(),
    }
    ```
- Always recompute `maxZ` for non-pinned nodes on load so new nodes start above the current stack.
- Expose helpers via context: `getNode(id)`, `getNodes()`, `updateNode(id, partial)`, etc.

## 2. LayerManager Utilities

- New module `lib/canvas/layer-manager.ts` (or similar) that operates on the shared nodes map. Core functions:
  ```ts
  registerNode(node: Partial<CanvasNode> & { id: string; type: string }): CanvasNode
  bringToFront(id: string): void
  bringSelectionToFront(ids: string[]): void
  focusNode(id: string): void // sets lastFocusedAt, calls bringToFront unless pinned
  serializeNodes(): CanvasNode[]
  deserializeNodes(nodes: CanvasNode[]): void
  getOrderedNodes(): CanvasNode[] // optional helper for debugging
  ```
- Ordering rule to document and enforce:
  1. Pinned nodes first (sorted by `pinnedPriority` descending, then `createdAt`).
  2. Non-pinned nodes ordered by `zIndex` descending.
  3. Use `lastFocusedAt` (or `createdAt`) as a tiebreaker when z-index matches.
- Implementation notes:
  - Layer raises are O(1) per node by maintaining a running `maxZ`; do not renumber the entire stack.
  - `bringSelectionToFront` should preserve relative order of the IDs passed in.
- Expose a dev console helper (e.g., `window.debugCanvasLayers = () => getOrderedNodes()`) for quick triage.

## 3. Update Panels & Components

- Replace local z-index state (`useState` / `globalDragging…`) with LayerManager calls:
  - On mount: ensure the node is registered.
  - On drag/focus/drop: `focusNode(id)` updates timestamps and ordering; `updateNode(id, { position: newPos })` persists position in the shared model.
  - During render: read `const node = getNode(id)` and use `node.position` / `node.zIndex` for inline styles (no direct DOM overrides).
- Remove duplicated z-index hacks now that rendering pulls from the shared model.

## 4. Persistence (Plain Mode)

- Update `lib/canvas/canvas-storage.ts` (or equivalent) to include serialized node metadata alongside camera state.
- Persist `{ schemaVersion, nodes, maxZ }`. On load:
  - Clamp invalid `zIndex` values, recompute `maxZ`, and keep pinned nodes within their reserved band.
  - Merge saved nodes with runtime `canvasItems`. If a saved node is missing, register a new one with default metadata; if a runtime node is missing from the saved list, append it with fresh timestamps.
- Document a follow-up task to feed the same metadata into Yjs once collaboration returns (not in scope now).

## 5. Testing / Verification

- Manual checklist or integration test covering:
  - Creating several panels/components and verifying order after drag/focus (camera flag on/off).
  - Multi-select bring-to-front preserves relative order of the selection.
  - Pinned band cannot be overtaken by non-pinned content.
  - Undo/redo of a bring-to-front restores prior ordering.
  - Persistence: align positions/z-order, reload, confirm ordering survives.
  - Verify `window.debugCanvasLayers()` (or similar) lists nodes in expected order for troubleshooting.

## 6. Safety / Rollback

- Keep the new LayerManager path behind an environment flag initially (e.g., `NEXT_PUBLIC_LAYER_MODEL`). Legacy code should remain runnable until the flag is on.
- Ensure panel/component drag handlers fall back to existing behavior if the shared model fails (e.g., guard `getNode`).

---

## Sequencing Summary

1. Introduce normalized node state in provider (with `maxZ` recomputation).
2. Build LayerManager helpers and ordering rules (including multi-select).
3. Migrate panels/components to read/write through LayerManager.
4. Extend plain-mode persistence to cover node metadata.
5. Verify behavior (focus order, persistence, pinned layers, undo/redo) in both camera modes; expose debug helper.
 ## 7. Undo / Redo (optional)

- Record minimal "bringToFront" ops so we can revert/redo layer changes (e.g., stack of `{ id, previousZ, newZ }`).
- Integrate with existing undo/redo handling if available, or gate behind dev flag until we implement a global history.

