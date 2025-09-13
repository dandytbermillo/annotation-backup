# Multi-Layer Canvas System Implementation Plan

## Executive Summary
Implementation of a three-layer canvas architecture that separates UI controls, note workspace, and folder navigation overlays into independent, interactive layers.

## Architecture Overview

### Layer Structure
```
Layer 0: Fixed UI Chrome (Sidebar)
├── Z-index: 1000
├── Position: Fixed viewport left
├── Contains: Tree view, search, controls
└── Behavior: Never pans, can hide/show

Layer 1: Notes Canvas  
├── Z-index: 1
├── Position: Pannable/zoomable
├── Contains: Note panels, annotations
└── Behavior: Primary workspace

Layer 2: Popup Overlay
├── Z-index: 100  
├── Position: Independent pan space
├── Contains: Cascading folder popups
└── Behavior: Can pan separately or sync
```

## Phase 0: Preparation & Migration Strategy (Week 0.5)

### 0.1 Feature Flag System (reuse existing runtime flags)
```typescript
// lib/offline/feature-flags.ts already provides a runtime-togglable system.
// Add a new key: 'ui.multiLayerCanvas' and gate overlay logic with it.

import { useFeatureFlag } from '@/lib/offline/feature-flags'

export function NotesExplorer() {
  const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas' as any)
  return multiLayerEnabled ? <MultiLayerCanvas /> : <CurrentImplementation />
}
```

### 0.2 State Migration Adapter
```typescript
// lib/adapters/popup-state-adapter.ts
export class PopupStateAdapter {
  // Convert existing Map-based state to layered architecture
  static toLayeredState(
    hoverPopovers: Map<string, CurrentPopupState>,
    currentTransform: Transform
  ): CanvasState {
    const popupLayer: LayerState = {
      id: 'popups',
      visible: hoverPopovers.size > 0,
      locked: false,
      opacity: 1,
      transform: currentTransform
    }
    
    return {
      activeLayer: hoverPopovers.size > 0 ? 'popups' : 'notes',
      layers: new Map([
        ['sidebar', { 
          id: 'sidebar',
          visible: true,
          locked: true,
          opacity: 1,
          transform: { x: 0, y: 0, scale: 1 }
        }],
        ['notes', {
          id: 'notes',
          visible: true,
          locked: false,
          opacity: hoverPopovers.size > 0 ? 0.6 : 1,
          transform: currentTransform
        }],
        ['popups', popupLayer]
      ]),
      syncPan: true,
      syncZoom: true,
      popups: hoverPopovers // Keep original for backward compatibility
    }
  }
  
  // Backward compatibility during migration
  static fromLayeredState(canvasState: CanvasState): Map<string, CurrentPopupState> {
    return canvasState.popups || new Map()
  }
}
```

### 0.3 Coordinate System Bridge (Fixed APIs)
```typescript
// lib/utils/coordinate-bridge.ts
export class CoordinateBridge {
  private static migrationMode: 'screen' | 'canvas' | 'hybrid' = 'hybrid'
  
  // FIXED: Added missing static methods
  static screenToCanvas(point: Point, transform: Transform): Point {
    return {
      x: (point.x - transform.x) / transform.scale,
      y: (point.y - transform.y) / transform.scale
    }
  }
  
  static canvasToScreen(point: Point, transform: Transform): Point {
    return {
      x: point.x * transform.scale + transform.x,
      y: point.y * transform.scale + transform.y
    }
  }
  
  // FIXED: Single transformation approach (no double scaling)
  static canvasToScreenPosition(point: Point, transform: Transform): Point {
    // Position only - scale applied via CSS transform
    return {
      x: point.x + transform.x,
      y: point.y + transform.y
    }
  }
  
  // Gradually migrate positions from screen to canvas
  static migratePosition(
    screenPos: Point,
    layerTransform: Transform
  ): { canvas: Point, screen: Point } {
    const canvas = this.screenToCanvas(screenPos, layerTransform)
    return { canvas, screen: screenPos }
  }
  
  // FIXED: Now uses static methods correctly
  static preserveRelativePositions(
    popups: Map<string, PopupState>,
    oldTransform: Transform,
    newTransform: Transform
  ): Map<string, PopupState> {
    const updated = new Map()
    
    popups.forEach((popup, id) => {
      const canvasPos = this.screenToCanvas(popup.position, oldTransform)
      const newScreenPos = this.canvasToScreenPosition(canvasPos, newTransform)
      
      updated.set(id, {
        ...popup,
        canvasPosition: canvasPos,
        position: newScreenPos // Position only, no scale
      })
    })
    
    return updated
  }
}

### 0.4 Design Tokens for Z-Index (Normalized)
```typescript
// lib/constants/z-index.ts
// FIXED: Consistent z-index values across all documentation
export const Z_INDEX = {
  // Base layers - normalized values
  NOTES_CANVAS: 1,
  POPUP_OVERLAY: 100,  // Base for popup layer
  SIDEBAR: 1000,       // Always above content
  
  // Popup specifics - consistent with overlay base
  POPUP_BASE: 100,     // Same as POPUP_OVERLAY for consistency
  POPUP_LEVEL_INCREMENT: 10,
  POPUP_DRAGGING_BOOST: 1000,
  
  // UI elements
  DROPDOWN: 1500,
  TOAST: 2000,
  MODAL: 3000
} as const

