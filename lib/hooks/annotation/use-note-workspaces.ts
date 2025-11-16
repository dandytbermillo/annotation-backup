import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"

import type { LayerContextValue } from "@/components/canvas/layer-provider"
import { NoteWorkspaceAdapter, type NoteWorkspaceSummary } from "@/lib/adapters/note-workspace-adapter"
import { isNoteWorkspaceEnabled } from "@/lib/flags/note"
import type { CanvasState } from "@/lib/hooks/annotation/use-workspace-canvas-state"
import type { WorkspacePanelSnapshot } from "@/lib/hooks/annotation/use-workspace-panel-positions"
import type { NoteWorkspacePayload } from "@/lib/types/note-workspace"

type DebugLogger = (event: {
  component: string
  action: string
  content_preview?: string
  metadata?: Record<string, unknown>
  note_id?: string | null
}) => void | Promise<void>

const DEFAULT_CAMERA = { x: 0, y: 0, scale: 1 }

export type NoteWorkspaceSlot = {
  noteId: string
  mainPosition?: { x: number; y: number } | null
}

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
}

type UseNoteWorkspaceResult = {
  featureEnabled: boolean
  isUnavailable: boolean
  workspaces: NoteWorkspaceSummary[]
  isLoading: boolean
  statusHelperText: string | null
  currentWorkspaceId: string | null
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
}: UseNoteWorkspaceOptions): UseNoteWorkspaceResult {
  const flagEnabled = isNoteWorkspaceEnabled()
  const adapterRef = useRef<NoteWorkspaceAdapter | null>(null)
  const [workspaces, setWorkspaces] = useState<NoteWorkspaceSummary[]>([])
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [statusHelperText, setStatusHelperText] = useState<string | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isHydratingRef = useRef(false)
  const lastCameraRef = useRef(DEFAULT_CAMERA)
  const [isUnavailable, setIsUnavailable] = useState(false)
  const unavailableNoticeShownRef = useRef(false)
  const lastHydratedWorkspaceIdRef = useRef<string | null>(null)

  const currentWorkspaceSummary = useMemo(
    () => workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null,
    [currentWorkspaceId, workspaces],
  )

  const featureEnabled = flagEnabled && !isUnavailable

  const emitDebugLog = useCallback(
    (payload: Parameters<NonNullable<DebugLogger>>[0]) => {
      if (!debugLogger) return
      void debugLogger(payload)
    },
    [debugLogger],
  )

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
    return {
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
    }
  }, [
    activeNoteId,
    canvasState?.translateX,
    canvasState?.translateY,
    canvasState?.zoom,
    getPanelSnapshot,
    openNotes,
    resolveMainPanelPosition,
    layerContext?.transforms.notes?.x,
    layerContext?.transforms.notes?.y,
    layerContext?.transforms.notes?.scale,
  ])

  const persistWorkspaceNow = useCallback(async () => {
    if (!featureEnabled || !currentWorkspaceSummary || isHydratingRef.current) {
      return
    }
    if (!adapterRef.current) return
    try {
      const payload = buildPayload()
      const updated = await adapterRef.current.saveWorkspace({
        id: currentWorkspaceSummary.id,
        payload,
        revision: currentWorkspaceSummary.revision,
      })
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
    }
  }, [buildPayload, currentWorkspaceSummary, featureEnabled])

  const scheduleSave = useCallback(
    (immediate = false) => {
      if (!featureEnabled || !currentWorkspaceSummary || isHydratingRef.current) {
        return
      }
      if (!adapterRef.current) return
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      if (immediate) {
        void persistWorkspaceNow()
        return
      }
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null
        void persistWorkspaceNow()
      }, 2500)
    },
    [currentWorkspaceSummary, featureEnabled, persistWorkspaceNow],
  )

  const flushPendingSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    void persistWorkspaceNow()
  }, [persistWorkspaceNow])

  const hydrateWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!adapterRef.current) return
      setIsLoading(true)
      try {
        const record = await adapterRef.current.loadWorkspace(workspaceId)
        isHydratingRef.current = true
        const targetIds = new Set(record.payload.openNotes.map((entry) => entry.noteId))
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
      } catch (error) {
        console.error("[NoteWorkspace] hydrate failed", error)
      } finally {
        isHydratingRef.current = false
        setIsLoading(false)
      }
    },
    [closeWorkspaceNote, layerContext, openNotes, openWorkspaceNote, setActiveNoteId],
  )

  useEffect(() => {
    if (!flagEnabled || isUnavailable) return
    adapterRef.current = new NoteWorkspaceAdapter()
    let cancelled = false
    emitDebugLog({
      component: "NoteWorkspace",
      action: "list_start",
    })
    ;(async () => {
      try {
        const list = await adapterRef.current!.listWorkspaces()
        if (cancelled) return
        setWorkspaces(list)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "list_success",
          metadata: { count: list.length },
        })
        if (!currentWorkspaceId) {
          const defaultWorkspace = list.find((workspace) => workspace.isDefault) ?? list[0]
          if (defaultWorkspace) {
            setCurrentWorkspaceId(defaultWorkspace.id)
          }
        }
      } catch (error) {
        console.warn(
          "[NoteWorkspace] failed to list",
          error instanceof Error ? error.message : error,
        )
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
  }, [flagEnabled, isUnavailable, currentWorkspaceId, emitDebugLog, markUnavailable])

  useEffect(() => {
    if (!featureEnabled || !isWorkspaceReady || !currentWorkspaceId) return
    if (lastHydratedWorkspaceIdRef.current === currentWorkspaceId) return
    lastHydratedWorkspaceIdRef.current = currentWorkspaceId
    hydrateWorkspace(currentWorkspaceId)
  }, [currentWorkspaceId, featureEnabled, hydrateWorkspace, isWorkspaceReady])

  useEffect(() => {
    if (!featureEnabled) return
    const handleBeforeUnload = () => {
      flushPendingSave()
    }
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushPendingSave()
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
    if (!featureEnabled || !currentWorkspaceSummary) return
    if (isHydratingRef.current) return
    scheduleSave()
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
    flushPendingSave()
    try {
      const workspace = await adapterRef.current.createWorkspace({
        payload: {
          schemaVersion: "1.0.0",
          openNotes: [],
          activeNoteId: null,
          camera: DEFAULT_CAMERA,
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
       flushPendingSave()
      setCurrentWorkspaceId(workspaceId)
    },
    [currentWorkspaceId, flushPendingSave],
  )

  return {
    featureEnabled,
    isUnavailable,
    workspaces,
    isLoading,
    statusHelperText,
    currentWorkspaceId,
    selectWorkspace: handleSelectWorkspace,
    createWorkspace: handleCreateWorkspace,
    deleteWorkspace: handleDeleteWorkspace,
    renameWorkspace: handleRenameWorkspace,
  }
}
