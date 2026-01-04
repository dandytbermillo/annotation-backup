/**
 * Bridge API Barrel Export
 * Phase 3.2 + 3.3: Widget Bridge Handler Wiring (Read + Write)
 */

// Workspace read handlers
export {
  handleGetPanels,
  handleGetActivePanel,
  type BridgePanelInfo,
  type WorkspaceHandlerState,
  type GetPanelsResponse,
  type GetActivePanelResponse,
} from './workspace'

// Workspace write handlers (Phase 3.3)
export {
  handleOpenPanel,
  handleClosePanel,
  handleFocusPanel,
  type OpenPanelParams,
  type ClosePanelParams,
  type FocusPanelParams,
  type WorkspaceWriteCallbacks,
  type WriteResult,
} from './workspace-write'

// Notes read handlers
export {
  handleGetCurrentNote,
  handleGetNote,
  type BridgeNoteInfo,
  type NotesHandlerState,
  type GetCurrentNoteResponse,
  type GetNoteResponse,
} from './notes'

// Notes write handlers (Phase 3.3)
export {
  handleUpdateNote,
  handleCreateNote,
  handleDeleteNote,
  type UpdateNoteParams,
  type CreateNoteParams,
  type DeleteNoteParams,
  type NotesWriteCallbacks,
  type NoteWriteResult,
} from './notes-write'

// Chat write handlers (Phase 3.3)
export {
  handleSendMessage,
  type SendMessageParams,
  type ChatWriteCallbacks,
  type ChatWriteResult,
} from './chat-write'
