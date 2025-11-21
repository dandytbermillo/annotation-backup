import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect, type Dispatch, type SetStateAction } from "react"

import type { LayerContextValue } from "@/components/canvas/layer-provider"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
import { DataStore } from "@/lib/data-store"
import { getWorkspaceStore } from "@/lib/workspace/workspace-store-registry"
import { NoteWorkspaceAdapter, type NoteWorkspaceSummary } from "@/lib/adapters/note-workspace-adapter"
import { isNoteWorkspaceEnabled, isNoteWorkspaceV2Enabled } from "@/lib/flags/note"
import type { CanvasState } from "@/lib/hooks/annotation/use-workspace-canvas-state"
import type { WorkspacePanelSnapshot } from "@/lib/hooks/annotation/use-workspace-panel-positions"
import type { NoteWorkspacePayload, NoteWorkspacePanelSnapshot } from "@/lib/types/note-workspace"
import type { NoteWorkspace } from "@/lib/workspace/types"
import {
  cacheWorkspaceSnapshot,
  getPendingPanelCount,
  getWorkspaceSnapshot,
  setNoteWorkspaceOwner,
  clearNoteWorkspaceOwner,
  waitForWorkspaceSnapshotReady,
  subscribeToWorkspaceSnapshotState,
  setActiveWorkspaceContext,
  type NoteWorkspaceSnapshot,
} from "@/lib/note-workspaces/state"

type DebugLogger = (event: {
  component: string
  action: string
  content_preview?: string
  metadata?: Record<string, unknown>
  note_id?: string | null
}) => void | Promise<void>

const DEFAULT_CAMERA = { x: 0, y: 0, scale: 1 }

const normalizePoint = (value: any): { x: number; y: number } | null => {
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

const roundNumber = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0
  }
  return Number(value.toFixed(4))
}

const serializeWorkspacePayload = (payload: NoteWorkspacePayload): string => {
  const normalizePointForHash = (point: { x?: number | null; y?: number | null } | null | undefined) => {
    if (!point || typeof point !== "object") return null
    return {
      x: roundNumber(point.x),
      y: roundNumber(point.y),
    }
  }

  const normalizeSizeForHash = (size: { width?: number | null; height?: number | null } | null | undefined) => {
    if (!size || typeof size !== "object") return null
    return {
      width: roundNumber(size.width),
      height: roundNumber(size.height),
    }
  }

  const normalizedOpenNotes = [...payload.openNotes]
    .map((entry) => ({
      noteId: entry.noteId ?? "",
      position: normalizePointForHash(entry.position as any),
      size: normalizeSizeForHash(entry.size as any),
      zIndex: typeof entry.zIndex === "number" ? entry.zIndex : null,
      isPinned: Boolean(entry.isPinned),
    }))
    .sort((a, b) => a.noteId.localeCompare(b.noteId))

  const normalizedPanels = [...payload.panels]
    .map((panel) => ({
      noteId: panel.noteId ?? "",
      panelId: panel.panelId ?? "",
      type: panel.type ?? null,
      title: panel.title ?? null,
      position: normalizePointForHash(panel.position),
      size: normalizeSizeForHash(panel.size),
      zIndex: typeof panel.zIndex === "number" ? panel.zIndex : null,
      metadata: panel.metadata ?? null,
      parentId: panel.parentId ?? null,
      branches: Array.isArray(panel.branches) ? [...panel.branches].sort() : null,
      worldPosition: normalizePointForHash(panel.worldPosition),
      worldSize: normalizeSizeForHash(panel.worldSize),
    }))
    .sort((a, b) => {
      const byNote = a.noteId.localeCompare(b.noteId)
      if (byNote !== 0) return byNote
      return a.panelId.localeCompare(b.panelId)
    })

  const normalizedCamera = {
    x: roundNumber(payload.camera?.x),
    y: roundNumber(payload.camera?.y),
    scale: roundNumber(payload.camera?.scale ?? 1),
  }

  return JSON.stringify({
    activeNoteId: payload.activeNoteId ?? null,
    camera: normalizedCamera,
    openNotes: normalizedOpenNotes,
    panels: normalizedPanels,
  })
}

const serializePanelSnapshots = (panels: NoteWorkspacePanelSnapshot[]): string => {
  const normalizePointForHash = (point: { x?: number | null; y?: number | null } | null | undefined) => {
    if (!point || typeof point !== "object") return null
    return {
      x: roundNumber(point.x),
      y: roundNumber(point.y),
    }
  }

  const normalizeSizeForHash = (size: { width?: number | null; height?: number | null } | null | undefined) => {
    if (!size || typeof size !== "object") return null
    return {
      width: roundNumber(size.width),
      height: roundNumber(size.height),
    }
  }

  const normalizedPanels = panels
    .map((panel) => ({
      noteId: panel.noteId ?? "",
      panelId: panel.panelId ?? "",
      type: panel.type ?? null,
      title: panel.title ?? null,
      position: normalizePointForHash(panel.position),
      size: normalizeSizeForHash(panel.size),
      zIndex: typeof panel.zIndex === "number" ? panel.zIndex : null,
      parentId: panel.parentId ?? null,
      branches: Array.isArray(panel.branches) ? [...panel.branches].sort() : null,
      worldPosition: normalizePointForHash(panel.worldPosition),
      worldSize: normalizeSizeForHash(panel.worldSize),
    }))
    .sort((a, b) => {
      const byNote = a.noteId.localeCompare(b.noteId)
      if (byNote !== 0) return byNote
      return a.panelId.localeCompare(b.panelId)
    })

  return JSON.stringify(normalizedPanels)
}

export type NoteWorkspaceSlot = {
  noteId: string
  mainPosition?: { x: number; y: number } | null
}
const existingOpenSnapshot = new Map<string, boolean>()

type UseNoteWorkspaceOptions = {
  openNotes: NoteWorkspaceSlot[]
  activeNoteId: string | null
  setActiveNoteId: Dispatch<SetStateAction<string | null>>
  resolveMainPanelPosition: (noteId: string) => { x: number; y: number } | null
  openWorkspaceNote: (noteId: string, options?: { mainPosition?: { x: number; y: number } | null; persist?: boolean; persistPosition?: boolean }) => Promise<void>
  closeWorkspaceNote: (noteId: string, options?: { persist?: boolean; removeWorkspace?: boolean }) => Promise<void>
  layerContext: LayerContextValue | null
  isWorkspaceReady: boolean
  getPanelSnapshot: (noteId: string) => WorkspacePanelSnapshot | null
  panelSnapshotVersion: number
  canvasState: CanvasState | null
  setCanvasState?: Dispatch<SetStateAction<CanvasState>>
  onUnavailable?: () => void
  debugLog?: DebugLogger
  sharedWorkspace: NoteWorkspace | null
}

