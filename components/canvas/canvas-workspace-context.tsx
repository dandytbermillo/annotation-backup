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

      try {
        const response = await fetch("/api/canvas/workspace", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notes: updates.map(update => ({
              noteId: update.noteId,
              isOpen: update.isOpen,
              mainPosition: update.mainPosition ?? undefined,
            })),
          }),
        })

        if (!response.ok) {
          const message = await response.text()
          throw new Error(message || "Failed to persist workspace update")
        }

        setWorkspaceError(null)
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        setWorkspaceError(err)
        throw err
      }
    },
    [],
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

  const openNote = useCallback(
    async (noteId: string, options?: OpenNoteOptions) => {
      const { mainPosition = null, persist = true } = options ?? {}
      if (!noteId) {
        return
      }

      setOpenNotes(prev => {
        const exists = prev.some(note => note.noteId === noteId)
        if (exists) {
          return prev.map(note =>
            note.noteId === noteId
              ? {
                  ...note,
                  mainPosition: mainPosition ?? note.mainPosition,
                }
              : note,
          )
        }

        const next: OpenWorkspaceNote = {
          noteId,
          mainPosition: mainPosition ?? null,
          updatedAt: null,
        }

        return [...prev, next]
      })

      ensureWorkspaceForOpenNotes([{ noteId, mainPosition: mainPosition ?? null, updatedAt: null }])

      if (persist) {
        await persistWorkspace([{ noteId, isOpen: true, mainPosition }])
        await refreshWorkspace()
      }
    },
    [ensureWorkspaceForOpenNotes, persistWorkspace, refreshWorkspace],
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
        await refreshWorkspace()
      }
    },
    [persistWorkspace, refreshWorkspace],
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
        await persistWorkspace([{ noteId, isOpen: true, mainPosition: position }])
      }
    },
    [persistWorkspace],
  )

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