// Helper to ensure consistency
export const getLayerZIndex = (layer: 'notes' | 'popups' | 'sidebar'): number => {
  switch (layer) {
    case 'notes': return Z_INDEX.NOTES_CANVAS
    case 'popups': return Z_INDEX.POPUP_OVERLAY
    case 'sidebar': return Z_INDEX.SIDEBAR
  }
}
```

## Phase 1: Foundation (Week 1)

### 1.1 Layer Management System with Compatibility
```typescript
interface LayerState {
  id: 'sidebar' | 'notes' | 'popups'
  visible: boolean
  locked: boolean
  opacity: number
  transform: {
    x: number
    y: number
    scale: number
  }
}

interface CanvasState {
  activeLayer: 'notes' | 'popups'
  layers: Map<string, LayerState>
  syncPan: boolean
  syncZoom: boolean
  // Migration compatibility
  popups?: Map<string, any> // Keep old state during migration
  migrationMode?: 'legacy' | 'hybrid' | 'new'
}
```

### 1.2 Parallel State Management
```typescript
// Keep existing state operational while adding new system
const [hoverPopovers, setHoverPopovers] = useState<Map<string, CurrentPopupState>>(new Map())

// FIXED: Use repo feature flags (runtime-togglable)
const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas' as any)

// Add new canvas state in parallel
const [canvasState, setCanvasState] = useState<CanvasState | null>(
  multiLayerEnabled ? {
    activeLayer: 'notes',
    layers: new Map([
      ['sidebar', { /* ... */ }],
      ['notes', { /* ... */ }],
      ['popups', { /* ... */ }]
    ]),
    syncPan: true,
    syncZoom: true,
    migrationMode: 'hybrid'
  } : null
)

// Sync states during migration period
useEffect(() => {
  if (multiLayerEnabled && canvasState?.migrationMode === 'hybrid') {
    const adapted = PopupStateAdapter.toLayeredState(hoverPopovers, currentTransform)
    setCanvasState(prev => ({ ...prev, ...adapted }))
  }
}, [hoverPopovers, multiLayerEnabled])
```

### 1.3 UI Layer State Management (Ephemeral)
```typescript
// lib/state/ui-layer-state.ts
// FIXED: Ephemeral UI state instead of localStorage persistence
// Complies with PostgreSQL-only persistence policy

export class UILayerState {
  private static instance: UILayerState
  private state: CanvasState | null = null
  
  private constructor() {
    this.state = this.getDefaultState()
  }
  
  static getInstance(): UILayerState {
    if (!this.instance) {
      this.instance = new UILayerState()
    }
    return this.instance
  }
  
  private getDefaultState(): CanvasState {
    return {
      activeLayer: 'notes',
      syncPan: true,
      syncZoom: true,
      layers: new Map([
        ['sidebar', {
          id: 'sidebar',
          visible: true,
          locked: true,
          opacity: 1,
          transform: { x: 0, y: 0, scale: 1 }
        }],
        ['notes', {
          id: 'notes',
          visible: true,
          locked: false,
          opacity: 1,
          transform: { x: 0, y: 0, scale: 1 }
        }],
        ['popups', {
          id: 'popups',
          visible: true,
          locked: false,
          opacity: 1,
          transform: { x: 0, y: 0, scale: 1 }
        }]
      ])
    }
  }
  
  get(): CanvasState {
    return this.state || this.getDefaultState()
  }
  
  update(updates: Partial<CanvasState>): void {
    this.state = { ...this.state, ...updates }
  }
  
  updateLayer(layerId: LayerId, updates: Partial<LayerState>): void {
    const layer = this.state?.layers.get(layerId)
    if (layer) {
      this.state?.layers.set(layerId, { ...layer, ...updates })
    }
  }
  
  reset(): void {
    this.state = this.getDefaultState()
  }
}

// React hook for UI state
export const useUILayerState = () => {
  const [state, setState] = useState<CanvasState>(() => 
    UILayerState.getInstance().get()
  )
  
  const updateState = useCallback((updates: Partial<CanvasState>) => {
    UILayerState.getInstance().update(updates)
    setState(UILayerState.getInstance().get())
  }, [])
  
  const updateLayer = useCallback((layerId: LayerId, updates: Partial<LayerState>) => {
    UILayerState.getInstance().updateLayer(layerId, updates)
    setState(UILayerState.getInstance().get())
  }, [])
  
  const resetState = useCallback(() => {
    UILayerState.getInstance().reset()
    setState(UILayerState.getInstance().get())
  }, [])
  
  return { state, updateState, updateLayer, resetState }
}

// Optional: PostgreSQL-backed preferences for persistent settings
// api/layer-preferences.ts
interface LayerPreferences {
  defaultActiveLayer?: 'notes' | 'popups'
  defaultSyncPan?: boolean
  defaultSyncZoom?: boolean
  sidebarVisible?: boolean
}

