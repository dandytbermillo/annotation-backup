# Feature Slug: independent_floating_note

## Overview

Make floating notes function independently of canvas infrastructure by separating coordinate systems, introducing capability-based adapters, and establishing screen-space as the primary coordinate system with optional canvas precision when available.

**Status:** Ready for Implementation
**Phase:** Phase 1 Complete, Starting Phase 2
**Estimated Duration:** 5 weeks (1 week per phase)
**Risk Level:** Medium

---

## Senior Engineer Analysis

### Context Understanding

After reading CLAUDE.md and analyzing the proposal with verification against the actual codebase, I've identified the core architectural challenge:

**Problem**: Floating notes (NotesExplorerPhase1, PopupOverlay) are tightly coupled to canvas infrastructure through:
1. `useLayer()` dependency for transforms/shortcuts (line 138 in notes-explorer-phase1.tsx)
2. `CoordinateBridge` requiring canvas transforms (4+ usages in explorer)
3. `PopupOverlay` preferring `#canvas-container` portal target
4. Persistence storing only `canvasPosition` (no screen-space alternative)

**Solution Pattern**: Follow industry patterns (Figma, Miro, Notion) by:
1. Dual coordinate storage (screen + canvas)
2. Capability-based adapter pattern
3. Controller abstraction for coordinate transforms
4. Graceful degradation when canvas absent

### Architecture Decisions

#### 1. Coordinate System Strategy

**Decision**: Dual storage with screen-space as primary

**Rationale**:
- ✅ Backward compatible (keeps existing canvasPosition)
- ✅ Screen-space works without canvas
- ✅ Canvas-space adds precision when available
- ✅ CoordinateBridge already handles bidirectional conversion

**Implementation**:
```typescript
// Schema v2
interface OverlayPopupDescriptor {
  canvasPosition: { x: number, y: number }     // v1 (keep for compat)
  overlayPosition?: { x: number, y: number }   // v2 (new primary)
  // ... other fields
}

// Reconciliation logic
function reconcilePosition(
  overlay: Point,
  canvas: Point,
  transform: Transform
): { primary: Point, drift: number } {
  const derived = CoordinateBridge.canvasToScreen(canvas, transform)
  const drift = Math.hypot(derived.x - overlay.x, derived.y - overlay.y)

  if (drift > TOLERANCE_PX) {
    console.warn(`Transform drift: ${drift}px`)
  }

  // Screen-space is source of truth
  return { primary: overlay || derived, drift }
}
```

#### 2. Controller Architecture

**Decision**: Thin controller with capability introspection

**Rationale**:
- ✅ Avoid god object - adapters do the work
- ✅ Capability pattern allows graceful degradation
- ✅ Similar to existing LayerProvider pattern
- ✅ Context provider for React integration

**Implementation**:
```typescript
// lib/overlay/floating-overlay-controller.ts

export interface OverlayCapabilities {
  transforms: boolean       // Always true
  shortcuts: boolean        // Canvas-only
  layerToggle: boolean     // Canvas-only
  persistence: boolean     // Optional
  resetView: boolean       // Optional
  toggleSidebar: boolean   // Canvas-only
}

export interface Transform {
  x: number
  y: number
  scale: number
}

export class FloatingOverlayController {
  private adapter: OverlayAdapter | null = null
  private popups: Map<string, OverlayPopupState> = new Map()

  get capabilities(): OverlayCapabilities {
    return this.adapter?.capabilities ?? {
      transforms: true,
      shortcuts: false,
      layerToggle: false,
      persistence: false,
      resetView: false,
      toggleSidebar: false,
    }
  }

  registerAdapter(adapter: OverlayAdapter): void {
    this.adapter = adapter
    adapter.onTransformChange((t) => this.handleTransformChange(t))
  }

  getTransform(): Transform {
    return this.adapter?.getTransform() ?? { x: 0, y: 0, scale: 1 }
  }

  updatePopupPosition(id: string, position: Point): void {
    // Store in screen-space
    const popup = this.popups.get(id)
    if (popup) {
      popup.overlayPosition = position
      // Derive canvas position if adapter available
      if (this.adapter) {
        const transform = this.adapter.getTransform()
        popup.canvasPosition = CoordinateBridge.screenToCanvas(
          position,
          transform
        )
      }
      this.persistPopup(popup)
    }
  }

  private handleTransformChange(transform: Transform): void {
    // Reconcile all popups when transform changes
    this.popups.forEach((popup, id) => {
      const { primary, drift } = reconcilePosition(
        popup.overlayPosition,
        popup.canvasPosition,
        transform
      )
      if (drift > TOLERANCE_PX) {
        // Update canvas position to match screen-space
        popup.canvasPosition = CoordinateBridge.screenToCanvas(
          primary,
          transform
        )
        this.persistPopup(popup)
      }
    })
  }
}
```

