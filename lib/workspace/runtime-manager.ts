"use client"

import { DataStore } from "@/lib/data-store"
import { LayerManager } from "@/lib/canvas/layer-manager"
import { getWorkspaceStore } from "@/lib/workspace/workspace-store-registry"
import { getWorkspaceLayerManager } from "@/lib/workspace/workspace-layer-manager-registry"

export type WorkspaceRuntime = {
  id: string
  dataStore: DataStore
  layerManager: LayerManager
  pendingPanels: Set<string>
  pendingComponents: Set<string>
  status: "idle" | "active" | "paused"
}

const runtimes = new Map<string, WorkspaceRuntime>()

export const getWorkspaceRuntime = (workspaceId: string): WorkspaceRuntime => {
  const existing = runtimes.get(workspaceId)
  if (existing) {
    return existing
  }

  const dataStore = getWorkspaceStore(workspaceId) ?? new DataStore()
  const layerManager = getWorkspaceLayerManager(workspaceId) ?? new LayerManager()

  const runtime: WorkspaceRuntime = {
    id: workspaceId,
    dataStore,
    layerManager,
    pendingPanels: new Set(),
    pendingComponents: new Set(),
    status: "idle",
  }
  runtimes.set(workspaceId, runtime)
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
  if (!runtimes.has(workspaceId)) return
  const runtime = runtimes.get(workspaceId)
  runtime?.pendingPanels.clear()
  runtime?.pendingComponents.clear()
  runtimes.delete(workspaceId)
}

export const listWorkspaceRuntimeIds = () => Array.from(runtimes.keys())
