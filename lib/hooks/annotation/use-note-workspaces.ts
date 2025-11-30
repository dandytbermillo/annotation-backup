import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect, type Dispatch, type SetStateAction } from "react"

import type { LayerContextValue } from "@/components/canvas/layer-provider"
import {
  useNoteWorkspaceRuntimeManager,
  type NoteWorkspaceDebugLogger,
} from "@/lib/hooks/annotation/use-note-workspace-runtime-manager"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
import { getLayerManager } from "@/lib/canvas/layer-manager"
import { getWorkspaceLayerManager } from "@/lib/workspace/workspace-layer-manager-registry"
import { DataStore } from "@/lib/data-store"
import { getWorkspaceStore } from "@/lib/workspace/workspace-store-registry"
import {
  getWorkspaceRuntime,
  getRuntimeOpenNotes,
  setRuntimeOpenNotes,
  getRuntimeMembership,
  setRuntimeMembership,
  setRuntimeNoteOwner,
  clearRuntimeNoteOwner,
  hasWorkspaceRuntime,
  listWorkspaceRuntimeIds,
  removeWorkspaceRuntime,
  // Phase 2: Visibility management
  setRuntimeVisible,
  isRuntimeVisible,
  listHotRuntimes,
  notifyRuntimeChanges,
} from "@/lib/workspace/runtime-manager"
import { NoteWorkspaceAdapter, type NoteWorkspaceSummary } from "@/lib/adapters/note-workspace-adapter"
import {
  isNoteWorkspaceEnabled,
  isNoteWorkspaceLiveStateEnabled,
  isNoteWorkspaceV2Enabled,
} from "@/lib/flags/note"
import type { CanvasState } from "@/lib/hooks/annotation/use-workspace-canvas-state"
import type { WorkspacePanelSnapshot } from "@/lib/hooks/annotation/use-workspace-panel-positions"
import type {
  NoteWorkspacePayload,
  NoteWorkspacePanelSnapshot,
  NoteWorkspaceComponentSnapshot,
} from "@/lib/types/note-workspace"
import { SHARED_WORKSPACE_ID, type NoteWorkspace, type NoteWorkspaceSlot } from "@/lib/workspace/types"
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
import { debugLog } from "@/lib/utils/debug-logger"

const DEFAULT_CAMERA = { x: 0, y: 0, scale: 1 }
// Enable workspace debug logging; can be toggled at runtime if needed.
const NOTE_WORKSPACE_DEBUG_ENABLED = true
const DESKTOP_RUNTIME_CAP = 4
const TOUCH_RUNTIME_CAP = 2
const CAPTURE_DEFER_DELAY_MS = 48

