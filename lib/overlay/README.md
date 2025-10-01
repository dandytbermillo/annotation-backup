# Floating Overlay System

Central controller and adapter system for floating notes independence from canvas infrastructure.

## Overview

The floating overlay system provides a capability-based API for managing popup positions, transforms, and layer interactions. It allows floating notes to function with or without a canvas, using adapters to bridge canvas-specific features when available.

## Architecture

```
FloatingOverlayController (lib/overlay/floating-overlay-controller.ts)
  ├── manages popup state (screen-space primary)
  ├── coordinates transform reconciliation
  └── exposes capability-based API

OverlayAdapter Interface (lib/overlay/types.ts)
  ├── CanvasOverlayAdapter (Phase 4) → bridges LayerProvider
  └── IdentityOverlayAdapter (Phase 4) → screen-space only

React Integration (components/overlay/floating-overlay-provider.tsx)
  ├── Context provider for controller access
  └── Hooks for transforms, capabilities, popups
```

## Core Concepts

### Dual Coordinate System

- **Screen-space (overlayPosition)**: Primary coordinate system, always available
- **Canvas-space (canvasPosition)**: Optional precision upgrade when canvas present
- **Reconciliation**: Controller syncs both when transforms change

### Capability Introspection

Adapters declare which features they support. Consumers check capabilities before using features.

```typescript
const capabilities = controller.capabilities

if (capabilities.shortcuts) {
  // Register keyboard shortcuts
}

if (capabilities.resetView) {
  <button onClick={() => controller.resetView()}>Reset</button>
}
```

## Layer Capability Matrix

| Capability | Canvas Adapter | Identity Adapter | Description |
|------------|---------------|------------------|-------------|
| `transforms` | ✅ Always | ✅ Always | Transform stream (pan/zoom/scale) |
| `shortcuts` | ✅ Yes | ❌ No | Keyboard shortcuts for layer switching |
| `layerToggle` | ✅ Yes | ❌ No | Multi-layer support (notes/popups) |
| `persistence` | ✅ Yes | ⚠️ Optional | Layout persistence available |
| `resetView` | ✅ Yes | ❌ No | View reset capability |
| `toggleSidebar` | ✅ Yes | ❌ No | Sidebar toggle |

### Capability Details

#### `transforms` (Required, always true)
- **Purpose**: Provides transform stream for coordinate conversions
- **Available**: Canvas and identity adapters
- **API**: `getTransform()`, `onTransformChange(callback)`
- **When absent**: Never (always available)

#### `shortcuts` (Optional, canvas-only)
- **Purpose**: Keyboard shortcuts for layer operations
- **Available**: Canvas adapter only
- **API**: `registerShortcut(key, handler)`
- **When absent**: Widget hides shortcut-dependent UI

#### `layerToggle` (Optional, canvas-only)
- **Purpose**: Switch between canvas layers (notes, popups)
- **Available**: Canvas adapter only
- **API**: `setActiveLayer(layer)`
- **When absent**: Widget operates in single-layer mode

#### `persistence` (Optional)
- **Purpose**: Save/load layout state
- **Available**: Both adapters (implementation-dependent)
- **API**: N/A (handled by adapter internally)
- **When absent**: Ephemeral state only

#### `resetView` (Optional, canvas-only)
- **Purpose**: Reset canvas view to default position/zoom
- **Available**: Canvas adapter only
- **API**: `resetView()`
- **When absent**: Widget provides local recentre button

#### `toggleSidebar` (Optional, canvas-only)
- **Purpose**: Toggle sidebar visibility
- **Available**: Canvas adapter only
- **API**: `toggleSidebar()`
- **When absent**: Widget hides sidebar toggle

## Usage

### Setup (React)

```typescript
import { FloatingOverlayProvider } from '@/components/overlay/floating-overlay-provider'

function App() {
  return (
    <FloatingOverlayProvider>
      <YourApp />
    </FloatingOverlayProvider>
  )
}
```

### Accessing the Controller

```typescript
import { useOverlayController } from '@/components/overlay/floating-overlay-provider'

function MyComponent() {
  const controller = useOverlayController()
  const capabilities = controller.capabilities

  // Check capability before using
  if (capabilities.resetView) {
    controller.resetView()
  }
}
```

### Subscribing to Transforms

```typescript
import { useOverlayTransform } from '@/components/overlay/floating-overlay-provider'

function MyComponent() {
  const transform = useOverlayTransform()
  // Transform updates automatically when adapter changes
}
```

### Registering Popups

