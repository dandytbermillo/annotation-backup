/**
 * Bridge API Barrel Export
 * Phase 3.2: Widget Bridge Handler Wiring (Read-Only)
 */

// Workspace handlers
export {
  handleGetPanels,
  handleGetActivePanel,
  type BridgePanelInfo,
  type WorkspaceHandlerState,
  type GetPanelsResponse,
  type GetActivePanelResponse,
} from './workspace'

// Notes handlers
export {
  handleGetCurrentNote,
  handleGetNote,
  type BridgeNoteInfo,
  type NotesHandlerState,
  type GetCurrentNoteResponse,
  type GetNoteResponse,
} from './notes'
