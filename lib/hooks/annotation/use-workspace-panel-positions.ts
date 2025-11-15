import { useCallback, useEffect, useMemo, useState } from "react"

import { ensurePanelKey } from "@/lib/canvas/composite-id"

type PanelPosition = { x: number; y: number }

type SharedWorkspace = {
  dataStore?: {
    get(key: string): any
    has?(key: string): boolean
    on(event: string, listener: (key?: string) => void): void
    off(event: string, listener: (key?: string) => void): void
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

export type WorkspacePanelSnapshot = {
  size: { width: number; height: number } | null
  zIndex: number | null
  isPinned: boolean
}

const normalizePosition = (value: any): PanelPosition | null => {
  if (!value || typeof value !== "object") return null
  const { x, y } = value as { x?: number; y?: number }
  if (typeof x !== "number" || typeof y !== "number") {
    return null
  }
  return { x, y }
}

const normalizeSize = (value: any): { width: number; height: number } | null => {
  if (!value || typeof value !== "object") return null
  const { width, height } = value as { width?: number; height?: number }
  if (typeof width !== "number" || typeof height !== "number") {
    return null
  }
  return { width, height }
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
  const [panelSnapshotVersion, setPanelSnapshotVersion] = useState(0)
  const watchedPanelKeys = useMemo(
    () => sortedOpenNotes.map((note) => ensurePanelKey(note.noteId, "main")),
    [sortedOpenNotes],
  )

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

  const getPanelSnapshot = useCallback(
    (noteId: string): WorkspacePanelSnapshot | null => {
      if (!noteId) return null
      const dataStore = sharedWorkspace?.dataStore
      if (!dataStore) return null
      const storeKey = ensurePanelKey(noteId, "main")
      const record = dataStore.get(storeKey)
      if (!record || typeof record !== "object") {
        return null
      }
      const size =
        normalizeSize((record as any).size) ??
        normalizeSize((record as any).dimensions) ??
        null
      const zIndex = typeof (record as any).zIndex === "number" ? (record as any).zIndex : null
      const isPinned = Boolean((record as any).isPinned)
      return {
        size,
        zIndex,
        isPinned,
      }
    },
    [sharedWorkspace],
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

  useEffect(() => {
    const dataStore = sharedWorkspace?.dataStore
    if (
      !dataStore ||
      typeof dataStore.on !== "function" ||
      typeof dataStore.off !== "function" ||
      watchedPanelKeys.length === 0
    ) {
      return undefined
    }
    const keySet = new Set(watchedPanelKeys)
    const handleMutation = (key?: string) => {
      if (!key) return
      if (!keySet.has(String(key))) return
      setPanelSnapshotVersion((prev) => prev + 1)
    }
    dataStore.on("set", handleMutation)
    dataStore.on("update", handleMutation)
    return () => {
      dataStore.off("set", handleMutation)
      dataStore.off("update", handleMutation)
    }
  }, [sharedWorkspace, watchedPanelKeys])

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
    panelSnapshotVersion,
    getPanelSnapshot,
  }
}