```typescript
import { usePopupRegistration, usePopupPosition } from '@/components/overlay/floating-overlay-provider'

function Popup({ id }: { id: string }) {
  // Register with controller
  usePopupRegistration(id, {
    folderId: null,
    parentId: null,
    canvasPosition: { x: 100, y: 200 },
    overlayPosition: { x: 100, y: 200 },
    level: 0,
  })

  // Update position
  const updatePosition = usePopupPosition(id)

  const handleDrag = (newPosition: { x: number, y: number }) => {
    updatePosition(newPosition) // Screen-space coordinates
  }
}
```

## Adapter Implementation (Phase 4)

### CanvasOverlayAdapter

Bridges existing `LayerProvider` to controller:

```typescript
import { CanvasOverlayAdapter } from '@/lib/overlay/adapters/canvas-overlay-adapter'

const adapter = new CanvasOverlayAdapter(layerContext)
controller.registerAdapter(adapter)
```

**Capabilities:**
- ✅ All capabilities enabled
- Wires LayerProvider transforms, shortcuts, layer toggles
- Provides full canvas integration

### IdentityOverlayAdapter

Screen-space only implementation:

```typescript
import { IdentityOverlayAdapter } from '@/lib/overlay/adapters/identity-overlay-adapter'

const adapter = new IdentityOverlayAdapter()
controller.registerAdapter(adapter)
```

**Capabilities:**
- ✅ `transforms` only (identity transform: `{ x: 0, y: 0, scale: 1 }`)
- ❌ No canvas-specific features
- Suitable for non-canvas routes

## Transform Reconciliation

The controller maintains both coordinate systems and reconciles them on transform changes:

```typescript
// When transform changes from adapter:
1. For each popup, calculate expected screen position from canvas position
2. Compare with actual overlayPosition (drift detection)
3. If drift > 5px:
   - Log warning
   - Update canvasPosition to match overlayPosition (screen is source of truth)
4. Notify all transform listeners
```

**Drift tolerance:** 5 pixels

## API Reference

### FloatingOverlayController

#### Properties
- `capabilities: OverlayCapabilities` - Current adapter capabilities

#### Methods
- `registerAdapter(adapter: OverlayAdapter): void` - Register adapter
- `unregisterAdapter(): void` - Remove current adapter
- `getTransform(): Transform` - Get current transform
- `onTransformChange(callback): () => void` - Subscribe to changes
- `registerPopup(popup): void` - Track popup
- `unregisterPopup(id): void` - Untrack popup
- `updatePopupPosition(id, position): void` - Update popup (screen-space)
- `getPopup(id): OverlayPopupState | undefined` - Get popup state
- `getAllPopups(): OverlayPopupState[]` - Get all popups
- `setActiveLayer(layer): void` - Set active layer (if capable)
- `resetView(): void` - Reset view (if capable)
- `toggleSidebar(): void` - Toggle sidebar (if capable)

### React Hooks

- `useOverlayController()` - Access controller
- `useOverlayTransform()` - Subscribe to transform (auto-updates)
- `useOverlayCapabilities()` - Subscribe to capabilities (auto-updates)
- `usePopupRegistration(id, initialState)` - Register popup
- `usePopupPosition(id)` - Get position updater

## Migration Guide

### From Direct LayerProvider Usage

**Before:**
```typescript
const layerContext = useLayer()
const transform = layerContext?.transforms.popups
```

**After:**
```typescript
const transform = useOverlayTransform()
// Works with or without canvas
```

### From Canvas-Dependent Features

**Before:**
```typescript
layerContext?.resetView()
// Breaks without canvas
```

**After:**
```typescript
const controller = useOverlayController()
if (controller.capabilities.resetView) {
  controller.resetView()
} else {
  // Fallback: local recentre logic
}
```

## Testing

Unit tests: `__tests__/lib/overlay/floating-overlay-controller.test.ts`

```bash
npx jest __tests__/lib/overlay/floating-overlay-controller.test.ts
```

**Coverage:**
- Capability introspection
- Transform management
- Popup lifecycle
- Adapter registration
- Coordinate reconciliation

## Implementation Status

- ✅ **Phase 1**: Overlay host (fallback DOM mount point)
- ✅ **Phase 2**: Schema v2 (dual coordinate storage)
- ✅ **Phase 3**: Controller + context provider (this module)
- ⏭️ **Phase 4**: Canvas & identity adapters
- ⏭️ **Phase 5**: Consumer refactors (NotesExplorer, PopupOverlay)
- ⏭️ **Phase 6**: Migration & hardening

## References

- **Proposal**: `docs/proposal/enhanced/independent_floating_note/proposal.md`
- **Implementation Plan**: `docs/proposal/enhanced/independent_floating_note/IMPLEMENTATION_PLAN.md`
- **Phase 2 Report**: `docs/proposal/enhanced/independent_floating_note/reports/2025-10-01-phase-2-implementation-report.md`
