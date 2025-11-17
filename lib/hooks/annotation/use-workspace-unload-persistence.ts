"use client"

import { useEffect } from "react"
import type { MutableRefObject } from "react"

import type { OpenWorkspaceNote, WorkspacePosition } from "@/lib/workspace/types"

interface UseWorkspaceUnloadPersistenceOptions {
  pendingPersistsRef: MutableRefObject<Map<string, WorkspacePosition>>
  pendingBatchRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  scheduledPersistRef: MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>
  featureEnabled: boolean
  openNotes: OpenWorkspaceNote[]
  isActive?: boolean
}

export function useWorkspaceUnloadPersistence({
  pendingPersistsRef,
  pendingBatchRef,
  scheduledPersistRef,
  featureEnabled,
  openNotes,
  isActive = true,
}: UseWorkspaceUnloadPersistenceOptions) {
  useEffect(() => {
    if (!isActive) {
      return () => {
        if (pendingBatchRef.current !== null) {
          clearTimeout(pendingBatchRef.current)
          pendingBatchRef.current = null
        }
        scheduledPersistRef.current.forEach(timeout => clearTimeout(timeout))
        scheduledPersistRef.current.clear()
      }
    }

    const persistActiveNotes = () => {
      if (pendingPersistsRef.current.size === 0) {
        return
      }

      if (featureEnabled) {
        const updates = Array.from(pendingPersistsRef.current.entries()).map(([noteId, position]) => ({
          noteId,
          mainPositionX: position.x,
          mainPositionY: position.y,
        }))

        if (updates.length === 0) return

        const body = JSON.stringify(updates)
        if (body.length > 60 * 1024) {
          console.warn("[CanvasWorkspace] Beacon payload exceeds size limit, truncating to first update")
          const truncatedBody = JSON.stringify([updates[0]])
          const blob = new Blob([truncatedBody], { type: "application/json" })
          try {
            navigator.sendBeacon("/api/canvas/workspace/flush", blob)
          } catch (error) {
            console.warn("[CanvasWorkspace] sendBeacon failed:", error)
          }
          return
        }

        try {
          const blob = new Blob([body], { type: "application/json" })
          navigator.sendBeacon("/api/canvas/workspace/flush", blob)
        } catch (error) {
          console.warn("[CanvasWorkspace] sendBeacon failed:", error)
        }
      } else {
        const payload = Array.from(pendingPersistsRef.current.entries()).map(([noteId, position]) => ({
          noteId,
          isOpen: true,
          mainPosition: position,
        }))

        if (payload.length === 0) return

        const body = JSON.stringify({ notes: payload })

        try {
          void fetch("/api/canvas/workspace", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
          })
        } catch {
          // Silent failure; nothing actionable during unload.
        }
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persistActiveNotes()
      }
    }

    window.addEventListener("beforeunload", persistActiveNotes)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      if (pendingBatchRef.current !== null) {
        clearTimeout(pendingBatchRef.current)
        pendingBatchRef.current = null
      }
      scheduledPersistRef.current.forEach(timeout => clearTimeout(timeout))
      scheduledPersistRef.current.clear()
      window.removeEventListener("beforeunload", persistActiveNotes)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [featureEnabled, isActive, openNotes, pendingBatchRef, pendingPersistsRef, scheduledPersistRef])
}