export async function saveLayerPreferences(
  userId: string, 
  prefs: LayerPreferences
): Promise<void> {
  // Parameterized query for security
  await db.query(
    `INSERT INTO user_preferences (user_id, preference_key, preference_value) 
     VALUES ($1, $2, $3) 
     ON CONFLICT (user_id, preference_key) 
     DO UPDATE SET preference_value = $3, updated_at = NOW()`,
    [userId, 'layer_preferences', JSON.stringify(prefs)]
  )
}

export async function loadLayerPreferences(
  userId: string
): Promise<LayerPreferences | null> {
  const result = await db.query(
    `SELECT preference_value FROM user_preferences 
     WHERE user_id = $1 AND preference_key = $2`,
    [userId, 'layer_preferences']
  )
  
  if (result.rows.length > 0) {
    return JSON.parse(result.rows[0].preference_value)
  }
  return null
}
```

## Phase 2: Layer Controls (Week 1-2)

### 2.1 Sidebar Controls
```tsx
// New component: LayerControls.tsx
<LayerControls>
  <LayerToggle layer="notes" />
  <LayerToggle layer="popups" />
  <OpacitySlider layer="popups" />
  <SyncToggle type="pan" />
  <SyncToggle type="zoom" />
  <ResetView />
</LayerControls>
```

### 2.2 Cross-Platform Keyboard Shortcuts
```typescript
// lib/hooks/use-keyboard-shortcuts.ts
import { useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

// FIXED: Cross-platform key detection
const getPlatformModifier = (): string => {
  if (typeof navigator === 'undefined') return 'Control'
  
  const platform = navigator.platform?.toLowerCase() || ''
  const userAgent = navigator.userAgent?.toLowerCase() || ''
  
  if (platform.includes('mac') || userAgent.includes('mac')) {
    return 'Meta'
  }
  return 'Control'
}

export const useLayerKeyboardShortcuts = (callbacks: {
  toggleLayer: () => void
  switchToNotes: () => void
  switchToPopups: () => void
  toggleSidebar: () => void
  resetView: () => void
}) => {
  // Use 'mod' for cross-platform compatibility (Cmd on Mac, Ctrl elsewhere)
  useHotkeys('tab', callbacks.toggleLayer, { preventDefault: true })
  useHotkeys('escape', callbacks.switchToNotes)
  useHotkeys('mod+1', callbacks.switchToNotes)
  useHotkeys('mod+2', callbacks.switchToPopups)
  useHotkeys('mod+b', callbacks.toggleSidebar)
  useHotkeys('mod+0', callbacks.resetView)
  
  // Manual drag modifier detection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) {
        document.body.dataset.dragMode = 'popup-only'
      } else if (e.code === 'Space') {
        document.body.dataset.dragMode = 'active-layer'
      }
    }
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey && e.code !== 'Space') {
        delete document.body.dataset.dragMode
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])
}

// Display shortcuts with platform-appropriate symbols
export const getShortcutDisplay = () => {
  const isMac = getPlatformModifier() === 'Meta'
  const mod = isMac ? '⌘' : 'Ctrl'
  
  return {
    'Tab': 'Toggle between layers',
    'Escape': 'Focus notes canvas',
    [`${mod}+1`]: 'Focus notes layer',
    [`${mod}+2`]: 'Focus popups layer',
    [`${mod}+B`]: 'Toggle sidebar',
    'Alt+Drag': 'Pan only popup layer',
    'Space+Drag': 'Pan active layer',
    [`${mod}+0`]: 'Reset view'
  }
}
```

### 2.3 Pan/Zoom Handlers
```typescript
const handlePan = (deltaX: number, deltaY: number, event: MouseEvent) => {
  const isAltPressed = event.altKey
  const activeLayer = canvasState.activeLayer
  
  if (isAltPressed) {
    // Pan only popup layer
    updateLayerTransform('popups', deltaX, deltaY)
  } else if (canvasState.syncPan) {
    // Pan both layers together
    updateLayerTransform('notes', deltaX, deltaY)
    updateLayerTransform('popups', deltaX, deltaY)
  } else {
    // Pan only active layer
    updateLayerTransform(activeLayer, deltaX, deltaY)
  }
}
```

## Phase 3: Popup Integration (Week 2)

### 3.1 Canvas Coordinate System (use CoordinateBridge)
```typescript
// Shared helpers prevent drift in math implementations
const toCanvas = (p: Point, t: Transform) => CoordinateBridge.screenToCanvas(p, t)
const toScreen = (p: Point, t: Transform) => CoordinateBridge.canvasToScreen(p, t)
```

### 3.2 Popup Positioning Updates
```typescript
const handleFolderHover = async (
  folder: TreeNode, 
  event: React.MouseEvent,
  parentPopoverId?: string
) => {
  const rect = event.currentTarget.getBoundingClientRect()
  const popupLayer = canvasState.layers.get('popups')
  if (!popupLayer) return
  
  // Calculate canvas position (consistent helper)
  const canvasPos = CoordinateBridge.screenToCanvas({ x: rect.right + 10, y: rect.top }, popupLayer.transform)
  
  // Store in canvas coordinates
  setHoverPopovers(prev => {
    const newMap = new Map(prev)
    newMap.set(popoverId, {
      // ... other properties
      canvasPosition: canvasPos,
      // Screen position calculated during render
    })
    return newMap
  })
}
```

### 3.3 Connection Line Compatibility Layer (canvas coords under container transform)
```typescript
// lib/rendering/connection-line-adapter.ts