#### 3. Adapter Pattern

**Decision**: Two adapters - Canvas and Identity

**Rationale**:
- ✅ Clear separation: canvas vs non-canvas
- ✅ CanvasOverlayAdapter wraps existing LayerProvider
- ✅ IdentityOverlayAdapter provides minimal screen-space behavior
- ✅ Stateless adapters - controller holds state

**Implementation**:
```typescript
// lib/overlay/adapters/overlay-adapter.ts (base interface)

export interface OverlayAdapter {
  readonly capabilities: OverlayCapabilities

  getTransform(): Transform
  onTransformChange(callback: (t: Transform) => void): () => void

  // Optional capabilities
  setActiveLayer?(layer: string): void
  registerShortcut?(key: string, handler: () => void): () => void
  resetView?(): void
  toggleSidebar?(): void
}

// lib/overlay/adapters/canvas-overlay-adapter.ts

export class CanvasOverlayAdapter implements OverlayAdapter {
  readonly capabilities: OverlayCapabilities = {
    transforms: true,
    shortcuts: true,
    layerToggle: true,
    persistence: true,
    resetView: true,
    toggleSidebar: true,
  }

  constructor(private layerContext: LayerContextValue) {}

  getTransform(): Transform {
    return this.layerContext.transforms.popups || { x: 0, y: 0, scale: 1 }
  }

  onTransformChange(callback: (t: Transform) => void): () => void {
    // Subscribe to layer transform changes
    const listener = () => callback(this.getTransform())
    // ... wire to layerContext
    return () => {
      // cleanup
    }
  }

  setActiveLayer(layer: string): void {
    this.layerContext.setActiveLayer(layer as 'notes' | 'popups')
  }

  resetView(): void {
    this.layerContext.resetView()
  }

  toggleSidebar(): void {
    this.layerContext.toggleSidebar()
  }
}

// lib/overlay/adapters/identity-overlay-adapter.ts

export class IdentityOverlayAdapter implements OverlayAdapter {
  readonly capabilities: OverlayCapabilities = {
    transforms: true,
    shortcuts: false,
    layerToggle: false,
    persistence: false,
    resetView: false,
    toggleSidebar: false,
  }

  private transform: Transform = { x: 0, y: 0, scale: 1 }
  private listeners: Set<(t: Transform) => void> = new Set()

  getTransform(): Transform {
    return this.transform
  }

  onTransformChange(callback: (t: Transform) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  // No canvas capabilities implemented
}
```

#### 4. React Integration

**Decision**: Context provider with hooks

**Implementation**:
```typescript
// components/overlay/floating-overlay-provider.tsx

const OverlayContext = createContext<FloatingOverlayController | null>(null)

export function FloatingOverlayProvider({ children }: { children: ReactNode }) {
  const controllerRef = useRef(new FloatingOverlayController())
  const [, forceUpdate] = useReducer((x) => x + 1, 0)

  // Auto-register adapter based on context
  const layerContext = useLayer()

  useEffect(() => {
    const controller = controllerRef.current
    let cleanup: (() => void) | undefined

    if (layerContext) {
      const adapter = new CanvasOverlayAdapter(layerContext)
      controller.registerAdapter(adapter)
      cleanup = () => controller.unregisterAdapter(adapter)
    } else {
      const adapter = new IdentityOverlayAdapter()
      controller.registerAdapter(adapter)
      cleanup = () => controller.unregisterAdapter(adapter)
    }

    forceUpdate()
    return cleanup
  }, [layerContext])

  return (
    <OverlayContext.Provider value={controllerRef.current}>
      {children}
    </OverlayContext.Provider>
  )
}

export function useOverlayController(): FloatingOverlayController {
  const controller = useContext(OverlayContext)
  if (!controller) {
    throw new Error('useOverlayController must be used within FloatingOverlayProvider')
  }
  return controller
}
```

### Migration Path

**Phase-by-Phase Strategy** (no feature flags, sequencing is safety net):

