"use client"

import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { DataStore } from "@/lib/data-store"
import { EventEmitter } from "@/lib/event-emitter"
import { LayerManager } from "@/lib/canvas/layer-manager"
import {
  syncMapToStorage,
  persistWorkspaceVersions as persistVersionsToStorage,
  applyWorkspaceVersionUpdates,
} from "@/lib/workspace/workspace-storage"
import {
  persistWorkspaceUpdates,
  type WorkspacePersistUpdate,
} from "@/lib/workspace/persist-workspace"
import {
  SHARED_WORKSPACE_ID,
  type NoteWorkspace,
  type OpenWorkspaceNote,
  type WorkspacePosition,
} from "@/lib/workspace/types"
import { useWorkspaceHydrationLoader } from "@/lib/hooks/annotation/use-workspace-hydration-loader"
import { useWorkspaceNoteManager } from "@/lib/hooks/annotation/use-workspace-note-manager"
import { useWorkspaceMainPositionUpdater } from "@/lib/hooks/annotation/use-workspace-main-position-updater"
import { useWorkspaceUnloadPersistence } from "@/lib/hooks/annotation/use-workspace-unload-persistence"
import { useWorkspaceVersionTracker } from "@/lib/hooks/annotation/use-workspace-version-tracker"
import { isNoteWorkspaceEnabled, isNoteWorkspaceV2Enabled } from "@/lib/flags/note"

export { SHARED_WORKSPACE_ID }
export type { NoteWorkspace, OpenWorkspaceNote, WorkspacePosition }

export interface OpenNoteOptions {
  mainPosition?: WorkspacePosition | null
  persist?: boolean
  persistPosition?: boolean
}

export interface CloseNoteOptions {
  persist?: boolean
  removeWorkspace?: boolean
}

interface CanvasWorkspaceContextValue {
  /** Ensure a workspace exists for the given note and return it */
  getWorkspace(noteId: string): NoteWorkspace
  /** Whether a workspace already exists for the note */
  hasWorkspace(noteId: string): boolean
  /** Remove a workspace and clean up listeners */
  removeWorkspace(noteId: string): void
  /** List note IDs currently tracked */
  listWorkspaces(): string[]
  /** Notes currently marked open in workspace persistence */
  openNotes: OpenWorkspaceNote[]
  /** Whether the initial workspace load has completed */
  isWorkspaceReady: boolean
  /** Whether workspace operations are in-flight */
  isWorkspaceLoading: boolean
  /** Whether workspace is currently hydrating (blocks highlight events) - TDD §4.1 */
  isHydrating: boolean
  /** Last workspace error, if any */
  workspaceError: Error | null
  /** Refresh workspace notes from backend */
  refreshWorkspace(): Promise<void>
  /** Mark a note as open (optionally persisting to backend) */
  openNote(noteId: string, options?: OpenNoteOptions): Promise<void>
  /** Mark a note as closed (optionally persisting to backend) */
  closeNote(noteId: string, options?: CloseNoteOptions): Promise<void>
  /** Update the stored main position for an open note */
  updateMainPosition(noteId: string, position: WorkspacePosition, persist?: boolean): Promise<void>
  /** Retrieve an unsaved workspace position if one exists */
  getPendingPosition(noteId: string): WorkspacePosition | null
  /** Retrieve a cached workspace position if one exists */
  getCachedPosition(noteId: string): WorkspacePosition | null
  /** Retrieve the current workspace version for a note, if known */
  getWorkspaceVersion(noteId: string): number | null
  /** Update cached workspace version (used by external persistence flows) */
  updateWorkspaceVersion(noteId: string, version: number): void
}

const CanvasWorkspaceContext = createContext<CanvasWorkspaceContextValue | null>(null)

// Feature flag for new ordered toolbar behavior (TDD §5.4 line 227)
const FEATURE_ENABLED = typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY === 'enabled'
const NOTE_WORKSPACES_ENABLED = isNoteWorkspaceEnabled()
const NOTE_WORKSPACES_V2_ENABLED = isNoteWorkspaceV2Enabled()

type WorkspaceVersionUpdate = { noteId: string; version: number }


