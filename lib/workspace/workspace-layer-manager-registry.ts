import { LayerManager } from "@/lib/canvas/layer-manager"

const layerRegistry = new Map<string, LayerManager>()

export function getWorkspaceLayerManager(workspaceId: string | null | undefined): LayerManager | null {
  if (!workspaceId) return null
  if (!layerRegistry.has(workspaceId)) {
    layerRegistry.set(workspaceId, new LayerManager())
  }
  return layerRegistry.get(workspaceId) ?? null
}

export function clearWorkspaceLayerManager(workspaceId: string | null | undefined) {
  if (!workspaceId) return
  layerRegistry.delete(workspaceId)
}

export function resetWorkspaceLayerManagers() {
  layerRegistry.clear()
}

export function listWorkspaceLayerManagers(): string[] {
  return Array.from(layerRegistry.keys())
}
