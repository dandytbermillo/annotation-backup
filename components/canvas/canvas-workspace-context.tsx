"use client"

import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { DataStore } from "@/lib/data-store"
import { EventEmitter } from "@/lib/event-emitter"
import { LayerManager } from "@/lib/canvas/layer-manager"
import { debugLog } from "@/lib/utils/debug-logger"

export interface NoteWorkspace {
  dataStore: DataStore
  events: EventEmitter
  layerManager: LayerManager
  loadedNotes: Set<string>  // Track which notes have been initialized to prevent re-init on mount/unmount
}

export const SHARED_WORKSPACE_ID = "__workspace__"

export interface WorkspacePosition {
  x: number
  y: number
}

export interface OpenWorkspaceNote {
  noteId: string
  mainPosition: WorkspacePosition | null
  updatedAt: string | null
}

export interface OpenNoteOptions {
  mainPosition?: WorkspacePosition | null
  persist?: boolean
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
}

const CanvasWorkspaceContext = createContext<CanvasWorkspaceContextValue | null>(null)

// Feature flag for new ordered toolbar behavior (TDD §5.4 line 227)
const FEATURE_ENABLED = typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY === 'enabled'

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
  const pendingBatchRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Shared 300ms batch timer (TDD §5.1)
  const PENDING_STORAGE_KEY = 'canvas_workspace_pending'
  const POSITION_CACHE_KEY = 'canvas_workspace_position_cache'
  const BATCH_DEBOUNCE_MS = 300 // TDD §5.1 line 216

  const syncPendingToStorage = useCallback(() => {
    if (typeof window === 'undefined') return

    const entries = Array.from(pendingPersistsRef.current.entries())
    if (entries.length === 0) {
      window.localStorage.removeItem(PENDING_STORAGE_KEY)
      return
    }

    try {
      window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(entries))
    } catch (error) {
      console.warn('[CanvasWorkspace] Failed to persist pending map to storage', error)
    }
  }, [])

  const syncPositionCacheToStorage = useCallback(() => {
    if (typeof window === 'undefined') return

    const entries = Array.from(positionCacheRef.current.entries())
    if (entries.length === 0) {
      window.localStorage.removeItem(POSITION_CACHE_KEY)
      return
    }

    try {
      window.localStorage.setItem(POSITION_CACHE_KEY, JSON.stringify(entries))
    } catch (error) {
      console.warn('[CanvasWorkspace] Failed to persist position cache to storage', error)
    }
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

  const persistWorkspace = useCallback(
    async (updates: Array<{ noteId: string; isOpen: boolean; mainPosition?: WorkspacePosition | null }>) => {
      if (updates.length === 0) {
        return
      }

      updates.forEach(update => {
        if (update.isOpen && update.mainPosition) {
          pendingPersistsRef.current.set(update.noteId, update.mainPosition)
        } else {
          pendingPersistsRef.current.delete(update.noteId)
        }
      })
      syncPendingToStorage()

      try {
        await debugLog({
          component: 'CanvasWorkspace',
          action: 'persist_attempt',
          metadata: { updates: updates.map(u => ({ noteId: u.noteId, isOpen: u.isOpen })) },
        })

        if (FEATURE_ENABLED) {
          // New path: Use POST /update with optimistic locking retry (TDD §5.1)
          // Map to server's expected schema
          const updatePayload = {
            updates: updates.map(update => {
              // Close operation
              if (!update.isOpen) {
                return {
                  noteId: update.noteId,
                  isOpen: false,
                }
              }

              // Position update
              if (update.mainPosition) {
                return {
                  noteId: update.noteId,
                  mainPositionX: update.mainPosition.x,
                  mainPositionY: update.mainPosition.y,
                }
              }

              // Fallback (shouldn't happen, but handle gracefully)
              return {
                noteId: update.noteId,
              }
            }),
          }

          let retries = 0
          const maxRetries = 3

          while (retries <= maxRetries) {
            const response = await fetch("/api/canvas/workspace/update", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              keepalive: true,
              body: JSON.stringify(updatePayload),
            })

            if (response.ok) {
              // Success - clear pending
              updates.forEach(update => {
                if (update.isOpen && update.mainPosition) {
                  pendingPersistsRef.current.delete(update.noteId)
                }
              })
              syncPendingToStorage()

              await debugLog({
                component: 'CanvasWorkspace',
                action: 'workspace_snapshot_persisted',
                metadata: {
                  noteIds: updates.map(u => u.noteId),
                  retryCount: retries,
                },
              })

              setWorkspaceError(null)
              return
            }

            // Handle 409 Conflict (optimistic lock failure) - TDD §5.2
            if (response.status === 409 && retries < maxRetries) {
              retries++
              await debugLog({
                component: 'CanvasWorkspace',
                action: 'persist_retry_conflict',
                metadata: {
                  retryCount: retries,
                  maxRetries,
                },
              })
              // Wait 50ms before retry
              await new Promise(resolve => setTimeout(resolve, 50))
              continue
            }

            // All other errors or max retries exceeded
            const messageRaw = await response.text()
            const trimmedMessage = messageRaw.trim()
            const statusMessage = `${response.status} ${response.statusText}`.trim()
            const combinedMessage = trimmedMessage || statusMessage || "Failed to persist workspace update"

            await debugLog({
              component: 'CanvasWorkspace',
              action: 'persist_failed',
              metadata: {
                status: response.status,
                statusText: response.statusText,
                payload: updatePayload,
                retries,
                message: combinedMessage,
              },
            })

            const err = new Error(combinedMessage)
            ;(err as any).status = response.status
            throw err
          }
        } else {
          // Legacy path: Use PATCH endpoint with original schema
          const patchPayload = {
            notes: updates.map(update => ({
              noteId: update.noteId,
              isOpen: update.isOpen,
              mainPosition: update.mainPosition ?? undefined,
            })),
          }

          const response = await fetch("/api/canvas/workspace", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            body: JSON.stringify(patchPayload),
          })

          if (!response.ok) {
            const messageRaw = await response.text()
            const trimmedMessage = messageRaw.trim()
            const statusMessage = `${response.status} ${response.statusText}`.trim()
            const combinedMessage = trimmedMessage || statusMessage || "Failed to persist workspace update"

            await debugLog({
              component: 'CanvasWorkspace',
              action: 'persist_failed',
              metadata: {
                status: response.status,
                statusText: response.statusText,
                payload: patchPayload,
                message: combinedMessage,
              },
            })

            const err = new Error(combinedMessage)
            ;(err as any).status = response.status
            throw err
          }

          updates.forEach(update => {
            if (update.isOpen && update.mainPosition) {
              pendingPersistsRef.current.delete(update.noteId)
            }
          })
          syncPendingToStorage()

          await debugLog({
            component: 'CanvasWorkspace',
            action: 'persist_succeeded',
            metadata: {
              noteIds: updates.map(u => u.noteId),
            },
          })

          setWorkspaceError(null)
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        const status = (err as any).status

        if (status === 404 || status === 409) {
          await debugLog({
            component: 'CanvasWorkspace',
            action: 'persist_retry_scheduled',
            metadata: {
              status,
              updates: updates.map(u => ({ noteId: u.noteId, isOpen: u.isOpen })),
              pending: Array.from(pendingPersistsRef.current.entries()),
              message: err.message,
            },
          })
        } else {
          await debugLog({
            component: 'CanvasWorkspace',
            action: 'persist_error',
            metadata: {
              status,
              updates: updates.map(u => ({ noteId: u.noteId, isOpen: u.isOpen })),
              pending: Array.from(pendingPersistsRef.current.entries()),
              message: err.message,
            },
          })
          setWorkspaceError(err)
        }

        throw err
      }
    },
    [syncPendingToStorage],
  )

  const refreshWorkspace = useCallback(async () => {
    const hydrationStartTime = Date.now()
    setIsWorkspaceLoading(true)
    setIsHydrating(true)

    try {
      const response = await fetch("/api/canvas/workspace", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || "Failed to load canvas workspace")
      }

      const result = await response.json()
      const notes = Array.isArray(result?.openNotes) ? result.openNotes : []

      if (FEATURE_ENABLED) {
        // New path: Ordered toolbar with full snapshot replay (TDD §3)
        const panels = Array.isArray(result?.panels) ? result.panels : []

        const normalized: OpenWorkspaceNote[] = notes.map((note: any) => {
          const rawPosition = note?.mainPosition
          const rawX = Number(rawPosition?.x)
          const rawY = Number(rawPosition?.y)
          const hasValidPosition = Number.isFinite(rawX) && Number.isFinite(rawY)

          return {
            noteId: String(note.noteId),
            mainPosition: hasValidPosition ? { x: rawX, y: rawY } : null,
            updatedAt: note?.updatedAt ? String(note.updatedAt) : null,
          }
        })

        // Pre-populate dataStore for all panels (TDD §4.1 line 177)
        const workspace = getWorkspace(SHARED_WORKSPACE_ID)

        // Load branches for all open notes
        const uniqueNoteIds = [...new Set(panels.map((p: any) => p.noteId))]
        const branchesByNote = new Map<string, any[]>()

        console.log('[Workspace] Loading branches for notes:', uniqueNoteIds)
        console.log('[Workspace] All panels:', panels.map((p: any) => ({
          noteId: p.noteId,
          panelId: p.panelId,
          type: p.type
        })))

        for (const noteId of uniqueNoteIds) {
          try {
            const url = `/api/postgres-offline/branches?noteId=${noteId}`
            console.log(`[Workspace] Fetching branches from: ${url}`)
            const response = await fetch(url)
            console.log(`[Workspace] Response status:`, response.status, response.statusText)

            if (response.ok) {
              const data = await response.json()
              console.log(`[Workspace] Response data for ${noteId}:`, data)
              console.log(`[Workspace] Data is array?`, Array.isArray(data))
              console.log(`[Workspace] Data type:`, typeof data)
              console.log(`[Workspace] Data.branches:`, data.branches)

              // API returns array directly, not wrapped in object
              const branches = Array.isArray(data) ? data : (data.branches || [])
              console.log(`[Workspace] Extracted branches:`, branches)
              branchesByNote.set(noteId, branches)
              console.log(`[Workspace] Loaded ${branches.length} branches for note ${noteId}:`, branches)
            } else {
              console.warn(`[Workspace] Failed to load branches for ${noteId}: ${response.status} ${response.statusText}`)
            }
          } catch (error) {
            console.warn(`[Workspace] Failed to load branches for note ${noteId}:`, error)
          }
        }

        console.log('[Workspace] All branches loaded:', branchesByNote)

        // First, store all branch objects in dataStore with their composite keys
        branchesByNote.forEach((branches, noteId) => {
          branches.forEach((branchObj: any) => {
            const branchKey = `${noteId}::${branchObj.id}`
            workspace.dataStore.set(branchKey, {
              id: branchObj.id,
              type: branchObj.type || 'note',
              title: branchObj.title || '',
              originalText: branchObj.originalText || '',
              metadata: branchObj.metadata || {},
              anchors: branchObj.anchors,
              parentId: branchObj.parentId,
              branches: [],  // Branch panels don't have children
            })
          })
        })

        // Seed panels from snapshot (prevents (2000,1500) default jump)
        panels.forEach((panel: any) => {
          const panelKey = `${panel.noteId}::${panel.panelId}`
          const existing = workspace.dataStore.get(panelKey)

          // Skip if already exists (idempotent - TDD §4.1 line 197)
          if (existing) {
            return
          }

          // Get branches for this note
          const noteBranches = branchesByNote.get(panel.noteId) || []

          console.log(`[Workspace] Looking up branches for panel ${panelKey}:`, {
            panelNoteId: panel.noteId,
            hasBranchesInMap: branchesByNote.has(panel.noteId),
            branchesMapKeys: Array.from(branchesByNote.keys()),
            noteBranches: noteBranches,
            noteBranchesCount: noteBranches.length
          })

          // Extract branch IDs for this specific panel based on parent_id
          // Main panel gets branches where parentId = "main"
          // Branch panels get branches where parentId = "branch-{branchId}"
          const expectedParentId = panel.panelId === 'main'
            ? 'main'
            : (panel.panelId.startsWith('branch-') ? panel.panelId : `branch-${panel.panelId}`)

          const branchIds = noteBranches
            .filter((b: any) => b.parentId === expectedParentId)
            .map((b: any) => b.id)

          console.log(`[Workspace] Setting dataStore for ${panelKey}:`, {
            panelId: panel.panelId,
            type: panel.type,
            expectedParentId,
            branchCount: branchIds.length,
            branchIds,
            allBranchesForNote: noteBranches.map((b: any) => ({ id: b.id, parentId: b.parentId }))
          })

          workspace.dataStore.set(panelKey, {
            id: panel.panelId,
            type: panel.type,
            title: panel.title || '',
            position: { x: panel.positionXWorld, y: panel.positionYWorld },
            dimensions: { width: panel.widthWorld, height: panel.heightWorld },
            zIndex: panel.zIndex,
            metadata: panel.metadata || {},
            worldPosition: { x: panel.positionXWorld, y: panel.positionYWorld },
            worldSize: { width: panel.widthWorld, height: panel.heightWorld },
            branches: branchIds,  // Array of branch ID strings
          })

          // Mark as loaded
          workspace.loadedNotes.add(panel.noteId)
        })

        ensureWorkspaceForOpenNotes(normalized)
        setOpenNotes(normalized)

        // Emit telemetry (TDD §8)
        const hydrationDuration = Date.now() - hydrationStartTime
        const componentBreakdown: Record<string, number> = {}

        panels.forEach((panel: any) => {
          const type = panel.type === 'main' || panel.type === 'branch' ? 'note' : panel.type
          componentBreakdown[type] = (componentBreakdown[type] || 0) + 1
        })

        try {
          await debugLog({
            component: 'CanvasWorkspace',
            action: 'workspace_toolbar_state_rehydrated',
            metadata: {
              workspaceId: SHARED_WORKSPACE_ID,
              focusedNoteId: notes.find((n: any) => n.isFocused)?.noteId || null,
              tabOrder: notes.map((n: any) => n.noteId),
              panelCount: panels.length,
              componentBreakdown,
              snapshotTimestamp: new Date().toISOString(),
              hydrationDurationMs: hydrationDuration
            }
          })
        } catch (logError) {
          console.warn('[CanvasWorkspace] Failed to emit hydration telemetry:', logError)
        }
      } else {
        // Legacy path: Unordered loading (TDD §5.4 line 228)
        const normalized: OpenWorkspaceNote[] = notes.map((note: any) => {
          const rawPosition = note?.mainPosition
          const rawX = Number(rawPosition?.x)
          const rawY = Number(rawPosition?.y)
          const hasValidPosition = Number.isFinite(rawX) && Number.isFinite(rawY)

          return {
            noteId: String(note.noteId),
            mainPosition: hasValidPosition ? { x: rawX, y: rawY } : null,
            updatedAt: note?.updatedAt ? String(note.updatedAt) : null,
          }
        })

        const merged: OpenWorkspaceNote[] = [...normalized]

        // First, apply position cache (all known positions)
        positionCacheRef.current.forEach((position, noteId) => {
          if (!position) return
          const existingIndex = merged.findIndex(note => note.noteId === noteId)
          if (existingIndex >= 0) {
            merged[existingIndex] = {
              ...merged[existingIndex],
              mainPosition: position,
            }
          }
        })

        // Then, override with pending persists (unsaved changes take priority)
        pendingPersistsRef.current.forEach((position, noteId) => {
          if (!position) return
          const existingIndex = merged.findIndex(note => note.noteId === noteId)
          if (existingIndex >= 0) {
            merged[existingIndex] = {
              ...merged[existingIndex],
              mainPosition: position,
            }
          } else {
            console.log(`[DEBUG refreshWorkspace] Adding note ${noteId} from pending only:`, position)
            merged.push({
              noteId,
              mainPosition: position,
              updatedAt: null,
            })
          }
        })

        ensureWorkspaceForOpenNotes(merged)
        setOpenNotes(merged)
      }

      setWorkspaceError(null)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      setWorkspaceError(err)
      throw err
    } finally {
      setIsWorkspaceLoading(false)
      setIsWorkspaceReady(true)
      setIsHydrating(false)
    }
  }, [ensureWorkspaceForOpenNotes, getWorkspace])

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
          await persistWorkspace(batch)
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
    [persistWorkspace, syncPendingToStorage],
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

  const openNote = useCallback(
    async (noteId: string, options?: OpenNoteOptions) => {
      const { mainPosition = null, persist = true } = options ?? {}
      const pendingPosition = pendingPersistsRef.current.get(noteId) ?? null
      const cachedPosition = positionCacheRef.current.get(noteId) ?? null
      const normalizedPosition = mainPosition ?? pendingPosition ?? cachedPosition ?? { x: 2000, y: 1500 }

      console.log(`[DEBUG openNote] Position resolution for ${noteId}:`, {
        mainPosition,
        pendingPosition,
        cachedPosition,
        normalizedPosition,
      })
      if (!noteId) {
        return
      }

      let alreadyOpen = false

      setOpenNotes(prev => {
        const exists = prev.some(note => note.noteId === noteId)
        alreadyOpen = exists
        if (exists) {
          return prev.map(note =>
            note.noteId === noteId
              ? {
                  ...note,
                  mainPosition: mainPosition ?? note.mainPosition ?? normalizedPosition,
                }
              : note,
          )
        }
        const next: OpenWorkspaceNote = {
          noteId,
          mainPosition: normalizedPosition,
          updatedAt: null,
        }

        return [...prev, next]
      })

      ensureWorkspaceForOpenNotes([{ noteId, mainPosition: normalizedPosition, updatedAt: null }])

      const shouldPersist = persist && (!alreadyOpen || mainPosition)

      if (shouldPersist) {
        const positionToPersist = mainPosition ?? normalizedPosition
        try {
          await persistWorkspace([{ noteId, isOpen: true, mainPosition: positionToPersist }])
          clearScheduledPersist(noteId)
          // Don't call refreshWorkspace - position is already in local state
          // This prevents unnecessary "Syncing..." UI flashing and potential loops
        } catch (error) {
          console.warn('[CanvasWorkspace] Immediate workspace persist failed, scheduling retry', {
            noteId,
            error: error instanceof Error ? error.message : String(error),
          })
          pendingPersistsRef.current.set(noteId, positionToPersist)
          scheduleWorkspacePersist(noteId, positionToPersist)
        }
      }
    },
    [ensureWorkspaceForOpenNotes, persistWorkspace, scheduleWorkspacePersist, clearScheduledPersist],
  )

  const closeNote = useCallback(
    async (noteId: string, options?: CloseNoteOptions) => {
      if (!noteId) {
        return
      }

      const { persist = true, removeWorkspace: remove = true } = options ?? {}

      setOpenNotes(prev => prev.filter(note => note.noteId !== noteId))

      if (remove) {
        workspacesRef.current.delete(noteId)
      }

      if (persist) {
        await persistWorkspace([{ noteId, isOpen: false }])
        // Don't call refreshWorkspace - note is already removed from local state
      }
    },
    [persistWorkspace],
  )

  const updateMainPosition = useCallback(
    async (noteId: string, position: WorkspacePosition, persist = true) => {
      await debugLog({
        component: 'CanvasWorkspace',
        action: 'update_main_position_called',
        metadata: { noteId, position, persist },
      })

      // ALWAYS cache the position immediately to localStorage
      positionCacheRef.current.set(noteId, position)
      syncPositionCacheToStorage()

      setOpenNotes(prev =>
        prev.map(note =>
          note.noteId === noteId
            ? {
                ...note,
                mainPosition: position,
              }
            : note,
        ),
      )

      if (persist) {
        try {
          await persistWorkspace([{ noteId, isOpen: true, mainPosition: position }])
          clearScheduledPersist(noteId)
          await debugLog({
            component: 'CanvasWorkspace',
            action: 'update_main_position_persist_succeeded',
            metadata: { noteId },
          })
          // SUCCESS: Don't refresh workspace - position is already in local state
          // Refreshing causes unnecessary loading states and potential loops
        } catch (error) {
          await debugLog({
            component: 'CanvasWorkspace',
            action: 'update_main_position_persist_failed',
            metadata: {
              noteId,
              error: error instanceof Error ? error.message : String(error),
            },
          })
          scheduleWorkspacePersist(noteId, position)
        }
      }
    },
    [persistWorkspace, scheduleWorkspacePersist, clearScheduledPersist, syncPositionCacheToStorage],
  )

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

  useEffect(() => {
    const persistActiveNotes = () => {
      if (pendingPersistsRef.current.size === 0) {
        return
      }

      if (FEATURE_ENABLED) {
        // New path: Use sendBeacon with flush endpoint (TDD §5.1 line 216)
        const updates = Array.from(pendingPersistsRef.current.entries()).map(([noteId, position]) => ({
          noteId,
          mainPositionX: position.x,
          mainPositionY: position.y,
        }))

        if (updates.length === 0) return

        const body = JSON.stringify(updates)

        // Check sendBeacon payload size (64KB limit, use 60KB for safety)
        if (body.length > 60 * 1024) {
          console.warn('[CanvasWorkspace] Beacon payload exceeds size limit, truncating to first update')
          // Truncate to just the first update to stay within limit
          const truncatedBody = JSON.stringify([updates[0]])
          const blob = new Blob([truncatedBody], { type: 'application/json' })
          try {
            navigator.sendBeacon('/api/canvas/workspace/flush', blob)
          } catch (error) {
            console.warn('[CanvasWorkspace] sendBeacon failed:', error)
          }
          return
        }

        try {
          // sendBeacon for emergency flush (TDD §5.7)
          // Use Blob with correct Content-Type to ensure proper parsing
          const blob = new Blob([body], { type: 'application/json' })
          navigator.sendBeacon('/api/canvas/workspace/flush', blob)
        } catch (error) {
          // Silent - nothing we can do during unload
          console.warn('[CanvasWorkspace] sendBeacon failed:', error)
        }
      } else {
        // Legacy path: Use keepalive fetch
        const payload = Array.from(pendingPersistsRef.current.entries()).map(([noteId, position]) => ({
          noteId,
          isOpen: true,
          mainPosition: position,
        }))

        if (payload.length === 0) return

        const body = JSON.stringify({ notes: payload })

        try {
          void fetch('/api/canvas/workspace', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
          })
        } catch (error) {
          // Silent - nothing we can do during unload
        }
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistActiveNotes()
      }
    }

    window.addEventListener('beforeunload', persistActiveNotes)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      // Clear shared batch timer (TDD §5.1)
      if (pendingBatchRef.current !== null) {
        clearTimeout(pendingBatchRef.current)
        pendingBatchRef.current = null
      }
      scheduledPersistRef.current.forEach(timeout => clearTimeout(timeout))
      scheduledPersistRef.current.clear()
      window.removeEventListener('beforeunload', persistActiveNotes)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [openNotes])

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
