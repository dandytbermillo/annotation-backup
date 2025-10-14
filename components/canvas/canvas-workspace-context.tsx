"use client"

import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useMemo, useRef } from "react"
import { DataStore } from "@/lib/data-store"
import { EventEmitter } from "@/lib/event-emitter"

export interface NoteWorkspace {
  dataStore: DataStore
  events: EventEmitter
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
}

const CanvasWorkspaceContext = createContext<CanvasWorkspaceContextValue | null>(null)

export function CanvasWorkspaceProvider({ children }: { children: ReactNode }) {
  const workspacesRef = useRef<Map<string, NoteWorkspace>>(new Map())

  const getWorkspace = useCallback((noteId: string): NoteWorkspace => {
    let workspace = workspacesRef.current.get(noteId)
    if (!workspace) {
      workspace = {
        dataStore: new DataStore(),
        events: new EventEmitter(),
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

  const value = useMemo<CanvasWorkspaceContextValue>(
    () => ({
      getWorkspace,
      hasWorkspace,
      removeWorkspace,
      listWorkspaces,
    }),
    [getWorkspace, hasWorkspace, removeWorkspace, listWorkspaces],
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