const detectRuntimeCapacity = () => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return DESKTOP_RUNTIME_CAP
  }
  try {
    if (window.matchMedia("(pointer: coarse)").matches) {
      return TOUCH_RUNTIME_CAP
    }
  } catch {
    // ignore matchMedia errors
  }
  return DESKTOP_RUNTIME_CAP
}

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

  const normalizedComponents = [...(payload.components ?? [])]
    .map((component) => ({
      id: component.id ?? "",
      type: component.type ?? "",
      position: normalizePointForHash(component.position as any),
      size: normalizeSizeForHash(component.size as any),
      zIndex: typeof component.zIndex === "number" ? component.zIndex : null,
      metadata: component.metadata ?? null,
    }))
    .sort((a, b) => {
      const byType = a.type.localeCompare(b.type)
      if (byType !== 0) return byType
      return a.id.localeCompare(b.id)
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
    components: normalizedComponents,
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

type WorkspaceSnapshotCache = {
  panels: NoteWorkspacePanelSnapshot[]
  components: NoteWorkspaceComponentSnapshot[]
  openNotes: NoteWorkspaceSlot[]
}

const ensureWorkspaceSnapshotCache = (
  cacheMap: Map<string, WorkspaceSnapshotCache>,
  workspaceId: string,
): WorkspaceSnapshotCache => {
  if (!cacheMap.has(workspaceId)) {
    cacheMap.set(workspaceId, { panels: [], components: [], openNotes: [] })
  }
  return cacheMap.get(workspaceId)!
}

const getLastNonEmptySnapshot = (
  workspaceId: string,
  lastNonEmpty: Map<string, NoteWorkspacePanelSnapshot[]>,
  cached: Map<string, WorkspaceSnapshotCache>,
): NoteWorkspacePanelSnapshot[] => {
  const fromLast = lastNonEmpty.get(workspaceId)
  if (fromLast && fromLast.length > 0) return fromLast
  const fromCached = cached.get(workspaceId)?.panels ?? []
  return fromCached && fromCached.length > 0 ? fromCached : []
}
const existingOpenSnapshot = new Map<string, boolean>()
const now = () => Date.now()

type UseNoteWorkspaceOptions = {
  openNotes: NoteWorkspaceSlot[]
  openNotesWorkspaceId?: string | null
  activeNoteId: string | null
  setActiveNoteId: Dispatch<SetStateAction<string | null>>
  resolveMainPanelPosition: (noteId: string) => { x: number; y: number } | null
  openWorkspaceNote: (noteId: string, options?: { mainPosition?: { x: number; y: number } | null; persist?: boolean; persistPosition?: boolean; workspaceId?: string }) => Promise<void>
  closeWorkspaceNote: (noteId: string, options?: { persist?: boolean; removeWorkspace?: boolean }) => Promise<void>
  layerContext: LayerContextValue | null
  isWorkspaceReady: boolean
  getPanelSnapshot: (noteId: string) => WorkspacePanelSnapshot | null
  panelSnapshotVersion: number
  canvasState: CanvasState | null
  setCanvasState?: Dispatch<SetStateAction<CanvasState>>
  onUnavailable?: () => void
  debugLog?: NoteWorkspaceDebugLogger
  sharedWorkspace: NoteWorkspace | null
}

type UseNoteWorkspaceResult = {
  featureEnabled: boolean
  isUnavailable: boolean
  workspaces: NoteWorkspaceSummary[]
  isLoading: boolean
  statusHelperText: string | null
  currentWorkspaceId: string | null
  targetWorkspaceId: string | null
  snapshotRevision: number
  selectWorkspace: (workspaceId: string) => void
  createWorkspace: () => void
  deleteWorkspace: (workspaceId: string) => void
  renameWorkspace: (workspaceId: string, name: string) => void
  scheduleImmediateSave?: (reason?: string) => void
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
  openNotesWorkspaceId = null,
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
  const liveStateEnabled = isNoteWorkspaceLiveStateEnabled()
  const adapterRef = useRef<NoteWorkspaceAdapter | null>(null)
  const panelSnapshotsRef = useRef<Map<string, NoteWorkspacePanelSnapshot[]>>(new Map())
  const workspaceSnapshotsRef = useRef<Map<string, WorkspaceSnapshotCache>>(new Map())
  const workspaceOpenNotesRef = useRef<Map<string, NoteWorkspaceSlot[]>>(new Map())
  const workspaceNoteMembershipRef = useRef<Map<string, Set<string>>>(new Map())
  const lastNonEmptySnapshotsRef = useRef<Map<string, NoteWorkspacePanelSnapshot[]>>(new Map())
  const snapshotOwnerWorkspaceIdRef = useRef<string | null>(null)
  const currentWorkspaceIdRef = useRef<string | null>(null)
  const lastPreviewedSnapshotRef = useRef<Map<string, NoteWorkspaceSnapshot | null>>(new Map())
  const workspaceRevisionRef = useRef<Map<string, string | null>>(new Map())
  const workspaceStoresRef = useRef<Map<string, DataStore>>(new Map())
  const lastComponentsSnapshotRef = useRef<Map<string, NoteWorkspaceComponentSnapshot[]>>(new Map())
  const lastPendingTimestampRef = useRef<Map<string, number>>(new Map())
  const replayingWorkspaceRef = useRef(0)
  const lastSavedPayloadHashRef = useRef<Map<string, string>>(new Map())
  const lastPanelSnapshotHashRef = useRef<string | null>(null)
  const ownedNotesRef = useRef<Map<string, string>>(new Map())
  const inferredWorkspaceNotesRef = useRef<Map<string, Set<string>>>(new Map())
  const previousVisibleWorkspaceRef = useRef<string | null>(null)
  const lastSaveReasonRef = useRef<string>("initial_schedule")
  const saveInFlightRef = useRef(false)
  const skipSavesUntilRef = useRef(0)
  const [workspaces, setWorkspaces] = useState<NoteWorkspaceSummary[]>([])
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null)
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [statusHelperText, setStatusHelperText] = useState<string | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isHydratingRef = useRef(false)
  const lastCameraRef = useRef(DEFAULT_CAMERA)
  const [isUnavailable, setIsUnavailable] = useState(false)
  const featureEnabled = flagEnabled && !isUnavailable
  const unavailableNoticeShownRef = useRef(false)
  const lastHydratedWorkspaceIdRef = useRef<string | null>(null)
  const captureRetryAttemptsRef = useRef<Map<string, number>>(new Map())
  const [snapshotRevision, setSnapshotRevision] = useState(0)
  const bumpSnapshotRevision = useCallback(() => {
    setSnapshotRevision((prev) => prev + 1)
  }, [])
  const runtimeCapacity = useMemo(
    () => (liveStateEnabled ? detectRuntimeCapacity() : Number.POSITIVE_INFINITY),
    [liveStateEnabled],
  )

  const currentWorkspaceSummary = useMemo(
    () => workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null,
    [currentWorkspaceId, workspaces],
  )
  const targetWorkspaceId = pendingWorkspaceId ?? currentWorkspaceId
  const currentWorkspaceSummaryId = currentWorkspaceSummary?.id ?? null

  const setWorkspaceNoteMembership = useCallback(
    (
      workspaceId: string | null | undefined,
      noteIds: Iterable<string | null | undefined>,
      timestamp?: number,
    ) => {
      if (!workspaceId) return
      const normalized = new Set<string>()
      for (const noteId of noteIds) {
        if (typeof noteId === "string" && noteId.length > 0) {
          normalized.add(noteId)
        }
      }

      const writeTimestamp = timestamp ?? Date.now()

      // DEBUG: Log what's being set with call stack
      const stack = new Error().stack?.split('\n').slice(2, 6).join(' | ') ?? 'no-stack'
      emitDebugLog({
        component: "NoteWorkspace",
        action: "set_workspace_membership_called",
        metadata: {
          workspaceId,
          inputNoteIds: Array.from(noteIds),
          normalizedNoteIds: Array.from(normalized),
          normalizedSize: normalized.size,
          previousSize: workspaceNoteMembershipRef.current.get(workspaceId)?.size ?? null,
          timestamp: writeTimestamp,
          callStack: stack,
        },
      })

      // Phase 1: Write to runtime FIRST when live state enabled (prevents stale overwrites)
      if (liveStateEnabled) {
        setRuntimeMembership(workspaceId, normalized, writeTimestamp)
      }

      // Keep ref in sync as backup/legacy fallback
      const previous = workspaceNoteMembershipRef.current.get(workspaceId)
      let shouldUpdateMembership = true
      if (previous && previous.size === normalized.size) {
        shouldUpdateMembership = false
        for (const value of normalized) {
          if (!previous.has(value)) {
            shouldUpdateMembership = true
            break
          }
        }
      }
      if (shouldUpdateMembership) {
        workspaceNoteMembershipRef.current.set(workspaceId, normalized)
      }

      if (liveStateEnabled) {
        // DEBUG: Verify what was actually set in runtime
        const verifySet = getRuntimeMembership(workspaceId)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "set_workspace_membership_verified",
          metadata: {
            workspaceId,
            attemptedToSet: Array.from(normalized),
            actuallySet: verifySet ? Array.from(verifySet) : null,
            matchesExpected: verifySet?.size === normalized.size,
          },
        })
      }
      if (!v2Enabled) {
        return
      }
      const previouslyOwnedByWorkspace = new Set<string>()
      ownedNotesRef.current.forEach((ownerWorkspaceId, noteId) => {
        if (ownerWorkspaceId === workspaceId) {
          previouslyOwnedByWorkspace.add(noteId)
        }
      })
      normalized.forEach((noteId) => {
        const existingOwner = ownedNotesRef.current.get(noteId)
        if (existingOwner && existingOwner !== workspaceId) {
          const existingMembership = workspaceNoteMembershipRef.current.get(existingOwner)
          existingMembership?.delete(noteId)
        }
        if (existingOwner !== workspaceId) {
          // Phase 1: Use runtime ownership when live state enabled
          if (liveStateEnabled) {
            setRuntimeNoteOwner(workspaceId, noteId)
          } else {
            setNoteWorkspaceOwner(noteId, workspaceId)
          }
          ownedNotesRef.current.set(noteId, workspaceId)
        }
        previouslyOwnedByWorkspace.delete(noteId)
      })
      previouslyOwnedByWorkspace.forEach((noteId) => {
        // Phase 1: Use runtime ownership when live state enabled
        if (liveStateEnabled) {
          clearRuntimeNoteOwner(workspaceId, noteId)
        } else {
          clearNoteWorkspaceOwner(noteId)
        }
        ownedNotesRef.current.delete(noteId)
      })
    },
    [liveStateEnabled, v2Enabled],
  )

  const getWorkspaceNoteMembership = useCallback(
    (workspaceId: string | null | undefined): Set<string> | null => {
      if (!workspaceId) return null
      // Phase 1: When live state enabled, runtime is the ONLY source of truth
      if (liveStateEnabled) {
        return getRuntimeMembership(workspaceId)  // Even if null/empty
      }
      // Legacy mode: Use ref fallback when live state is disabled
      return workspaceNoteMembershipRef.current.get(workspaceId) ?? null
    },
    [liveStateEnabled],
  )

  const normalizeWorkspaceSlots = (
    slots:
      | Iterable<{
          noteId?: string | null
          mainPosition?: { x: number; y: number } | null
          position?: { x: number; y: number } | null
        }>
      | null
      | undefined,
  ): NoteWorkspaceSlot[] => {
    if (!slots) return []
    const normalized: NoteWorkspaceSlot[] = []
    const seen = new Set<string>()
    for (const slot of slots) {
      if (!slot || typeof slot.noteId !== "string" || slot.noteId.length === 0) continue
      if (seen.has(slot.noteId)) continue
      const position = slot.mainPosition ?? slot.position ?? null
      const mainPosition =
        position && typeof position.x === "number" && typeof position.y === "number"
          ? { x: position.x, y: position.y }
          : null
      normalized.push({ noteId: slot.noteId, mainPosition })
      seen.add(slot.noteId)
    }
    return normalized
  }

  const areWorkspaceSlotsEqual = (a: NoteWorkspaceSlot[] | null | undefined, b: NoteWorkspaceSlot[] | null | undefined) => {
    if (a === b) return true
    if (!a || !b) return false
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      const left = a[index]
      const right = b[index]
      if (left.noteId !== right.noteId) return false
      const leftPos = left.mainPosition
      const rightPos = right.mainPosition
      if (Boolean(leftPos) !== Boolean(rightPos)) return false
      if (leftPos && rightPos && (leftPos.x !== rightPos.x || leftPos.y !== rightPos.y)) return false
    }
    return true
  }

  const commitWorkspaceOpenNotes = useCallback(
    (
      workspaceId: string | null | undefined,
      slots:
        | Iterable<{
            noteId?: string | null
            mainPosition?: { x: number; y: number } | null
            position?: { x: number; y: number } | null
          }>
        | null
        | undefined,
      options?: { updateMembership?: boolean; updateCache?: boolean; timestamp?: number; callSite?: string },
    ): NoteWorkspaceSlot[] => {
      if (!workspaceId) return []
      const normalized = normalizeWorkspaceSlots(slots)
      const writeTimestamp = options?.timestamp ?? Date.now()

      // DEBUG: Trace note addition timing with call site for stale-write diagnosis
      const debugStartTime = performance.now()
      void debugLog({
        component: "NoteDelay",
        action: "commit_open_notes_start",
        metadata: {
          workspaceId,
          noteCount: normalized.length,
          noteIds: normalized.map(n => n.noteId),
          liveStateEnabled,
          timestampMs: debugStartTime,
          callSite: options?.callSite ?? "unknown",
        },
      })

      // Phase 1: Write to runtime FIRST when live state enabled (prevents stale overwrites)
      if (liveStateEnabled) {
        setRuntimeOpenNotes(workspaceId, normalized, writeTimestamp)
      }

      // Keep ref in sync as backup/legacy fallback
      const previous = workspaceOpenNotesRef.current.get(workspaceId)
      const changed = !areWorkspaceSlotsEqual(previous, normalized)
      if (changed) {
        workspaceOpenNotesRef.current.set(workspaceId, normalized)
      }

      const shouldUpdateMembership = options?.updateMembership ?? true
      const shouldUpdateCache = options?.updateCache ?? true
      if (shouldUpdateMembership) {
        setWorkspaceNoteMembership(
          workspaceId,
          normalized.map((entry) => entry.noteId),
          writeTimestamp,
        )
      }
      if (shouldUpdateCache) {
        const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, workspaceId)
        cache.openNotes = normalized
      }

      // DEBUG: Trace note addition timing
      void debugLog({
        component: "NoteDelay",
        action: "commit_open_notes_end",
        metadata: {
          workspaceId,
          noteCount: normalized.length,
          durationMs: performance.now() - debugStartTime,
        },
      })

      return normalized
    },
    [liveStateEnabled, setWorkspaceNoteMembership],
  )

  const getWorkspaceOpenNotes = useCallback(
    (workspaceId: string | null | undefined): NoteWorkspaceSlot[] => {
      if (!workspaceId) return []

      // DEBUG: Trace note reading timing
      void debugLog({
        component: "NoteDelay",
        action: "get_open_notes_called",
        metadata: {
          workspaceId,
          liveStateEnabled,
          timestampMs: performance.now(),
        },
      })

      // Phase 1: When live state enabled, runtime is the ONLY source of truth
      // No fallbacks to provider/refs/cache - they would overwrite runtime
      if (liveStateEnabled) {
        const runtimeSlots = getRuntimeOpenNotes(workspaceId)
        // DEBUG: Log what we got from runtime
        void debugLog({
          component: "NoteDelay",
          action: "get_open_notes_result_live_state",
          metadata: {
            workspaceId,
            noteCount: runtimeSlots.length,
            noteIds: runtimeSlots.map(n => n.noteId),
            timestampMs: performance.now(),
          },
        })
        // Keep ref in sync for debugging/legacy compatibility
        const stored = workspaceOpenNotesRef.current.get(workspaceId)
        if (!areWorkspaceSlotsEqual(stored, runtimeSlots)) {
          workspaceOpenNotesRef.current.set(workspaceId, runtimeSlots)
        }
        return runtimeSlots
      }

      // Legacy mode: Use fallback chain when live state is disabled
      const stored = workspaceOpenNotesRef.current.get(workspaceId)
      if (stored && stored.length > 0) {
        return stored
      }
      const cachedSnapshot = workspaceSnapshotsRef.current.get(workspaceId)
      if (stored && stored.length === 0 && cachedSnapshot && cachedSnapshot.openNotes.length > 0) {
        return commitWorkspaceOpenNotes(workspaceId, cachedSnapshot.openNotes, { updateMembership: false, callSite: "getOpenNotes_cachedSnapshot1" })
      }
      const canUseProvider =
        openNotesWorkspaceId &&
        openNotesWorkspaceId === workspaceId &&
        replayingWorkspaceRef.current === 0 &&
        !isHydratingRef.current
      if (canUseProvider && openNotes.length > 0) {
        return commitWorkspaceOpenNotes(workspaceId, openNotes, { updateCache: false, callSite: "getOpenNotes_provider" })
      }
      if (cachedSnapshot && cachedSnapshot.openNotes.length > 0) {
        return commitWorkspaceOpenNotes(workspaceId, cachedSnapshot.openNotes, { updateMembership: false, callSite: "getOpenNotes_cachedSnapshot2" })
      }
      const membership = workspaceNoteMembershipRef.current.get(workspaceId)
      if (membership && membership.size > 0) {
        const inferred = Array.from(membership).map((noteId) => ({ noteId, mainPosition: null }))
        return commitWorkspaceOpenNotes(workspaceId, inferred, { updateCache: false, callSite: "getOpenNotes_membership" })
      }
      return stored ?? []
    },
    [commitWorkspaceOpenNotes, getRuntimeOpenNotes, liveStateEnabled, openNotes, openNotesWorkspaceId],
  )

  const filterPanelsForWorkspace = useCallback(
    (workspaceId: string | null | undefined, panels: NoteWorkspacePanelSnapshot[]) => {
      if (!workspaceId) return panels
      if (!v2Enabled) {
        return panels
      }
      const membership = getWorkspaceNoteMembership(workspaceId)
      if (!membership) {
        return []
      }
      if (membership.size === 0) {
        return []
      }
      return panels.filter((panel) => {
        if (!panel.noteId) return false
        return membership.has(panel.noteId)
      })
    },
    [getWorkspaceNoteMembership, v2Enabled],
  )

  const getRuntimeDataStore = useCallback(
    (workspaceId: string | null | undefined): DataStore | null => {
      if (!liveStateEnabled || !workspaceId) return null
      return getWorkspaceRuntime(workspaceId).dataStore
    },
    [liveStateEnabled],
  )

  const getWorkspaceDataStore = useCallback(
    (workspaceId: string | null | undefined) => {
      if (!v2Enabled) {
        return sharedWorkspace?.dataStore ?? null
      }
      if (liveStateEnabled) {
        if (!workspaceId) return null
        return getRuntimeDataStore(workspaceId)
      }
      return getWorkspaceStore(workspaceId ?? undefined)
    },
    [sharedWorkspace?.dataStore, v2Enabled, liveStateEnabled, getRuntimeDataStore],
  )

  const emitDebugLog = useCallback(
    (payload: Parameters<NonNullable<NoteWorkspaceDebugLogger>>[0]) => {
      if (!debugLogger || !NOTE_WORKSPACE_DEBUG_ENABLED) return
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

  const getProviderOpenNoteIds = useCallback(
    (workspaceId: string | null | undefined): Set<string> => {
      if (!workspaceId) return new Set()
      if (!openNotesWorkspaceId || openNotesWorkspaceId !== workspaceId) return new Set()
      return new Set(
        openNotes
          .map((entry) => entry?.noteId)
          .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
      )
    },
    [openNotes, openNotesWorkspaceId],
  )

  const pruneWorkspaceEntries = useCallback(
    (workspaceId: string | null | undefined, observedNoteIds: Set<string>, reason: string) => {
      if (!v2Enabled || !workspaceId) return false
      const membership = workspaceNoteMembershipRef.current.get(workspaceId)
      const storedSlots = workspaceOpenNotesRef.current.get(workspaceId) ?? []
      const providerNoteIds = getProviderOpenNoteIds(workspaceId)
      const providerMatches = openNotesWorkspaceId === workspaceId
      const lastPendingAt = lastPendingTimestampRef.current.get(workspaceId) ?? 0
      if (lastPendingAt > 0 && now() - lastPendingAt < 1500) {
        return false
      }
      if (!providerMatches && providerNoteIds.size === 0) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "workspace_prune_skipped_offscreen",
          metadata: {
            workspaceId,
            reason,
            openNotesWorkspaceId,
            observedNoteCount: observedNoteIds.size,
          },
        })
        return false
      }
      const staleNoteIds = new Set<string>()
      if (membership) {
        membership.forEach((noteId) => {
          if (!observedNoteIds.has(noteId) && !providerNoteIds.has(noteId)) {
            staleNoteIds.add(noteId)
          }
        })
      }
      storedSlots.forEach((slot) => {
        if (slot.noteId && !observedNoteIds.has(slot.noteId) && !providerNoteIds.has(slot.noteId)) {
          staleNoteIds.add(slot.noteId)
        }
      })
      if (staleNoteIds.size === 0) {
        return false
      }
      const filteredSlots = storedSlots.filter((slot) => !staleNoteIds.has(slot.noteId))
      commitWorkspaceOpenNotes(workspaceId, filteredSlots, { updateCache: true, callSite: "evictStaleNotes" })
      const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, workspaceId)
      if (cache.panels.length > 0) {
        cache.panels = cache.panels.filter((panel) => {
          if (!panel.noteId) return true
          return !staleNoteIds.has(panel.noteId)
        })
      }
      if (cache.panels.length === 0) {
        lastNonEmptySnapshotsRef.current.delete(workspaceId)
      }
      staleNoteIds.forEach((noteId) => {
        panelSnapshotsRef.current.delete(noteId)
      })
      emitDebugLog({
        component: "NoteWorkspace",
        action: "workspace_prune_stale_notes",
        metadata: {
          workspaceId,
          reason,
          staleNoteIds: Array.from(staleNoteIds),
          observedNoteCount: observedNoteIds.size,
          providerOpenCount: providerNoteIds.size,
        },
      })
      return true
    },
    [commitWorkspaceOpenNotes, emitDebugLog, getProviderOpenNoteIds, openNotesWorkspaceId, v2Enabled],
  )

  const collectPanelSnapshotsFromDataStore = useCallback((): NoteWorkspacePanelSnapshot[] => {
    const snapshots: NoteWorkspacePanelSnapshot[] = []
    const activeWorkspaceId = snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
    const primaryStore = getWorkspaceDataStore(activeWorkspaceId)
    const workspaceMembership = getWorkspaceNoteMembership(activeWorkspaceId)
    const membershipKnown = workspaceMembership !== null && workspaceMembership !== undefined
    const inferredNoteIds = new Set<string>()

    const collectFromStore = (store: DataStore | null) => {
      if (!store || typeof store.keys !== "function") return
      for (const key of store.keys() as Iterable<string>) {
        const rawKey = String(key)
        const parsed = parsePanelKey(rawKey)
        const noteId = parsed?.noteId
        const panelId = parsed?.panelId ?? "main"
        if (!noteId) continue
        const record = store.get(rawKey)
        if (!record || typeof record !== "object") continue
        const position = normalizePoint((record as any).position) ?? normalizePoint((record as any).worldPosition)
        const size = normalizeSize((record as any).dimensions) ?? normalizeSize((record as any).worldSize)
        const branches = Array.isArray((record as any).branches)
          ? (record as any).branches.map((entry: unknown) => String(entry))
          : null
        if (!position && !size && !branches && typeof (record as any).zIndex !== "number" && !(record as any).type) {
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
    }

    collectFromStore(primaryStore)
    if (!v2Enabled && snapshots.length === 0) {
      const fallbackStore = sharedWorkspace?.dataStore ?? getWorkspaceDataStore(SHARED_WORKSPACE_ID)
      if (fallbackStore && fallbackStore !== primaryStore) {
        collectFromStore(fallbackStore)
      }
    }
    if (!primaryStore) {
      return []
    }
    if (v2Enabled && !membershipKnown) {
      return []
    }
    const ownedNotesForWorkspace = ownedNotesRef.current
    if (workspaceMembership) {
      if (workspaceMembership.size === 0) {
        const ownedPanels = snapshots.filter(
          (snapshot) => snapshot.noteId && ownedNotesForWorkspace.get(snapshot.noteId) === activeWorkspaceId,
        )
        if (activeWorkspaceId) {
          if (ownedPanels.length === 0) {
            inferredWorkspaceNotesRef.current.delete(activeWorkspaceId)
          } else {
            inferredWorkspaceNotesRef.current.set(
              activeWorkspaceId,
              new Set(ownedPanels.map((panel) => panel.noteId!).filter(Boolean)),
            )
          }
        }
        return ownedPanels
      }
      const filtered = snapshots.filter((snapshot) => {
        if (!snapshot.noteId) return false
        if (workspaceMembership.has(snapshot.noteId)) {
          return true
        }
        const owner = ownedNotesForWorkspace.get(snapshot.noteId)
        if (owner === activeWorkspaceId) {
          return true
        }
        if (!owner && activeWorkspaceId) {
          inferredNoteIds.add(snapshot.noteId)
          return true
        }
        return false
      })
      if (activeWorkspaceId) {
        if (inferredNoteIds.size > 0) {
          inferredWorkspaceNotesRef.current.set(activeWorkspaceId, new Set(inferredNoteIds))
        } else {
          inferredWorkspaceNotesRef.current.delete(activeWorkspaceId)
        }
      }
      return filtered
    }
    if (activeWorkspaceId) {
      inferredWorkspaceNotesRef.current.delete(activeWorkspaceId)
    }
    return snapshots
  }, [currentWorkspaceId, getWorkspaceDataStore, getWorkspaceNoteMembership, sharedWorkspace, v2Enabled])

  const getAllPanelSnapshots = useCallback(
    (options?: { useFallback?: boolean }): NoteWorkspacePanelSnapshot[] => {
      const useFallback = options?.useFallback ?? true
      const workspaceId =
        snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
      if (workspaceId && workspaceSnapshotsRef.current.has(workspaceId)) {
        const storedPanels = workspaceSnapshotsRef.current.get(workspaceId)?.panels ?? []
        if (storedPanels.length > 0 || !useFallback) return storedPanels
        const fallback = getLastNonEmptySnapshot(
          workspaceId,
          lastNonEmptySnapshotsRef.current,
          workspaceSnapshotsRef.current,
        )
        if (fallback.length > 0) return fallback
        return storedPanels
      }
      if (panelSnapshotsRef.current.size > 0) {
        return Array.from(panelSnapshotsRef.current.values()).flat()
      }
      const collected = collectPanelSnapshotsFromDataStore()
      if (workspaceId && collected.length === 0 && useFallback) {
        const fallback = getLastNonEmptySnapshot(
          workspaceId,
          lastNonEmptySnapshotsRef.current,
          workspaceSnapshotsRef.current,
        )
        if (fallback.length > 0) return fallback
      }
      return collected
    },
    [collectPanelSnapshotsFromDataStore, currentWorkspaceId],
  )

  const updatePanelSnapshotMap = useCallback(
    (
      panels: NoteWorkspacePanelSnapshot[],
      reason: string,
      options?: { allowEmpty?: boolean; mergeWithExisting?: boolean },
    ) => {
      const allowEmpty = options?.allowEmpty ?? false
      const mergeWithExisting = options?.mergeWithExisting ?? false
      let ownerId =
        snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
      if (!snapshotOwnerWorkspaceIdRef.current && ownerId) {
        snapshotOwnerWorkspaceIdRef.current = ownerId
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_owner_fallback",
          metadata: {
            reason,
            fallbackWorkspaceId: ownerId,
            panelCount: panels.length,
            noteIds: Array.from(new Set(panels.map((panel) => panel.noteId))),
          },
        })
      }
      if (!ownerId) {
        const activeId = currentWorkspaceIdRef.current ?? currentWorkspaceId
        if (activeId) {
          ownerId = activeId
          snapshotOwnerWorkspaceIdRef.current = activeId
          emitDebugLog({
            component: "NoteWorkspace",
            action: "panel_snapshot_owner_fallback_attach",
            metadata: {
              reason,
              fallbackWorkspaceId: activeId,
              panelCount: panels.length,
              noteIds: Array.from(new Set(panels.map((panel) => panel.noteId))),
              timestampMs: Date.now(),
            },
          })
        } else {
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
      }

      ownerId = snapshotOwnerWorkspaceIdRef.current ?? ownerId
      const fallbackPanels = ownerId
        ? getLastNonEmptySnapshot(ownerId, lastNonEmptySnapshotsRef.current, workspaceSnapshotsRef.current)
        : []
      let panelsToPersist =
        panels.length > 0
          ? panels
          : allowEmpty
            ? []
            : fallbackPanels
      if (!allowEmpty && panels.length === 0 && fallbackPanels.length > 0) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_fallback_to_last_non_empty",
          metadata: {
            reason,
            workspaceId: ownerId,
            cachedPanelCount: fallbackPanels.length,
          },
        })
      }
      if (mergeWithExisting && ownerId && panelsToPersist.length > 0) {
        const existingPanels = workspaceSnapshotsRef.current.get(ownerId)?.panels ?? []
        if (existingPanels.length > 0) {
          const updatedNoteIds = new Set(
            panelsToPersist
              .map((panel) => (panel.noteId ? String(panel.noteId) : null))
              .filter((id): id is string => Boolean(id)),
          )
          const preservedPanels = existingPanels.filter((panel) => {
            if (!panel.noteId) return false
            return !updatedNoteIds.has(panel.noteId)
          })
          const merged = [...preservedPanels, ...panelsToPersist]
          const deduped = new Map<string, NoteWorkspacePanelSnapshot>()
          merged.forEach((panel) => {
            if (!panel.noteId || !panel.panelId) return
            const key = `${panel.noteId}:${panel.panelId}`
            deduped.set(key, panel)
          })
          panelsToPersist = Array.from(deduped.values())
          emitDebugLog({
            component: "NoteWorkspace",
            action: "panel_snapshot_merge_existing",
            metadata: {
              workspaceId: ownerId,
              mergedCount: panelsToPersist.length,
              updatedNoteIds: Array.from(updatedNoteIds),
            },
          })
        }
      }

      const snapshotHash = serializePanelSnapshots(panelsToPersist)
      if (snapshotHash === lastPanelSnapshotHashRef.current) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_skip_duplicate",
          metadata: {
            workspaceId: ownerId,
            reason,
            panelCount: panelsToPersist.length,
          },
        })
        return
      }
      lastPanelSnapshotHashRef.current = snapshotHash

      if (!panelsToPersist || panelsToPersist.length === 0) {
        if (allowEmpty) {
          const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, ownerId)
          cache.panels = []
          workspaceNoteMembershipRef.current.set(ownerId, new Set())
          lastNonEmptySnapshotsRef.current.delete(ownerId)
          emitDebugLog({
            component: "NoteWorkspace",
            action: "panel_snapshot_cleared",
            metadata: {
              reason,
              workspaceId: ownerId,
            },
          })
          const dataStore = getWorkspaceDataStore(ownerId)
          if (dataStore && typeof dataStore.keys === "function") {
            const keys: string[] = []
            for (const key of dataStore.keys() as Iterable<string>) {
              keys.push(String(key))
            }
            keys.forEach((key) => dataStore.delete(key))
          }
        } else {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "panel_snapshot_skip_empty_no_fallback",
            metadata: {
              reason,
              workspaceId: ownerId,
            },
          })
        }
        return
      }
      const next = new Map(panelSnapshotsRef.current)
      panelsToPersist.forEach((panel) => {
        if (!panel.noteId) return
        const existing = next.get(panel.noteId) ?? []
        const filtered = existing.filter((entry) => entry.panelId !== panel.panelId)
        filtered.push(panel)
        next.set(panel.noteId, filtered)
      })
      panelSnapshotsRef.current = next
      if (ownerId) {
        const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, ownerId)
        cache.panels = panelsToPersist
        if (!workspaceNoteMembershipRef.current.has(ownerId)) {
          const inferredNoteIds = new Set(
            panelsToPersist
              .map((panel) => panel.noteId)
              .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
          )
          workspaceNoteMembershipRef.current.set(ownerId, inferredNoteIds)
        }
      }
      emitDebugLog({
        component: "NoteWorkspace",
        action: "panel_snapshot_updated",
        metadata: {
          reason,
          panelCount: panelsToPersist.length,
          noteIds: Array.from(new Set(panelsToPersist.map((panel) => panel.noteId))),
          workspaceId: ownerId,
          timestampMs: Date.now(),
          cachedWorkspaceCount: workspaceSnapshotsRef.current.size,
        },
      })
    },
    [emitDebugLog, v2Enabled, getWorkspaceDataStore, currentWorkspaceId],
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
      if (replayingWorkspaceRef.current > 0) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_skip_during_replay",
          metadata: {
            workspaceId: snapshotOwnerWorkspaceIdRef.current,
          },
        })
        return
      }
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
      updatePanelSnapshotMap(snapshots, "datastore_mutation", {
        allowEmpty: false,
        mergeWithExisting: true,
      })
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
    replayingWorkspaceRef,
  ])

  const waitForPanelSnapshotReadiness = useCallback(
    async (reason: string, maxWaitMs = 800, workspaceOverride?: string | null): Promise<boolean> => {
      if (!featureEnabled || !v2Enabled) return true
      const workspaceId =
        workspaceOverride ??
        snapshotOwnerWorkspaceIdRef.current ??
        currentWorkspaceIdRef.current ??
        currentWorkspaceId
      if (!workspaceId) return true
      if (replayingWorkspaceRef.current > 0) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "snapshot_wait_replay",
          metadata: {
            workspaceId,
            pendingReplays: replayingWorkspaceRef.current,
            reason,
          },
        })
        const replaySettled = await new Promise<boolean>((resolve) => {
          const start = Date.now()
          const check = () => {
            if (replayingWorkspaceRef.current === 0) {
              resolve(true)
              return
            }
            if (Date.now() - start >= maxWaitMs) {
              resolve(false)
              return
            }
            setTimeout(check, 16)
          }
          check()
        })
        emitDebugLog({
          component: "NoteWorkspace",
          action: replaySettled ? "snapshot_replay_resolved" : "snapshot_replay_timeout",
          metadata: {
            workspaceId,
            pendingReplays: replayingWorkspaceRef.current,
            reason,
          },
        })
        if (!replaySettled) {
          return false
        }
      }
      const pendingCount = getPendingPanelCount(workspaceId)
      const lastPendingAt = lastPendingTimestampRef.current.get(workspaceId) ?? 0
      const hasRecentPending = lastPendingAt > 0 && Date.now() - lastPendingAt < maxWaitMs
      const waitReason =
        pendingCount > 0 ? "pending_panels" : hasRecentPending ? "recent_pending" : "none"
      emitDebugLog({
        component: "NoteWorkspace",
        action: "snapshot_wait_pending_panels",
        metadata: {
          workspaceId,
          pendingCount,
          reason,
          waitReason,
          lastPendingMs: lastPendingAt ? Date.now() - lastPendingAt : null,
        },
      })
      if (waitReason === "none") {
        return true
      }
      // If we just saw pending activity, require a short stability window before capturing.
      if (waitReason === "recent_pending") {
        const stabilityMs = Math.min(200, maxWaitMs)
        const stable = await new Promise<boolean>((resolve) => {
          const start = Date.now()
          const check = () => {
            const elapsed = Date.now() - start
            const stillPending = getPendingPanelCount(workspaceId)
            if (stillPending === 0 && elapsed >= stabilityMs) {
              resolve(true)
              return
            }
            if (elapsed >= maxWaitMs) {
              resolve(false)
              return
            }
            setTimeout(check, 16)
          }
          check()
        })
        if (!stable) {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "snapshot_pending_timeout",
          metadata: {
            workspaceId,
            reason,
            pendingCount,
            lastPendingMs: lastPendingAt ? Date.now() - lastPendingAt : null,
          },
        })
          return false
        }
      }
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
          waitReason,
        },
      })
      return ready
    },
    [currentWorkspaceId, emitDebugLog, featureEnabled, v2Enabled, waitForWorkspaceSnapshotReady],
  )

  const applyPanelSnapshots = useCallback(
    (
      panels: NoteWorkspacePanelSnapshot[] | undefined,
      targetNoteIds: Set<string>,
      components?: NoteWorkspaceComponentSnapshot[],
      options?: {
        allowEmptyApply?: boolean
        clearWorkspace?: boolean
        suppressMutationEvents?: boolean
        clearComponents?: boolean
        reason?: string
      },
    ) => {
      const replayStartedAt = Date.now()
      const allowEmptyApply = options?.allowEmptyApply ?? false
      const shouldClearWorkspace = options?.clearWorkspace ?? false
      const suppressMutations = options?.suppressMutationEvents ?? true
      const shouldClearComponentsExplicit = options?.clearComponents ?? false
      const applyReason = options?.reason ?? "apply_panel_snapshots"
      let releasingReplay = false
      if (suppressMutations) {
        replayingWorkspaceRef.current += 1
        releasingReplay = true
      }
      try {
        const hasPanelPayload = Boolean(panels && panels.length > 0)
        const hasComponentPayload = Array.isArray(components)
        const hasAnyComponentRecords = Boolean(components && components.length > 0)
        if (!hasPanelPayload && !hasAnyComponentRecords && !allowEmptyApply && !shouldClearWorkspace) return
        const activeWorkspaceId =
          snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current ?? currentWorkspaceId
        const dataStore = getWorkspaceDataStore(activeWorkspaceId)
        const layerMgr = getWorkspaceLayerManager(activeWorkspaceId)
        if (!dataStore) return
        const runtimeState =
          !liveStateEnabled || !activeWorkspaceId
            ? "legacy"
            : hasWorkspaceRuntime(activeWorkspaceId)
              ? "hot"
              : "cold"

        const normalizedTargetIds = new Set<string>(targetNoteIds)
        const workspaceMembership = getWorkspaceNoteMembership(activeWorkspaceId)
        const membershipKnown = workspaceMembership !== null && workspaceMembership !== undefined
        if (v2Enabled && !membershipKnown) {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "panel_snapshot_skip_membership_unknown",
            metadata: {
              workspaceId: activeWorkspaceId,
              reason: applyReason,
            },
          })
          return
        }
        const allowedNoteIds = workspaceMembership ? new Set<string>(workspaceMembership) : null
        if (allowedNoteIds) {
          normalizedTargetIds.forEach((noteId) => {
            if (noteId) {
              allowedNoteIds.add(noteId)
            }
          })
        }
        panels?.forEach((panel) => {
          if (!panel.noteId) return
          normalizedTargetIds.add(panel.noteId)
        })

        // DEBUG: Log membership state before pruning loop
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_apply_membership_state",
          metadata: {
            workspaceId: activeWorkspaceId,
            reason: applyReason,
            runtimeState,
            workspaceMembershipSize: workspaceMembership?.size ?? null,
            workspaceMembershipIds: workspaceMembership ? Array.from(workspaceMembership) : null,
            allowedNoteIdsSize: allowedNoteIds?.size ?? null,
            allowedNoteIds: allowedNoteIds ? Array.from(allowedNoteIds) : null,
            normalizedTargetIdsSize: normalizedTargetIds.size,
            normalizedTargetIds: Array.from(normalizedTargetIds),
            panelCount: panels?.length ?? 0,
          },
        })

        const shouldTargetAllNotes = normalizedTargetIds.size === 0
        const shouldLimitToAllowed = Boolean(allowedNoteIds)
        const keysToRemove: string[] = []
        if (typeof dataStore.keys === "function") {
          for (const key of dataStore.keys() as Iterable<string>) {
            const rawKey = String(key)
            const parsed = parsePanelKey(rawKey)
            if (!parsed?.noteId || !parsed?.panelId) continue
            let removeKey = false
            const belongsToWorkspace =
              !shouldLimitToAllowed || allowedNoteIds?.has(parsed.noteId) || normalizedTargetIds.has(parsed.noteId)
            // FIX 3: Respect preserved membership when determining if panel is targeted
            // Panels belonging to workspace via membership should not be pruned even if not in snapshot
            const isTargeted = shouldTargetAllNotes ||
                               normalizedTargetIds.has(parsed.noteId) ||
                               (allowedNoteIds?.has(parsed.noteId) ?? false)
            if (shouldClearWorkspace) {
              removeKey = true
            } else if (!belongsToWorkspace) {
              removeKey = true
            } else if (!isTargeted) {
              removeKey = true
            }
            if (removeKey) {
              keysToRemove.push(rawKey)
              // DEBUG: Log why this panel is being removed
              emitDebugLog({
                component: "NoteWorkspace",
                action: "panel_snapshot_prune_decision",
                metadata: {
                  workspaceId: activeWorkspaceId,
                  panelKey: rawKey,
                  noteId: parsed.noteId,
                  panelId: parsed.panelId,
                  reason: applyReason,
                  shouldClearWorkspace,
                  belongsToWorkspace,
                  isTargeted,
                  inAllowedNoteIds: allowedNoteIds?.has(parsed.noteId) ?? null,
                  inNormalizedTargetIds: normalizedTargetIds.has(parsed.noteId),
                  shouldTargetAllNotes,
                  shouldLimitToAllowed,
                  removalReason: shouldClearWorkspace ? "clearWorkspace" : !belongsToWorkspace ? "notBelongsToWorkspace" : "notTargeted",
                },
              })
            }
          }
        }

        panels?.forEach((panel) => {
          if (!panel.noteId || !panel.panelId) return
          const shouldApplyPanel = shouldTargetAllNotes || normalizedTargetIds.has(panel.noteId)
          if (!shouldApplyPanel) return
          const key = ensurePanelKey(panel.noteId, panel.panelId)
          dataStore.set(key, {
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

        if (keysToRemove.length > 0) {
          keysToRemove.forEach((key) => {
            dataStore.delete(key)
          })
          emitDebugLog({
            component: "NoteWorkspace",
            action: shouldClearWorkspace ? "panel_snapshot_apply_clear" : "panel_snapshot_apply_prune",
            metadata: {
              workspaceId: activeWorkspaceId,
              clearedCount: keysToRemove.length,
              clearedAll: shouldClearWorkspace && keysToRemove.length > 0,
            },
          })
        }

        if (!hasPanelPayload && !allowEmptyApply && !shouldClearWorkspace) {
          // nothing else to do for panels
        }
        if (layerMgr) {
          const existingComponentNodes =
            typeof layerMgr.getNodes === "function"
              ? Array.from(layerMgr.getNodes().values()).filter((node: any) => node.type === "component")
              : []
          if (components && components.length > 0) {
            const incomingIds = new Set<string>()
            components.forEach((component) => {
              if (!component.id || !component.type) return
              incomingIds.add(component.id)
              const componentMetadata = {
                ...(component.metadata ?? {}),
              } as Record<string, unknown> & { componentType?: string }
              const hasComponentType =
                typeof componentMetadata.componentType === "string" && componentMetadata.componentType.length > 0
              if (!hasComponentType) {
                componentMetadata.componentType = component.type
              }
              layerMgr.registerNode({
                id: component.id,
                type: "component",
                position: component.position ?? { x: 0, y: 0 },
                dimensions: component.size ?? undefined,
                zIndex: component.zIndex ?? undefined,
                metadata: componentMetadata,
              } as any)
            })
            existingComponentNodes
              .filter((node: any) => !incomingIds.has(node.id))
              .forEach((node: any) => {
                if (shouldClearComponentsExplicit || shouldClearWorkspace) {
                  layerMgr.removeNode(node.id)
                }
              })
            emitDebugLog({
              component: "NoteWorkspace",
              action: "component_snapshot_apply",
              metadata: {
                workspaceId: activeWorkspaceId,
                incomingCount: components.length,
                removedCount:
                  shouldClearComponentsExplicit || shouldClearWorkspace
                    ? existingComponentNodes.filter((node: any) => !incomingIds.has(node.id)).length
                    : 0,
              },
            })
          } else if (shouldClearComponentsExplicit || shouldClearWorkspace) {
            existingComponentNodes.forEach((node: any) => layerMgr.removeNode(node.id))
            emitDebugLog({
              component: "NoteWorkspace",
              action: "component_snapshot_apply_clear",
              metadata: {
                workspaceId: activeWorkspaceId,
                clearedCount: existingComponentNodes.length,
                allowEmpty: allowEmptyApply,
              },
            })
          }
        }
        emitDebugLog({
          component: "NoteWorkspace",
          action: "workspace_snapshot_replay",
          metadata: {
            workspaceId: activeWorkspaceId,
            reason: applyReason,
            panelCount: panels?.length ?? 0,
            componentCount: Array.isArray(components) ? components.length : 0,
            targetNoteCount: normalizedTargetIds.size,
            clearedCount: keysToRemove.length,
            clearedWorkspace: shouldClearWorkspace,
            suppressedMutations: suppressMutations,
            durationMs: Date.now() - replayStartedAt,
            runtimeState,
          },
        })
        if (panels) {
          lastPanelSnapshotHashRef.current = serializePanelSnapshots(panels)
        } else if (allowEmptyApply || shouldClearWorkspace) {
          lastPanelSnapshotHashRef.current = serializePanelSnapshots([])
        }
      } finally {
        if (releasingReplay) {
          replayingWorkspaceRef.current = Math.max(0, replayingWorkspaceRef.current - 1)
        }
      }
    },
    [
      sharedWorkspace,
      layerContext,
      v2Enabled,
      currentWorkspaceId,
      emitDebugLog,
      getWorkspaceNoteMembership,
      hasWorkspaceRuntime,
      liveStateEnabled,
    ],
  )

  const captureCurrentWorkspaceSnapshot = useCallback(
    async (
      targetWorkspaceId?: string | null,
      options?: { readinessReason?: string; readinessMaxWaitMs?: number; skipReadiness?: boolean },
    ) => {
      const workspaceId =
        targetWorkspaceId ??
        snapshotOwnerWorkspaceIdRef.current ??
        currentWorkspaceId ??
        currentWorkspaceIdRef.current
      if (!workspaceId) return
      const readinessReason = options?.readinessReason ?? "capture_snapshot"
      const readinessMaxWaitMs = options?.readinessMaxWaitMs ?? 800
      if (!options?.skipReadiness) {
        const ready = await waitForPanelSnapshotReadiness(readinessReason, readinessMaxWaitMs, workspaceId)
        if (!ready) {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "snapshot_capture_skipped_pending",
            metadata: {
              workspaceId,
              reason: readinessReason,
            },
          })
          return
        }
      }
      let workspaceOpenNotes = getWorkspaceOpenNotes(workspaceId)
      const providerOpenSlots = openNotesWorkspaceId === workspaceId ? openNotes : []
      const runtimeOpenSlots = getWorkspaceOpenNotes(workspaceId)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "snapshot_open_notes_source",
        metadata: {
          workspaceId,
          providerCount: providerOpenSlots.length,
          providerWorkspaceId: openNotesWorkspaceId,
          runtimeCount: runtimeOpenSlots.length,
        },
      })
      const existingIds = new Set(
        workspaceOpenNotes
          .map((entry) => entry.noteId)
          .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
      )
      const mergeSlots = [...providerOpenSlots, ...runtimeOpenSlots]
        .map((entry) =>
          entry?.noteId ? { noteId: entry.noteId, mainPosition: entry.mainPosition ?? null } : null,
        )
        .filter((entry): entry is { noteId: string; mainPosition: { x: number; y: number } | null } => Boolean(entry))
      const missingSlots = mergeSlots.filter((slot) => !existingIds.has(slot.noteId))
      if (missingSlots.length > 0) {
        workspaceOpenNotes = commitWorkspaceOpenNotes(workspaceId, [...workspaceOpenNotes, ...missingSlots], { callSite: "snapshotRuntimeSync" })
        emitDebugLog({
          component: "NoteWorkspace",
          action: "snapshot_open_notes_runtime_sync",
          metadata: {
            workspaceId,
            addedNoteIds: missingSlots.map((slot) => slot.noteId),
            mergedSourceCount: mergeSlots.length,
          },
        })
      }
      let openNoteIds = new Set(
        workspaceOpenNotes
          .map((entry) => entry.noteId)
          .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
      )
      if (liveStateEnabled) {
        const cachedPanels = workspaceSnapshotsRef.current.get(workspaceId)?.panels ?? []
        if (cachedPanels.length > 0) {
          const cachedNoteIds = new Set(
            cachedPanels
              .map((panel) => panel.noteId)
              .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
          )
          const missingCachedNotes = Array.from(cachedNoteIds).filter((noteId) => !openNoteIds.has(noteId))
          if (missingCachedNotes.length > 0) {
            // FIX 4: Prevent infinite deferral loop from stale cached snapshots
            // Check if this is genuinely waiting for new notes or just stale cache
            const currentMembership = getRuntimeMembership(workspaceId)
            const allMissingAreInMembership = missingCachedNotes.every(
              (noteId) => currentMembership?.has(noteId) ?? false
            )

            if (allMissingAreInMembership && currentMembership && currentMembership.size >= cachedNoteIds.size) {
              // Cache is stale - membership already expanded beyond cached snapshot, don't defer
              emitDebugLog({
                component: "NoteWorkspace",
                action: "snapshot_capture_skip_stale_cache",
                metadata: {
                  workspaceId,
                  missingNoteIds: missingCachedNotes,
                  cachedNoteCount: cachedNoteIds.size,
                  openNoteCount: openNoteIds.size,
                  membershipCount: currentMembership.size,
                  reason: "cached_snapshot_stale_vs_membership",
                },
              })
              // Continue with capture using current state, not stale cache
            } else {
              // Legitimate wait for notes to be added to open list
              emitDebugLog({
                component: "NoteWorkspace",
                action: "snapshot_capture_deferred_cached_open_notes",
                metadata: {
                  workspaceId,
                  missingNoteIds: missingCachedNotes,
                  cachedNoteCount: cachedNoteIds.size,
                  openNoteCount: openNoteIds.size,
                  timestampMs: Date.now(),
                },
              })
              setTimeout(() => {
                captureCurrentWorkspaceSnapshot(workspaceId, {
                  readinessReason: "deferred_cached_open_notes",
                  readinessMaxWaitMs,
                })
              }, CAPTURE_DEFER_DELAY_MS)
              return
            }
          }
        }
      }
      const captureStartedAt = Date.now()
      emitDebugLog({
        component: "NoteWorkspace",
        action: "snapshot_capture_start",
        metadata: {
          workspaceId,
          openNoteCount: workspaceOpenNotes.length,
          activeNoteId,
          timestampMs: captureStartedAt,
        },
      })
      const previousOwner = snapshotOwnerWorkspaceIdRef.current
      snapshotOwnerWorkspaceIdRef.current = workspaceId
      const snapshots = collectPanelSnapshotsFromDataStore()
      if (workspaceId) {
        const inferredNotes = inferredWorkspaceNotesRef.current.get(workspaceId)
        if (inferredNotes && inferredNotes.size > 0) {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "panel_snapshot_inferred_membership",
            metadata: {
              workspaceId,
              inferredNoteIds: Array.from(inferredNotes),
            },
          })
          inferredWorkspaceNotesRef.current.delete(workspaceId)
        }
      }
      const observedNoteIds = new Set(
        snapshots
          .map((panel) => panel.noteId)
          .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
      )
      const missingOpenNotes = Array.from(observedNoteIds).filter((noteId) => !openNoteIds.has(noteId))
      // FIX 1: Guard against stale provider state in live-state hot runtime
      if (liveStateEnabled && hasWorkspaceRuntime(workspaceId) && missingOpenNotes.length > 0) {
        const currentAttempts = captureRetryAttemptsRef.current.get(workspaceId) ?? 0
        const maxRetries = 3
        const retryTimeoutMs = 100
        if (currentAttempts < maxRetries) {
          captureRetryAttemptsRef.current.set(workspaceId, currentAttempts + 1)
          emitDebugLog({
            component: "NoteWorkspace",
            action: "snapshot_capture_deferred_runtime_sync",
            metadata: {
              workspaceId,
              missingNoteIds: missingOpenNotes,
              panelNoteCount: observedNoteIds.size,
              openNoteCount: openNoteIds.size,
              attemptNumber: currentAttempts + 1,
              maxRetries,
              reason: readinessReason,
            },
          })
          setTimeout(() => {
            captureCurrentWorkspaceSnapshot(workspaceId, {
              readinessReason: "deferred_runtime_sync",
              readinessMaxWaitMs,
            })
          }, retryTimeoutMs)
          return
        } else {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "snapshot_capture_runtime_sync_timeout",
            metadata: {
              workspaceId,
              missingNoteIds: missingOpenNotes,
              attemptsExhausted: currentAttempts,
              proceedingWithRuntimeState: true,
            },
          })
          captureRetryAttemptsRef.current.delete(workspaceId)
        }
      } else if (missingOpenNotes.length === 0) {
        captureRetryAttemptsRef.current.delete(workspaceId)
      }
      if (missingOpenNotes.length > 0) {
        const augmentedSlots = [
          ...workspaceOpenNotes,
          ...missingOpenNotes.map((noteId) => ({
            noteId,
            mainPosition: resolveMainPanelPosition(noteId) ?? null,
          })),
        ]
        workspaceOpenNotes = commitWorkspaceOpenNotes(workspaceId, augmentedSlots, { callSite: "snapshotOpenNoteSeed" })
        openNoteIds = new Set(
          workspaceOpenNotes
            .map((entry) => entry.noteId)
            .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
        )
        emitDebugLog({
          component: "NoteWorkspace",
          action: "snapshot_open_note_seed",
          metadata: {
            workspaceId,
            addedNoteIds: missingOpenNotes,
            observedNoteCount: observedNoteIds.size,
          },
        })
      }
      pruneWorkspaceEntries(workspaceId, observedNoteIds, "capture_snapshot")
      const fallbackPanels = getLastNonEmptySnapshot(
        workspaceId,
        lastNonEmptySnapshotsRef.current,
        workspaceSnapshotsRef.current,
      )
      const mergedPanels = (() => {
        if (fallbackPanels.length === 0) {
          return snapshots
        }
        if (snapshots.length === 0) {
          return fallbackPanels
        }
        const mergeMap = new Map<string, NoteWorkspacePanelSnapshot>()
        const toKey = (panel: NoteWorkspacePanelSnapshot) =>
          `${panel.noteId ?? "unknown"}:${panel.panelId ?? "unknown"}`
        fallbackPanels.forEach((panel) => {
          if (!panel.noteId || !panel.panelId) return
          mergeMap.set(toKey(panel), panel)
        })
        snapshots.forEach((panel) => {
          if (!panel.noteId || !panel.panelId) return
          mergeMap.set(toKey(panel), panel)
        })
        return Array.from(mergeMap.values())
      })()
      if (fallbackPanels.length > 0 && snapshots.length > 0 && mergedPanels.length > snapshots.length) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "panel_snapshot_merge_fallback",
          metadata: {
            workspaceId,
            snapshotCount: snapshots.length,
            mergedCount: mergedPanels.length,
          },
        })
      }
      const snapshotsToCache = mergedPanels.length > 0 ? mergedPanels : []
      updatePanelSnapshotMap(snapshotsToCache, "workspace_switch_capture", { allowEmpty: false })
      const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, workspaceId)
      cache.panels = snapshotsToCache
      if (snapshotsToCache.length > 0) {
        lastNonEmptySnapshotsRef.current.set(workspaceId, snapshotsToCache)
      }
      lastPanelSnapshotHashRef.current = serializePanelSnapshots(snapshotsToCache)
      const membershipSource = new Set<string>()
      workspaceOpenNotes.forEach((entry) => {
        if (entry.noteId) {
          membershipSource.add(entry.noteId)
        }
      })
      observedNoteIds.forEach((noteId) => membershipSource.add(noteId))

      // DEBUG: Log membership being set from capture
      emitDebugLog({
        component: "NoteWorkspace",
        action: "capture_set_membership_from_observed",
        metadata: {
          workspaceId,
          membershipSourceIds: Array.from(membershipSource),
          membershipSourceSize: membershipSource.size,
          workspaceOpenNotesCount: workspaceOpenNotes.length,
          observedNoteIdsCount: observedNoteIds.size,
        },
      })

      setWorkspaceNoteMembership(workspaceId, membershipSource)
      const workspaceIdForComponents = workspaceId
      const lm = workspaceIdForComponents ? getWorkspaceLayerManager(workspaceIdForComponents) : null
      const componentsFromManager: NoteWorkspaceComponentSnapshot[] =
        lm && typeof lm.getNodes === "function"
          ? Array.from(lm.getNodes().values())
              .filter((node: any) => node.type === "component")
              .map((node: any) => ({
                id: node.id,
                type:
                  (node as any).metadata?.componentType && typeof (node as any).metadata?.componentType === "string"
                    ? (node as any).metadata.componentType
                    : typeof node.type === "string"
                      ? node.type
                      : "component",
                position: (node as any).position ?? null,
                size: (node as any).dimensions ?? null,
                zIndex: typeof (node as any).zIndex === "number" ? (node as any).zIndex : null,
                metadata: (node as any).metadata ?? null,
              }))
          : []

      const cachedSnapshot = workspaceId ? getWorkspaceSnapshot(workspaceId) : null
      const lastComponents = workspaceId ? lastComponentsSnapshotRef.current.get(workspaceId) ?? [] : []
      const components: NoteWorkspaceComponentSnapshot[] = (() => {
        const source =
          componentsFromManager.length > 0 ? componentsFromManager : cachedSnapshot?.components ?? lastComponents
        if (!source || source.length === 0) return []
        const byId = new Map<string, NoteWorkspaceComponentSnapshot>()
        ;(cachedSnapshot?.components ?? []).forEach((c) => byId.set(c.id, c))
        lastComponents.forEach((c) => byId.set(c.id, c))
        return source.map((c) => {
          if (c.type && c.type !== "component") return c
          const fallback = byId.get(c.id)
          if (fallback && fallback.type && fallback.type !== "component") {
            return { ...c, type: fallback.type, metadata: c.metadata ?? fallback.metadata ?? null }
          }
        return c
      })
    })()
    if (v2Enabled) {
      if (components.length > 0 && workspaceId) {
        lastComponentsSnapshotRef.current.set(workspaceId, components)
      }
      cache.components = components
      const normalizedOpenNotes = workspaceOpenNotes.map((note) => ({
        noteId: note.noteId,
        mainPosition: resolveMainPanelPosition(note.noteId),
      }))
      cache.openNotes = normalizedOpenNotes
      commitWorkspaceOpenNotes(workspaceId, normalizedOpenNotes, { callSite: "captureSnapshot" })
      cacheWorkspaceSnapshot({
        workspaceId,
        panels: snapshots,
        components,
        openNotes: normalizedOpenNotes,
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
        openNoteCount: workspaceOpenNotes.length,
        componentCount: components?.length ?? 0,
        durationMs: Date.now() - captureStartedAt,
        cameraSource,
        timestampMs: Date.now(),
      },
    })
      if (targetWorkspaceId) {
        snapshotOwnerWorkspaceIdRef.current = previousOwner
      } else {
        snapshotOwnerWorkspaceIdRef.current = previousOwner ?? workspaceId
      }
    },
    [
      activeNoteId,
      canvasState,
      collectPanelSnapshotsFromDataStore,
      commitWorkspaceOpenNotes,
      currentWorkspaceId,
      emitDebugLog,
      getWorkspaceOpenNotes,
      layerContext?.transforms.notes,
      pruneWorkspaceEntries,
      resolveMainPanelPosition,
      updatePanelSnapshotMap,
      setWorkspaceNoteMembership,
      waitForPanelSnapshotReadiness,
      liveStateEnabled,
      v2Enabled,
    ],
  )

  const buildPayloadFromSnapshot = useCallback(
    (workspaceId: string, snapshot: NoteWorkspaceSnapshot): NoteWorkspacePayload => {
      const normalizedOpenNotes = snapshot.openNotes.map((entry) => ({
        noteId: entry.noteId,
        position: entry.mainPosition ?? null,
      }))
      const active = snapshot.activeNoteId ?? normalizedOpenNotes[0]?.noteId ?? null
      const payload: NoteWorkspacePayload = {
        schemaVersion: "1.1.0",
        openNotes: normalizedOpenNotes,
        activeNoteId: active,
        camera: snapshot.camera ?? DEFAULT_CAMERA,
        panels: snapshot.panels ?? [],
      }
      if (snapshot.components && snapshot.components.length > 0) {
        payload.components = snapshot.components
      }
      return payload
    },
    [],
  )

  const persistWorkspaceSnapshot = useCallback(
    async (workspaceId: string | null | undefined, reason: string) => {
      if (!workspaceId || !adapterRef.current) return false
      const snapshot = getWorkspaceSnapshot(workspaceId)
      if (!snapshot) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_skip_no_snapshot",
          metadata: { workspaceId, reason },
        })
        return false
      }
      const payload = buildPayloadFromSnapshot(workspaceId, snapshot)
      const payloadHash = serializeWorkspacePayload(payload)
      const previousHash = lastSavedPayloadHashRef.current.get(workspaceId)
      if (previousHash === payloadHash) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_skip_no_changes",
          metadata: { workspaceId, reason },
        })
        return true
      }
      const saveStart = Date.now()
      try {
        const updated = await adapterRef.current.saveWorkspace({
          id: workspaceId,
          payload,
          revision: workspaceRevisionRef.current.get(workspaceId) ?? "",
        })
        workspaceRevisionRef.current.set(workspaceId, updated.revision ?? null)
        lastSavedPayloadHashRef.current.set(workspaceId, payloadHash)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_success",
          metadata: {
            workspaceId,
            reason,
            panelCount: payload.panels.length,
            openCount: payload.openNotes.length,
            durationMs: Date.now() - saveStart,
          },
        })
        return true
      } catch (error) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_error",
          metadata: {
            workspaceId,
            reason,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - saveStart,
          },
        })
        return false
      }
    },
    [adapterRef, buildPayloadFromSnapshot, emitDebugLog],
  )

  const {
    ensureRuntimePrepared,
    updateRuntimeAccess,
    runtimeAccessRef,
  } = useNoteWorkspaceRuntimeManager({
    liveStateEnabled,
    currentWorkspaceId,
    pendingWorkspaceId,
    runtimeCapacity,
    captureSnapshot: captureCurrentWorkspaceSnapshot,
    persistSnapshot: persistWorkspaceSnapshot,
    emitDebugLog,
  })

  const rehydratePanelsForNote = useCallback(
    (noteId: string, workspaceId?: string) => {
      if (workspaceId && workspaceSnapshotsRef.current.has(workspaceId)) {
        const perWorkspace = (workspaceSnapshotsRef.current.get(workspaceId)?.panels ?? []).filter(
          (panel) => panel.noteId === noteId,
        )
        if (perWorkspace.length > 0) {
          applyPanelSnapshots(perWorkspace, new Set([noteId]), undefined, { reason: "rehydrate_note" })
          return
        }
      }
      const stored = panelSnapshotsRef.current.get(noteId)
      if (!stored || stored.length === 0) return
      applyPanelSnapshots(stored, new Set([noteId]), undefined, { reason: "rehydrate_note" })
    },
    [applyPanelSnapshots],
  )

  const previewWorkspaceFromSnapshot = useCallback(
    async (workspaceId: string, snapshot: NoteWorkspaceSnapshot, options?: { force?: boolean }) => {
      const force = options?.force ?? false
      if (liveStateEnabled) {
        await ensureRuntimePrepared(workspaceId, "preview_snapshot")
      }
      const lastPreview = lastPreviewedSnapshotRef.current.get(workspaceId)
      if (!force && lastPreview === snapshot) {
        return
      }

      // FIX 8: Don't apply empty snapshot if runtime has notes
      // This protects against stale/transitional snapshots overwriting live state
      const snapshotOpenNotesCount = snapshot.openNotes?.length ?? 0
      if (snapshotOpenNotesCount === 0 && liveStateEnabled && hasWorkspaceRuntime(workspaceId)) {
        const runtimeOpenNotes = getRuntimeOpenNotes(workspaceId)
        if (runtimeOpenNotes && runtimeOpenNotes.length > 0) {
          emitDebugLog({
            component: "NoteWorkspace",
            action: "fix8_rejected_empty_snapshot",
            metadata: {
              workspaceId,
              runtimeNoteCount: runtimeOpenNotes.length,
              reason: "runtime_has_notes_would_lose_data",
            },
          })
          return // Don't apply - would lose notes
        }
      }

      snapshotOwnerWorkspaceIdRef.current = workspaceId
      const panelSnapshots = snapshot.panels ?? []
      const declaredNoteIds = new Set(
        snapshot.openNotes.map((entry) => entry.noteId).filter((noteId): noteId is string => Boolean(noteId)),
      )
      if (declaredNoteIds.size === 0) {
        panelSnapshots.forEach((panel) => {
          if (panel.noteId) {
            declaredNoteIds.add(panel.noteId)
          }
        })
      }
      // FIX 2: Prevent membership regression from partial snapshots in hot runtimes
      const runtimeState = liveStateEnabled && hasWorkspaceRuntime(workspaceId) ? "hot" : "cold"

      // FIX 9: Skip snapshot replay entirely for hot runtimes
      // Hot runtimes maintain their own state - the canvas was just hidden via CSS, not unmounted.
      // All panels, components, and notes are still there. Replaying the snapshot would:
      // 1. Set workspaceRestorationInProgress flag causing canvas to skip sync
      // 2. Potentially overwrite live state with stale snapshot data
      // 3. Cause the canvas to appear empty during the restoration window
      // For hot runtimes, we just need visibility toggle - no state changes needed.
      // IMPORTANT: Do NOT call bumpSnapshotRevision() here - it triggers the canvas's internal
      // restoration logic which sets workspaceRestorationInProgress=true and skips component rendering.
      if (runtimeState === "hot") {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "preview_snapshot_skip_hot_runtime",
          metadata: {
            workspaceId,
            reason: "Hot runtime maintains own state, skip snapshot replay",
            openNotesInSnapshot: snapshot.openNotes?.length ?? 0,
            panelsInSnapshot: snapshot.panels?.length ?? 0,
          },
        })
        lastPreviewedSnapshotRef.current.set(workspaceId, snapshot)
        // No bumpSnapshotRevision() - canvas already has its content, just becoming visible
        return
      }

      // Cold runtime: snapshot is authoritative (hot runtimes already returned via FIX 9)
      emitDebugLog({
        component: "NoteWorkspace",
        action: "preview_set_membership_branch",
        metadata: { workspaceId, branch: "cold_runtime", noteCount: declaredNoteIds.size },
      })
      setWorkspaceNoteMembership(workspaceId, declaredNoteIds)
      const scopedPanels = filterPanelsForWorkspace(workspaceId, panelSnapshots)
      const targetIds = new Set<string>(declaredNoteIds)
      scopedPanels.forEach((panel) => {
        if (panel.noteId) {
          targetIds.add(panel.noteId)
        }
      })
      const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, workspaceId)
      cache.panels = scopedPanels
      cache.components = Array.isArray(snapshot.components) ? [...snapshot.components] : []
      const normalizedOpenNotes = snapshot.openNotes.map((entry) => ({
        noteId: entry.noteId,
        mainPosition: entry.mainPosition ?? null,
      }))

      // Cold runtime: use snapshot openNotes directly (hot runtimes already returned via FIX 9)
      const openNotesToCommit = normalizedOpenNotes
      cache.openNotes = openNotesToCommit

      // FIX 5: Prevent commitWorkspaceOpenNotes from overwriting Fix 2's merged membership
      // The membership was already set correctly by Fix 2 above (lines 2080-2112)
      // We only want to update the open notes cache/runtime, not the membership
      commitWorkspaceOpenNotes(workspaceId, openNotesToCommit, { updateMembership: false, callSite: "replaySnapshot" })
      updatePanelSnapshotMap(scopedPanels, "preview_snapshot", { allowEmpty: true })
      const panelNoteIds = new Set(scopedPanels.map((panel) => panel.noteId).filter(Boolean) as string[])
      panelNoteIds.forEach((id) => targetIds.add(id))
      applyPanelSnapshots(scopedPanels, panelNoteIds, snapshot.components, {
        allowEmptyApply: true,
        suppressMutationEvents: true,
        reason: "preview_snapshot",
      })

      // Extend targetIds with openNotes for close loop reconciliation
      openNotesToCommit.forEach(n => targetIds.add(n.noteId))

      // Close loop for cold runtimes: close notes not in the target snapshot
      // (Hot runtimes skip this entirely via FIX 9 early return above)
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
          workspaceId,
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
          panelCount: scopedPanels.length,
          openCount: snapshot.openNotes.length,
          activeNoteId: nextActive,
        },
      })
      bumpSnapshotRevision()
    },
    [
      applyPanelSnapshots,
      bumpSnapshotRevision,
      closeWorkspaceNote,
      commitWorkspaceOpenNotes,
      ensureRuntimePrepared,
      emitDebugLog,
      filterPanelsForWorkspace,
      layerContext,
      liveStateEnabled,
      openWorkspaceNote,
      setWorkspaceNoteMembership,
      setActiveNoteId,
      setCanvasState,
    ],
  )



  useEffect(() => {
    if (!featureEnabled || !v2Enabled) {
      setActiveWorkspaceContext(null)
      return
    }
    currentWorkspaceIdRef.current = currentWorkspaceId
    setActiveWorkspaceContext(currentWorkspaceId ?? null)
    if (currentWorkspaceId) {
      emitDebugLog({
        component: "NoteWorkspace",
        action: "workspace_active_set",
        metadata: { workspaceId: currentWorkspaceId },
      })
    }
  }, [featureEnabled, v2Enabled, currentWorkspaceId])

  useEffect(() => {
    return () => {
      setActiveWorkspaceContext(null)
    }
  }, [])

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
    if (featureEnabled && v2Enabled) {
      return
    }
    if (ownedNotesRef.current.size === 0) {
      return
    }
    ownedNotesRef.current.forEach((_, noteId) => {
      clearNoteWorkspaceOwner(noteId)
    })
    ownedNotesRef.current.clear()
    workspaceNoteMembershipRef.current.clear()
  }, [featureEnabled, v2Enabled])

  useEffect(() => {
    if (!featureEnabled || !v2Enabled) return
    if (!currentWorkspaceId) return
    if (openNotesWorkspaceId !== currentWorkspaceId) return
    if (replayingWorkspaceRef.current > 0 || isHydratingRef.current) return

    // FIX 18: Guard against committing empty openNotes to a hot runtime during workspace switch.
    // When switching workspaces, the provider's openNotes is transiently empty while the runtime
    // still has notes from the previous session. Committing empty here would wipe the runtime's
    // note membership, causing useCanvasNoteSync to remove the main panel.
    // Only skip if: (1) openNotes is empty AND (2) runtime already has notes (hot runtime)
    if (openNotes.length === 0) {
      const runtimeMembership = getRuntimeMembership(currentWorkspaceId)
      if (runtimeMembership && runtimeMembership.size > 0) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "openNotesSync_skip_hot_runtime",
          metadata: {
            workspaceId: currentWorkspaceId,
            openNotesCount: 0,
            runtimeMembershipCount: runtimeMembership.size,
            runtimeNoteIds: Array.from(runtimeMembership),
            reason: "provider_openNotes_transiently_empty_but_runtime_has_notes",
          },
        })
        return
      }
    }

    // DEBUG: Log what we're about to commit and whether it matches expected workspace
    emitDebugLog({
      component: "NoteWorkspace",
      action: "openNotesSync_about_to_commit",
      metadata: {
        currentWorkspaceId,
        openNotesWorkspaceId,
        openNotesCount: openNotes.length,
        openNoteIds: openNotes.map(n => n.noteId),
        workspaceIdMatch: currentWorkspaceId === openNotesWorkspaceId,
      },
    })

    commitWorkspaceOpenNotes(currentWorkspaceId, openNotes, { updateCache: false, callSite: "useEffect_openNotesSync" })
  }, [
    commitWorkspaceOpenNotes,
    emitDebugLog,
    featureEnabled,
    v2Enabled,
    currentWorkspaceId,
    openNotes,
    openNotesWorkspaceId,
  ])

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
    const workspaceIdForComponents =
      currentWorkspaceId ?? snapshotOwnerWorkspaceIdRef.current ?? currentWorkspaceIdRef.current
    if (!workspaceIdForComponents) {
      return {
        schemaVersion: "1.1.0",
        openNotes: [],
        activeNoteId: null,
        camera: cameraTransform,
        panels: [],
        components: [],
      }
    }
    const workspaceMembership = getWorkspaceNoteMembership(workspaceIdForComponents)
    const storedOpenNotesForWorkspace = workspaceOpenNotesRef.current.get(workspaceIdForComponents) ?? []
    let hasKnownNotes = Boolean(
      (workspaceMembership && workspaceMembership.size > 0) || storedOpenNotesForWorkspace.length > 0,
    )
    let panelSnapshots =
      v2Enabled && currentWorkspaceId
        ? collectPanelSnapshotsFromDataStore()
        : getAllPanelSnapshots({ useFallback: false })
    const observedNoteIds = new Set(
      panelSnapshots
        .map((panel) => panel.noteId)
        .filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0),
    )
    const workspacePruned = pruneWorkspaceEntries(workspaceIdForComponents, observedNoteIds, "build_payload")
    if (v2Enabled && workspaceIdForComponents && observedNoteIds.size > 0) {
      setWorkspaceNoteMembership(workspaceIdForComponents, observedNoteIds)
    }
    if (workspacePruned) {
      const refreshedSlots = workspaceOpenNotesRef.current.get(workspaceIdForComponents) ?? []
      const refreshedMembership = getWorkspaceNoteMembership(workspaceIdForComponents)
      hasKnownNotes =
        refreshedSlots.length > 0 ||
        Boolean(refreshedMembership && refreshedMembership.size > 0)
    }
    const cachedPanelsForWorkspace =
      workspaceSnapshotsRef.current.get(workspaceIdForComponents)?.panels ??
      getLastNonEmptySnapshot(
        workspaceIdForComponents,
        lastNonEmptySnapshotsRef.current,
        workspaceSnapshotsRef.current,
      )
    if (panelSnapshots.length === 0 && hasKnownNotes && cachedPanelsForWorkspace.length > 0) {
      panelSnapshots = cachedPanelsForWorkspace
      emitDebugLog({
        component: "NoteWorkspace",
        action: "panel_snapshot_use_cached_for_payload",
        metadata: {
          workspaceId: workspaceIdForComponents,
          fallbackCount: cachedPanelsForWorkspace.length,
        },
      })
    }
    const shouldAllowEmptyPanels = !hasKnownNotes && panelSnapshots.length === 0
    updatePanelSnapshotMap(panelSnapshots, "build_payload", { allowEmpty: shouldAllowEmptyPanels })
    const lm = getWorkspaceLayerManager(workspaceIdForComponents)
    const components: NoteWorkspaceComponentSnapshot[] =
      lm && typeof lm.getNodes === "function"
        ? Array.from(lm.getNodes().values())
            .filter((node: any) => node.type === "component")
            .map((node: any) => ({
              id: node.id,
              type:
                (node as any).metadata?.componentType && typeof (node as any).metadata?.componentType === "string"
                  ? (node as any).metadata.componentType
                  : typeof node.type === "string"
                    ? node.type
                    : "component",
              position: (node as any).position ?? null,
              size: (node as any).dimensions ?? null,
              zIndex: typeof (node as any).zIndex === "number" ? (node as any).zIndex : null,
              metadata: (node as any).metadata ?? null,
            }))
        : []

    let workspaceOpenNotes = getWorkspaceOpenNotes(workspaceIdForComponents)
    if (workspaceOpenNotes.length === 0 && workspaceMembership && workspaceMembership.size > 0) {
      const inferredSlots = Array.from(workspaceMembership).map((noteId) => ({
        noteId,
        mainPosition: resolveMainPanelPosition(noteId),
      }))
      workspaceOpenNotes = commitWorkspaceOpenNotes(workspaceIdForComponents, inferredSlots, {
        updateCache: false,
        callSite: "buildPayload_inferred",
      })
    }
    const payload: NoteWorkspacePayload = {
      schemaVersion: "1.1.0",
      openNotes: workspaceOpenNotes.map((note) => {
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
      components,
    }
    if (v2Enabled && currentWorkspaceId) {
      cacheWorkspaceSnapshot({
        workspaceId: currentWorkspaceId,
        panels: panelSnapshots,
        components,
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
          componentCount: components?.length ?? 0,
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
    collectPanelSnapshotsFromDataStore,
    commitWorkspaceOpenNotes,
    getPanelSnapshot,
    getWorkspaceLayerManager,
    getWorkspaceNoteMembership,
    getWorkspaceOpenNotes,
    pruneWorkspaceEntries,
    setWorkspaceNoteMembership,
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
    if (!featureEnabled || !currentWorkspaceSummary || isHydratingRef.current || replayingWorkspaceRef.current > 0) {
      saveInFlightRef.current = false
      emitDebugLog({
        component: "NoteWorkspace",
        action: "save_skipped_workspace_busy",
        metadata: {
          workspaceId: currentWorkspaceSummary?.id,
          reason: replayingWorkspaceRef.current > 0 ? "replaying" : "hydrating",
        },
      })
      return
    }
    if (!adapterRef.current) return
    const saveStart = Date.now()
    const workspaceId = currentWorkspaceSummary.id
    const reason = lastSaveReasonRef.current
    const workspaceOpenNotes = getWorkspaceOpenNotes(workspaceId)
    emitDebugLog({
      component: "NoteWorkspace",
      action: "save_attempt",
      metadata: {
        workspaceId,
        reason,
        timestampMs: saveStart,
        openCount: workspaceOpenNotes.length,
      },
    })
    try {
      const ready = await waitForPanelSnapshotReadiness("persist_workspace", 800, workspaceId)
      if (!ready) {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "save_skip_pending_snapshot",
          metadata: {
            workspaceId,
            reason,
          },
        })
        saveInFlightRef.current = false
        return
      }
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
  }, [buildPayload, currentWorkspaceSummary, emitDebugLog, featureEnabled, getWorkspaceOpenNotes])

  useEffect(() => {
    if (!featureEnabled || !v2Enabled) return
    const unsubscribe = subscribeToWorkspaceSnapshotState((event) => {
      if (event.type === "panel_pending") {
        lastPendingTimestampRef.current.set(event.workspaceId, Date.now())
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
          !isHydratingRef.current &&
          replayingWorkspaceRef.current === 0
        ) {
          void (async () => {
            await captureCurrentWorkspaceSnapshot(undefined, { readinessReason: "panel_ready_capture" })
            lastSaveReasonRef.current = "panel_ready_auto_save"
            await persistWorkspaceNow()
          })()
        }
      } else if (event.type === "component_pending") {
        lastPendingTimestampRef.current.set(event.workspaceId, Date.now())
        emitDebugLog({
          component: "NoteWorkspace",
          action: "component_pending",
          metadata: {
            workspaceId: event.workspaceId,
            componentId: event.componentId,
            pendingCount: event.pendingCount,
            timestampMs: event.timestamp,
          },
        })
      } else if (event.type === "component_ready") {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "component_ready",
          metadata: {
            workspaceId: event.workspaceId,
            componentId: event.componentId,
            pendingCount: event.pendingCount,
            timestampMs: event.timestamp,
          },
        })
        if (
          event.workspaceId === currentWorkspaceId &&
          !isHydratingRef.current &&
          replayingWorkspaceRef.current === 0
        ) {
          void (async () => {
            await captureCurrentWorkspaceSnapshot(undefined, { readinessReason: "component_ready_capture" })
            lastSaveReasonRef.current = "component_ready_auto_save"
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
        const declaredNoteIds = new Set(
          record.payload.openNotes.map((entry) => entry.noteId).filter((noteId): noteId is string => Boolean(noteId)),
        )
        const incomingPanels = record.payload.panels ?? []
        if (declaredNoteIds.size === 0) {
          incomingPanels.forEach((panel) => {
            if (panel.noteId) {
              declaredNoteIds.add(panel.noteId)
            }
          })
        }
        setWorkspaceNoteMembership(workspaceId, declaredNoteIds)
        const scopedPanels = filterPanelsForWorkspace(workspaceId, incomingPanels)
        const targetIds = new Set<string>(declaredNoteIds)
        scopedPanels.forEach((panel) => {
          if (panel.noteId) {
            targetIds.add(panel.noteId)
          }
        })
        const incomingComponents = record.payload.components ?? []
        const resolvedComponents =
          incomingComponents && incomingComponents.length > 0
            ? incomingComponents
            : lastComponentsSnapshotRef.current.get(workspaceId) ?? incomingComponents
        updatePanelSnapshotMap(scopedPanels, "hydrate_workspace", { allowEmpty: true })
        const cache = ensureWorkspaceSnapshotCache(workspaceSnapshotsRef.current, workspaceId)
        cache.panels = scopedPanels
        cache.components = resolvedComponents ?? []
        const normalizedSnapshotOpenNotes = record.payload.openNotes.map((entry) => ({
          noteId: entry.noteId,
          mainPosition: entry.position ?? null,
        }))
        cache.openNotes = normalizedSnapshotOpenNotes
        commitWorkspaceOpenNotes(workspaceId, normalizedSnapshotOpenNotes, { callSite: "restoreWorkspace" })
        lastPanelSnapshotHashRef.current = serializePanelSnapshots(scopedPanels)
        if (resolvedComponents && resolvedComponents.length > 0) {
          lastComponentsSnapshotRef.current.set(workspaceId, resolvedComponents)
        }
        const panelNoteIds = new Set(scopedPanels.map((panel) => panel.noteId).filter(Boolean) as string[])
        panelNoteIds.forEach((id) => targetIds.add(id))
        applyPanelSnapshots(scopedPanels, panelNoteIds, resolvedComponents, {
          allowEmptyApply: true,
          suppressMutationEvents: true,
          reason: "hydrate_workspace",
        })
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
              workspaceId,
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

        // Phase 2: Mark runtime visible after initial hydration completes
        if (liveStateEnabled) {
          setRuntimeVisible(workspaceId, true)
          emitDebugLog({
            component: "NoteWorkspace",
            action: "workspace_runtime_visible",
            metadata: { workspaceId, wasCold: true, source: "hydrate_workspace" },
          })
        }
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
      commitWorkspaceOpenNotes,
      emitDebugLog,
      filterPanelsForWorkspace,
      layerContext,
      liveStateEnabled,
      openNotes,
      openWorkspaceNote,
      setActiveNoteId,
      setCanvasState,
      setWorkspaceNoteMembership,
      setIsLoading,
      setStatusHelperText,
      setWorkspaces,
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
    emitDebugLog({
      component: "NoteWorkspace",
      action: "hydrate_on_route_load",
      metadata: {
        workspaceId: currentWorkspaceId,
        lastHydratedWorkspaceId: lastHydratedWorkspaceIdRef.current,
      },
    })
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
      } else if (event.type === "component_pending") {
        lastPendingTimestampRef.current.set(event.workspaceId, Date.now())
        emitDebugLog({
          component: "NoteWorkspace",
          action: "component_pending",
          metadata: {
            workspaceId: event.workspaceId,
            componentId: event.componentId,
            pendingCount: event.pendingCount,
            timestampMs: event.timestamp,
          },
        })
      } else if (event.type === "component_ready") {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "component_ready",
          metadata: {
            workspaceId: event.workspaceId,
            componentId: event.componentId,
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
          !isHydratingRef.current &&
          replayingWorkspaceRef.current === 0
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
    if (isHydratingRef.current || replayingWorkspaceRef.current > 0) return
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

  // Trigger save when component set changes (so default workspace captures non-note components)
  useEffect(() => {
    if (!featureEnabled) return
    if (isHydratingRef.current || replayingWorkspaceRef.current > 0) return
    scheduleSave({ reason: "components_changed" })
  }, [scheduleSave, featureEnabled, panelSnapshotVersion])

  const handleCreateWorkspace = useCallback(async () => {
    if (!featureEnabled || !adapterRef.current) return
    flushPendingSave("workspace_create")
    try {
      const workspace = await adapterRef.current.createWorkspace({
        payload: {
          schemaVersion: "1.1.0",
          openNotes: [],
          activeNoteId: null,
          camera: DEFAULT_CAMERA,
          panels: [],
          components: [],
        },
      })
      await ensureRuntimePrepared(workspace.id, "create_workspace")
      setWorkspaces((prev) => [...prev, workspace])
      setCurrentWorkspaceId(workspace.id)
      setWorkspaceNoteMembership(workspace.id, [])
      commitWorkspaceOpenNotes(workspace.id, [], { updateCache: false, callSite: "createWorkspace" })
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
  }, [
    commitWorkspaceOpenNotes,
    emitDebugLog,
    ensureRuntimePrepared,
    featureEnabled,
    flushPendingSave,
    setWorkspaceNoteMembership,
  ])

  const handleDeleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!adapterRef.current) return
      try {
        await adapterRef.current.deleteWorkspace(workspaceId)
        setWorkspaces((prev) => prev.filter((workspace) => workspace.id !== workspaceId))
        workspaceNoteMembershipRef.current.delete(workspaceId)
        workspaceOpenNotesRef.current.delete(workspaceId)
        Array.from(ownedNotesRef.current.entries()).forEach(([noteId, ownerWorkspaceId]) => {
          if (ownerWorkspaceId === workspaceId) {
            clearNoteWorkspaceOwner(noteId)
            ownedNotesRef.current.delete(noteId)
          }
        })
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
      if (workspaceId === currentWorkspaceId && pendingWorkspaceId === null) return
      const previousWorkspaceId = currentWorkspaceIdRef.current ?? currentWorkspaceId ?? null
      setPendingWorkspaceId(workspaceId)
      setActiveWorkspaceContext(workspaceId)

      // Phase 2: Check if target workspace has a hot runtime
      const targetRuntimeState = hasWorkspaceRuntime(workspaceId) ? "hot" : "cold"

      emitDebugLog({
        component: "NoteWorkspace",
        action: "select_workspace_requested",
        metadata: { workspaceId, previousWorkspaceId, targetRuntimeState },
      })

      // Phase 2: HOT SWITCH - Just toggle visibility, skip snapshot capture/replay
      if (liveStateEnabled && targetRuntimeState === "hot") {
        emitDebugLog({
          component: "NoteWorkspace",
          action: "workspace_switch_hot",
          metadata: {
            workspaceId,
            previousWorkspaceId,
            hotRuntimeCount: listHotRuntimes().length,
          },
        })

        // Hide previous runtime
        if (previousWorkspaceId) {
          setRuntimeVisible(previousWorkspaceId, false)
          emitDebugLog({
            component: "NoteWorkspace",
            action: "workspace_runtime_hidden",
            metadata: { workspaceId: previousWorkspaceId },
          })
        }

        // Show target runtime
        setRuntimeVisible(workspaceId, true)
        emitDebugLog({
          component: "NoteWorkspace",
          action: "workspace_runtime_visible",
          metadata: { workspaceId, wasCold: false },
        })

        // Update state without async snapshot work
        snapshotOwnerWorkspaceIdRef.current = workspaceId
        setCurrentWorkspaceId(workspaceId)
        setPendingWorkspaceId(null)

        emitDebugLog({
          component: "NoteWorkspace",
          action: "select_workspace_hot_complete",
          metadata: { workspaceId },
        })

        return
      }

      // COLD SWITCH - Original behavior with snapshot capture/replay
      const run = async () => {
        try {
          await ensureRuntimePrepared(workspaceId, "select_workspace")
          await captureCurrentWorkspaceSnapshot(undefined, {
            readinessReason: "workspace_switch_capture",
            readinessMaxWaitMs: 1500,
          })
          lastSaveReasonRef.current = "workspace_switch"
          await persistWorkspaceNow()

          // Phase 2: Hide previous runtime after capture
          if (liveStateEnabled && previousWorkspaceId) {
            setRuntimeVisible(previousWorkspaceId, false)
            emitDebugLog({
              component: "NoteWorkspace",
              action: "workspace_runtime_hidden",
              metadata: { workspaceId: previousWorkspaceId },
            })
          }

          snapshotOwnerWorkspaceIdRef.current = workspaceId
          setActiveWorkspaceContext(workspaceId)
          setWorkspaceNoteMembership(workspaceId, [])
          const cachedSnapshot = getWorkspaceSnapshot(workspaceId)
          const cachedRevision = workspaceRevisionRef.current.get(workspaceId) ?? null
          const cachedPanels = workspaceSnapshotsRef.current.get(workspaceId)?.panels ?? null

          const applyCachedSnapshot = async () => {
            if (v2Enabled && cachedSnapshot) {
              const seedNoteIds =
                cachedSnapshot?.openNotes?.map((entry) => entry.noteId).filter((id): id is string => Boolean(id)) ?? []
              setWorkspaceNoteMembership(workspaceId, seedNoteIds)
              await previewWorkspaceFromSnapshot(workspaceId, cachedSnapshot, { force: true })
            } else if (!v2Enabled && cachedPanels && cachedPanels.length > 0) {
              const scopedPanels = filterPanelsForWorkspace(workspaceId, cachedPanels)
              setTimeout(() => {
                snapshotOwnerWorkspaceIdRef.current = workspaceId
                applyPanelSnapshots(
                  scopedPanels,
                  new Set(scopedPanels.map((panel) => panel.noteId)),
                  undefined,
                  {
                    allowEmptyApply: scopedPanels.length === 0,
                    clearWorkspace: true,
                    clearComponents: true,
                    suppressMutationEvents: true,
                    reason: "legacy_workspace_switch",
                  },
                )
              }, 0)
            }
          }

          await applyCachedSnapshot()
          setCurrentWorkspaceId(workspaceId)
          setPendingWorkspaceId(null)
          snapshotOwnerWorkspaceIdRef.current = workspaceId
          setActiveWorkspaceContext(workspaceId)
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
                components: record?.payload?.components ?? [],
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
                await previewWorkspaceFromSnapshot(workspaceId, adapterSnapshot as any, { force: true })
              } else {
                // Replay cached snapshot even if revisions match to keep the store populated
                await previewWorkspaceFromSnapshot(workspaceId, cachedSnapshot, { force: true })
              }
            } catch (adapterError) {
              emitDebugLog({
                component: "NoteWorkspace",
                action: "adapter_load_error",
                metadata: {
                  workspaceId,
                  error: adapterError instanceof Error ? adapterError.message : String(adapterError),
                },
              })
            }
          }

          // Phase 2: Show new runtime after cold load complete
          if (liveStateEnabled) {
            setRuntimeVisible(workspaceId, true)
            emitDebugLog({
              component: "NoteWorkspace",
              action: "workspace_runtime_visible",
              metadata: { workspaceId, wasCold: true },
            })
          }
        } catch (error) {
          setPendingWorkspaceId(null)
          setActiveWorkspaceContext(previousWorkspaceId)
          emitDebugLog({
            component: "NoteWorkspace",
            action: "select_workspace_error",
            metadata: {
              workspaceId,
              error: error instanceof Error ? error.message : String(error),
            },
          })
        }
      }
      void run()
    },
    [
      applyPanelSnapshots,
      filterPanelsForWorkspace,
      captureCurrentWorkspaceSnapshot,
      currentWorkspaceId,
      ensureRuntimePrepared,
      liveStateEnabled,
      pendingWorkspaceId,
      persistWorkspaceNow,
      previewWorkspaceFromSnapshot,
      emitDebugLog,
      v2Enabled,
      adapterRef,
      workspaceRevisionRef,
      setWorkspaceNoteMembership,
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
    if (!liveStateEnabled) return
    if (currentWorkspaceId) {
      void ensureRuntimePrepared(currentWorkspaceId, "current_workspace")
    }
  }, [currentWorkspaceId, ensureRuntimePrepared, liveStateEnabled])

  useEffect(() => {
    if (!liveStateEnabled) return
    if (pendingWorkspaceId) {
      void ensureRuntimePrepared(pendingWorkspaceId, "pending_workspace")
    }
  }, [ensureRuntimePrepared, liveStateEnabled, pendingWorkspaceId])

  useEffect(() => {
    if (!liveStateEnabled) return
    const prevVisible = previousVisibleWorkspaceRef.current
    if (prevVisible && prevVisible !== currentWorkspaceId) {
      emitDebugLog({
        component: "NoteWorkspaceRuntime",
        action: "workspace_runtime_hidden",
        metadata: {
          workspaceId: prevVisible,
          runtimeCount: listWorkspaceRuntimeIds().length,
        },
      })
    }
    if (currentWorkspaceId) {
      const wasCold = !runtimeAccessRef.current.has(currentWorkspaceId)
      emitDebugLog({
        component: "NoteWorkspaceRuntime",
        action: "workspace_runtime_visible",
        metadata: {
          workspaceId: currentWorkspaceId,
          wasCold,
          runtimeCount: listWorkspaceRuntimeIds().length,
        },
      })
      updateRuntimeAccess(currentWorkspaceId)
    }
    previousVisibleWorkspaceRef.current = currentWorkspaceId ?? null
  }, [currentWorkspaceId, emitDebugLog, liveStateEnabled, updateRuntimeAccess])

  useEffect(() => {
    if (!featureEnabled || !activeNoteId) return
    const snapshots = panelSnapshotsRef.current.get(activeNoteId)
    if (!snapshots || snapshots.length === 0) return
    const workspaceIdForNote =
      ownedNotesRef.current.get(activeNoteId) ??
      snapshotOwnerWorkspaceIdRef.current ??
      currentWorkspaceId ??
      currentWorkspaceIdRef.current ??
      null
    const dataStore = getWorkspaceDataStore(workspaceIdForNote)
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
    rehydratePanelsForNote(activeNoteId, workspaceIdForNote ?? undefined)
  }, [
    activeNoteId,
    currentWorkspaceId,
    featureEnabled,
    getWorkspaceDataStore,
    rehydratePanelsForNote,
    emitDebugLog,
  ])

  return {
    featureEnabled,
    isUnavailable,
    workspaces,
    isLoading,
    statusHelperText,
    currentWorkspaceId,
    targetWorkspaceId,
    snapshotRevision,
    selectWorkspace: handleSelectWorkspace,
    createWorkspace: handleCreateWorkspace,
    deleteWorkspace: handleDeleteWorkspace,
    renameWorkspace: handleRenameWorkspace,
    scheduleImmediateSave: flushPendingSave,
  }
}
