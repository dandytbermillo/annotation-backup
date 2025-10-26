"use client"

import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { DataStore } from "@/lib/data-store"
import { EventEmitter } from "@/lib/event-emitter"
import { LayerManager } from "@/lib/canvas/layer-manager"
import { debugLog } from "@/lib/utils/debug-logger"
import { DEFAULT_PANEL_DIMENSIONS } from "@/lib/canvas/panel-metrics"

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
  version: number
}

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

type WorkspaceVersionUpdate = { noteId: string; version: number }

const computeViewportCenteredPosition = (): WorkspacePosition => {
  const { width, height } = DEFAULT_PANEL_DIMENSIONS
  if (typeof window === 'undefined') {
    return { x: 0, y: 0 }
  }
  return {
    x: Math.round(window.innerWidth / 2 - width / 2),
    y: Math.round(window.innerHeight / 2 - height / 2),
  }
}

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

  const persistWorkspaceVersions = useCallback(() => {
    if (typeof window === 'undefined') return

    const entries = Array.from(workspaceVersionsRef.current.entries())
    try {
      if (entries.length === 0) {
        window.localStorage.removeItem(WORKSPACE_VERSION_CACHE_KEY)
      } else {
        window.localStorage.setItem(WORKSPACE_VERSION_CACHE_KEY, JSON.stringify(entries))
      }
    } catch (error) {
      console.warn('[CanvasWorkspace] Failed to persist workspace versions to storage', error)
    }
  }, [])

  const applyVersionUpdates = useCallback((updates: WorkspaceVersionUpdate[]) => {
    if (!Array.isArray(updates) || updates.length === 0) {
      return
    }

    let mutated = false

    updates.forEach(update => {
      if (!update || typeof update.noteId !== 'string') {
        return
      }
      const parsedVersion = Number(update.version)
      if (!Number.isFinite(parsedVersion)) {
        return
      }

      const prevVersion = workspaceVersionsRef.current.get(update.noteId)
      if (prevVersion === parsedVersion) {
        return
      }

      workspaceVersionsRef.current.set(update.noteId, parsedVersion)
      mutated = true
    })

    if (!mutated) {
      return
    }

    setOpenNotes(prev =>
      prev.map(note => {
        const updatedVersion = workspaceVersionsRef.current.get(note.noteId)
        if (updatedVersion === undefined || updatedVersion === note.version) {
          return note
        }
        return { ...note, version: updatedVersion }
      }),
    )
    persistWorkspaceVersions()
  }, [persistWorkspaceVersions])

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
      if (updates.length === 0) {
        return []
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

            const rawBody = await response.text()

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

              let parsedPayload: any = null
              try {
                parsedPayload = rawBody ? JSON.parse(rawBody) : null
              } catch (parseError) {
                console.warn('[CanvasWorkspace] Failed to parse workspace/update payload', parseError)
              }

              if (parsedPayload) {
                const versionUpdates = extractVersionUpdates(parsedPayload)
                applyVersionUpdates(versionUpdates)
              }

              setWorkspaceError(null)
              return parsedPayload ? extractVersionUpdates(parsedPayload) : []
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
            const trimmedMessage = rawBody.trim()
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

          const rawBody = await response.text()

          if (!response.ok) {
            const trimmedMessage = rawBody.trim()
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

          let parsedPayload: any = null
          try {
            parsedPayload = rawBody ? JSON.parse(rawBody) : null
          } catch (parseError) {
            console.warn('[CanvasWorkspace] Failed to parse workspace PATCH payload', parseError)
          }

          if (parsedPayload) {
            const versionUpdates = extractVersionUpdates(parsedPayload)
            applyVersionUpdates(versionUpdates)
            setWorkspaceError(null)
            return versionUpdates
          }

          setWorkspaceError(null)
          return []
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

      return []
    },
    [syncPendingToStorage, extractVersionUpdates, applyVersionUpdates],
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
          const versionValue = Number(note?.version ?? 0)
          const version = Number.isFinite(versionValue) ? versionValue : 0

          return {
            noteId: String(note.noteId),
            mainPosition: hasValidPosition ? { x: rawX, y: rawY } : null,
            updatedAt: note?.updatedAt ? String(note.updatedAt) : null,
            version,
          }
        })

        workspaceVersionsRef.current.clear()
        normalized.forEach(entry => {
          workspaceVersionsRef.current.set(entry.noteId, entry.version)
        })
        persistWorkspaceVersions()

        // Pre-populate dataStore for all panels (TDD §4.1 line 177)
        const workspace = getWorkspace(SHARED_WORKSPACE_ID)

        // Load branches for all open notes
        const uniqueNoteIds = [...new Set(panels.map((p: any) => String(p.noteId)))] as string[]
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

        // Helper to normalize branch ID from database format to UI format
        const normalizeBranchId = (rawId: string | null | undefined): string => {
          if (!rawId) return ''
          if (rawId === 'main') return 'main'
          if (rawId.startsWith('branch-')) return rawId
          return `branch-${rawId}`
        }

        // Helper to normalize parent ID from database format to UI format
        const normalizeParentId = (rawId: string | null | undefined): string => {
          if (!rawId || rawId === 'main') return 'main'
          if (rawId.startsWith('branch-')) return rawId
          return `branch-${rawId}`
        }

        // Helper to normalize panel IDs returned from the workspace API
        const normalizePanelId = (rawId: string, panelType?: string): string => {
          if (!rawId) return rawId
          if (rawId === 'main') return 'main'
          if (rawId.startsWith('branch-')) return rawId
          if (panelType && ['branch', 'context', 'annotation'].includes(panelType)) {
            return `branch-${rawId}`
          }
          return rawId
        }

        // First, store all branch objects in dataStore with their composite keys
        branchesByNote.forEach((branches, noteId) => {
          branches.forEach((branchObj: any) => {
            // Transform DB UUID to UI format: database stores raw UUID, UI expects "branch-{uuid}"
            const branchPanelId = normalizeBranchId(branchObj.id)
            const branchKey = `${noteId}::${branchPanelId}`

            // CRITICAL: Normalize parentId to match UI format
            // Database stores raw UUID or "main", but UI expects "branch-{uuid}" or "main"
            const normalizedParent = normalizeParentId(branchObj.parentId)

            workspace.dataStore.set(branchKey, {
              id: branchPanelId,  // Use UI format to match panel expectations
              type: branchObj.type || 'note',
              title: branchObj.title || '',
              originalText: branchObj.originalText || '',
              metadata: branchObj.metadata || {},
              anchors: branchObj.anchors,
              parentId: normalizedParent,  // Use normalized parentId with "branch-" prefix
              branches: [],  // Branch panels don't have children
            })
          })
        })

        // Seed panels from snapshot (prevents (2000,1500) default jump)
        panels.forEach((panel: any) => {
          const normalizedPanelId = normalizePanelId(panel.panelId, panel.type)
          const normalizedParentId = normalizeParentId(panel.parentId)

          const legacyPanelKey = `${panel.noteId}::${panel.panelId}`
          const panelKey = `${panel.noteId}::${normalizedPanelId}`

          let existing = workspace.dataStore.get(panelKey)
          if (!existing && legacyPanelKey !== panelKey) {
            const legacyEntry = workspace.dataStore.get(legacyPanelKey)
            if (legacyEntry) {
              workspace.dataStore.delete(legacyPanelKey)
              existing = legacyEntry
            }
          }

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
          const expectedParentId = normalizedPanelId === 'main'
            ? 'main'
            : normalizedPanelId

          const branchIds = noteBranches
            .filter((b: any) => normalizeParentId(b.parentId) === expectedParentId)
            .map((b: any) => normalizeBranchId(b.id))  // Future-proof: handles both raw UUIDs and pre-prefixed IDs

          console.log(`[Workspace] Setting dataStore for ${panelKey}:`, {
            panelId: normalizedPanelId,
            type: panel.type,
            expectedParentId,
            branchCount: branchIds.length,
            branchIds,
            allBranchesForNote: noteBranches.map((b: any) => ({ id: b.id, parentId: b.parentId }))
          })

          workspace.dataStore.set(panelKey, {
            id: normalizedPanelId,
            type: panel.type,
            title: panel.title || '',
            position: { x: panel.positionXWorld, y: panel.positionYWorld },
            dimensions: { width: panel.widthWorld, height: panel.heightWorld },
            zIndex: panel.zIndex,
            metadata: {
              ...(panel.metadata || {}),
              ...(normalizedPanelId !== 'main' && normalizedParentId
                ? { parentId: normalizedParentId, parentPanelId: normalizedParentId }
                : {})
            },
            parentId: normalizedPanelId === 'main' ? null : normalizedParentId,
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
          const versionValue = Number(note?.version ?? 0)
          const version = Number.isFinite(versionValue) ? versionValue : 0

          return {
            noteId: String(note.noteId),
            mainPosition: hasValidPosition ? { x: rawX, y: rawY } : null,
            updatedAt: note?.updatedAt ? String(note.updatedAt) : null,
            version,
          }
        })

        workspaceVersionsRef.current.clear()
        normalized.forEach(entry => {
          workspaceVersionsRef.current.set(entry.noteId, entry.version)
        })
        persistWorkspaceVersions()

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
              version: workspaceVersionsRef.current.get(noteId) ?? 0,
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
  }, [ensureWorkspaceForOpenNotes, getWorkspace, persistWorkspaceVersions])

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
      const { mainPosition = null, persist = true, persistPosition = true } = options ?? {}
      const pendingPosition = pendingPersistsRef.current.get(noteId) ?? null
      const cachedPosition = positionCacheRef.current.get(noteId) ?? null

      // Calculate smart default position: place new notes on the right side of existing panels
      const calculateSmartDefaultPosition = (): WorkspacePosition => {
        const fallbackCenter = (() => {
          const { width, height } = DEFAULT_PANEL_DIMENSIONS
          if (typeof window === 'undefined') {
            return { x: 0, y: 0 }
          }
          return {
            x: Math.round(window.innerWidth / 2 - width / 2),
            y: Math.round(window.innerHeight / 2 - height / 2),
          }
        })()

        if (typeof window === 'undefined') return fallbackCenter

        // Find all panels currently in the DOM
        const allPanels = document.querySelectorAll('[data-store-key]')
        if (allPanels.length === 0) return fallbackCenter

        let rightmostX = 0
        let rightmostY = fallbackCenter.y
        let rightmostWidth = DEFAULT_PANEL_DIMENSIONS.width

        allPanels.forEach(panel => {
          const style = window.getComputedStyle(panel as HTMLElement)
          const rect = (panel as HTMLElement).getBoundingClientRect()
          const panelX = parseFloat(style.left) || 0
          const panelY = parseFloat(style.top) || fallbackCenter.y
          const panelWidth = rect.width || DEFAULT_PANEL_DIMENSIONS.width

          // Find the rightmost panel (x + width is the furthest right)
          if (panelX + panelWidth > rightmostX + rightmostWidth) {
            rightmostX = panelX
            rightmostY = panelY
            rightmostWidth = panelWidth
          }
        })

        // Place new note on the right side with a 50px gap
        const gap = 50
        return {
          x: Math.round(rightmostX + rightmostWidth + gap),
          y: Math.round(rightmostY),
        }
      }

      const smartDefaultPosition = mainPosition ?? pendingPosition ?? cachedPosition ?? calculateSmartDefaultPosition()
      const normalizedPosition = smartDefaultPosition
      if (normalizedPosition) {
        positionCacheRef.current.set(noteId, normalizedPosition)
        syncPositionCacheToStorage()
      }
      const positionToPersist = persistPosition ? normalizedPosition : null

      console.log(`[DEBUG openNote] Position resolution for ${noteId}:`, {
        mainPosition,
        pendingPosition,
        cachedPosition,
        smartDefaultPosition,
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
        const version = workspaceVersionsRef.current.get(noteId) ?? 0
        const next: OpenWorkspaceNote = {
          noteId,
          mainPosition: normalizedPosition,
          updatedAt: null,
          version,
        }

        return [...prev, next]
      })

      ensureWorkspaceForOpenNotes([{
        noteId,
        mainPosition: normalizedPosition,
        updatedAt: null,
        version: workspaceVersionsRef.current.get(noteId) ?? 0,
      }])

      const shouldPersist = persist && (!alreadyOpen || !!positionToPersist)

      if (shouldPersist) {
        const payload: { noteId: string; isOpen: boolean; mainPosition?: WorkspacePosition | null } = {
          noteId,
          isOpen: true,
        }
        if (positionToPersist) {
          payload.mainPosition = positionToPersist
        }
        try {
          const versionUpdates = await persistWorkspace([payload])
          applyVersionUpdates(versionUpdates)
          clearScheduledPersist(noteId)
          // Don't call refreshWorkspace - position is already in local state
          // This prevents unnecessary "Syncing..." UI flashing and potential loops
        } catch (error) {
          console.warn('[CanvasWorkspace] Immediate workspace persist failed, scheduling retry', {
            noteId,
            error: error instanceof Error ? error.message : String(error),
          })
          if (positionToPersist) {
            pendingPersistsRef.current.set(noteId, positionToPersist)
            scheduleWorkspacePersist(noteId, positionToPersist)
          }
        }
      }
    },
    [ensureWorkspaceForOpenNotes, persistWorkspace, scheduleWorkspacePersist, clearScheduledPersist, applyVersionUpdates, syncPositionCacheToStorage],
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
        const versionUpdates = await persistWorkspace([{ noteId, isOpen: false }])
        applyVersionUpdates(versionUpdates)
        invalidateLocalSnapshot(noteId)
        // Persist main panel state as closed so hydration does not revive it
        try {
          await fetch(`/api/canvas/layout/${noteId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              updates: [
                {
                  id: "main",
                  state: "closed"
                }
              ]
            })
          })
        } catch (error) {
          console.warn("[CanvasWorkspace] Failed to mark main panel closed", {
            noteId,
            error: error instanceof Error ? error.message : String(error)
          })
        }
        // Don't call refreshWorkspace - note is already removed from local state
      }
    },
    [persistWorkspace, applyVersionUpdates, invalidateLocalSnapshot],
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
          const versionUpdates = await persistWorkspace([{ noteId, isOpen: true, mainPosition: position }])
          applyVersionUpdates(versionUpdates)
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
    [persistWorkspace, scheduleWorkspacePersist, clearScheduledPersist, syncPositionCacheToStorage, applyVersionUpdates],
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

  const getWorkspaceVersion = useCallback((noteId: string): number | null => {
    const value = workspaceVersionsRef.current.get(noteId)
    return typeof value === 'number' ? value : null
  }, [])

  const updateWorkspaceVersion = useCallback((noteId: string, version: number) => {
    applyVersionUpdates([{ noteId, version }])
  }, [applyVersionUpdates])

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
