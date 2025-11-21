import { DataStore } from "@/lib/data-store"

const storeRegistry = new Map<string, DataStore>()

export function getWorkspaceStore(workspaceId: string | null | undefined): DataStore | null {
  if (!workspaceId) return null
  if (!storeRegistry.has(workspaceId)) {
    storeRegistry.set(workspaceId, new DataStore())
  }
  return storeRegistry.get(workspaceId) ?? null
}

export function clearWorkspaceStore(workspaceId: string | null | undefined) {
  if (!workspaceId) return
  storeRegistry.delete(workspaceId)
}

export function resetWorkspaceStores() {
  storeRegistry.clear()
}

export function listWorkspaceStores(): string[] {
  return Array.from(storeRegistry.keys())
}