type UseNoteWorkspaceResult = {
  featureEnabled: boolean
  isUnavailable: boolean
  workspaces: NoteWorkspaceSummary[]
  isLoading: boolean
  statusHelperText: string | null
  currentWorkspaceId: string | null
  snapshotRevision: number
  selectWorkspace: (workspaceId: string) => void
  createWorkspace: () => void
  deleteWorkspace: (workspaceId: string) => void
  renameWorkspace: (workspaceId: string, name: string) => void
}

const formatSyncedLabel = (timestamp: string | Date) => {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  return `Note workspace synced at ${new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date)}`
}

export function useNoteWorkspaces({
  openNotes,
  activeNoteId,
  setActiveNoteId,
  resolveMainPanelPosition,
  openWorkspaceNote,
  closeWorkspaceNote,
  layerContext,
  isWorkspaceReady,
  getPanelSnapshot,
  panelSnapshotVersion,
  canvasState,
  setCanvasState,
  onUnavailable,
  debugLog: debugLogger,
  sharedWorkspace,
}: UseNoteWorkspaceOptions): UseNoteWorkspaceResult {
  const flagEnabled = isNoteWorkspaceEnabled()
  const v2Enabled = isNoteWorkspaceV2Enabled()
  const adapterRef = useRef<NoteWorkspaceAdapter | null>(null)
  const panelSnapshotsRef = useRef<Map<string, NoteWorkspacePanelSnapshot[]>>(new Map())
  const workspaceSnapshotsRef = useRef<Map<string, NoteWorkspacePanelSnapshot[]>>(new Map())
  const snapshotOwnerWorkspaceIdRef = useRef<string | null>(null)
  const currentWorkspaceIdRef = useRef<string | null>(null)
  const lastPreviewedSnapshotRef = useRef<Map<string, NoteWorkspaceSnapshot | null>>(new Map())
  const workspaceRevisionRef = useRef<Map<string, string | null>>(new Map())
  const workspaceStoresRef = useRef<Map<string, DataStore>>(new Map())
  const lastSavedPayloadHashRef = useRef<Map<string, string>>(new Map())
  const lastPanelSnapshotHashRef = useRef<string | null>(null)
  const ownedNotesRef = useRef<Map<string, string>>(new Map())
  const lastSaveReasonRef = useRef<string>("initial_schedule")
  const saveInFlightRef = useRef(false)
  const skipSavesUntilRef = useRef(0)
  const [workspaces, setWorkspaces] = useState<NoteWorkspaceSummary[]>([])
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [statusHelperText, setStatusHelperText] = useState<string | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isHydratingRef = useRef(false)
  const lastCameraRef = useRef(DEFAULT_CAMERA)
  const [isUnavailable, setIsUnavailable] = useState(false)
  const featureEnabled = flagEnabled && !isUnavailable
  const unavailableNoticeShownRef = useRef(false)
  const lastHydratedWorkspaceIdRef = useRef<string | null>(null)
  const [snapshotRevision, setSnapshotRevision] = useState(0)
  const bumpSnapshotRevision = useCallback(() => {
    setSnapshotRevision((prev) => prev + 1)
  }, [])

  const currentWorkspaceSummary = useMemo(
    () => workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null,
    [currentWorkspaceId, workspaces],
  )
  const currentWorkspaceSummaryId = currentWorkspaceSummary?.id ?? null

  const makeWorkspaceKey = useCallback(
    (workspaceId: string | null | undefined, panelKey: string) => {
      if (!v2Enabled || !workspaceId) return panelKey
      return `ws:${workspaceId}::${panelKey}`
    },
    [v2Enabled],
  )

  const stripWorkspaceKey = useCallback(
    (workspaceId: string | null | undefined, key: string) => {
      if (!v2Enabled || !workspaceId) return key
      const prefix = `ws:${workspaceId}::`
      return key.startsWith(prefix) ? key.slice(prefix.length) : null
    },
    [v2Enabled],
  )

  const getWorkspaceDataStore = useCallback(
    (workspaceId: string | null | undefined) => {
      if (!v2Enabled) {
        return sharedWorkspace?.dataStore ?? null
      }
      return getWorkspaceStore(workspaceId ?? undefined)
    },
    [sharedWorkspace?.dataStore, v2Enabled],
  )

  const emitDebugLog = useCallback(
    (payload: Parameters<NonNullable<DebugLogger>>[0]) => {
      if (!debugLogger) return
      let workspaceName: string | undefined
      if (payload.metadata && typeof payload.metadata === "object") {
        const workspaceId =
          typeof payload.metadata.workspaceId === "string"
            ? payload.metadata.workspaceId
            : null
        if (workspaceId) {
          const matching = workspaces.find((entry) => entry.id === workspaceId)
          if (matching) {
            workspaceName = matching.name
          }
        }
      } else {
        payload.metadata = {}
      }
      if (payload.metadata && workspaceName) {
        ;(payload.metadata as Record<string, unknown>).workspaceName = workspaceName
      }
      void debugLogger(payload)
    },
    [debugLogger, workspaces],
  )

  const collectPanelSnapshotsFromDataStore = useCallback((): NoteWorkspacePanelSnapshot[] => {
    const snapshots: NoteWorkspacePanelSnapshot[] = []
    const activeWorkspaceId = snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
    const dataStore = getWorkspaceDataStore(activeWorkspaceId)
    if (!dataStore || typeof dataStore.keys !== "function") {
      return snapshots
    }
    for (const key of dataStore.keys() as Iterable<string>) {
      const rawKey = String(key)
      const strippedKey = stripWorkspaceKey(activeWorkspaceId, rawKey)
      if (v2Enabled && activeWorkspaceId && strippedKey === null) {
        continue
      }
      const parsed = parsePanelKey(strippedKey ?? rawKey)
      const noteId = parsed?.noteId
      const panelId = parsed?.panelId ?? "main"
      if (!noteId) continue
      const record = dataStore.get(rawKey)
      if (!record || typeof record !== "object") continue
      const position = normalizePoint((record as any).position) ?? normalizePoint((record as any).worldPosition)
      const size = normalizeSize((record as any).dimensions) ?? normalizeSize((record as any).worldSize)
      const branches = Array.isArray((record as any).branches)
        ? (record as any).branches.map((entry: unknown) => String(entry))
        : null
      if (!position && !size && !branches && typeof (record as any).zIndex !== "number") {
        continue
      }
      snapshots.push({
        noteId,
        panelId,
        type: typeof (record as any).type === "string" ? (record as any).type : null,
        title: typeof (record as any).title === "string" ? (record as any).title : null,
        position,
        size,
        zIndex: typeof (record as any).zIndex === "number" ? (record as any).zIndex : null,
        metadata:
          (record as any).metadata && typeof (record as any).metadata === "object"
            ? (record as any).metadata
            : null,
        parentId: typeof (record as any).parentId === "string" ? (record as any).parentId : null,
        branches,
        worldPosition: normalizePoint((record as any).worldPosition),
        worldSize: normalizeSize((record as any).worldSize),
      })
    }
    if (snapshots.length === 0 && panelSnapshotsRef.current.size > 0) {
      return Array.from(panelSnapshotsRef.current.values()).flat()
    }
    return snapshots
  }, [sharedWorkspace])

  const getAllPanelSnapshots = useCallback((): NoteWorkspacePanelSnapshot[] => {
    const workspaceId =
      snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
    if (workspaceId && workspaceSnapshotsRef.current.has(workspaceId)) {
      return workspaceSnapshotsRef.current.get(workspaceId) ?? []
    }
    if (panelSnapshotsRef.current.size > 0) {
      return Array.from(panelSnapshotsRef.current.values()).flat()
    }
    return collectPanelSnapshotsFromDataStore()
  }, [collectPanelSnapshotsFromDataStore, currentWorkspaceId])

  const updatePanelSnapshotMap = useCallback(
    (panels: NoteWorkspacePanelSnapshot[], reason: string) => {
      if (!snapshotOwnerWorkspaceIdRef.current) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_skipped_no_owner",
          metadata: {
            reason,
            panelCount: panels.length,
            noteIds: Array.from(new Set(panels.map((panel) => panel.noteId))),
            timestampMs: Date.now(),
          },
        })
        return
      }
      if (panels.length === 0) return
      const next = new Map(panelSnapshotsRef.current)
      panels.forEach((panel) => {
        if (!panel.noteId) return
        const existing = next.get(panel.noteId) ?? []
        const filtered = existing.filter((entry) => entry.panelId !== panel.panelId)
        filtered.push(panel)
        next.set(panel.noteId, filtered)
      })
      panelSnapshotsRef.current = next
      const ownerId = snapshotOwnerWorkspaceIdRef.current
      if (ownerId) {
        workspaceSnapshotsRef.current.set(ownerId, Array.from(next.values()).flat())
      }
      emitDebugLog({
        component: "NoteWorkspace",
        action: "panel_snapshot_updated",
        metadata: {
          reason,
          panelCount: panels.length,
          noteIds: Array.from(new Set(panels.map((panel) => panel.noteId))),
          workspaceId: ownerId,
          timestampMs: Date.now(),
          cachedWorkspaceCount: workspaceSnapshotsRef.current.size,
        },
      })
    },
    [emitDebugLog],
  )

  useEffect(() => {
    const activeWorkspaceId = snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
    const dataStore = getWorkspaceDataStore(activeWorkspaceId)
    if (!dataStore || typeof dataStore.on !== "function" || typeof dataStore.off !== "function") {
      return undefined
    }
    if (v2Enabled && activeWorkspaceId && !snapshotOwnerWorkspaceIdRef.current) {
      snapshotOwnerWorkspaceIdRef.current = activeWorkspaceId
    }

    const handleMutation = () => {
      const snapshots = collectPanelSnapshotsFromDataStore()
      const snapshotHash = serializePanelSnapshots(snapshots)
      if (snapshotHash === lastPanelSnapshotHashRef.current) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_skip_no_changes",
          metadata: {
            workspaceId: snapshotOwnerWorkspaceIdRef.current,
            panelCount: snapshots.length,
          },
        })
        return
      }
      lastPanelSnapshotHashRef.current = snapshotHash
      updatePanelSnapshotMap(snapshots, "datastore_mutation")
    }

    dataStore.on("set", handleMutation)
    dataStore.on("update", handleMutation)
    dataStore.on("delete", handleMutation)

    return () => {
      dataStore.off("set", handleMutation)
      dataStore.off("update", handleMutation)
      dataStore.off("delete", handleMutation)
    }
  }, [
    collectPanelSnapshotsFromDataStore,
    emitDebugLog,
    getWorkspaceDataStore,
    updatePanelSnapshotMap,
    currentWorkspaceId,
  ])

  const waitForPanelSnapshotReadiness = useCallback(
    async (reason: string, maxWaitMs = 800) => {
      if (!featureEnabled || !v2Enabled) return
      const workspaceId =
        snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
      if (!workspaceId) return
      const pendingCount = getPendingPanelCount(workspaceId)
      if (pendingCount === 0) return
      emitDebugLog({
        component: "NoteWorkspace",
        action: "snapshot_wait_pending_panels",
        metadata: {
          workspaceId,
          pendingCount,
          reason,
        },
      })
      const ready = await Promise.race<boolean>([
        waitForWorkspaceSnapshotReady(workspaceId, maxWaitMs),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), maxWaitMs)),
      ])
      emitDebugLog({
        component: "NoteWorkspace",
        action: ready ? "snapshot_pending_resolved" : "snapshot_pending_timeout",
        metadata: {
          workspaceId,
          pendingCount: getPendingPanelCount(workspaceId),
          reason,
        },
      })
    },
    [currentWorkspaceId, emitDebugLog, featureEnabled, v2Enabled],
  )

  const applyPanelSnapshots = useCallback(
    (panels: NoteWorkspacePanelSnapshot[] | undefined, targetNoteIds: Set<string>) => {
      if (!panels || panels.length === 0) return
      const activeWorkspaceId = snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
      const dataStore = getWorkspaceDataStore(activeWorkspaceId)
      if (!dataStore) return
      if (typeof dataStore.keys === "function") {
        const keysToRemove: string[] = []
        for (const key of dataStore.keys() as Iterable<string>) {
          const rawKey = String(key)
          const strippedKey = stripWorkspaceKey(activeWorkspaceId, rawKey)
          if (v2Enabled && activeWorkspaceId && strippedKey === null) {
            continue
          }
          const parsed = parsePanelKey(strippedKey ?? rawKey)
          if (parsed?.noteId && targetNoteIds.has(parsed.noteId)) {
            keysToRemove.push(rawKey)
          }
        }
        keysToRemove.forEach((key) => {
          dataStore.delete(key)
        })
      }
      panels.forEach((panel) => {
        if (!panel.noteId || !panel.panelId || !targetNoteIds.has(panel.noteId)) return
        const key = ensurePanelKey(panel.noteId, panel.panelId)
        const namespacedKey = makeWorkspaceKey(activeWorkspaceId, key)
        dataStore.set(namespacedKey, {
          id: panel.panelId,
          type: panel.type ?? "note",
          position: panel.position ?? panel.worldPosition ?? null,
          dimensions: panel.size ?? panel.worldSize ?? null,
          zIndex: panel.zIndex ?? undefined,
          title: panel.title ?? undefined,
          metadata: panel.metadata ?? undefined,
          parentId: panel.parentId ?? null,
          branches: panel.branches ?? [],
          worldPosition: panel.worldPosition ?? panel.position ?? null,
          worldSize: panel.worldSize ?? panel.size ?? null,
        })
      })
      lastPanelSnapshotHashRef.current = serializePanelSnapshots(panels)
    },
    [sharedWorkspace],
  )

  const captureCurrentWorkspaceSnapshot = useCallback(async () => {
    const workspaceId = snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceId
    if (!workspaceId) return
    await waitForPanelSnapshotReadiness("capture_snapshot")
    const captureStartedAt = Date.now()
    emitDebugLog({
      component: "NoteWorkspace",
      action: "snapshot_capture_start",
      metadata: {
        workspaceId,
        openNoteCount: openNotes.length,
        activeNoteId,
        timestampMs: captureStartedAt,
      },
    })
    const previousOwner = snapshotOwnerWorkspaceIdRef.current
    snapshotOwnerWorkspaceIdRef.current = workspaceId
    const snapshots = collectPanelSnapshotsFromDataStore()
    updatePanelSnapshotMap(snapshots, "workspace_switch_capture")
    workspaceSnapshotsRef.current.set(workspaceId, snapshots)
    lastPanelSnapshotHashRef.current = serializePanelSnapshots(snapshots)
    if (v2Enabled) {
      cacheWorkspaceSnapshot({
        workspaceId,
        panels: snapshots,
        openNotes: openNotes.map((note) => ({
          noteId: note.noteId,
          mainPosition: resolveMainPanelPosition(note.noteId),
        })),
        camera: canvasState
          ? {
              x: canvasState.translateX,
              y: canvasState.translateY,
              scale: canvasState.zoom,
            }
          : layerContext?.transforms.notes ?? DEFAULT_CAMERA,
        activeNoteId,
      })
      lastPreviewedSnapshotRef.current.delete(workspaceId)
    }
    snapshotOwnerWorkspaceIdRef.current = previousOwner ?? workspaceId
    const cameraSource = canvasState
      ? "canvas_state"
      : layerContext?.transforms.notes
        ? "layer_transform"
        : "default_camera"
    emitDebugLog({
      component: "NoteWorkspace",
      action: "snapshot_capture_complete",
      metadata: {
        workspaceId,
        panelCount: snapshots.length,
        openNoteCount: openNotes.length,
        durationMs: Date.now() - captureStartedAt,
        cameraSource,
        timestampMs: Date.now(),
      },
    })
  }, [
    activeNoteId,
    canvasState,
    collectPanelSnapshotsFromDataStore,
    currentWorkspaceId,
    emitDebugLog,
    layerContext?.transforms.notes,
    openNotes,
    resolveMainPanelPosition,
    updatePanelSnapshotMap,
    waitForPanelSnapshotReadiness,
    v2Enabled,
  ])

  const rehydratePanelsForNote = useCallback(
    (noteId: string, workspaceId?: string) => {
      if (workspaceId && workspaceSnapshotsRef.current.has(workspaceId)) {
        const perWorkspace = workspaceSnapshotsRef.current
          .get(workspaceId)!
          .filter((panel) => panel.noteId === noteId)
        if (perWorkspace.length > 0) {
          applyPanelSnapshots(perWorkspace, new Set([noteId]))
          return
        }
      }
      const stored = panelSnapshotsRef.current.get(noteId)
      if (!stored || stored.length === 0) return
      applyPanelSnapshots(stored, new Set([noteId]))
    },
    [applyPanelSnapshots],
  )

  const previewWorkspaceFromSnapshot = useCallback(
    async (workspaceId: string, snapshot: NoteWorkspaceSnapshot) => {
      const lastPreview = lastPreviewedSnapshotRef.current.get(workspaceId)
      if (lastPreview === snapshot) {
        return
      }
      snapshotOwnerWorkspaceIdRef.current = workspaceId
      const panelSnapshots = snapshot.panels ?? []
      const targetIds = new Set(snapshot.openNotes.map((entry) => entry.noteId))
      workspaceSnapshotsRef.current.set(workspaceId, panelSnapshots)
      if (panelSnapshots.length > 0) {
        applyPanelSnapshots(panelSnapshots, targetIds)
      }

      const currentOpenIds = new Set(openNotes.map((note) => note.noteId))
      const notesToClose = openNotes.filter((note) => !targetIds.has(note.noteId))
      await Promise.all(
        notesToClose.map((note) =>
          closeWorkspaceNote(note.noteId, { persist: false, removeWorkspace: false }).catch(() => {}),
        ),
      )
      notesToClose.forEach((note) => currentOpenIds.delete(note.noteId))

      for (const entry of snapshot.openNotes) {
        if (currentOpenIds.has(entry.noteId)) continue
        await openWorkspaceNote(entry.noteId, {
          mainPosition: entry.mainPosition ?? undefined,
          persist: false,
          persistPosition: false,
        })
        currentOpenIds.add(entry.noteId)
      }

      const nextActive = snapshot.activeNoteId || snapshot.openNotes[0]?.noteId || null
      setActiveNoteId(nextActive)

      const nextCamera = snapshot.camera ?? DEFAULT_CAMERA
      if (layerContext?.setTransform) {
        layerContext.setTransform("notes", nextCamera)
      }
      if (setCanvasState) {
        setCanvasState((prev) => ({
          ...prev,
          translateX: nextCamera.x,
          translateY: nextCamera.y,
          zoom: nextCamera.scale,
        }))
      }

      lastPreviewedSnapshotRef.current.set(workspaceId, snapshot)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "preview_snapshot_applied",
        metadata: {
          workspaceId,
          panelCount: panelSnapshots.length,
          openCount: snapshot.openNotes.length,
          activeNoteId: nextActive,
        },
      })
      bumpSnapshotRevision()
    },
    [
      applyPanelSnapshots,
      closeWorkspaceNote,
      emitDebugLog,
      layerContext,
      openNotes,
      openWorkspaceNote,
      setActiveNoteId,
      setCanvasState,
      bumpSnapshotRevision,
    ],
  )

  useEffect(() => {
    if (!featureEnabled || !v2Enabled) {
      setActiveWorkspaceContext(null)
      return
    }
    currentWorkspaceIdRef.current = currentWorkspaceId
    setActiveWorkspaceContext(currentWorkspaceId ?? null)
    return () => {
      setActiveWorkspaceContext(null)
    }
  }, [featureEnabled, v2Enabled, currentWorkspaceId])

  useEffect(() => {
    if (!v2Enabled) return
    if (currentWorkspaceId && snapshotOwnerWorkspaceIdRef.current !== currentWorkspaceId) {
      snapshotOwnerWorkspaceIdRef.current = currentWorkspaceId
    }
    return () => {
      if (snapshotOwnerWorkspaceIdRef.current === currentWorkspaceId) {
        snapshotOwnerWorkspaceIdRef.current = null
      }
    }
  }, [v2Enabled, currentWorkspaceId])

  useEffect(() => {
    if (!featureEnabled || !v2Enabled) {
      if (ownedNotesRef.current.size > 0) {
        ownedNotesRef.current.forEach((_, noteId) => {
          clearNoteWorkspaceOwner(noteId)
        })
        ownedNotesRef.current.clear()
      }
      return
    }
    const workspaceId = currentWorkspaceId
    if (!workspaceId) {
      ownedNotesRef.current.forEach((_, noteId) => {
        clearNoteWorkspaceOwner(noteId)
      })
      ownedNotesRef.current.clear()
      return
    }
    const nextNoteIds = new Set(openNotes.map((entry) => entry.noteId))
    nextNoteIds.forEach((noteId) => {
      if (!noteId) return
      const existingOwner = ownedNotesRef.current.get(noteId)
      if (existingOwner !== workspaceId) {
        setNoteWorkspaceOwner(noteId, workspaceId)
        ownedNotesRef.current.set(noteId, workspaceId)
      }
    })
    Array.from(ownedNotesRef.current.keys()).forEach((noteId) => {
      if (!nextNoteIds.has(noteId)) {
        clearNoteWorkspaceOwner(noteId)
        ownedNotesRef.current.delete(noteId)
      }
    })
  }, [featureEnabled, v2Enabled, currentWorkspaceId, openNotes])

  const markUnavailable = useCallback(
    (reason?: string) => {
      if (!flagEnabled) return
      setIsUnavailable(true)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "api_unavailable",
        metadata: { reason: reason ?? null },
      })
      if (!unavailableNoticeShownRef.current) {
        unavailableNoticeShownRef.current = true
        onUnavailable?.()
      }
    },
    [emitDebugLog, flagEnabled, onUnavailable],
  )

  const buildPayload = useCallback((): NoteWorkspacePayload => {
    const cameraTransform =
      canvasState != null
        ? {
            x: canvasState.translateX,
            y: canvasState.translateY,
            scale: canvasState.zoom,
          }
        : layerContext?.transforms.notes ?? DEFAULT_CAMERA
    lastCameraRef.current = cameraTransform
    const panelSnapshots = getAllPanelSnapshots()
    updatePanelSnapshotMap(panelSnapshots, "build_payload")
    const payload: NoteWorkspacePayload = {
      schemaVersion: "1.0.0",
      openNotes: openNotes.map((note) => {
        const snapshot = getPanelSnapshot(note.noteId)
        return {
          noteId: note.noteId,
          position: resolveMainPanelPosition(note.noteId) ?? null,
          size: snapshot?.size ?? null,
          zIndex: snapshot?.zIndex ?? null,
          isPinned: snapshot?.isPinned ?? false,
        }
      }),
      activeNoteId,
      camera: cameraTransform,
      panels: panelSnapshots,
    }
    if (v2Enabled && currentWorkspaceId) {
      cacheWorkspaceSnapshot({
        workspaceId: currentWorkspaceId,
        panels: panelSnapshots,
        openNotes: payload.openNotes.map((entry) => ({
          noteId: entry.noteId,
          mainPosition: entry.position ?? null,
        })),
        camera: cameraTransform,
        activeNoteId,
      })
      lastPreviewedSnapshotRef.current.delete(currentWorkspaceId)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "snapshot_cached_from_payload",
        metadata: {
          workspaceId: currentWorkspaceId,
          panelCount: panelSnapshots.length,
          openCount: payload.openNotes.length,
        },
      })
    }
    return payload
  }, [
    activeNoteId,
    currentWorkspaceId,
    canvasState?.translateX,
    canvasState?.translateY,
    canvasState?.zoom,
    getPanelSnapshot,
    openNotes,
    resolveMainPanelPosition,
    layerContext?.transforms.notes?.x,
    layerContext?.transforms.notes?.y,
    layerContext?.transforms.notes?.scale,
    getAllPanelSnapshots,
    panelSnapshotVersion,
    updatePanelSnapshotMap,
    v2Enabled,
    emitDebugLog,
  ])

  const persistWorkspaceNow = useCallback(async () => {
    const now = Date.now()
    if (now < skipSavesUntilRef.current) {
      return
    }
    if (saveInFlightRef.current) {
      return
    }
    saveInFlightRef.current = true
    if (!featureEnabled || !currentWorkspaceSummary || isHydratingRef.current) {
      saveInFlightRef.current = false
      return
    }
    if (!adapterRef.current) return
    const saveStart = Date.now()
    const workspaceId = currentWorkspaceSummary.id
    const reason = lastSaveReasonRef.current
    emitDebugLog({
      component: "NoteWorkspace",
      action: "save_attempt",
      metadata: {
        workspaceId,
        reason,
        timestampMs: saveStart,
        openCount: openNotes.length,
      },
    })
    try {
      await waitForPanelSnapshotReadiness("persist_workspace")
      const payload = buildPayload()
      const payloadHash = serializeWorkspacePayload(payload)
      const previousHash = lastSavedPayloadHashRef.current.get(workspaceId)
      if (previousHash === payloadHash) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_skip_no_changes",
          metadata: {
            workspaceId,
            panelCount: payload.panels.length,
            openCount: payload.openNotes.length,
            durationMs: Date.now() - saveStart,
            reason,
          },
        })
        saveInFlightRef.current = false
        return
      }
      const updated = await adapterRef.current.saveWorkspace({
        id: workspaceId,
        payload,
        revision: currentWorkspaceSummary.revision,
      })
      workspaceRevisionRef.current.set(workspaceId, updated.revision ?? null)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "save_success",
        metadata: {
          workspaceId,
          panelCount: payload.panels.length,
          openCount: payload.openNotes.length,
          durationMs: Date.now() - saveStart,
          reason,
        },
      })
      saveInFlightRef.current = false
      lastSavedPayloadHashRef.current.set(workspaceId, payloadHash)
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === updated.id
            ? {
                ...workspace,
                revision: updated.revision,
                updatedAt: updated.updatedAt,
                noteCount: updated.noteCount,
              }
            : workspace,
        ),
      )
      setStatusHelperText(formatSyncedLabel(updated.updatedAt))
    } catch (error) {
      console.warn("[NoteWorkspace] save failed", error)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_error",
          metadata: {
            workspaceId,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - saveStart,
            reason,
          },
        })
        skipSavesUntilRef.current = Date.now() + 1000
        saveInFlightRef.current = false
        return
    }
    saveInFlightRef.current = false
  }, [buildPayload, currentWorkspaceSummary, emitDebugLog, featureEnabled, openNotes.length])

  useEffect(() => {
    if (!featureEnabled || !v2Enabled) return
    const unsubscribe = subscribeToWorkspaceSnapshotState((event) => {
      if (event.type === "panel_pending") {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_pending",
          metadata: {
            workspaceId: event.workspaceId,
            noteId: event.noteId,
            panelId: event.panelId,
            pendingCount: event.pendingCount,
            timestampMs: event.timestamp,
          },
        })
      } else if (event.type === "panel_ready") {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_ready",
          metadata: {
            workspaceId: event.workspaceId,
            noteId: event.noteId,
            panelId: event.panelId,
            pendingCount: event.pendingCount,
            timestampMs: event.timestamp,
          },
        })
        if (
          event.workspaceId === currentWorkspaceId &&
          !isHydratingRef.current
        ) {
          void (async () => {
            await captureCurrentWorkspaceSnapshot()
            lastSaveReasonRef.current = "panel_ready_auto_save"
            await persistWorkspaceNow()
          })()
        }
      }
    })
    return unsubscribe
  }, [
    captureCurrentWorkspaceSnapshot,
    currentWorkspaceId,
    emitDebugLog,
    featureEnabled,
    persistWorkspaceNow,
    v2Enabled,
  ])

  const scheduleSave = useCallback(
    (options?: { immediate?: boolean; reason?: string }) => {
      if (!featureEnabled || !currentWorkspaceSummary || isHydratingRef.current) {
        return
      }
      const { immediate = false, reason = "unspecified" } = options ?? {}
      if (!adapterRef.current) return
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      lastSaveReasonRef.current = reason
      emitDebugLog({
        component: "NoteWorkspace",
        action: "save_schedule",
        metadata: {
          workspaceId: currentWorkspaceSummary.id,
          immediate,
          reason,
        },
      })
      if (immediate) {
        void persistWorkspaceNow()
        return
      }
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null
        void persistWorkspaceNow()
      }, 2500)
    },
    [currentWorkspaceSummary, emitDebugLog, featureEnabled, persistWorkspaceNow],
  )

  const flushPendingSave = useCallback(
    (reason = "manual_flush") => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      lastSaveReasonRef.current = reason
      emitDebugLog({
        component: "NoteWorkspace",
        action: "save_flush",
        metadata: {
          workspaceId: currentWorkspaceSummaryId,
          reason,
        },
      })
      void persistWorkspaceNow()
    },
    [currentWorkspaceSummaryId, emitDebugLog, persistWorkspaceNow],
  )

  const hydrateWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!adapterRef.current) return
      setIsLoading(true)
      const hydrateStart = Date.now()
      try {
        const record = await adapterRef.current.loadWorkspace(workspaceId)
        isHydratingRef.current = true
        snapshotOwnerWorkspaceIdRef.current = workspaceId
        workspaceRevisionRef.current.set(workspaceId, (record as any).revision ?? null)
        const targetIds = new Set(record.payload.openNotes.map((entry) => entry.noteId))
        const incomingPanels = record.payload.panels ?? []
        updatePanelSnapshotMap(incomingPanels, "hydrate_workspace")
        workspaceSnapshotsRef.current.set(workspaceId, incomingPanels)
        lastPanelSnapshotHashRef.current = serializePanelSnapshots(incomingPanels)
        applyPanelSnapshots(incomingPanels, targetIds)
        const closePromises = openNotes
          .filter((note) => !targetIds.has(note.noteId))
          .map((note) =>
            closeWorkspaceNote(note.noteId, { persist: false, removeWorkspace: false }).catch(() => {}),
          )
        await Promise.all(closePromises)

        for (const panel of record.payload.openNotes) {
          const alreadyOpen = openNotes.some((note) => note.noteId === panel.noteId)
          if (!alreadyOpen) {
            await openWorkspaceNote(panel.noteId, {
              mainPosition: panel.position ?? undefined,
              persist: false,
              persistPosition: false,
            })
          }
        }

        const nextActive = record.payload.activeNoteId || record.payload.openNotes[0]?.noteId || null
        setActiveNoteId(nextActive)

        snapshotOwnerWorkspaceIdRef.current = workspaceId

        const nextCamera = record.payload.camera ?? DEFAULT_CAMERA
        if (layerContext?.setTransform) {
          layerContext.setTransform("notes", nextCamera)
        }
        if (setCanvasState) {
          setCanvasState((prev) => ({
            ...prev,
            translateX: nextCamera.x,
            translateY: nextCamera.y,
            zoom: nextCamera.scale,
          }))
        }

        if (v2Enabled) {
          cacheWorkspaceSnapshot({
            workspaceId,
            revision: record.revision ?? null,
            panels: incomingPanels,
            openNotes: record.payload.openNotes.map((entry) => ({
              noteId: entry.noteId,
              mainPosition: entry.position ?? null,
            })),
            camera: nextCamera,
            activeNoteId: nextActive,
          })
          lastPreviewedSnapshotRef.current.delete(workspaceId)
        }

        setStatusHelperText(formatSyncedLabel(record.updatedAt))
        setWorkspaces((prev) =>
          prev.map((workspace) =>
            workspace.id === record.id
              ? {
                  ...workspace,
                  revision: record.revision,
                  updatedAt: record.updatedAt,
                  noteCount: record.noteCount,
              }
            : workspace,
        ),
        )
        lastSavedPayloadHashRef.current.set(workspaceId, serializeWorkspacePayload(record.payload))
        emitDebugLog({
          component: "NoteWorkspace",
          action: "hydrate_success",
          metadata: {
            workspaceId,
            panelCount: incomingPanels.length,
            openCount: record.payload.openNotes.length,
            durationMs: Date.now() - hydrateStart,
          },
        })
        bumpSnapshotRevision()
      } catch (error) {
        console.error("[NoteWorkspace] hydrate failed", error)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "hydrate_error",
          metadata: {
            workspaceId,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      } finally {
        isHydratingRef.current = false
        snapshotOwnerWorkspaceIdRef.current = workspaceId
        setIsLoading(false)
      }
    },
    [
      applyPanelSnapshots,
      closeWorkspaceNote,
      emitDebugLog,
      layerContext,
      openNotes,
      openWorkspaceNote,
      setActiveNoteId,
      bumpSnapshotRevision,
    ],
  )

  const listedOnceRef = useRef(false)

  useEffect(() => {
    if (!flagEnabled || isUnavailable) return
    if (listedOnceRef.current) return
    adapterRef.current = new NoteWorkspaceAdapter()
    let cancelled = false
    emitDebugLog({
      component: "NoteWorkspace",
      action: "list_start",
    })
    ;(async () => {
      try {
        let list = await adapterRef.current!.listWorkspaces()
        if (list.length === 0) {
          try {
            await adapterRef.current!.ensureDefaultWorkspace()
            list = await adapterRef.current!.listWorkspaces()
          } catch (seedError) {
            console.warn("[NoteWorkspace] failed to seed default workspace", seedError)
          }
        }
        if (cancelled) return
        listedOnceRef.current = true
        setWorkspaces(list)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "list_success",
          metadata: { count: list.length },
        })
        if (!currentWorkspaceId) {
          const defaultWorkspace = list.find((workspace) => workspace.isDefault) ?? list[0]
          if (defaultWorkspace) {
            snapshotOwnerWorkspaceIdRef.current = defaultWorkspace.id
            setCurrentWorkspaceId(defaultWorkspace.id)
          }
        }
      } catch (error) {
        console.warn(
          "[NoteWorkspace] failed to list",
          error instanceof Error ? error.message : error,
        )
        if (cancelled) return
        listedOnceRef.current = true
        setWorkspaces([])
        emitDebugLog({
          component: "NoteWorkspace",
          action: "list_error",
          metadata: { error: error instanceof Error ? error.message : String(error) },
        })
        markUnavailable(error instanceof Error ? error.message : undefined)
      }
    })()
    return () => {
      cancelled = true
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
    }
  }, [flagEnabled, isUnavailable, emitDebugLog, markUnavailable])

  useEffect(() => {
    if (!featureEnabled || !isWorkspaceReady || !currentWorkspaceId) return
    if (lastHydratedWorkspaceIdRef.current === currentWorkspaceId) return
    lastHydratedWorkspaceIdRef.current = currentWorkspaceId
    hydrateWorkspace(currentWorkspaceId)
  }, [currentWorkspaceId, featureEnabled, hydrateWorkspace, isWorkspaceReady])

  useEffect(() => {
    if (!featureEnabled) return
    const handleBeforeUnload = () => {
      flushPendingSave("before_unload")
    }
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushPendingSave("visibility_hidden")
      }
    }
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", handleBeforeUnload)
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility)
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", handleBeforeUnload)
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility)
      }
    }
  }, [featureEnabled, flushPendingSave])

  useEffect(() => {
    if (!featureEnabled || !v2Enabled) return
    const unsubscribe = subscribeToWorkspaceSnapshotState((event) => {
      if (event.type === "panel_pending") {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_pending",
          metadata: {
            workspaceId: event.workspaceId,
            noteId: event.noteId,
            panelId: event.panelId,
            pendingCount: event.pendingCount,
            timestampMs: event.timestamp,
          },
        })
      } else if (event.type === "panel_ready") {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_ready",
          metadata: {
            workspaceId: event.workspaceId,
            noteId: event.noteId,
            panelId: event.panelId,
            pendingCount: event.pendingCount,
            timestampMs: event.timestamp,
          },
        })
      } else if (event.type === "workspace_ready") {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "workspace_ready",
          metadata: {
            workspaceId: event.workspaceId,
            pendingCount: event.pendingCount,
            timestampMs: event.timestamp,
          },
        })
        if (
          featureEnabled &&
          v2Enabled &&
          event.workspaceId === currentWorkspaceId &&
          !isHydratingRef.current
        ) {
          void (async () => {
            await captureCurrentWorkspaceSnapshot()
            lastSaveReasonRef.current = "panel_ready_auto_save"
            await persistWorkspaceNow()
          })()
        }
      }
    })
    return unsubscribe
  }, [
    captureCurrentWorkspaceSnapshot,
    currentWorkspaceId,
    emitDebugLog,
    featureEnabled,
    persistWorkspaceNow,
    v2Enabled,
  ])

  useEffect(() => {
    if (!featureEnabled || !currentWorkspaceSummary) return
    if (isHydratingRef.current) return
    scheduleSave({ reason: "state_change" })
  }, [
    activeNoteId,
    currentWorkspaceSummary,
    featureEnabled,
    openNotes,
    canvasState?.translateX,
    canvasState?.translateY,
    canvasState?.zoom,
    panelSnapshotVersion,
    scheduleSave,
  ])

  const handleCreateWorkspace = useCallback(async () => {
    if (!featureEnabled || !adapterRef.current) return
    flushPendingSave("workspace_create")
    try {
      const workspace = await adapterRef.current.createWorkspace({
        payload: {
          schemaVersion: "1.0.0",
          openNotes: [],
          activeNoteId: null,
          camera: DEFAULT_CAMERA,
          panels: [],
        },
      })
      setWorkspaces((prev) => [...prev, workspace])
      setCurrentWorkspaceId(workspace.id)
      setStatusHelperText(formatSyncedLabel(workspace.updatedAt))
      emitDebugLog({
        component: "NoteWorkspace",
        action: "create_success",
        metadata: { workspaceId: workspace.id },
      })
    } catch (error) {
      console.error("[NoteWorkspace] create failed", error)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "create_error",
        metadata: { error: error instanceof Error ? error.message : String(error) },
      })
    }
  }, [emitDebugLog, featureEnabled, flushPendingSave])

  const handleDeleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!adapterRef.current) return
      try {
        await adapterRef.current.deleteWorkspace(workspaceId)
        setWorkspaces((prev) => prev.filter((workspace) => workspace.id !== workspaceId))
        if (currentWorkspaceId === workspaceId) {
          const fallback = workspaces.find((workspace) => workspace.id !== workspaceId)
          setCurrentWorkspaceId(fallback?.id ?? null)
        }
        emitDebugLog({
          component: "NoteWorkspace",
          action: "delete_success",
          metadata: { workspaceId },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete workspace"
        console.error("[NoteWorkspace] delete failed", error)
        setStatusHelperText(message)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "delete_error",
          metadata: { workspaceId, error: message },
        })
      }
    },
    [currentWorkspaceId, emitDebugLog, workspaces],
  )

  const handleRenameWorkspace = useCallback(
    async (workspaceId: string, nextName: string) => {
      if (!adapterRef.current) return
      const workspace = workspaces.find((entry) => entry.id === workspaceId)
      if (!workspace) return
      const trimmed = nextName.trim()
      if (!trimmed) return
      try {
        const payload = buildPayload()
        const updated = await adapterRef.current.saveWorkspace({
          id: workspaceId,
          payload,
          revision: workspace.revision,
          name: trimmed,
        })
        setWorkspaces((prev) =>
          prev.map((entry) =>
            entry.id === updated.id
              ? {
                  ...entry,
                  name: updated.name,
                  revision: updated.revision,
                  updatedAt: updated.updatedAt,
                }
              : entry,
          ),
        )
        if (currentWorkspaceId === workspaceId) {
          setStatusHelperText(formatSyncedLabel(updated.updatedAt))
        }
      } catch (error) {
        console.error("[NoteWorkspace] rename failed", error)
      }
    },
    [buildPayload, currentWorkspaceId, workspaces],
  )

  const handleSelectWorkspace = useCallback(
    (workspaceId: string) => {
      if (workspaceId === currentWorkspaceId) return
      const run = async () => {
        await waitForPanelSnapshotReadiness("workspace_switch_capture", 1500)
        await captureCurrentWorkspaceSnapshot()
        lastSaveReasonRef.current = "workspace_switch"
        await persistWorkspaceNow()

        snapshotOwnerWorkspaceIdRef.current = workspaceId
        const cachedSnapshot = getWorkspaceSnapshot(workspaceId)
        const cachedRevision = workspaceRevisionRef.current.get(workspaceId) ?? null
        const cachedPanels = workspaceSnapshotsRef.current.get(workspaceId) ?? null

        const applyCachedSnapshot = async () => {
          if (v2Enabled && cachedSnapshot) {
            await previewWorkspaceFromSnapshot(workspaceId, cachedSnapshot)
          } else if (!v2Enabled && cachedPanels && cachedPanels.length > 0) {
            setTimeout(() => {
              snapshotOwnerWorkspaceIdRef.current = workspaceId
              applyPanelSnapshots(cachedPanels, new Set(cachedPanels.map((panel) => panel.noteId)))
            }, 0)
          }
        }

        await applyCachedSnapshot()
        setCurrentWorkspaceId(workspaceId)
        snapshotOwnerWorkspaceIdRef.current = workspaceId
        emitDebugLog({
          component: "NoteWorkspace",
          action: "select_workspace",
          metadata: {
            workspaceId,
            hadCachedSnapshot: Boolean(cachedSnapshot),
            cachedPanelCount: cachedSnapshot?.panels.length ?? cachedPanels?.length ?? 0,
            cachedRevision,
          },
        })

        if (v2Enabled && adapterRef.current) {
          try {
            const record = await adapterRef.current.loadWorkspace(workspaceId)
            const adapterRevision = (record as any).revision ?? null
            const adapterSnapshot = {
              panels: record?.payload?.panels ?? [],
              openNotes: record?.payload?.openNotes ?? [],
              activeNoteId: record?.payload?.activeNoteId ?? null,
              camera: record?.payload?.camera ?? DEFAULT_CAMERA,
            }
            const cachedRevisionValue = workspaceRevisionRef.current.get(workspaceId) ?? null
            const shouldApplyAdapter = !cachedSnapshot || adapterRevision !== cachedRevisionValue

            if (adapterRevision) {
              workspaceRevisionRef.current.set(workspaceId, adapterRevision)
            }

            if (shouldApplyAdapter || !cachedSnapshot) {
              await previewWorkspaceFromSnapshot(workspaceId, adapterSnapshot as any)
            } else {
              // Replay cached snapshot even if revisions match to keep the store populated
              await previewWorkspaceFromSnapshot(workspaceId, cachedSnapshot)
            }
          } catch (error) {
            emitDebugLog({
              component: "NoteWorkspace",
              action: "adapter_load_error",
              metadata: { workspaceId, error: error instanceof Error ? error.message : String(error) },
            })
          }
        }
      }
      void run()
    },
    [
      applyPanelSnapshots,
      captureCurrentWorkspaceSnapshot,
      currentWorkspaceId,
      persistWorkspaceNow,
      previewWorkspaceFromSnapshot,
      emitDebugLog,
      v2Enabled,
      adapterRef,
      workspaceRevisionRef,
    ],
  )

  useLayoutEffect(() => {
    if (!featureEnabled || v2Enabled || openNotes.length === 0) return
    const dataStore = sharedWorkspace?.dataStore
    if (!dataStore) return
    const hydrated: string[] = []
    openNotes.forEach((note) => {
      if (!note.noteId) return
      const snapshots = panelSnapshotsRef.current.get(note.noteId)
      if (!snapshots || snapshots.length === 0) return
      const missing = snapshots.some((panel) => {
        const key = ensurePanelKey(panel.noteId, panel.panelId)
        let exists = false
        if (typeof dataStore.has === "function") {
          try {
            exists = Boolean(dataStore.has(key))
          } catch {
            exists = false
          }
        }
        if (!exists) {
          exists = Boolean(dataStore.get(key))
        }
        return !exists
      })
      if (missing) {
        rehydratePanelsForNote(note.noteId)
        hydrated.push(note.noteId)
      }
    })
    if (hydrated.length > 0) {
      emitDebugLog({
        component: "NoteWorkspace",
        action: "panel_snapshot_rehydrated",
        metadata: {
          noteIds: hydrated,
          reason: "open_notes_refresh",
        },
      })
    }
  }, [featureEnabled, v2Enabled, openNotes, panelSnapshotVersion, sharedWorkspace, rehydratePanelsForNote, emitDebugLog])

  useEffect(() => {
    if (!v2Enabled || !currentWorkspaceId) return
    const snapshot = getWorkspaceSnapshot(currentWorkspaceId)
    if (!snapshot) return
    previewWorkspaceFromSnapshot(currentWorkspaceId, snapshot)
  }, [currentWorkspaceId, previewWorkspaceFromSnapshot, v2Enabled])

  useEffect(() => {
    if (!featureEnabled || !activeNoteId) return
    const snapshots = panelSnapshotsRef.current.get(activeNoteId)
    if (!snapshots || snapshots.length === 0) return
    const dataStore = sharedWorkspace?.dataStore
    if (!dataStore) return
    const hasAllPanels = snapshots.every((panel) => {
      const key = ensurePanelKey(panel.noteId, panel.panelId)
      let exists = false
      if (typeof dataStore.has === "function") {
        try {
          exists = Boolean(dataStore.has(key))
        } catch {
          exists = false
        }
      }
      if (!exists) {
        exists = Boolean(dataStore.get(key))
      }
      return exists
    })
    if (hasAllPanels) return
    emitDebugLog({
      component: "NoteWorkspace",
      action: "panel_snapshot_missing",
      metadata: {
        noteIds: [activeNoteId],
        reason: "active_note_check",
      },
    })
    rehydratePanelsForNote(activeNoteId)
  }, [activeNoteId, featureEnabled, rehydratePanelsForNote, sharedWorkspace, emitDebugLog])

  return {
    featureEnabled,
    isUnavailable,
    workspaces,
    isLoading,
    statusHelperText,
    currentWorkspaceId,
    snapshotRevision,
    selectWorkspace: handleSelectWorkspace,
    createWorkspace: handleCreateWorkspace,
    deleteWorkspace: handleDeleteWorkspace,
    renameWorkspace: handleRenameWorkspace,
  }
}
