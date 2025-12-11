/**
 * Pure utility functions for workspace management.
 * These functions have NO dependencies on React state or hooks.
 *
 * Extracted from use-note-workspaces.ts for maintainability.
 * @see docs/proposal/refactor/use-note-workspaces/REFACTORING_PLAN.md
 */

import type {
  NoteWorkspacePayload,
  NoteWorkspacePanelSnapshot,
  NoteWorkspaceComponentSnapshot,
} from "@/lib/types/note-workspace"
import type { NoteWorkspaceSlot } from "@/lib/workspace/types"

// ============================================================================
// Constants
// ============================================================================

/** Default camera position for new workspaces */
export const DEFAULT_CAMERA = { x: 0, y: 0, scale: 1 }

/** Enable workspace debug logging; can be toggled at runtime if needed */
export const NOTE_WORKSPACE_DEBUG_ENABLED = true

/** Maximum number of hot runtimes on desktop */
export const DESKTOP_RUNTIME_CAP = 4

/** Maximum number of hot runtimes on touch devices */
export const TOUCH_RUNTIME_CAP = 2

/** Delay before deferred snapshot capture (ms) */
export const CAPTURE_DEFER_DELAY_MS = 48

// ============================================================================
// Types
// ============================================================================

/** Cache structure for workspace snapshots */
export type WorkspaceSnapshotCache = {
  panels: NoteWorkspacePanelSnapshot[]
  components: NoteWorkspaceComponentSnapshot[]
  openNotes: NoteWorkspaceSlot[]
}

// ============================================================================
// Runtime Detection
// ============================================================================

/**
 * Detect runtime capacity based on device type.
 * Touch devices get fewer hot runtimes to conserve memory.
 */
export const detectRuntimeCapacity = (): number => {
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

// ============================================================================
// Normalization Utilities
// ============================================================================

/**
 * Normalize a point value to { x, y } or null.
 * Used for consistent position handling.
 */
export const normalizePoint = (value: any): { x: number; y: number } | null => {
  if (!value || typeof value !== "object") return null
  const { x, y } = value as { x?: number; y?: number }
  if (typeof x !== "number" || typeof y !== "number") {
    return null
  }
  return { x, y }
}

/**
 * Normalize a size value to { width, height } or null.
 * Used for consistent dimension handling.
 */
export const normalizeSize = (value: any): { width: number; height: number } | null => {
  if (!value || typeof value !== "object") return null
  const { width, height } = value as { width?: number; height?: number }
  if (typeof width !== "number" || typeof height !== "number") {
    return null
  }
  return { width, height }
}

/**
 * Round a number to 4 decimal places for consistent hashing.
 * Returns 0 for non-finite values.
 */
export const roundNumber = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0
  }
  return Number(value.toFixed(4))
}

// ============================================================================
// Serialization Utilities (for change detection)
// ============================================================================

/**
 * Serialize a workspace payload to a deterministic string for change detection.
 * Normalizes and sorts all values to ensure consistent hashing.
 */
