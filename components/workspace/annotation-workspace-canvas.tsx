"use client"

import { forwardRef, type ReactNode } from "react"

import ModernAnnotationCanvas from "../annotation-canvas-modern"

export type AnnotationWorkspaceCanvasProps = {
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
}

export const AnnotationWorkspaceCanvas = forwardRef<any, AnnotationWorkspaceCanvasProps>(function AnnotationWorkspaceCanvas(
  {
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
  },
  ref,
) {
  return (
    <ModernAnnotationCanvas
      ref={ref}
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
    >
      {children}
    </ModernAnnotationCanvas>
  )
})