export function CanvasWorkspaceProvider({ children }: { children: ReactNode }) {
  const workspacesRef = useRef<Map<string, NoteWorkspace>>(new Map())
  const sharedWorkspaceRef = useRef<NoteWorkspace | null>(null)
  const [openNotes, setOpenNotes] = useState<OpenWorkspaceNote[]>([])
  const [isWorkspaceReady, setIsWorkspaceReady] = useState(false)
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false)
  const [isHydrating, setIsHydrating] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<Error | null>(null)
  const scheduledPersistRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const pendingPersistsRef = useRef<Map<string, WorkspacePosition>>(new Map())
  const positionCacheRef = useRef<Map<string, WorkspacePosition>>(new Map())
  const workspaceVersionsRef = useRef<Map<string, number>>(new Map())
  const pendingBatchRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Shared 300ms batch timer (TDD §5.1)
  const PENDING_STORAGE_KEY = 'canvas_workspace_pending'
  const POSITION_CACHE_KEY = 'canvas_workspace_position_cache'
  const WORKSPACE_VERSION_CACHE_KEY = 'canvas_workspace_versions'
  const BATCH_DEBOUNCE_MS = 300 // TDD §5.1 line 216

  const syncPendingToStorage = useCallback(() => {
    syncMapToStorage(PENDING_STORAGE_KEY, pendingPersistsRef)
  }, [])

  const syncPositionCacheToStorage = useCallback(() => {
    syncMapToStorage(POSITION_CACHE_KEY, positionCacheRef)
  }, [])

  const persistWorkspaceVersions = useCallback(() => {
    persistVersionsToStorage(WORKSPACE_VERSION_CACHE_KEY, workspaceVersionsRef)
  }, [])

  const applyVersionUpdates = useCallback(
    (updates: WorkspaceVersionUpdate[]) => {
      applyWorkspaceVersionUpdates(updates, workspaceVersionsRef, setOpenNotes)
      persistWorkspaceVersions()
    },
    [setOpenNotes, persistWorkspaceVersions],
  )

  const extractVersionUpdates = useCallback((payload: any): WorkspaceVersionUpdate[] => {
    if (!payload) {
      return []
    }

    const raw = Array.isArray(payload?.versions) ? payload.versions : []
    const cleaned: WorkspaceVersionUpdate[] = []

    raw.forEach((entry: any) => {
      if (!entry || typeof entry !== 'object') return
      const noteId = typeof entry.noteId === 'string' ? entry.noteId : null
      const versionValue = 'version' in entry ? (entry as any).version : undefined
      const parsedVersion = Number(versionValue)
      if (!noteId || !Number.isFinite(parsedVersion)) return
      cleaned.push({ noteId, version: parsedVersion })
    })

    return cleaned
  }, [])

  const getWorkspace = useCallback((noteId: string): NoteWorkspace => {
    if (noteId === SHARED_WORKSPACE_ID) {
      if (!sharedWorkspaceRef.current) {
        sharedWorkspaceRef.current = {
          dataStore: new DataStore(),
          events: new EventEmitter(),
          layerManager: new LayerManager(),
          loadedNotes: new Set<string>(),
        }
      }
      return sharedWorkspaceRef.current
    }

    let workspace = workspacesRef.current.get(noteId)
    if (!workspace) {
      workspace = {
        dataStore: new DataStore(),
        events: new EventEmitter(),
        layerManager: new LayerManager(),
        loadedNotes: new Set<string>(),
      }
      workspacesRef.current.set(noteId, workspace)
    }
    return workspace
  }, [])

  const hasWorkspace = useCallback((noteId: string) => workspacesRef.current.has(noteId), [])

  const removeWorkspace = useCallback((noteId: string) => {
    workspacesRef.current.delete(noteId)
  }, [])

  const listWorkspaces = useCallback(() => Array.from(workspacesRef.current.keys()), [])

  const ensureWorkspaceForOpenNotes = useCallback(
    (notes: OpenWorkspaceNote[]) => {
      notes.forEach(note => {
        if (!workspacesRef.current.has(note.noteId)) {
          getWorkspace(note.noteId)
        }
      })
    },
    [getWorkspace],
  )

  const invalidateLocalSnapshot = useCallback((noteId: string) => {
    if (!noteId) return

    positionCacheRef.current.delete(noteId)
    pendingPersistsRef.current.delete(noteId)
    const pendingTimer = scheduledPersistRef.current.get(noteId)
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer)
      scheduledPersistRef.current.delete(noteId)
    }
    syncPendingToStorage()
    syncPositionCacheToStorage()

    if (typeof window === 'undefined') return

    try {
      window.localStorage.removeItem(`annotation-canvas-state:${noteId}`)
    } catch (error) {
      console.warn('[CanvasWorkspace] Failed to remove canvas snapshot cache', error)
    }

    try {
      window.localStorage.removeItem(`note-data-${noteId}`)
      window.localStorage.removeItem(`note-data-${noteId}:invalidated`)
    } catch (error) {
      console.warn('[CanvasWorkspace] Failed to clear plain-mode note cache', error)
    }
  }, [syncPendingToStorage, syncPositionCacheToStorage])

  const persistWorkspace = useCallback(
    async (updates: Array<{ noteId: string; isOpen: boolean; mainPosition?: WorkspacePosition | null }>) => {
      if (NOTE_WORKSPACES_V2_ENABLED) {
        return []
      }
      return persistWorkspaceUpdates(updates as WorkspacePersistUpdate[], {
        featureEnabled: FEATURE_ENABLED,
        skipServer: NOTE_WORKSPACES_ENABLED,
        pendingPersistsRef,
        syncPendingToStorage,
        extractVersionUpdates,
        applyVersionUpdates,
        setWorkspaceError,
      })
    },
    [syncPendingToStorage, extractVersionUpdates, applyVersionUpdates, setWorkspaceError],
  )

  const refreshWorkspace = useWorkspaceHydrationLoader({
    featureEnabled: FEATURE_ENABLED && !NOTE_WORKSPACES_V2_ENABLED,
    skipHydration: NOTE_WORKSPACES_V2_ENABLED,
    sharedWorkspaceId: SHARED_WORKSPACE_ID,
    getWorkspace,
    ensureWorkspaceForOpenNotes,
    setOpenNotes: notes => setOpenNotes(notes),
    workspaceVersionsRef,
    pendingPersistsRef,
    positionCacheRef,
    persistWorkspaceVersions,
    setWorkspaceError: error => setWorkspaceError(error),
    setIsWorkspaceLoading: value => setIsWorkspaceLoading(value),
    setIsHydrating: value => setIsHydrating(value),
    setIsWorkspaceReady: value => setIsWorkspaceReady(value),
  })

  const clearScheduledPersist = useCallback((noteId: string) => {
    const existing = scheduledPersistRef.current.get(noteId)
    if (existing !== undefined) {
      clearTimeout(existing)
      scheduledPersistRef.current.delete(noteId)
    }
  }, [])

  const scheduleWorkspacePersist = useCallback(
    (noteId: string, position: WorkspacePosition) => {
      // Add to pending batch queue
      pendingPersistsRef.current.set(noteId, position)
      syncPendingToStorage()

      // Clear existing batch timer
      if (pendingBatchRef.current !== null) {
        clearTimeout(pendingBatchRef.current)
      }

      // Start new shared 300ms batch timer (TDD §5.1 line 216)
      pendingBatchRef.current = setTimeout(async () => {
        const batch = Array.from(pendingPersistsRef.current.entries()).map(([id, pos]) => ({
          noteId: id,
          isOpen: true,
          mainPosition: pos,
        }))

        if (batch.length === 0) {
          pendingBatchRef.current = null
          return
        }

        try {
          const versionUpdates = await persistWorkspace(batch)
          applyVersionUpdates(versionUpdates)
          // Don't call refreshWorkspace here - it causes infinite loops
          // The position is already in local state, no need to reload from DB
        } catch (error) {
          console.warn('[CanvasWorkspace] Batched workspace persist failed', {
            batchSize: batch.length,
            error: error instanceof Error ? error.message : String(error),
          })
        } finally {
          pendingBatchRef.current = null
        }
      }, BATCH_DEBOUNCE_MS)
    },
    [persistWorkspace, syncPendingToStorage, applyVersionUpdates],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Restore position cache
    try {
      const cachedPositions = window.localStorage.getItem(POSITION_CACHE_KEY)
      if (cachedPositions) {
        const entries = JSON.parse(cachedPositions) as Array<[string, WorkspacePosition]>
        entries.forEach(([noteId, position]) => {
          if (!noteId || !position) return
          const { x, y } = position
          if (!Number.isFinite(x) || !Number.isFinite(y)) return
          positionCacheRef.current.set(noteId, position)
        })
      }
    } catch (error) {
      console.warn('[CanvasWorkspace] Failed to restore position cache', error)
    }

    if (NOTE_WORKSPACES_V2_ENABLED) {
      return
    }

    // Restore pending persists
    try {
      const stored = window.localStorage.getItem(PENDING_STORAGE_KEY)
      if (!stored) return

      const entries = JSON.parse(stored) as Array<[string, WorkspacePosition]>
      entries.forEach(([noteId, position]) => {
        if (!noteId || !position) return
        const { x, y } = position
        if (!Number.isFinite(x) || !Number.isFinite(y)) return

        pendingPersistsRef.current.set(noteId, position)
        scheduleWorkspacePersist(noteId, position)
      })
      syncPendingToStorage()
    } catch (error) {
      console.warn('[CanvasWorkspace] Failed to restore pending persistence state', error)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { openNote, closeNote } = useWorkspaceNoteManager({
    setOpenNotes,
    ensureWorkspaceForOpenNotes,
    workspaceVersionsRef,
    positionCacheRef,
    pendingPersistsRef,
    persistWorkspace,
    scheduleWorkspacePersist,
    clearScheduledPersist,
    applyVersionUpdates,
    syncPositionCacheToStorage,
    workspacesRef,
    invalidateLocalSnapshot,
  })

  const { updateMainPosition } = useWorkspaceMainPositionUpdater({
    setOpenNotes,
    positionCacheRef,
    syncPositionCacheToStorage,
    persistWorkspace,
    applyVersionUpdates,
    clearScheduledPersist,
    scheduleWorkspacePersist,
  })

  const { getWorkspaceVersion, updateWorkspaceVersion } = useWorkspaceVersionTracker({
    workspaceVersionsRef,
    applyVersionUpdates,
  })

  const getPendingPosition = useCallback((noteId: string): WorkspacePosition | null => {
    const position = pendingPersistsRef.current.get(noteId)
    if (!position) return null
    return { ...position }
  }, [])

  const getCachedPosition = useCallback((noteId: string): WorkspacePosition | null => {
    const position = positionCacheRef.current.get(noteId)
    if (!position) return null
    return { ...position }
  }, [])

  useWorkspaceUnloadPersistence({
    pendingPersistsRef,
    pendingBatchRef,
    scheduledPersistRef,
    featureEnabled: FEATURE_ENABLED,
    openNotes,
    isActive: !NOTE_WORKSPACES_V2_ENABLED,
  })

  useEffect(() => {
    // Initial load happens once; callers can refresh as needed later.
    if (!isWorkspaceReady) {
      refreshWorkspace().catch(error => {
        console.error("[CanvasWorkspaceProvider] Failed to load workspace:", error)
      })
    }
  }, [isWorkspaceReady, refreshWorkspace])

  const value = useMemo<CanvasWorkspaceContextValue>(
    () => ({
      getWorkspace,
      hasWorkspace,
      removeWorkspace,
      listWorkspaces,
      openNotes,
      isWorkspaceReady,
      isWorkspaceLoading,
      isHydrating,
      workspaceError,
      refreshWorkspace,
      openNote,
      closeNote,
      updateMainPosition,
      getPendingPosition,
      getCachedPosition,
      getWorkspaceVersion,
      updateWorkspaceVersion,
    }),
    [
      getWorkspace,
      hasWorkspace,
      removeWorkspace,
      listWorkspaces,
      openNotes,
      isWorkspaceReady,
      isWorkspaceLoading,
      isHydrating,
      workspaceError,
      refreshWorkspace,
      openNote,
      closeNote,
      updateMainPosition,
      getPendingPosition,
      getCachedPosition,
      getWorkspaceVersion,
      updateWorkspaceVersion,
    ],
  )

  return <CanvasWorkspaceContext.Provider value={value}>{children}</CanvasWorkspaceContext.Provider>
}

export function useCanvasWorkspace(): CanvasWorkspaceContextValue {
  const context = useContext(CanvasWorkspaceContext)
  if (!context) {
    throw new Error("useCanvasWorkspace must be used within a CanvasWorkspaceProvider")
  }
  return context
}