export const serializeWorkspacePayload = (payload: NoteWorkspacePayload): string => {
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

/**
 * Serialize panel snapshots to a deterministic string for change detection.
 */
export const serializePanelSnapshots = (panels: NoteWorkspacePanelSnapshot[]): string => {
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

// ============================================================================
// Cache Utilities
// ============================================================================

/**
 * Ensure a workspace snapshot cache exists, creating an empty one if needed.
 */
export const ensureWorkspaceSnapshotCache = (
  cacheMap: Map<string, WorkspaceSnapshotCache>,
  workspaceId: string,
): WorkspaceSnapshotCache => {
  if (!cacheMap.has(workspaceId)) {
    cacheMap.set(workspaceId, { panels: [], components: [], openNotes: [] })
  }
  return cacheMap.get(workspaceId)!
}

/**
 * Get the last non-empty snapshot for a workspace.
 * Falls back through multiple cache sources.
 */
export const getLastNonEmptySnapshot = (
  workspaceId: string,
  lastNonEmpty: Map<string, NoteWorkspacePanelSnapshot[]>,
  cached: Map<string, WorkspaceSnapshotCache>,
): NoteWorkspacePanelSnapshot[] => {
  const fromLast = lastNonEmpty.get(workspaceId)
  if (fromLast && fromLast.length > 0) return fromLast
  const fromCached = cached.get(workspaceId)?.panels ?? []
  return fromCached && fromCached.length > 0 ? fromCached : []
}

// ============================================================================
// Module-level State (non-React)
// ============================================================================

/** Track which notes have existing open snapshots */
export const existingOpenSnapshot = new Map<string, boolean>()

/** Current timestamp utility */
export const now = (): number => Date.now()

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Format a timestamp for the "synced at" label display.
 * Returns empty string for invalid dates.
 */
export const formatSyncedLabel = (timestamp: string | Date): string => {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  return `Note workspace synced at ${new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date)}`
}

// ============================================================================
// Workspace Slot Utilities
// ============================================================================

/**
 * Normalize workspace slot entries to consistent format.
 * Deduplicates by noteId and normalizes position fields.
 */
export const normalizeWorkspaceSlots = (
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

/**
 * Check if two workspace slot arrays are equal.
 * Compares noteId and mainPosition for each slot.
 */
export const areWorkspaceSlotsEqual = (
  a: NoteWorkspaceSlot[] | null | undefined,
  b: NoteWorkspaceSlot[] | null | undefined,
): boolean => {
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

// ============================================================================
// Panel Snapshot Utilities
// ============================================================================

/**
 * Build a panel snapshot from a raw record.
 * Pure function that normalizes record data into a typed snapshot.
 *
 * @param noteId - Note ID for the panel
 * @param panelId - Panel ID (defaults to "main")
 * @param record - Raw record from DataStore
 * @returns Panel snapshot or null if record is invalid
 */
export const buildPanelSnapshotFromRecord = (
  noteId: string,
  panelId: string,
  record: unknown,
): NoteWorkspacePanelSnapshot | null => {
  if (!record || typeof record !== "object") return null

  const rec = record as Record<string, unknown>
  const position = normalizePoint(rec.position) ?? normalizePoint(rec.worldPosition)
  const size = normalizeSize(rec.dimensions) ?? normalizeSize(rec.worldSize)
  const branches = Array.isArray(rec.branches)
    ? rec.branches.map((entry: unknown) => String(entry))
    : null

  // Skip if no meaningful data
  if (!position && !size && !branches && typeof rec.zIndex !== "number" && !rec.type) {
    return null
  }

  return {
    noteId,
    panelId,
    type: typeof rec.type === "string" ? rec.type : null,
    title: typeof rec.title === "string" ? rec.title : null,
    position,
    size,
    zIndex: typeof rec.zIndex === "number" ? rec.zIndex : null,
    metadata: rec.metadata && typeof rec.metadata === "object" ? (rec.metadata as Record<string, unknown>) : null,
    parentId: typeof rec.parentId === "string" ? rec.parentId : null,
    branches,
    worldPosition: normalizePoint(rec.worldPosition),
    worldSize: normalizeSize(rec.worldSize),
  }
}

/**
 * Create a unique key for a panel snapshot.
 * Used for deduplication and merging panel snapshots.
 *
 * @param panel - Panel snapshot to create key for
 * @returns Unique key string "noteId:panelId"
 */
export const panelSnapshotToKey = (panel: NoteWorkspacePanelSnapshot): string =>
  `${panel.noteId ?? "unknown"}:${panel.panelId ?? "unknown"}`

/**
 * Merge two arrays of panel snapshots, deduplicating by key.
 * Later entries (from `primary`) override earlier entries (from `fallback`).
 *
 * @param fallback - Fallback panels (used if not in primary)
 * @param primary - Primary panels (override fallback)
 * @returns Merged array of panel snapshots
 */
export const mergePanelSnapshots = (
  fallback: NoteWorkspacePanelSnapshot[],
  primary: NoteWorkspacePanelSnapshot[],
): NoteWorkspacePanelSnapshot[] => {
  if (fallback.length === 0) return primary
  if (primary.length === 0) return fallback

  const mergeMap = new Map<string, NoteWorkspacePanelSnapshot>()

  for (const panel of fallback) {
    if (!panel.noteId || !panel.panelId) continue
    mergeMap.set(panelSnapshotToKey(panel), panel)
  }

  for (const panel of primary) {
    if (!panel.noteId || !panel.panelId) continue
    mergeMap.set(panelSnapshotToKey(panel), panel)
  }

  return Array.from(mergeMap.values())
}

// ============================================================================
// Component Snapshot Utilities
// ============================================================================

/**
 * Merge component snapshots with fallback enrichment.
 * Enriches components that have generic "component" type with type/metadata from fallbacks.
 *
 * @param source - Primary source of components (may have incomplete type info)
 * @param cachedComponents - Cached components for fallback
 * @param lastComponents - Last known components for fallback
 * @returns Merged array with enriched type information
 */
export const mergeComponentSnapshots = (
  source: NoteWorkspaceComponentSnapshot[],
  cachedComponents: NoteWorkspaceComponentSnapshot[],
  lastComponents: NoteWorkspaceComponentSnapshot[],
): NoteWorkspaceComponentSnapshot[] => {
  if (!source || source.length === 0) return []

  const byId = new Map<string, NoteWorkspaceComponentSnapshot>()
  cachedComponents.forEach((c) => byId.set(c.id, c))
  lastComponents.forEach((c) => byId.set(c.id, c))

  return source.map((c) => {
    if (c.type && c.type !== "component") return c
    const fallback = byId.get(c.id)
    if (fallback && fallback.type && fallback.type !== "component") {
      return { ...c, type: fallback.type, metadata: c.metadata ?? fallback.metadata ?? null }
    }
    return c
  })
}