```
Phase 1: ✅ COMPLETE
  - Overlay host fallback exists
  - lib/utils/overlay-host.ts provides ensureFloatingOverlayHost()

Phase 2: Schema v2 → Pure data structure change, no behavior
  - Add overlayPosition field to schema
  - Update persistence adapters to read/write both fields
  - Write migration script (backfill overlayPosition)
  - VALIDATION: type-check, unit tests
  - RISK: Low (additive change)

Phase 3: Controller → Parallel infrastructure, not used yet
  - Create FloatingOverlayController
  - Create context provider
  - Unit tests for controller
  - VALIDATION: type-check, unit tests
  - RISK: Low (not consumed yet)

Phase 4: Adapters → Wiring, still optional
  - Create CanvasOverlayAdapter
  - Create IdentityOverlayAdapter
  - Wire to LayerProvider
  - VALIDATION: type-check, unit tests, manual testing
  - RISK: Medium (integration points)

Phase 5: Consumer Refactor → Actual behavior change
  - Refactor NotesExplorerPhase1 to use controller
  - Refactor PopupOverlay to use controller
  - Keep fallback to old code paths
  - VALIDATION: type-check, unit tests, e2e tests
  - RISK: High (behavior changes)

Phase 6: Hardening → Cleanup
  - Remove old code paths
  - Add runtime warnings
  - Integration tests
  - VALIDATION: full test suite
  - RISK: Low (cleanup)
```

---

## Phase Implementation Details

### Phase 2: Screen-Space Persistence Layer

**Duration**: 1 week
**Risk**: Low
**Dependencies**: None

#### Tasks

1. **Update Schema** (Day 1)
   ```typescript
   // lib/types/overlay-layout.ts
   export const OVERLAY_LAYOUT_SCHEMA_VERSION = '2.0.0' // Increment

   export interface OverlayPopupDescriptor {
     id: string
     folderId: string | null
     parentId: string | null
     canvasPosition: OverlayCanvasPosition     // v1 - keep
     overlayPosition?: OverlayCanvasPosition   // v2 - new
     level: number
     height?: number
   }
   ```

2. **Update Persistence Adapter** (Day 2)
   ```typescript
   // lib/adapters/overlay-layout-adapter.ts

   async saveLayout({
     layout,
     version,
     revision,
     userId,
   }: SaveLayoutParams): Promise<OverlayLayoutEnvelope> {
     // Ensure both canvasPosition and overlayPosition are saved
     const enrichedLayout = {
       ...layout,
       popups: layout.popups.map(popup => ({
         ...popup,
         overlayPosition: popup.overlayPosition || popup.canvasPosition
       }))
     }

     // ... rest of save logic
   }
   ```

3. **Write Migration Script** (Day 3)
   ```typescript
   // scripts/migrate-overlay-layout-v2.ts

   async function migrateToV2() {
     const layouts = await loadAllLayouts()

     for (const layout of layouts) {
       if (layout.version === '1.0.0') {
         // Backfill overlayPosition from canvasPosition
         const migrated = {
           ...layout,
           version: '2.0.0',
           popups: layout.popups.map(popup => ({
             ...popup,
             overlayPosition: popup.canvasPosition // Screen = canvas initially
           }))
         }
         await saveLayout(migrated)
       }
     }
   }
   ```

4. **Add Unit Tests** (Day 4-5)
   ```typescript
   // __tests__/lib/types/overlay-layout.test.ts

   describe('Overlay Layout Schema v2', () => {
     it('should support dual coordinate storage', () => {
       const popup: OverlayPopupDescriptor = {
         id: 'test',
         canvasPosition: { x: 100, y: 200 },
         overlayPosition: { x: 150, y: 250 },
         // ...
       }
       expect(popup.overlayPosition).toBeDefined()
     })

     it('should be backward compatible', () => {
       const popup: OverlayPopupDescriptor = {
         id: 'test',
         canvasPosition: { x: 100, y: 200 },
         // overlayPosition omitted
         // ...
       }
       expect(popup.overlayPosition).toBeUndefined()
     })
   })
   ```

#### Validation

```bash
npm run type-check  # Must pass
npm run test        # Must pass
npm run lint        # Must pass
```

#### Files Modified

- `lib/types/overlay-layout.ts`
- `lib/adapters/overlay-layout-adapter.ts`
- `scripts/migrate-overlay-layout-v2.ts` (new)
- `__tests__/lib/types/overlay-layout.test.ts` (new)

