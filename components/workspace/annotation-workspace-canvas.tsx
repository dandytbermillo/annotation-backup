"use client"

import dynamic from "next/dynamic"
import { forwardRef, type ReactNode } from "react"

const ModernAnnotationCanvas = dynamic(() => import("../annotation-canvas-modern"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
      <div className="text-2xl font-semibold text-white animate-pulse">Loading canvas...</div>
    </div>
  ),
})

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
    >
      {children}
    </ModernAnnotationCanvas>
  )
})
