"use client"

import { useEffect } from "react"

import type { UnifiedProvider } from "@/lib/provider-switcher"
import { isPlainModeActive } from "@/lib/collab-mode"
import { getDefaultMainPosition } from "@/lib/canvas/canvas-defaults"
import { debugLog } from "@/lib/utils/debug-logger"

type Point = { x: number; y: number }

type UseCollaborativeNoteInitializationOptions = {
  noteId: string
  workspaceMainPosition: Point | null
  provider: UnifiedProvider
}

export function useCollaborativeNoteInitialization({
  noteId,
  workspaceMainPosition,
  provider,
}: UseCollaborativeNoteInitializationOptions) {
  useEffect(() => {
    if (isPlainModeActive()) {
      return
    }

    provider.setCurrentNote(noteId)

    const storageKey = `note-data-${noteId}`
    const existingData =
      typeof window !== "undefined" ? window.localStorage?.getItem(storageKey) : null
    const isNewNote = !existingData

    console.log("[AnnotationCanvas] Initializing note:", {
      noteId,
      hasExistingData: !!existingData,
      isNewNote,
    })

    const initialPosition = workspaceMainPosition ?? getDefaultMainPosition()

    debugLog({
      component: "AnnotationCanvas",
      action: "provider_init_position",
      metadata: {
        noteId,
        workspaceMainPosition,
        initialPosition,
        isNewNote,
      },
    })

    const defaultData = {
      main: {
        title: "New Document",
        type: "main",
        content: "",
        branches: [],
        position: initialPosition,
        isEditable: true,
        isNew: isNewNote,
      },
    }

    console.log("[AnnotationCanvas] Default data for main panel:", defaultData.main)

    provider.initializeDefaultData(noteId, defaultData)
  }, [noteId, workspaceMainPosition, provider])
}