#### Acceptance Criteria

- [ ] Schema v2 defined with overlayPosition field
- [ ] Type-check passes (verified with actual output)
- [ ] Unit tests pass (verified with actual output)
- [ ] Migration script written and tested
- [ ] No behavior changes - pure data structure

---

### Phase 3: FloatingOverlayController

**Duration**: 1 week
**Risk**: Low
**Dependencies**: Phase 2

#### Tasks

1. **Create Controller** (Day 1-2)
   ```typescript
   // lib/overlay/floating-overlay-controller.ts

   export class FloatingOverlayController {
     // See "Controller Architecture" section above for full implementation
   }
   ```

2. **Create Context Provider** (Day 3)
   ```typescript
   // components/overlay/floating-overlay-provider.tsx

   // See "React Integration" section above for full implementation
   ```

3. **Add Unit Tests** (Day 4-5)
   ```typescript
   // __tests__/lib/overlay/floating-overlay-controller.test.ts

   describe('FloatingOverlayController', () => {
     it('should report default capabilities without adapter', () => {
       const controller = new FloatingOverlayController()
       expect(controller.capabilities.transforms).toBe(true)
       expect(controller.capabilities.shortcuts).toBe(false)
     })

     it('should update capabilities when adapter registered', () => {
       const controller = new FloatingOverlayController()
       const adapter = new MockCanvasAdapter()
       controller.registerAdapter(adapter)
       expect(controller.capabilities.shortcuts).toBe(true)
     })

     it('should reconcile positions on transform change', () => {
       // Test reconciliation logic
     })
   })
   ```

#### Validation

```bash
npm run type-check
npm run test
npm run lint
```

#### Files Created

- `lib/overlay/floating-overlay-controller.ts`
- `lib/overlay/types.ts`
- `components/overlay/floating-overlay-provider.tsx`
- `lib/overlay/README.md` (capability matrix documentation)
- `__tests__/lib/overlay/floating-overlay-controller.test.ts`

#### Acceptance Criteria

- [ ] Controller class created with capability API
- [ ] Context provider created
- [ ] Unit tests pass (verified with actual output)
- [ ] Type-check passes
- [ ] Capability matrix documented in README
- [ ] Controller exists but not consumed yet

---

### Phase 4: Canvas & Identity Adapters

**Duration**: 1 week
**Risk**: Medium
**Dependencies**: Phase 3

#### Tasks

1. **Create Base Interface** (Day 1)
   ```typescript
   // lib/overlay/adapters/overlay-adapter.ts

   // See "Adapter Pattern" section above
   ```

2. **Create CanvasOverlayAdapter** (Day 2-3)
   ```typescript
   // lib/overlay/adapters/canvas-overlay-adapter.ts

   // See "Adapter Pattern" section above
   ```

3. **Create IdentityOverlayAdapter** (Day 3)
   ```typescript
   // lib/overlay/adapters/identity-overlay-adapter.ts

   // See "Adapter Pattern" section above
   ```

4. **Add Unit Tests** (Day 4-5)
   ```typescript
   // __tests__/lib/overlay/adapters/canvas-overlay-adapter.test.ts

   describe('CanvasOverlayAdapter', () => {
     it('should expose all capabilities', () => {
       const mockLayer = createMockLayerContext()
       const adapter = new CanvasOverlayAdapter(mockLayer)
       expect(adapter.capabilities.shortcuts).toBe(true)
       expect(adapter.capabilities.layerToggle).toBe(true)
     })

     it('should forward transform from LayerProvider', () => {
       const mockLayer = createMockLayerContext()
       mockLayer.transforms.popups = { x: 100, y: 200, scale: 1.5 }
       const adapter = new CanvasOverlayAdapter(mockLayer)
       expect(adapter.getTransform()).toEqual({ x: 100, y: 200, scale: 1.5 })
     })
   })

   // __tests__/lib/overlay/adapters/identity-overlay-adapter.test.ts

   describe('IdentityOverlayAdapter', () => {
     it('should expose minimal capabilities', () => {
       const adapter = new IdentityOverlayAdapter()
       expect(adapter.capabilities.shortcuts).toBe(false)
       expect(adapter.capabilities.layerToggle).toBe(false)
       expect(adapter.capabilities.transforms).toBe(true)
     })
   })
   ```

#### Validation

