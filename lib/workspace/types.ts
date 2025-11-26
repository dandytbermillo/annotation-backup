import type { DataStore } from "@/lib/data-store"
import type { EventEmitter } from "@/lib/event-emitter"
import type { LayerManager } from "@/lib/canvas/layer-manager"

export interface WorkspacePosition {
  x: number
  y: number
}

export interface OpenWorkspaceNote {
  noteId: string
  mainPosition: WorkspacePosition | null
  updatedAt: string | null
  version: number
}

export interface NoteWorkspaceSlot {
  noteId: string
  mainPosition?: WorkspacePosition | null
}

export interface NoteWorkspace {
  dataStore: DataStore
  events: EventEmitter
  layerManager: LayerManager
  loadedNotes: Set<string>
}

export const SHARED_WORKSPACE_ID = "__workspace__"
