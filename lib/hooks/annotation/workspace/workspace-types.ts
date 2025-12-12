/**
 * Type definitions for workspace management hooks.
 * Extracted from use-note-workspaces.ts for maintainability.
 *
 * @see docs/proposal/refactor/use-note-workspaces/REFACTORING_PLAN.md
 */

import type { Dispatch, SetStateAction } from "react"
import type { LayerContextValue } from "@/components/canvas/layer-provider"
import type { NoteWorkspaceDebugLogger } from "@/lib/hooks/annotation/use-note-workspace-runtime-manager"
import type { CanvasState } from "@/lib/hooks/annotation/use-workspace-canvas-state"
import type { WorkspacePanelSnapshot } from "@/lib/hooks/annotation/use-workspace-panel-positions"
import type { NoteWorkspaceSummary } from "@/lib/adapters/note-workspace-adapter"
import type { NoteWorkspace, NoteWorkspaceSlot } from "@/lib/workspace/types"

// ============================================================================
// Hook Options Type
// ============================================================================

/**
 * Options for the useNoteWorkspaces hook.
 * Provides all external dependencies needed by the workspace manager.
 */
export type UseNoteWorkspaceOptions = {
  /** Currently open notes in the workspace */
  openNotes: NoteWorkspaceSlot[]
  /** ID of the workspace that owns the openNotes array */
  openNotesWorkspaceId?: string | null
  /** Currently active note ID */
  activeNoteId: string | null
  /** Setter for active note ID */
  setActiveNoteId: Dispatch<SetStateAction<string | null>>
  /** Resolve main panel position for a note */
  resolveMainPanelPosition: (noteId: string) => { x: number; y: number } | null
  /** Open a note in the workspace */
  openWorkspaceNote: (
    noteId: string,
    options?: {
      mainPosition?: { x: number; y: number } | null
      persist?: boolean
      persistPosition?: boolean
      workspaceId?: string
    }
  ) => Promise<void>
  /** Close a note in the workspace */
  closeWorkspaceNote: (
    noteId: string,
    options?: { persist?: boolean; removeWorkspace?: boolean }
  ) => Promise<void>
  /** Layer context for canvas operations */
  layerContext: LayerContextValue | null
  /** Whether the workspace is ready for operations */
  isWorkspaceReady: boolean
  /** Get panel snapshot for a note */
  getPanelSnapshot: (noteId: string) => WorkspacePanelSnapshot | null
  /** Version number for panel snapshots (triggers updates) */
  panelSnapshotVersion: number
  /** Current canvas state (camera position, zoom, etc.) */
  canvasState: CanvasState | null
  /** Setter for canvas state */
  setCanvasState?: Dispatch<SetStateAction<CanvasState>>
  /** Callback when workspace becomes unavailable */
  onUnavailable?: () => void
  /** Debug logger for workspace operations */
  debugLog?: NoteWorkspaceDebugLogger
  /** Shared workspace reference */
  sharedWorkspace: NoteWorkspace | null
}

// ============================================================================
// Hook Result Type
// ============================================================================

/**
 * Result returned by the useNoteWorkspaces hook.
 * Provides workspace state and operations to consumers.
 */
export type UseNoteWorkspaceResult = {
  /** Whether workspace feature is enabled */
  featureEnabled: boolean
  /** Whether workspace is unavailable (e.g., adapter failed) */
  isUnavailable: boolean
  /** All workspaces available to the user */
  workspaces: NoteWorkspaceSummary[]
  /** Workspaces filtered for the current entry */
  workspacesForCurrentEntry: NoteWorkspaceSummary[]
  /** Whether workspace list is loading */
  isLoading: boolean
  /** Status helper text (e.g., "Synced at 3:45 PM") */
  statusHelperText: string | null
  /** Currently active workspace ID */
  currentWorkspaceId: string | null
  /** Target workspace ID during transitions */
  targetWorkspaceId: string | null
  /** Current entry ID context */
  currentEntryId: string | null
  /** Set the current entry ID */
  setCurrentEntryId: (entryId: string | null) => void
  /** Snapshot revision counter for cache invalidation */
  snapshotRevision: number
  /** Select/switch to a workspace */
  selectWorkspace: (workspaceId: string) => void
  /** Create a new workspace */
  createWorkspace: () => void
  /** Delete a workspace */
  deleteWorkspace: (workspaceId: string) => void
  /** Rename a workspace */
  renameWorkspace: (workspaceId: string, name: string) => void
  /** Schedule an immediate save (optional) */
  scheduleImmediateSave?: (reason?: string) => void
  /** Clear a deleted component from cache to prevent hydration loops */
  clearDeletedComponentFromCache?: (workspaceId: string, componentId: string) => void
  /** Clear a closed note from cache to prevent stale note restoration */
  clearClosedNoteFromCache?: (workspaceId: string, noteId: string) => void
}
