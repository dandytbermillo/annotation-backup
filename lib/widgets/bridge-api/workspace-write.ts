/**
 * Workspace Write Bridge API Handlers
 * Phase 3.3: Permission Gating + Write APIs
 *
 * Write handlers for workspace operations (require write:workspace permission).
 * These dispatch events that the dashboard listens for.
 */

// =============================================================================
// Types
// =============================================================================

/** Params for openPanel */
export interface OpenPanelParams {
  panelId: string
}

/** Params for closePanel */
export interface ClosePanelParams {
  panelId: string
}

/** Params for focusPanel */
export interface FocusPanelParams {
  panelId: string
}

/** Result for write operations */
export interface WriteResult {
  success: boolean
  error?: string
}

/** Callbacks for workspace write operations */
export interface WorkspaceWriteCallbacks {
  openPanel?: (panelId: string) => Promise<boolean>
  closePanel?: (panelId: string) => Promise<boolean>
  focusPanel?: (panelId: string) => Promise<boolean>
}

// =============================================================================
// Handler Functions
// =============================================================================

/**
 * Open a panel by ID
 * Permission: write:workspace
 */
export async function handleOpenPanel(
  params: OpenPanelParams,
  callbacks: WorkspaceWriteCallbacks
): Promise<WriteResult> {
  if (!params.panelId) {
    return { success: false, error: 'panelId is required' }
  }

  if (!callbacks.openPanel) {
    return { success: false, error: 'openPanel not implemented' }
  }

  try {
    const success = await callbacks.openPanel(params.panelId)
    return { success }
  } catch (error) {
    console.error('[BridgeAPI] Error opening panel:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Close a panel by ID
 * Permission: write:workspace
 */
export async function handleClosePanel(
  params: ClosePanelParams,
  callbacks: WorkspaceWriteCallbacks
): Promise<WriteResult> {
  if (!params.panelId) {
    return { success: false, error: 'panelId is required' }
  }

  if (!callbacks.closePanel) {
    return { success: false, error: 'closePanel not implemented' }
  }

  try {
    const success = await callbacks.closePanel(params.panelId)
    return { success }
  } catch (error) {
    console.error('[BridgeAPI] Error closing panel:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Focus a panel by ID
 * Permission: write:workspace
 */
export async function handleFocusPanel(
  params: FocusPanelParams,
  callbacks: WorkspaceWriteCallbacks
): Promise<WriteResult> {
  if (!params.panelId) {
    return { success: false, error: 'panelId is required' }
  }

  if (!callbacks.focusPanel) {
    return { success: false, error: 'focusPanel not implemented' }
  }

  try {
    const success = await callbacks.focusPanel(params.panelId)
    return { success }
  } catch (error) {
    console.error('[BridgeAPI] Error focusing panel:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