```bash
npm run type-check
npm run test
npm run lint

# Manual testing
npm run dev
# Open floating notes widget
# Verify adapters register correctly
```

#### Files Created

- `lib/overlay/adapters/overlay-adapter.ts`
- `lib/overlay/adapters/canvas-overlay-adapter.ts`
- `lib/overlay/adapters/identity-overlay-adapter.ts`
- `__tests__/lib/overlay/adapters/canvas-overlay-adapter.test.ts`
- `__tests__/lib/overlay/adapters/identity-overlay-adapter.test.ts`

#### Acceptance Criteria

- [ ] Base OverlayAdapter interface defined
- [ ] CanvasOverlayAdapter wraps LayerProvider
- [ ] IdentityOverlayAdapter provides screen-space only
- [ ] Unit tests pass (verified)
- [ ] Type-check passes
- [ ] Manual testing shows adapters register correctly

---

### Phase 5: Consumer Refactor

**Duration**: 1 week
**Risk**: High
**Dependencies**: Phase 4

#### Tasks

1. **Refactor NotesExplorerPhase1** (Day 1-3)

   **Before** (current code):
   ```typescript
   const layerContext = multiLayerEnabled ? useLayer() : null
   // Direct useLayer usage
   ```

   **After** (using controller):
   ```typescript
   const controller = useOverlayController()
   const { capabilities } = controller

   // Capability-based rendering
   {capabilities.shortcuts && (
     <LayerShortcuts />
   )}

   {capabilities.resetView ? (
     <button onClick={() => controller.adapter?.resetView?.()}>
       Reset View
     </button>
   ) : (
     <button onClick={localResetView}>
       Recenter
     </button>
   )}
   ```

2. **Refactor PopupOverlay** (Day 3-4)

   **Before** (current code):
   ```typescript
   const canvasEl = document.getElementById('canvas-container')
   const layerCtx = useLayer()
   const sharedTransform = layerCtx?.transforms.popups
   ```

   **After** (using controller):
   ```typescript
   const controller = useOverlayController()
   const transform = controller.getTransform()
   const overlayHost = controller.adapter?.getOverlayHost?.() ||
                       ensureFloatingOverlayHost()
   ```

3. **Add E2E Tests** (Day 5)
   ```typescript
   // e2e/floating-notes-independence.spec.ts

   test('floating notes work before canvas mounts', async ({ page }) => {
     await page.goto('/no-canvas-route')
     await page.click('[data-testid="open-floating-notes"]')
     await expect(page.locator('.floating-notes-widget')).toBeVisible()
   })

   test('popup positions persist across canvas mount/unmount', async ({ page }) => {
     // Open popup, record position
     // Unmount canvas
     // Remount canvas
     // Verify popup in same screen position
   })
   ```

#### Validation

```bash
npm run type-check
npm run test
npm run test:e2e
npm run lint

# Manual regression testing
npm run dev
# Test scenarios from proposal lines 92-95
```

#### Files Modified

- `components/notes-explorer-phase1.tsx`
- `components/canvas/popup-overlay.tsx`
- `e2e/floating-notes-independence.spec.ts` (new)

#### Acceptance Criteria

- [ ] NotesExplorerPhase1 uses controller hooks
- [ ] PopupOverlay uses controller transform stream
- [ ] Capability-based rendering works
- [ ] Type-check passes (verified)
- [ ] Unit tests pass (verified)
- [ ] E2E tests pass (verified)
- [ ] Manual regression passes all scenarios

---

### Phase 6: Migration & Hardening

**Duration**: 1 week
**Risk**: Low
**Dependencies**: Phase 5

#### Tasks

1. **Remove Old Code Paths** (Day 1-2)
   - Remove direct `useLayer()` calls from floating notes
   - Remove canvas-container DOM queries
   - Clean up unused imports

2. **Add Runtime Warnings** (Day 2)
   ```typescript
   // In controller
   if (!this.adapter && attemptCanvasFeature) {
     console.warn(
       'Attempted canvas-only feature without adapter registered',
       { feature: 'setActiveLayer', component: 'NotesExplorer' }
     )
   }
   ```

3. **Integration Tests** (Day 3-4)
   ```typescript
   // __tests__/integration/floating-notes-independence.test.ts

   describe('Floating Notes Independence', () => {
     it('should work without canvas mounted', async () => {
       // Render FloatingNotesWidget without canvas
       // Verify transforms, popup positioning
     })

     it('should handle canvas hot reload', async () => {
       // Mount canvas, open popups
       // Unmount canvas
       // Remount canvas
       // Verify popups restored correctly
     })
   })
   ```