interface PathData { d: string; stroke: string; strokeWidth: number; opacity: number }

export class ConnectionLineAdapter {
  static adaptConnectionLines(
    popups: Map<string, PopupState>,
    isDragging: boolean
  ): PathData[] {
    const paths: PathData[] = []
    popups.forEach((popup) => {
      if (!popup.parentId) return
      const parent = popups.get(popup.parentId)
      if (!parent || !popup.canvasPosition || !parent.canvasPosition) return
      const start = parent.canvasPosition
      const end = popup.canvasPosition
      const controlPointOffset = 50
      const midX = (start.x + end.x) / 2
      const d = `M ${start.x} ${start.y} C ${start.x + controlPointOffset} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`
      paths.push({
        d,
        stroke: isDragging ? 'rgba(59,130,246,1)' : 'rgba(59,130,246,0.6)',
        strokeWidth: isDragging ? 3 : 2,
        opacity: isDragging ? 1 : 0.7,
      })
    })
    return paths
  }
}
```

### 3.4 Z-Index Management with Design Tokens
```typescript
// lib/utils/z-index-manager.ts
import { Z_INDEX } from '@/lib/constants/z-index'

export class ZIndexManager {
  static getPopupZIndex(
    popupLevel: number,
    isDragging: boolean,
    useMultiLayer: boolean
  ): number {
    if (!useMultiLayer) {
      // Legacy z-index calculation for backward compatibility
      return 9999 + popupLevel + (isDragging ? 1000 : 0)
    }
    
    // New layered z-index using design tokens
    const baseZ = Z_INDEX.POPUP_BASE
    const levelOffset = popupLevel * Z_INDEX.POPUP_LEVEL_INCREMENT
    const dragOffset = isDragging ? Z_INDEX.POPUP_DRAGGING_BOOST : 0
    
    return baseZ + levelOffset + dragOffset
  }
  
  static reconcileZIndices(
    elements: HTMLElement[],
    migrationMode: 'legacy' | 'hybrid' | 'new'
  ): void {
    elements.forEach((el, index) => {
      const isPopup = el.classList.contains('popup')
      const isDragging = el.dataset.dragging === 'true'
      const level = parseInt(el.dataset.level || '0')
      
      el.style.zIndex = String(
        this.getPopupZIndex(level, isDragging, migrationMode !== 'legacy')
      )
    })
  }
}
```

### 3.5 Render Updates with Proper Pointer Events (single container transform)
```tsx
// Container applies translate/scale; children use canvas coordinates (no per-node scale)
const PopupOverlay: React.FC = () => {
  const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas' as any)
  const popupLayer = canvasState?.layers.get('popups')
  if (!multiLayerEnabled || !popupLayer) return null

  return (
    <div
      id="popup-overlay"
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: Z_INDEX.POPUP_OVERLAY, ...CoordinateBridge.containerTransformStyle(popupLayer.transform) }}
    >
      {/* Connection lines (canvas coords) */}
      <svg className="absolute inset-0 pointer-events-none">
        {ConnectionLineAdapter.adaptConnectionLines(hoverPopovers, !!draggingPopup).map((p, i) => (
          <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} opacity={p.opacity} fill="none" />
        ))}
      </svg>

      {/* Popups (canvas coords) */}
      {Array.from(hoverPopovers.values()).map((popover) => {
        if (!popover.canvasPosition) return null
        const zIndex = ZIndexManager.getPopupZIndex(popover.level, !!popover.isDragging, true)
        return (
          <div
            key={popover.id}
            id={`popup-${popover.id}`}
            className="absolute bg-gray-800 border border-gray-700 rounded-lg shadow-xl pointer-events-auto"
            style={{ left: `${popover.canvasPosition.x}px`, top: `${popover.canvasPosition.y}px`, zIndex, opacity: canvasState?.activeLayer === 'notes' ? 0.6 : 1 }}
          >
            {/* Popup content */}
          </div>
        )
      })}
    </div>
  )
}
```

## Phase 4: Auto-Switch Logic (Week 2-3)

### 4.1 Layer Auto-Detection
```typescript
// Auto-switch when last popup closes
useEffect(() => {
  if (hoverPopovers.size === 0 && canvasState.activeLayer === 'popups') {
    // Enhanced visual feedback when switching
    const lastPopupClosing = true
    
    if (lastPopupClosing) {
      showToast("Returning to notes canvas")
      
      // Smooth transition animation
      fadeOutPopupLayer()
      fadeInNotesCanvas()
      
      // After animation completes
      setTimeout(() => {
        setCanvasState(prev => ({
          ...prev,
          activeLayer: 'notes'
        }))
      }, 300) // Match animation duration
    }
  }
}, [hoverPopovers.size])

