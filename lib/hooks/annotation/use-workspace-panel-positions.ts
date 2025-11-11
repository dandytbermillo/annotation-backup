import { useCallback } from "react"
import { ensurePanelKey } from "@/lib/canvas/composite-id"

type PanelPosition = { x: number; y: number }

type SharedWorkspace = {
  dataStore?: {
    get(key: string): any
    has?(key: string): boolean
  } | null
} | null

type WorkspacePanelPositionDeps = {
  sharedWorkspace: SharedWorkspace
  sortedOpenNotes: Array<{ noteId: string }>
  openNotes: Array<{ noteId: string; mainPosition?: PanelPosition | null }>
  activeNoteId: string | null
  getPendingPosition: (noteId: string) => PanelPosition | null | undefined
  getCachedPosition: (noteId: string) => PanelPosition | null | undefined
  debugLog: (event: { component: string; action: string; metadata?: Record<string, unknown> }) => void
}

const normalizePosition = (value: any): PanelPosition | null => {
  if (!value || typeof value !== "object") return null
  const { x, y } = value as { x?: number; y?: number }
  if (typeof x !== "number" || typeof y !== "number") {
    return null
  }
  return { x, y }
}

const resolveFromDataStore = (sharedWorkspace: SharedWorkspace, noteId: string): PanelPosition | null => {
  const dataStore = sharedWorkspace?.dataStore
  if (!dataStore) return null
  const storeKey = ensurePanelKey(noteId, "main")
  const record = dataStore.get(storeKey)
  if (record && typeof record === "object") {
    const candidates = [
      normalizePosition((record as any)?.position),
      normalizePosition((record as any)?.worldPosition),
      normalizePosition((record as any)?.mainPosition),
    ]
    for (const candidate of candidates) {
      if (candidate) return candidate
    }
  }
  return null
}

export function useWorkspacePanelPositions({
  sharedWorkspace,
  sortedOpenNotes,
  openNotes,
  activeNoteId,
  getPendingPosition,
  getCachedPosition,
  debugLog,
}: WorkspacePanelPositionDeps) {
  const logWorkspaceNotePositions = useCallback(
    (context: string) => {
      const dataStore = sharedWorkspace?.dataStore
      if (!dataStore) return

      const positions = sortedOpenNotes.map((note) => {
        const storeKey = ensurePanelKey(note.noteId, "main")
        const record = dataStore.get(storeKey)
        const position =
          record?.position ?? record?.worldPosition ?? record?.mainPosition ?? null

        return {
          noteId: note.noteId,
          hasRecord: Boolean(record),
          position,
        }
      })

      debugLog({
        component: "AnnotationApp",
        action: "panel_position_snapshot",
        metadata: {
          context,
          activeNoteId,
          positions,
        },
      })
    },
    [sharedWorkspace, sortedOpenNotes, activeNoteId, debugLog],
  )

  const resolveMainPanelPosition = useCallback(
    (noteId: string): PanelPosition | null => {
      if (!noteId) return null

      const pending = normalizePosition(getPendingPosition(noteId))
      if (pending) return pending

      const cached = normalizePosition(getCachedPosition(noteId))
      if (cached) return cached

      const openNote = openNotes.find((note) => note.noteId === noteId)
      const openPosition = normalizePosition(openNote?.mainPosition)
      if (openPosition) return openPosition

      const dataStorePosition = resolveFromDataStore(sharedWorkspace, noteId)
      if (dataStorePosition) {
        return dataStorePosition
      }

      console.log("[resolveMainPanelPosition] DataStore miss, trying database for", noteId)
      return null
    },
    [getPendingPosition, getCachedPosition, openNotes, sharedWorkspace],
  )

  const hasRenderedMainPanel = useCallback(
    (noteId: string | null | undefined): boolean => {
      if (!noteId) return false
      const dataStore = sharedWorkspace?.dataStore
      if (!dataStore) return false
      const storeKey = ensurePanelKey(noteId, "main")

      if (typeof dataStore.has === "function") {
        try {
          return Boolean(dataStore.has(storeKey))
        } catch {
          // Fall through to get + truthiness if .has throws (defensive for custom stores)
        }
      }

      return Boolean(dataStore.get(storeKey))
    },
    [sharedWorkspace],
  )

  return {
    logWorkspaceNotePositions,
    resolveMainPanelPosition,
    hasRenderedMainPanel,
  }
}