4. **Performance Testing** (Day 5)
   - Measure transform reconciliation overhead
   - Test with 100+ popups
   - Profile React renders

#### Validation

```bash
npm run type-check
npm run test
npm run test:integration
npm run test:e2e
npm run lint

# Full validation sequence from CLAUDE.md
./scripts/test-plain-mode.sh
```

#### Files Modified

- `components/notes-explorer-phase1.tsx` (cleanup)
- `components/canvas/popup-overlay.tsx` (cleanup)
- `__tests__/integration/floating-notes-independence.test.ts` (new)
- `docs/proposal/enhanced/independent_floating_note/reports/2025-10-01-phase-6-report.md` (new)

#### Acceptance Criteria

- [ ] All old code paths removed
- [ ] Runtime warnings added
- [ ] Integration tests pass (verified)
- [ ] E2E tests pass (verified)
- [ ] Performance acceptable (<16ms for reconciliation)
- [ ] No regressions in existing functionality

---

## Testing Strategy

### Unit Tests

```typescript
// Controller tests
- FloatingOverlayController capability reporting
- Transform reconciliation logic
- Popup position updates
- Adapter registration/unregistration

// Adapter tests
- CanvasOverlayAdapter wraps LayerProvider correctly
- IdentityOverlayAdapter provides minimal capabilities
- Transform change notifications
- Capability introspection

// Schema tests
- Schema v2 backward compatibility
- Migration logic
```

### Integration Tests

```typescript
// Cross-component scenarios
- Widget opens before canvas mounts
- Popup positions persist across canvas mount/unmount
- Non-canvas routes work
- Canvas hot reload
- Transform reconciliation under load
```

### E2E Tests (Playwright)

```typescript
// Visual regression scenarios
- Popup alignment through zoom
- Browser resize
- Multiple popups
- Drag interactions
- Screen-space persistence
```

### Manual Regression

From proposal lines 92-95:
- [ ] Popups stay aligned through canvas mount/unmount
- [ ] Browser resize maintains positions
- [ ] Zoom doesn't break alignment
- [ ] Hot reload preserves state

---

## Risk Management

### Risk 1: Large File Refactoring

**File**: `components/notes-explorer-phase1.tsx` (43k+ tokens)

**Mitigation**:
- Create backups before each edit pass
- Incremental changes, test after each
- Extract complex logic into hooks
- Don't refactor everything at once

**Backup Strategy** (from CLAUDE.md):
```bash
# Before first edit
cp notes-explorer-phase1.tsx notes-explorer-phase1.tsx.backup

# Before second edit
cp notes-explorer-phase1.tsx notes-explorer-phase1.tsx.backup.1

# Before third edit
cp notes-explorer-phase1.tsx notes-explorer-phase1.tsx.backup.2

# etc.
```

### Risk 2: Transform Drift

**Problem**: Screen and canvas coordinates may diverge

**Mitigation**:
- Reconciliation logic with tolerance threshold
- Log drift warnings
- Unit tests for edge cases
- Screen-space is source of truth

**Monitoring**:
```typescript
const TOLERANCE_PX = 5

if (drift > TOLERANCE_PX) {
  console.warn('Transform drift detected', {
    drift,
    popup: id,
    overlayPos,
    canvasPos,
    transform
  })
}
```

### Risk 3: State Management Complexity

**Problem**: Multiple coordinate systems, adapters, transforms

**Mitigation**:
- CoordinateBridge as single source of truth for conversions
- Controller centralizes state management
- Comprehensive unit tests for each layer
- Debug logging for state changes

### Risk 4: Backward Compatibility

**Problem**: Old code must keep working during migration

**Mitigation**:
- Schema v2 is additive (keeps canvasPosition)
- Controller runs parallel to existing code (Phase 3-4)
- Gradual migration per component (Phase 5)
- Fallback code paths until Phase 6

---

## Rollback Plan

Per proposal line 22: "Feature flags are not part of this rollout; sequencing and testing act as the safety net"

### Phase-by-Phase Rollback

**If Phase 2 fails**:
- Revert schema changes
- Remove overlayPosition field
- Minimal impact (no behavior changes)

**If Phase 3 fails**:
- Remove controller files
- Remove context provider
- No impact on existing code (not consumed yet)