// Auto-switch when opening first popup
useEffect(() => {
  if (hoverPopovers.size === 1 && canvasState.activeLayer === 'notes') {
    setCanvasState(prev => ({
      ...prev,
      activeLayer: 'popups'
    }))
  }
}, [hoverPopovers.size])
```

### 4.2 Visual Feedback
```typescript
// Layer transition animations
const layerTransitionStyle = {
  transition: 'opacity 0.3s ease, filter 0.3s ease',
  opacity: isActiveLayer ? 1 : 0.6,
  filter: isActiveLayer ? 'none' : 'brightness(0.8)',
  pointerEvents: isActiveLayer ? 'auto' : 'none'
}

// Animation functions
const fadeOutPopupLayer = () => {
  const popupLayer = document.getElementById('popup-overlay')
  if (popupLayer) {
    popupLayer.style.transition = 'opacity 0.3s ease-out'
    popupLayer.style.opacity = '0'
  }
}

const fadeInNotesCanvas = () => {
  const notesCanvas = document.getElementById('notes-canvas')
  if (notesCanvas) {
    notesCanvas.style.transition = 'opacity 0.3s ease-in, filter 0.3s ease'
    notesCanvas.style.opacity = '1'
    notesCanvas.style.filter = 'none'
  }
}

// Toast notification function
const showToast = (message: string) => {
  const toast = document.createElement('div')
  toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50'
  toast.textContent = message
  document.body.appendChild(toast)
  
  // Animate in
  toast.style.opacity = '0'
  toast.style.transform = 'translateY(10px)'
  toast.style.transition = 'all 0.3s ease'
  
  setTimeout(() => {
    toast.style.opacity = '1'
    toast.style.transform = 'translateY(0)'
  }, 10)
  
  // Remove after 2 seconds
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transform = 'translateY(10px)'
    setTimeout(() => toast.remove(), 300)
  }, 2000)
}
```

### 4.3 Click-Through Logic
```typescript
const handleCanvasClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  
  // Check if clicking on empty space
  if (target.classList.contains('canvas-background')) {
    if (canvasState.activeLayer === 'popups') {
      setCanvasState(prev => ({
        ...prev,
        activeLayer: 'notes'
      }))
    }
  }
}
```

## Phase 5: Visual Indicators (Week 3)

### 5.1 Layer Status UI
```tsx
// Visual indicator component
<LayerIndicator>
  <div className={`layer-tab ${activeLayer === 'notes' ? 'active' : ''}`}>
    📝 Notes Canvas
  </div>
  <div className={`layer-tab ${activeLayer === 'popups' ? 'active' : ''}`}>
    📁 Popup Overlay ({hoverPopovers.size})
  </div>
</LayerIndicator>
```

### 5.2 Sidebar Integration
```tsx
// Add to sidebar
<div className="layer-controls p-4 border-t">
  <h3 className="text-sm font-semibold mb-2">View Controls</h3>
  
  <div className="space-y-2">
    <button 
      onClick={() => toggleLayer('popups')}
      className="flex items-center gap-2"
    >
      <Eye className={popupsVisible ? 'text-blue-400' : 'text-gray-400'} />
      <span>Popups {hoverPopovers.size > 0 ? `(${hoverPopovers.size})` : ''}</span>
    </button>
    
    <button
      onClick={() => toggleSyncPan()}
      className="flex items-center gap-2"
    >
      <Link className={syncPan ? 'text-blue-400' : 'text-gray-400'} />
      <span>Sync Pan</span>
    </button>
    
    <button onClick={resetView} className="flex items-center gap-2">
      <RotateCcw className="text-gray-400" />
      <span>Reset View</span>
    </button>
  </div>
</div>
```

## Phase 6: Performance Optimization (Week 3-4)

### 6.1 Viewport Culling
```typescript
const isInViewport = (
  position: { x: number, y: number },
  size: { width: number, height: number },
  viewport: { x: number, y: number, width: number, height: number }
): boolean => {
  return !(
    position.x + size.width < viewport.x ||
    position.x > viewport.x + viewport.width ||
    position.y + size.height < viewport.y ||
    position.y > viewport.y + viewport.height
  )
}

