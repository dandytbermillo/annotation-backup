"use client"

import { useEffect, useRef } from "react"
import type { MutableRefObject } from "react"

import type { DebugLogData } from "@/lib/utils/debug-logger"

type UseWorkspaceSeedRegistryOptions = {
  noteId: string
  workspaceSeededNotesRef: MutableRefObject<Set<string>>
  mainPanelSeededRef: MutableRefObject<boolean>
  debugLog: (entry: DebugLogData) => void | Promise<void>
}

export function useWorkspaceSeedRegistry({
  noteId,
  workspaceSeededNotesRef,
  mainPanelSeededRef,
  debugLog,
}: UseWorkspaceSeedRegistryOptions) {
  const initialNoteRef = useRef<string | null>(null)

  useEffect(() => {
    const isFirstNote = initialNoteRef.current === null

    if (isFirstNote) {
      initialNoteRef.current = noteId
    }

    const wasSeeded = workspaceSeededNotesRef.current.has(noteId)

    void debugLog({
      component: "AnnotationCanvas",
      action: "noteId_changed_resetting_refs",
      metadata: {
        noteId,
        prevMainPanelSeeded: mainPanelSeededRef.current,
        prevWorkspaceSeedApplied: wasSeeded,
        isFirstNote,
      },
    })

    mainPanelSeededRef.current = false

    if (isFirstNote) {
      workspaceSeededNotesRef.current.clear()
      void debugLog({
        component: "AnnotationCanvas",
        action: "workspace_seed_reset_all",
        metadata: { reason: "first_note", noteId },
      })
    }

    void debugLog({
      component: "AnnotationCanvas",
      action: "workspace_seed_note_cleared",
      metadata: {
        noteId,
        seededNotes: Array.from(workspaceSeededNotesRef.current),
      },
    })
  }, [debugLog, mainPanelSeededRef, noteId, workspaceSeededNotesRef])
}
