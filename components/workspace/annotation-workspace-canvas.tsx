"use client"

import { forwardRef, type ReactNode } from "react"

import ModernAnnotationCanvas from "../annotation-canvas-modern"

export type AnnotationWorkspaceCanvasProps = {
  workspaceId?: string | null
  noteIds: string[]
  primaryNoteId: string | null
  freshNoteSeeds?: Record<string, { x: number; y: number }>
  onConsumeFreshNoteSeed?: (noteId: string) => void
  freshNoteIds?: string[]
  onFreshNoteHydrated?: (noteId: string) => void
  onCanvasStateChange?: (state: {
    zoom: number
    showConnections: boolean
    translateX: number
    translateY: number
    lastInteraction?: { x: number; y: number } | null
  }) => void
  mainOnlyNoteIds?: string[]
  onMainOnlyLayoutHandled?: (noteId: string) => void
  showAddComponentMenu?: boolean
  onToggleAddComponentMenu?: () => void
  onRegisterActiveEditor?: (editorRef: any, panelId: string) => void
  onSnapshotLoadComplete?: () => void
  skipSnapshotForNote?: string | null
  onSnapshotSettled?: (noteId: string) => void
  isNotesExplorerOpen?: boolean
  noteTitleMap?: Map<string, string> | null
  workspaceSnapshotRevision?: number
  children?: ReactNode
  onComponentChange?: () => void
  /** Callback when a component is deleted - use to clear caches */
  onComponentDeleted?: (workspaceId: string, componentId: string) => void
  /** When true, pause hydration to prevent fetch loops (for hidden pinned canvases) */
  isCanvasHidden?: boolean
  // Control Center integration - callbacks from floating toolbar
  /** Callback to create a new note */
  onCreateNote?: () => void
  /** Callback to open recent notes panel */
  onOpenRecent?: () => void
  /** Callback to toggle constellation/canvas view */
  onToggleCanvas?: () => void
  /** Whether constellation panel is currently visible */
  showConstellationPanel?: boolean
  // Note Switcher integration - for dock panel (controlled by parent)
  /** Open notes count for badge display */
  openNotesForSwitcher?: Array<{ noteId: string; updatedAt?: string | null }>
  /** Whether the note switcher popover is open (controlled by parent) */
  isNoteSwitcherOpen?: boolean
  /** Callback to toggle the note switcher popover */
  onToggleNoteSwitcher?: () => void
  /** Callback when a note is selected in the switcher */
  onSelectNote?: (noteId: string) => void
  /** Callback when a note is closed from the switcher */
  onCloseNote?: (noteId: string) => void
  /** Callback to center on a note */
  onCenterNote?: (noteId: string) => void
  /** Whether notes are currently loading */
  isNotesLoading?: boolean
  // Workspace Switcher integration - for dock panel (controlled by parent)
  /** Workspaces for the switcher popover */
  workspacesForSwitcher?: Array<{ id: string; name: string; noteCount?: number; updatedAt?: string | null; isDefault?: boolean }>
  /** Current workspace ID (to mark as active) */
  currentWorkspaceIdForSwitcher?: string | null
  /** Whether the workspace switcher popover is open */
  isWorkspaceSwitcherOpen?: boolean
  /** Callback to toggle the workspace switcher popover */
  onToggleWorkspaceSwitcher?: () => void
  /** Callback when a workspace is selected */
  onSelectWorkspace?: (workspaceId: string) => void
  /** Callback when a workspace is deleted */
  onDeleteWorkspace?: (workspaceId: string) => void
  /** Callback when a workspace is renamed */
  onRenameWorkspace?: (workspaceId: string, newName: string) => void
  /** Callback to create a new workspace */
  onCreateWorkspace?: () => void
  /** Whether workspaces are loading */
  isWorkspacesLoading?: boolean
  /** ID of workspace currently being deleted */
  deletingWorkspaceId?: string | null
  /** Current workspace name for display */
  currentWorkspaceName?: string
  /** Callback to return to dashboard (passed to canvas dock) */
  onReturnToDashboard?: () => void
}

