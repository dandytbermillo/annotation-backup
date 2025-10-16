"use client"

import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { DataStore } from "@/lib/data-store"
import { EventEmitter } from "@/lib/event-emitter"
import { LayerManager } from "@/lib/canvas/layer-manager"

export interface NoteWorkspace {
  dataStore: DataStore
  events: EventEmitter
  layerManager: LayerManager
}

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
}

const CanvasWorkspaceContext = createContext<CanvasWorkspaceContextValue | null>(null)

export function CanvasWorkspaceProvider({ children }: { children: ReactNode }) {
  const workspacesRef = useRef<Map<string, NoteWorkspace>>(new Map())
  const [openNotes, setOpenNotes] = useState<OpenWorkspaceNote[]>([])
  const [isWorkspaceReady, setIsWorkspaceReady] = useState(false)
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<Error | null>(null)
  const scheduledPersistRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const pendingPersistsRef = useRef<Map<string, WorkspacePosition>>(new Map())
  const PENDING_STORAGE_KEY = 'canvas_workspace_pending'

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

  const getWorkspace = useCallback((noteId: string): NoteWorkspace => {
    let workspace = workspacesRef.current.get(noteId)
    if (!workspace) {
      workspace = {
        dataStore: new DataStore(),
        events: new EventEmitter(),
        layerManager: new LayerManager(),
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

      const payload = {
        notes: updates.map(update => ({
          noteId: update.noteId,
          isOpen: update.isOpen,
          mainPosition: update.mainPosition ?? undefined,
        })),
      }

      try {
        const response = await fetch("/api/canvas/workspace", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          const messageRaw = await response.text()
          const trimmedMessage = messageRaw.trim()
          const statusMessage = `${response.status} ${response.statusText}`.trim()
          const combinedMessage = trimmedMessage || statusMessage || "Failed to persist workspace update"

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

        setWorkspaceError(null)
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        const status = (err as any).status

        if (status !== 404 && status !== 409) {
          setWorkspaceError(err)
        }

        throw err
      }
    },
    [syncPendingToStorage],
  )

  const refreshWorkspace = useCallback(async () => {
    setIsWorkspaceLoading(true)
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

      ensureWorkspaceForOpenNotes(normalized)
      setOpenNotes(normalized)
      setWorkspaceError(null)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      setWorkspaceError(err)
      throw err
    } finally {
      setIsWorkspaceLoading(false)
      setIsWorkspaceReady(true)
    }
  }, [ensureWorkspaceForOpenNotes])

  const clearScheduledPersist = useCallback((noteId: string) => {
    const existing = scheduledPersistRef.current.get(noteId)
    if (existing !== undefined) {
      clearTimeout(existing)
      scheduledPersistRef.current.delete(noteId)
    }
  }, [])

  const scheduleWorkspacePersist = useCallback(
    (noteId: string, position: WorkspacePosition) => {
      clearScheduledPersist(noteId)
      pendingPersistsRef.current.set(noteId, position)
      syncPendingToStorage()

      const timeout = setTimeout(async () => {
        try {
          await persistWorkspace([{ noteId, isOpen: true, mainPosition: position }])
          // Don't call refreshWorkspace here - it causes infinite loops
          // The position is already in local state, no need to reload from DB
        } catch (error) {
          console.warn('[CanvasWorkspace] Delayed workspace persist failed', {
            noteId,
            error: error instanceof Error ? error.message : String(error),
          })
        } finally {
          scheduledPersistRef.current.delete(noteId)
        }
      }, 750)

      scheduledPersistRef.current.set(noteId, timeout)
    },
    [clearScheduledPersist, persistWorkspace, syncPendingToStorage],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return

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
      const normalizedPosition = mainPosition ?? { x: 2000, y: 1500 }
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
          // SUCCESS: Don't refresh workspace - position is already in local state
          // Refreshing causes unnecessary loading states and potential loops
        } catch (error) {
          console.warn('[CanvasWorkspace] Panel position persist failed, scheduling retry', {
            noteId,
            error: error instanceof Error ? error.message : String(error),
          })
          // CRITICAL: Don't call refreshWorkspace on failure - it would overwrite our local state
          // Keep the new position in pendingPersistsRef for retry and beforeunload
          scheduleWorkspacePersist(noteId, position)
        }
      }
    },
    [persistWorkspace, scheduleWorkspacePersist, clearScheduledPersist],
  )

  useEffect(() => {
    const persistActiveNotes = () => {
      if (pendingPersistsRef.current.size === 0) {
        return
      }

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

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistActiveNotes()
      }
    }

    window.addEventListener('beforeunload', persistActiveNotes)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
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
      workspaceError,
      refreshWorkspace,
      openNote,
      closeNote,
      updateMainPosition,
    }),
    [
      getWorkspace,
      hasWorkspace,
      removeWorkspace,
      listWorkspaces,
      openNotes,
      isWorkspaceReady,
      isWorkspaceLoading,
      workspaceError,
      refreshWorkspace,
      openNote,
      closeNote,
      updateMainPosition,
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
