/**
 * Canvas configuration constants
 * Centralized configuration to avoid hard-coded values
 */

export const CANVAS_CONFIG = {
  // Default panel dimensions and positions
  panels: {
    main: {
      position: { x: 2000, y: 1500 },
      dimensions: { width: 420, height: 350 },
      title: 'Main Document'
    },
    spacing: {
      horizontal: 450,  // Space between panels horizontally
      vertical: 400,    // Space between panels vertically  
      fromMain: 100     // Gap from main panel to additional panels
    },
    layout: {
      maxColumns: 3,    // Maximum columns for grid layout
      maxPanels: 9      // Maximum additional panels (safety limit)
    }
  },
  
  // Canvas viewport defaults
  viewport: {
    defaultZoom: 1,
    minZoom: 0.3,
    maxZoom: 2,
    defaultTranslate: { x: -1000, y: -1200 }
  },
  
  // Recent notes configuration
  recentNotes: {
    maxItems: 10,           // Maximum recent notes to track
    displayLimit: 5,        // How many to show in UI
    cleanupThreshold: 30    // Clean up entries older than 30 days
  },
  
  // Performance limits
  performance: {
    maxBranches: 50,        // Maximum branches per panel
    maxPanelsTotal: 20,     // Maximum total panels on canvas
    debounceDelay: 300      // Milliseconds to debounce updates
  }
}

/**
 * Calculate position for additional panel based on index
 */
export function calculatePanelPosition(index: number): { x: number, y: number } {
  const { main, spacing, layout } = CANVAS_CONFIG.panels
  
  const col = index % layout.maxColumns
  const row = Math.floor(index / layout.maxColumns)
  
  const baseX = main.position.x + main.dimensions.width + spacing.fromMain
  const baseY = main.position.y
  
  return {
    x: baseX + (col * spacing.horizontal),
    y: baseY + (row * spacing.vertical)
  }
}

/**
 * Check if a position is within reasonable canvas bounds
 */
export function isValidPosition(position: { x: number, y: number }): boolean {
  const maxBound = 10000
  const minBound = -10000
  
  return (
    position.x >= minBound && 
    position.x <= maxBound && 
    position.y >= minBound && 
    position.y <= maxBound
  )
}