export const AnnotationWorkspaceCanvas = forwardRef<any, AnnotationWorkspaceCanvasProps>(function AnnotationWorkspaceCanvas(
  {
    workspaceId,
    noteIds,
    primaryNoteId,
    freshNoteSeeds,
    onConsumeFreshNoteSeed,
    freshNoteIds,
    onFreshNoteHydrated,
    onCanvasStateChange,
    mainOnlyNoteIds,
    onMainOnlyLayoutHandled,
    showAddComponentMenu,
    onToggleAddComponentMenu,
    onRegisterActiveEditor,
    onSnapshotLoadComplete,
    skipSnapshotForNote,
    onSnapshotSettled,
    isNotesExplorerOpen = false,
    noteTitleMap = null,
    workspaceSnapshotRevision = 0,
    children,
    onComponentChange,
    onComponentDeleted,
    isCanvasHidden = false,
    // Control Center integration
    onCreateNote,
    onOpenRecent,
    onToggleCanvas,
    showConstellationPanel,
    // Note Switcher integration
    openNotesForSwitcher,
    isNoteSwitcherOpen,
    onToggleNoteSwitcher,
    onSelectNote,
    onCloseNote,
    onCenterNote,
    isNotesLoading,
    // Workspace Switcher integration
    workspacesForSwitcher,
    currentWorkspaceIdForSwitcher,
    isWorkspaceSwitcherOpen,
    onToggleWorkspaceSwitcher,
    onSelectWorkspace,
    onDeleteWorkspace,
    onRenameWorkspace,
    onCreateWorkspace,
    isWorkspacesLoading,
    deletingWorkspaceId,
    currentWorkspaceName,
    // Dashboard integration
    onReturnToDashboard,
  },
  ref,
) {
  return (
    <ModernAnnotationCanvas
      ref={ref}
      workspaceId={workspaceId ?? undefined}
      noteIds={noteIds}
      primaryNoteId={primaryNoteId}
      freshNoteSeeds={freshNoteSeeds}
      onConsumeFreshNoteSeed={onConsumeFreshNoteSeed}
      isNotesExplorerOpen={isNotesExplorerOpen}
      freshNoteIds={freshNoteIds}
      onFreshNoteHydrated={onFreshNoteHydrated}
      onCanvasStateChange={onCanvasStateChange}
      mainOnlyNoteIds={mainOnlyNoteIds}
      onMainOnlyLayoutHandled={onMainOnlyLayoutHandled}
      showAddComponentMenu={showAddComponentMenu}
      onToggleAddComponentMenu={onToggleAddComponentMenu}
      onRegisterActiveEditor={onRegisterActiveEditor}
      onSnapshotLoadComplete={onSnapshotLoadComplete}
      skipSnapshotForNote={skipSnapshotForNote}
      onSnapshotSettled={onSnapshotSettled}
      noteTitleMap={noteTitleMap}
      workspaceSnapshotRevision={workspaceSnapshotRevision}
      onComponentChange={onComponentChange}
      onComponentDeleted={onComponentDeleted}
      isCanvasHidden={isCanvasHidden}
      // Control Center integration
      onCreateNote={onCreateNote}
      onOpenRecent={onOpenRecent}
      onToggleCanvas={onToggleCanvas}
      showConstellationPanel={showConstellationPanel}
      // Note Switcher integration
      openNotesForSwitcher={openNotesForSwitcher}
      isNoteSwitcherOpen={isNoteSwitcherOpen}
      onToggleNoteSwitcher={onToggleNoteSwitcher}
      onSelectNote={onSelectNote}
      onCloseNote={onCloseNote}
      onCenterNote={onCenterNote}
      isNotesLoading={isNotesLoading}
      // Workspace Switcher integration
      workspacesForSwitcher={workspacesForSwitcher}
      currentWorkspaceIdForSwitcher={currentWorkspaceIdForSwitcher}
      isWorkspaceSwitcherOpen={isWorkspaceSwitcherOpen}
      onToggleWorkspaceSwitcher={onToggleWorkspaceSwitcher}
      onSelectWorkspace={onSelectWorkspace}
      onDeleteWorkspace={onDeleteWorkspace}
      onRenameWorkspace={onRenameWorkspace}
      onCreateWorkspace={onCreateWorkspace}
      isWorkspacesLoading={isWorkspacesLoading}
      deletingWorkspaceId={deletingWorkspaceId}
      currentWorkspaceName={currentWorkspaceName}
      // Dashboard integration
      onReturnToDashboard={onReturnToDashboard}
    >
      {children}
    </ModernAnnotationCanvas>
  )
})
