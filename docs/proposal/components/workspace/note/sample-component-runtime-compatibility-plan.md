# Sample Component Runtime Compatibility Plan

This plan covers the requirements for keeping demo/sample components (e.g., StickyNote, DragTest, PerformanceTest, future examples) compatible with the runtime ledger and `useComponentRegistration` so they behave like notes and the primary components across switches and reloads.

## 1. Component API Consistency

- Every workspace component must accept the following props:
  - `componentId: string`
  - `workspaceId: string | null | undefined`
  - `position: { x: number; y: number }` (world/canvas coordinates)
  - Optional `size`, `metadata`, `onStateUpdate`
- Components must pass these props down to any internal renderers so runtime state stays accurate.

## 2. Runtime Registration Contract

- Inside each component (or a shared wrapper) call `useComponentRegistration({ workspaceId, componentId, componentType, position, size, metadata, zIndex })`.
- If the component lets the user drag/resize, keep its position/size in React state and feed updates back through the hook so `updateRuntimeComponent` runs.

## 2a. Component Removal Contract

- When a component is closed/deleted via `handleComponentClose`, call `removeRuntimeComponent(workspaceId, componentId)` to remove it from the runtime ledger.
- This ensures closed components don't reappear on workspace switch or reload.
- The removal must happen in `use-component-creation-handler.ts` where `handleComponentClose` is defined.

```typescript
// Example implementation:
const handleComponentClose = useCallback(
  (id: string) => {
    // Remove from runtime ledger first
    if (workspaceKey) {
      removeRuntimeComponent(workspaceKey, id)
    }
    // Then remove from canvas items
    setCanvasItems(prev => prev.filter(item => item.id !== id))
    onComponentChange?.()
  },
  [setCanvasItems, onComponentChange, workspaceKey],
)
```

## 3. Component Panel Integration (`components/canvas/component-panel.tsx`)

- Ensure every component entry (including StickyNote/DragTest/PerformanceTest) supplies `workspaceId`, `position`, and `metadata` props when rendered.
- Infer a default position from the panel’s own position if the component doesn’t provide one yet.
- Listen for `onStateUpdate` and persist meaningful state in the runtime ledger.

## 4. Dev-Mode Guards

- Keep the dev-mode warning that fires when a component renders without a position or workspaceId (prevents silent data loss).
- Consider adding a warning if a component renders without calling `useComponentRegistration` (e.g., by checking the runtime ledger count vs. component items).

## 5. Persistence / Hydration Tests

For each sample component:
1. Create it in Workspace A → switch to Workspace B → switch back. Component must still render with previous state.
2. Reload app (cold start). Component must rehydrate in the same workspace with the same position/state.
3. Exceed runtime cap to evict the workspace → switch back later. Component must reappear (ensures eviction persistence works).

## 6. Documentation & Templates

- Add a template/example component (e.g., `SampleComponent.tsx`) that demonstrates the required props and `useComponentRegistration` usage.
- Document the API expectations (workspaceId, position, state updates) for contributors adding new components.

Following this plan ensures every workspace component—whether production or sample—shares the same runtime lifecycle, eliminating “demo-only” regressions.