// Only render visible popups (convert via CoordinateBridge)
const visiblePopups = Array.from(hoverPopovers.values()).filter(popup => {
  if (!popupLayer || !popup.canvasPosition) return false
  const screenPos = CoordinateBridge.canvasToScreen(popup.canvasPosition, popupLayer.transform)
  return isInViewport(screenPos, { width: 300, height: 400 }, viewport)
})
```

### 6.2 Debounced Updates
```typescript
const debouncedPan = useMemo(
  () => debounce((deltaX: number, deltaY: number) => {
    updateLayerTransform(activeLayer, deltaX, deltaY)
  }, 16), // 60fps
  [activeLayer]
)
```

## Testing Strategy

### Unit Tests
```typescript
// tests/unit/coordinate-bridge.test.ts
describe('CoordinateBridge', () => {
  it('should convert screen to canvas coordinates correctly', () => {
    const screenPos = { x: 500, y: 300 }
    const transform = { x: 100, y: 50, scale: 1.5 }
    const result = CoordinateBridge.migratePosition(screenPos, transform)
    
    expect(result.canvas).toEqual({
      x: (500 - 100) / 1.5,  // 266.67
      y: (300 - 50) / 1.5    // 166.67
    })
    expect(result.screen).toEqual(screenPos)
  })
  
  it('should preserve relative positions during transform changes', () => {
    const popups = new Map([
      ['p1', { position: { x: 100, y: 100 } }],
      ['p2', { position: { x: 200, y: 150 } }]
    ])
    const oldTransform = { x: 0, y: 0, scale: 1 }
    const newTransform = { x: 50, y: 25, scale: 1.2 }
    
    const migrated = CoordinateBridge.preserveRelativePositions(
      popups, oldTransform, newTransform
    )
    
    // Verify relative distances are maintained
    const p1 = migrated.get('p1')
    const p2 = migrated.get('p2')
    const relativeDistance = Math.sqrt(
      Math.pow(p2.canvasPosition.x - p1.canvasPosition.x, 2) +
      Math.pow(p2.canvasPosition.y - p1.canvasPosition.y, 2)
    )
    
    expect(relativeDistance).toBeCloseTo(111.8, 1) // Original distance
  })
})

// tests/unit/z-index-manager.test.ts
describe('ZIndexManager', () => {
  it('should maintain backward compatibility in legacy mode', () => {
    const legacyZ = ZIndexManager.getPopupZIndex(2, false, false)
    expect(legacyZ).toBe(10001) // 9999 + 2
    
    const dragZ = ZIndexManager.getPopupZIndex(2, true, false)
    expect(dragZ).toBe(11001) // 9999 + 2 + 1000
  })
  
  it('should use new z-index system in multi-layer mode', () => {
    const layeredZ = ZIndexManager.getPopupZIndex(2, false, true)
    expect(layeredZ).toBe(1020) // 1000 + 20
    
    const dragZ = ZIndexManager.getPopupZIndex(2, true, true)
    expect(dragZ).toBe(2020) // 1000 + 20 + 1000
  })
})
```

### Integration Tests
```typescript
// tests/integration/layer-switching.test.tsx
describe('Layer Switching', () => {
  // FIXED: Use FeatureFlagsProvider in tests
  const renderWithFeatureFlags = (component: React.ReactElement) => {
    return render(
      <FeatureFlagsProvider testMode={true}>
        {component}
      </FeatureFlagsProvider>
    )
  }
  
  it('should auto-switch to popup layer when first popup opens', async () => {
    const { getByTestId, queryByTestId } = render(<NotesExplorer />)
    
    // Initially on notes layer
    expect(getByTestId('active-layer')).toHaveTextContent('notes')
    
    // Hover to open popup
    const folderEye = getByTestId('folder-eye-documents')
    fireEvent.mouseEnter(folderEye)
    
    // Wait for popup
    await waitFor(() => {
      expect(queryByTestId('popup-1')).toBeInTheDocument()
    })
    
    // Should auto-switch to popup layer
    expect(getByTestId('active-layer')).toHaveTextContent('popups')
  })
  
  it('should return to notes when last popup closes', async () => {
    const { getByTestId, queryByTestId } = render(<NotesExplorer />)
    
    // Open popup
    const folderEye = getByTestId('folder-eye-documents')
    fireEvent.mouseEnter(folderEye)
    await waitFor(() => expect(queryByTestId('popup-1')).toBeInTheDocument())
    
    // Close popup
    const closeButton = getByTestId('popup-close-1')
    fireEvent.click(closeButton)
    
    // Should show toast and switch back
    await waitFor(() => {
      expect(queryByTestId('toast')).toHaveTextContent('Returning to notes canvas')
      expect(getByTestId('active-layer')).toHaveTextContent('notes')
    })
  })
})

// tests/integration/coordinate-migration.test.tsx
describe('Coordinate Migration', () => {
  it('should maintain popup positions when enabling multi-layer mode', async () => {
    // FIXED: Use FeatureFlagsProvider instead of process.env
    const { rerender, getByTestId } = render(
      <FeatureFlagsProvider testMode={true}>
        <NotesExplorer />
      </FeatureFlagsProvider>
    )
    
    // Start with feature disabled
    act(() => {
      // Access test-only toggle function
      window.testHelpers.toggleFeature('MULTI_LAYER_CANVAS', false)
    })
    
    // Open popups
    const popup1 = await openPopup('documents')
    const originalPos1 = getPopupPosition(popup1)
    
    // Enable multi-layer mode
    act(() => {
      window.testHelpers.toggleFeature('MULTI_LAYER_CANVAS', true)
    })
    
    rerender(
      <FeatureFlagsProvider testMode={true}>
        <NotesExplorer />
      </FeatureFlagsProvider>
    )
    
    // Positions should be preserved
    const migratedPos1 = getPopupPosition(popup1)
    expect(migratedPos1).toEqual(originalPos1)
  })
})
```

### Performance Tests (Realistic Approach)
```typescript
// tests/performance/layer-performance.test.ts
// FIXED: Realistic performance testing approaches

