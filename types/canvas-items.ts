// Unified canvas item types

export type ComponentType = 'calculator' | 'timer' | 'sticky-note' | 'dragtest' | 'perftest' | 'editor'
export type PanelType = 'main' | 'editor' | 'note' | 'explore' | 'promote'

export interface CanvasItem {
  id: string
  itemType: 'panel' | 'component'
  position: { x: number; y: number }
  zIndex?: number
  isVisible?: boolean
  noteId?: string
  storeKey?: string
  
  // For components
  componentType?: ComponentType
  componentState?: any
  
  // For panels
  panelId?: string  // The ID used to fetch panel data from dataStore/Yjs
  panelType?: PanelType
  
  // Common properties
  dimensions?: { width: number; height: number }
  title?: string
  minimized?: boolean
}

export interface CanvasItemsState {
  items: CanvasItem[]
  nextZIndex: number
}

// Helper functions
export function isPanel(item: CanvasItem): boolean {
  return item.itemType === 'panel'
}

export function isComponent(item: CanvasItem): boolean {
  return item.itemType === 'component'
}

export function createPanelItem(
  panelId: string,
  position: { x: number; y: number } = { x: 2000, y: 1500 },
  panelType: PanelType = 'note',
  noteId?: string,
  storeKey?: string
): CanvasItem {
  return {
    id: `panel-${panelId}-${Date.now()}`,
    itemType: 'panel',
    panelId,
    panelType,
    noteId,
    storeKey,
    position,
    dimensions: { width: 500, height: 400 }
  }
}

export function createComponentItem(
  componentType: ComponentType,
  position: { x: number; y: number }
): CanvasItem {
  return {
    id: `component-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    itemType: 'component',
    componentType,
    position,
    dimensions: { width: 350, height: 300 }
  }
}