**If Phase 4 fails**:
- Remove adapter files
- Keep controller (dormant)
- No impact on existing code

**If Phase 5 fails**:
- Revert consumer refactors
- Restore old useLayer() usage
- Keep controller/adapters (not breaking anything)

**If Phase 6 fails**:
- Restore old code paths
- Keep both old and new implementations
- Investigate root cause before retry

### Git Strategy

```bash
# Each phase on separate branch
git checkout -b feat/independent-floating-note-phase-2
# ... implement phase 2
git commit -m "feat(overlay): add screen-space persistence (Phase 2)"

# Test, validate, merge
git checkout main
git merge feat/independent-floating-note-phase-2

# Repeat for each phase
```

---

## Dependencies

### External

- None - self-contained refactoring

### Internal

- ✅ Phase 1 complete: `lib/utils/overlay-host.ts` exists
- ✅ `CoordinateBridge` exists and tested
- ✅ `LayerProvider` stable
- ✅ `OverlayLayoutAdapter` exists

---

## Timeline

```
Week 1: Phase 2 - Schema v2
  Mon-Tue: Update schema, persistence adapter
  Wed:     Write migration script
  Thu-Fri: Unit tests, validation

Week 2: Phase 3 - Controller
  Mon-Tue: Create FloatingOverlayController
  Wed:     Create context provider
  Thu-Fri: Unit tests, validation

Week 3: Phase 4 - Adapters
  Mon:     Base interface
  Tue-Wed: CanvasOverlayAdapter
  Wed:     IdentityOverlayAdapter
  Thu-Fri: Unit tests, manual testing

Week 4: Phase 5 - Consumer Refactor
  Mon-Wed: Refactor NotesExplorerPhase1
  Wed-Thu: Refactor PopupOverlay
  Fri:     E2E tests, manual regression

Week 5: Phase 6 - Hardening
  Mon-Tue: Remove old code paths
  Tue:     Runtime warnings
  Wed-Thu: Integration tests
  Fri:     Performance testing, documentation
```

---

## Success Metrics

### Phase 2
- ✅ Schema v2 defined
- ✅ Type-check passes
- ✅ Unit tests pass
- ✅ Migration script works

### Phase 3
- ✅ Controller created
- ✅ Context provider created
- ✅ Unit tests pass
- ✅ Capability matrix documented

### Phase 4
- ✅ Both adapters created
- ✅ Unit tests pass
- ✅ Manual testing passes
- ✅ Type-check passes

### Phase 5
- ✅ Consumers refactored
- ✅ Type-check passes
- ✅ Unit tests pass
- ✅ E2E tests pass
- ✅ Manual regression passes

### Phase 6
- ✅ Old code removed
- ✅ Integration tests pass
- ✅ Performance acceptable
- ✅ No regressions

---

## Open Questions

From proposal lines 97-99 (Open Questions section):

1. **Multiple overlay surfaces simultaneously?**
   - Answer in Phase 3: Controller supports single adapter only initially
   - Future: Add multi-adapter registration if needed

2. **Screen-space persistence + collaborative sessions?**
   - Defer to Option B (Yjs collaboration phase)
   - Out of scope for Option A (offline, single-user)

---

## Next Steps

1. ✅ Read CLAUDE.md - Complete
2. ✅ Verify proposal - Complete (see VERIFICATION_REPORT.md)
3. ✅ Create feature workspace structure - Complete
4. ✅ Write IMPLEMENTATION_PLAN.md - Complete
5. ⏭️ Begin Phase 2 implementation
   - Start with schema v2
   - Follow validation gates
   - Write implementation report

---

## References

- Proposal: `docs/proposal/enhanced/independent_floating_note/proposal.md`
- Verification: `docs/proposal/enhanced/independent_floating_note/VERIFICATION_REPORT.md`
- CLAUDE.md: Project conventions
- Existing code:
  - `lib/utils/overlay-host.ts` (Phase 1 foundation)
  - `lib/utils/coordinate-bridge.ts` (coordinate conversions)
  - `components/canvas/layer-provider.tsx` (existing pattern)
  - `lib/types/overlay-layout.ts` (schema v1)
  - `components/notes-explorer-phase1.tsx` (consumer)
  - `components/canvas/popup-overlay.tsx` (consumer)

---

**Implementation Status**: Ready to begin Phase 2
**Last Updated**: 2025-10-01
**Author**: Claude (Senior Engineer Analysis)