// Option A: Playwright-based real browser testing
// tests/e2e/performance.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Performance Tests', () => {
  test('maintains smooth performance with 50 popups', async ({ page }) => {
    await page.goto('/test/performance')
    
    // Use Performance API in real browser
    const metrics = await page.evaluate(async () => {
      // Start performance monitoring
      performance.mark('test-start')
      
      // Create 50 popups programmatically
      for (let i = 0; i < 50; i++) {
        window.testHelpers.createPopup(i, {
          x: Math.random() * 1000,
          y: Math.random() * 800
        })
      }
      
      // Measure popup creation
      performance.mark('popups-created')
      performance.measure('popup-creation', 'test-start', 'popups-created')
      
      // Pan operation
      performance.mark('pan-start')
      await window.testHelpers.panLayer('popups', 100, 100)
      performance.mark('pan-end')
      performance.measure('pan-operation', 'pan-start', 'pan-end')
      
      // Get measurements
      const creationTime = performance.getEntriesByName('popup-creation')[0]
      const panTime = performance.getEntriesByName('pan-operation')[0]
      
      // Use requestAnimationFrame to measure real FPS
      return new Promise((resolve) => {
        let frames = 0
        let startTime = performance.now()
        
        function measureFrame() {
          frames++
          const elapsed = performance.now() - startTime
          
          if (elapsed >= 1000) {
            resolve({
              fps: frames,
              creationTime: creationTime.duration,
              panTime: panTime.duration
            })
          } else {
            requestAnimationFrame(measureFrame)
          }
        }
        
        requestAnimationFrame(measureFrame)
      })
    })
    
    // Assert realistic thresholds
    expect(metrics.fps).toBeGreaterThan(30) // 30fps minimum for smooth
    expect(metrics.creationTime).toBeLessThan(500) // 50 popups in 500ms
    expect(metrics.panTime).toBeLessThan(100) // Pan in 100ms
  })
})

// Option B: Synthetic benchmarks with clear disclaimers
describe('Synthetic Performance Benchmarks', () => {
  // Note: These tests measure computation speed, not rendering performance
  
  it('coordinate transformations are fast', () => {
    const iterations = 10000
    const start = performance.now()
    
    for (let i = 0; i < iterations; i++) {
      CoordinateBridge.screenToCanvas(
        { x: Math.random() * 1920, y: Math.random() * 1080 },
        { x: 100, y: 50, scale: 1.5 }
      )
    }
    
    const duration = performance.now() - start
    const opsPerSecond = (iterations / duration) * 1000
    
    // Should handle at least 100k operations per second
    expect(opsPerSecond).toBeGreaterThan(100000)
  })
  
  it('z-index calculations are efficient', () => {
    const iterations = 100000
    const start = performance.now()
    
    for (let i = 0; i < iterations; i++) {
      ZIndexManager.getPopupZIndex(
        Math.floor(Math.random() * 10),
        Math.random() > 0.5,
        true
      )
    }
    
    const duration = performance.now() - start
    
    // 100k calculations should take less than 50ms
    expect(duration).toBeLessThan(50)
  })
})

// Option C: Manual profiling component for development
const PerformanceProfiler: React.FC = () => {
  const [metrics, setMetrics] = useState<any>(null)
  
  const runPerformanceTest = () => {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const frameMetrics = entries
        .filter(e => e.entryType === 'frame')
        .map(e => e.duration)
      
      setMetrics({
        avgFrameTime: frameMetrics.reduce((a, b) => a + b) / frameMetrics.length,
        maxFrameTime: Math.max(...frameMetrics),
        droppedFrames: frameMetrics.filter(t => t > 16.67).length
      })
    })
    
    observer.observe({ entryTypes: ['frame', 'measure'] })
    
    // Run test scenario
    performance.mark('test-start')
    createMany50Popups()
    panPopupLayer(100, 100)
    performance.mark('test-end')
    performance.measure('full-test', 'test-start', 'test-end')
    
    setTimeout(() => observer.disconnect(), 2000)
  }
  
  return (
    <div>
      <button onClick={runPerformanceTest}>Profile Performance</button>
      {metrics && (
        <pre>{JSON.stringify(metrics, null, 2)}</pre>
      )}
    </div>
  )
}
```

### E2E Tests
```typescript
// tests/e2e/multi-layer-workflow.spec.ts
test.describe('Multi-Layer Canvas Workflow', () => {
  test('complete folder exploration workflow', async ({ page }) => {
    await page.goto('/notes')
    
    // Open cascading popups
    await page.hover('[data-testid="folder-eye-documents"]')
    await page.waitForSelector('[data-testid="popup-1"]')
    
    await page.hover('[data-testid="popup-1-folder-drafts"]')
    await page.waitForSelector('[data-testid="popup-2"]')
    
    // Verify layer switched
    const activeLayer = await page.textContent('[data-testid="active-layer"]')
    expect(activeLayer).toBe('popups')
    
    // Test independent panning
    await page.keyboard.down('Alt')
    await page.mouse.down()
    await page.mouse.move(100, 100)
    await page.mouse.up()
    await page.keyboard.up('Alt')
    
    // Verify only popup layer moved
    const popupTransform = await page.evaluate(() => {
      return window.canvasState.layers.get('popups').transform
    })
    const notesTransform = await page.evaluate(() => {
      return window.canvasState.layers.get('notes').transform
    })
    
    expect(popupTransform.x).toBe(100)
    expect(notesTransform.x).toBe(0)
    
    // Close all popups
    await page.keyboard.press('Escape')
    
    // Verify returned to notes
    await page.waitForSelector('[data-testid="toast"]')
    const toast = await page.textContent('[data-testid="toast"]')
    expect(toast).toBe('Returning to notes canvas')
  })
  
  test('keyboard navigation between layers', async ({ page }) => {
    await page.goto('/notes')
    
    // Tab to switch layers
    await page.keyboard.press('Tab')
    let activeLayer = await page.textContent('[data-testid="active-layer"]')
    expect(activeLayer).toBe('popups')
    
    // Cmd+1 for notes
    await page.keyboard.press('Meta+1')
    activeLayer = await page.textContent('[data-testid="active-layer"]')
    expect(activeLayer).toBe('notes')
    
    // Cmd+2 for popups
    await page.keyboard.press('Meta+2')
    activeLayer = await page.textContent('[data-testid="active-layer"]')
    expect(activeLayer).toBe('popups')
  })
})

