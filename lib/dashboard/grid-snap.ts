/**
 * Grid Snap Configuration and Utilities
 *
 * Provides snap-to-grid functionality for dashboard panels.
 * All panels align to a consistent grid with gaps between them.
 */

// =============================================================================
// Grid Configuration
// =============================================================================

/** Grid cell size including gap (panel + gap) */
export const GRID_CELL_SIZE = 170

/** Gap between panels in pixels */
export const GRID_GAP = 16

/** Base panel unit size (GRID_CELL_SIZE - GRID_GAP) */
export const PANEL_UNIT = GRID_CELL_SIZE - GRID_GAP  // 154px

/** Starting offset from canvas edge */
export const GRID_OFFSET = 40

// =============================================================================
// Panel Size Definitions
// =============================================================================

export type PanelSizeKey = 'small' | 'medium' | 'tall' | 'large' | 'wide' | 'xlarge'

export interface PanelSizeConfig {
  /** Grid columns this size occupies */
  cols: number
  /** Grid rows this size occupies */
  rows: number
  /** Actual width in pixels */
  width: number
  /** Actual height in pixels */
  height: number
  /** Display label */
  label: string
}

/**
 * Standard panel sizes aligned to grid.
 * Width/height account for gaps when spanning multiple cells.
 */
export const PANEL_SIZES: Record<PanelSizeKey, PanelSizeConfig> = {
  small: {
    cols: 1,
    rows: 1,
    width: PANEL_UNIT,                    // 154px
    height: PANEL_UNIT,                   // 154px
    label: '1×1',
  },
  medium: {
    cols: 2,
    rows: 1,
    width: PANEL_UNIT * 2 + GRID_GAP,     // 324px (154 + 16 + 154)
    height: PANEL_UNIT,                   // 154px
    label: '2×1',
  },
  tall: {
    cols: 1,
    rows: 2,
    width: PANEL_UNIT,                    // 154px
    height: PANEL_UNIT * 2 + GRID_GAP,    // 324px
    label: '1×2',
  },
  large: {
    cols: 2,
    rows: 2,
    width: PANEL_UNIT * 2 + GRID_GAP,     // 324px
    height: PANEL_UNIT * 2 + GRID_GAP,    // 324px
    label: '2×2',
  },
  wide: {
    cols: 3,
    rows: 1,
    width: PANEL_UNIT * 3 + GRID_GAP * 2, // 494px (154 + 16 + 154 + 16 + 154)
    height: PANEL_UNIT,                   // 154px
    label: '3×1',
  },
  xlarge: {
    cols: 3,
    rows: 2,
    width: PANEL_UNIT * 3 + GRID_GAP * 2, // 494px
    height: PANEL_UNIT * 2 + GRID_GAP,    // 324px
    label: '3×2',
  },
}

// =============================================================================
// Snap Calculation Functions
// =============================================================================

/**
 * Snap a position to the nearest grid cell.
 * Returns the top-left position of the grid cell.
 */
export function snapToGrid(x: number, y: number): { x: number; y: number } {
  // Calculate grid cell index
  const gridX = Math.round((x - GRID_OFFSET) / GRID_CELL_SIZE)
  const gridY = Math.round((y - GRID_OFFSET) / GRID_CELL_SIZE)

  // Ensure non-negative grid positions
  const clampedGridX = Math.max(0, gridX)
  const clampedGridY = Math.max(0, gridY)

  // Convert back to pixel position
  return {
    x: clampedGridX * GRID_CELL_SIZE + GRID_OFFSET,
    y: clampedGridY * GRID_CELL_SIZE + GRID_OFFSET,
  }
}

/**
 * Get the grid cell coordinates for a position.
 */
export function getGridCell(x: number, y: number): { col: number; row: number } {
  const col = Math.round((x - GRID_OFFSET) / GRID_CELL_SIZE)
  const row = Math.round((y - GRID_OFFSET) / GRID_CELL_SIZE)
  return {
    col: Math.max(0, col),
    row: Math.max(0, row),
  }
}

/**
 * Convert grid cell coordinates to pixel position.
 */
export function gridCellToPixels(col: number, row: number): { x: number; y: number } {
  return {
    x: col * GRID_CELL_SIZE + GRID_OFFSET,
    y: row * GRID_CELL_SIZE + GRID_OFFSET,
  }
}

/**
 * Find the closest standard panel size for given dimensions.
 */
export function findClosestPanelSize(width: number, height: number): PanelSizeKey {
  let closestSize: PanelSizeKey = 'medium'
  let closestDistance = Infinity

  for (const [key, config] of Object.entries(PANEL_SIZES)) {
    const distance = Math.sqrt(
      Math.pow(width - config.width, 2) +
      Math.pow(height - config.height, 2)
    )
    if (distance < closestDistance) {
      closestDistance = distance
      closestSize = key as PanelSizeKey
    }
  }

  return closestSize
}

/**
 * Snap dimensions to the nearest standard panel size.
 */
export function snapDimensionsToSize(width: number, height: number): { width: number; height: number } {
  const sizeKey = findClosestPanelSize(width, height)
  const size = PANEL_SIZES[sizeKey]
  return {
    width: size.width,
    height: size.height,
  }
}

/**
 * Get the size key for a panel based on its current dimensions.
 * Returns null if dimensions don't match any standard size.
 */
export function getPanelSizeKey(width: number, height: number): PanelSizeKey | null {
  const tolerance = 20 // Allow some tolerance for existing panels

  for (const [key, config] of Object.entries(PANEL_SIZES)) {
    if (
      Math.abs(width - config.width) <= tolerance &&
      Math.abs(height - config.height) <= tolerance
    ) {
      return key as PanelSizeKey
    }
  }

  return null
}

/**
 * Check if a position is within snap threshold of a grid line.
 */
export function isNearSnapPoint(
  x: number,
  y: number,
  threshold: number = 30
): boolean {
  const snapped = snapToGrid(x, y)
  const distance = Math.sqrt(
    Math.pow(x - snapped.x, 2) +
    Math.pow(y - snapped.y, 2)
  )
  return distance <= threshold
}

// =============================================================================
// Migration Utilities
// =============================================================================

/**
 * Migrate a panel's position and size to grid-aligned values.
 * Used when transitioning existing panels to the new grid system.
 */
export function migratePanelToGrid(
  x: number,
  y: number,
  width: number,
  height: number
): {
  x: number
  y: number
  width: number
  height: number
  sizeKey: PanelSizeKey
} {
  const snappedPos = snapToGrid(x, y)
  const sizeKey = findClosestPanelSize(width, height)
  const size = PANEL_SIZES[sizeKey]

  return {
    x: snappedPos.x,
    y: snappedPos.y,
    width: size.width,
    height: size.height,
    sizeKey,
  }
}
