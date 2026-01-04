/**
 * Workspace Bridge API Handlers
 * Phase 3.2: Widget Bridge Handler Wiring (Read-Only)
 *
 * Pure functions that transform workspace state into bridge responses.
 * These are called by the sandbox bridge when widgets request workspace data.
 */

// =============================================================================
// Types
// =============================================================================

/** Minimal panel info returned to widgets (read-only, no secrets) */
export interface BridgePanelInfo {
  id: string
  type: string
  title: string | null
  isActive: boolean
}

/** Input state for workspace handlers */
export interface WorkspaceHandlerState {
  /** List of visible panels */
  panels: Array<{
    id: string
    panelType: string
    title: string | null
  }>
  /** Currently active/focused panel ID */
  activePanelId: string | null
}

// =============================================================================
// Response Types
// =============================================================================

export interface GetPanelsResponse {
  panels: BridgePanelInfo[]
}

export interface GetActivePanelResponse {
  panel: BridgePanelInfo | null
}

// =============================================================================
// Handler Functions
// =============================================================================

/**
 * Get list of visible panels
 * Permission: read:workspace
 */
export function handleGetPanels(state: WorkspaceHandlerState): GetPanelsResponse {
  const panels: BridgePanelInfo[] = state.panels.map(panel => ({
    id: panel.id,
    type: panel.panelType,
    title: panel.title,
    isActive: panel.id === state.activePanelId,
  }))

  return { panels }
}

/**
 * Get the currently active panel
 * Permission: read:workspace
 */
export function handleGetActivePanel(state: WorkspaceHandlerState): GetActivePanelResponse {
  if (!state.activePanelId) {
    return { panel: null }
  }

  const activePanel = state.panels.find(p => p.id === state.activePanelId)
  if (!activePanel) {
    return { panel: null }
  }

  return {
    panel: {
      id: activePanel.id,
      type: activePanel.panelType,
      title: activePanel.title,
      isActive: true,
    },
  }
}