## Migration Strategy

### Step 1: Prepare Current Code
- Backup current implementation
- Create feature branch `feat/multi-layer-canvas`
- Set up feature flag

### Step 2: Incremental Implementation
1. Add layer state management (non-breaking)
2. Update popup positioning logic
3. Add layer controls to sidebar
4. Implement pan/zoom handlers
5. Add auto-switch logic
6. Polish and optimize

### Step 3: Testing & Rollout
- Internal testing with feature flag
- Beta testing with selected users
- Full rollout with fallback option

## Success Metrics

### Performance
- Pan/zoom at 60fps
- Popup render < 16ms
- Memory usage < 100MB for 50 popups

### User Experience
- Layer switch time < 100ms
- Smooth transitions
- Intuitive controls
- Zero learning curve

### Code Quality
- 90% test coverage
- TypeScript strict mode
- No runtime errors
- Clean separation of concerns

## Timeline

```
Week 0.5: Preparation Phase (NEW - Critical)
- Day 1-2: Implement feature flag system
- Day 2-3: Create state migration adapters
- Day 3: Coordinate system bridge
- Day 3-4: Connection line compatibility layer
- Day 4-5: Testing infrastructure setup

Week 1: Foundation & Layer Controls
- Parallel state management implementation
- Layer UI state (ephemeral; Option A compliant)
- Basic UI components (non-connected)
- Z-index reconciliation

Week 2: Popup Integration & Auto-Switch
- Connect UI components via feature flag
- Implement coordinate migrations
- Auto-switch logic with visual feedback
- Connection line adaptations

Week 3: Visual Indicators & Performance
- Complete UI integration
- Performance optimizations
- Viewport culling
- Animation polish

Week 4: Testing & Polish
- Comprehensive test execution
- Performance benchmarking
- Bug fixes from testing
- Final migration validation

Week 5: Documentation & Deployment
- User documentation
- Migration guides
- Phased rollout plan
- Monitoring setup
```

## Risk Mitigation

### Technical Risks
- **Performance degradation**: Implement viewport culling
- **State synchronization**: Use single source of truth
- **Browser compatibility**: Test across browsers
- **Memory leaks**: Proper cleanup in useEffect

### UX Risks
- **Confusion**: Clear visual indicators
- **Complexity**: Progressive disclosure
- **Breaking changes**: Feature flag rollout

## Documentation Requirements

### User Documentation
- Layer concept explanation
- Keyboard shortcuts guide
- Video tutorials
- FAQ section

### Developer Documentation
- API reference
- Architecture diagrams
- Code examples
- Migration guide

## Conclusion

This multi-layer canvas system will transform the annotation application into a powerful, spatially-aware workspace that maintains the simplicity of current interactions while adding professional-grade navigation capabilities. The implementation is designed to be incremental, testable, and performant.

---

### Validation Plan (aligns with CLAUDE.md)
- Lint: `npm run lint` (no new errors)
- Types: `npm run type-check` (strict; no `any` at boundaries)
- Unit: `npm run test` (CoordinateBridge math, z-index manager)
- Integration (only if preferences API added): `docker compose up -d postgres && npm run test:integration`
- Plain mode script: `./scripts/test-plain-mode.sh` (if present in repo)
- E2E: `npx playwright test` for basic overlay flows (open first popup auto-switches; close last popup returns to notes with toast)

### SSR & Pointer Events Notes
- Guard `window/document` access; initialize client-only bits in `useEffect`.
- Overlay root uses `pointer-events: none`; popup nodes use `pointer-events: auto`.
- Prefer Pointer Events for drag/pan; use wheel listeners with `{ passive: false }` when preventing default.
- Do not mix screen- and canvas-space for the same element; container transform owns scaling.

Document Version: 1.1 (Refined for Option A)
