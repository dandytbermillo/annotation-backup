"use client"

import { DataStore } from "@/lib/data-store"
import { LayerManager } from "@/lib/canvas/layer-manager"
import { getWorkspaceStore } from "@/lib/workspace/workspace-store-registry"
import { getWorkspaceLayerManager } from "@/lib/workspace/workspace-layer-manager-registry"
import type { NoteWorkspaceSlot } from "@/lib/workspace/types"

export type WorkspaceRuntime = {
  id: string
  dataStore: DataStore
  layerManager: LayerManager
  pendingPanels: Set<string>
  pendingComponents: Set<string>
  status: "idle" | "active" | "paused"
  openNotes: NoteWorkspaceSlot[]
  membership: Set<string>
  noteOwners: Map<string, string>  // Phase 1: noteId -> workspaceId ownership
  // Timestamps to prevent stale overwrites (Phase 1 ownership plumbing)
  openNotesUpdatedAt: number
  membershipUpdatedAt: number
}

const runtimes = new Map<string, WorkspaceRuntime>()

// DEBUG: Unique ID to detect multiple module instances
const MODULE_INSTANCE_ID = Math.random().toString(36).substring(2, 8)
if (process.env.NODE_ENV === "development") {
  console.log(`[WorkspaceRuntime] Module loaded, instance ID: ${MODULE_INSTANCE_ID}`)
}

export const getWorkspaceRuntime = (workspaceId: string): WorkspaceRuntime => {
  // Dev-mode assertion: workspace ID must be valid
  if (process.env.NODE_ENV === "development") {
    if (!workspaceId || typeof workspaceId !== "string" || workspaceId.trim() === "") {
      console.error("[WorkspaceRuntime] Invalid workspace ID:", workspaceId)
      throw new Error(`Invalid workspace ID: ${workspaceId}`)
    }
  }

  // DEBUG: Trace Map state before lookup
  if (process.env.NODE_ENV === "development") {
    const hasKey = runtimes.has(workspaceId)
    const existingKeys = Array.from(runtimes.keys())
    console.log(`[WorkspaceRuntime] getWorkspaceRuntime called`, {
      moduleInstanceId: MODULE_INSTANCE_ID,
      workspaceId,
      hasKey,
      existingKeys,
      mapSize: runtimes.size,
    })
  }

  const existing = runtimes.get(workspaceId)
  if (existing) {
    return existing
  }

  const dataStore = getWorkspaceStore(workspaceId) ?? new DataStore()
  const layerManager = getWorkspaceLayerManager(workspaceId) ?? new LayerManager()

  const now = Date.now()
  const runtime: WorkspaceRuntime = {
    id: workspaceId,
    dataStore,
    layerManager,
    pendingPanels: new Set(),
    pendingComponents: new Set(),
    status: "idle",
    openNotes: [],
    membership: new Set(),
    noteOwners: new Map(),
    openNotesUpdatedAt: now,
    membershipUpdatedAt: now,
  }
  runtimes.set(workspaceId, runtime)

  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] Created new runtime for workspace: ${workspaceId}`, {
      totalRuntimes: runtimes.size,
      runtimeIds: Array.from(runtimes.keys()),
    })
  }

  return runtime
}

export const markRuntimeActive = (workspaceId: string) => {
  const runtime = getWorkspaceRuntime(workspaceId)
  runtime.status = "active"
}

export const markRuntimePaused = (workspaceId: string) => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return
  runtime.status = "paused"
}

export const removeWorkspaceRuntime = (workspaceId: string) => {
  // DEBUG: Track when runtimes are removed
  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] removeWorkspaceRuntime called`, {
      moduleInstanceId: MODULE_INSTANCE_ID,
      workspaceId,
      hadKey: runtimes.has(workspaceId),
      keysBeforeRemoval: Array.from(runtimes.keys()),
      stack: new Error().stack?.split('\n').slice(1, 5).join('\n'),
    })
  }

  if (!runtimes.has(workspaceId)) return
  const runtime = runtimes.get(workspaceId)
  if (runtime) {
    runtime.pendingPanels.clear()
    runtime.pendingComponents.clear()
    runtime.openNotes = []
    runtime.membership.clear()
  }
  runtimes.delete(workspaceId)
}

export const listWorkspaceRuntimeIds = () => Array.from(runtimes.keys())

export const hasWorkspaceRuntime = (workspaceId: string): boolean => {
  return runtimes.has(workspaceId)
}

export const getRuntimeOpenNotes = (workspaceId: string): NoteWorkspaceSlot[] => {
  return runtimes.get(workspaceId)?.openNotes ?? []
}

export const setRuntimeOpenNotes = (
  workspaceId: string,
  slots: NoteWorkspaceSlot[],
  timestamp?: number,
) => {
  const runtime = getWorkspaceRuntime(workspaceId)
  const writeTimestamp = timestamp ?? Date.now()

  // Phase 1: Reject stale writes to prevent snapshot overwrites
  if (writeTimestamp < runtime.openNotesUpdatedAt) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[WorkspaceRuntime] Rejected stale openNotes write for workspace ${workspaceId}`,
        {
          attemptedTimestamp: writeTimestamp,
          currentTimestamp: runtime.openNotesUpdatedAt,
          staleness: runtime.openNotesUpdatedAt - writeTimestamp,
          attemptedSlots: slots,
          currentSlots: runtime.openNotes,
        },
      )
    }
    return
  }

  runtime.openNotes = slots
  runtime.openNotesUpdatedAt = writeTimestamp
}

export const getRuntimeMembership = (workspaceId: string): Set<string> | null => {
  return runtimes.get(workspaceId)?.membership ?? null
}

export const setRuntimeMembership = (
  workspaceId: string,
  noteIds: Iterable<string>,
  timestamp?: number,
) => {
  const runtime = getWorkspaceRuntime(workspaceId)
  const writeTimestamp = timestamp ?? Date.now()

  // Phase 1: Reject stale writes to prevent snapshot overwrites
  if (writeTimestamp < runtime.membershipUpdatedAt) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[WorkspaceRuntime] Rejected stale membership write for workspace ${workspaceId}`,
        {
          attemptedTimestamp: writeTimestamp,
          currentTimestamp: runtime.membershipUpdatedAt,
          staleness: runtime.membershipUpdatedAt - writeTimestamp,
          attemptedNoteIds: Array.from(noteIds),
          currentMembership: Array.from(runtime.membership),
        },
      )
    }
    return
  }

  runtime.membership = new Set(noteIds)
  runtime.membershipUpdatedAt = writeTimestamp
}

// Phase 1: Note ownership functions (per-runtime)
export const setRuntimeNoteOwner = (workspaceId: string, noteId: string) => {
  if (!noteId || !workspaceId) return
  const runtime = getWorkspaceRuntime(workspaceId)
  runtime.noteOwners.set(noteId, workspaceId)
}

export const clearRuntimeNoteOwner = (workspaceId: string, noteId: string) => {
  if (!noteId || !workspaceId) return
  const runtime = runtimes.get(workspaceId)
  if (runtime) {
    runtime.noteOwners.delete(noteId)
  }
}

export const getRuntimeNoteOwner = (noteId: string): string | null => {
  // Check all runtimes to find which one owns this note
  for (const [workspaceId, runtime] of runtimes.entries()) {
    if (runtime.noteOwners.has(noteId)) {
      return runtime.noteOwners.get(noteId) ?? null
    }
  }
  return null
}
