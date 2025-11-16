"use client"

import { debugLog } from "@/lib/utils/debug-logger"
import type { WorkspacePosition } from "@/lib/workspace/types"

export type WorkspacePersistUpdate = {
  noteId: string
  isOpen: boolean
  mainPosition?: WorkspacePosition | null
}

export type WorkspaceVersionUpdate = { noteId: string; version: number }

export interface PersistWorkspaceDeps {
  featureEnabled: boolean
  skipServer?: boolean
  pendingPersistsRef: React.MutableRefObject<Map<string, WorkspacePosition>>
  syncPendingToStorage: () => void
  extractVersionUpdates: (payload: any) => WorkspaceVersionUpdate[]
  applyVersionUpdates: (updates: WorkspaceVersionUpdate[]) => void
  setWorkspaceError: React.Dispatch<React.SetStateAction<Error | null>>
}

export async function persistWorkspaceUpdates(
  updates: WorkspacePersistUpdate[],
  {
    featureEnabled,
    skipServer = false,
    pendingPersistsRef,
    syncPendingToStorage,
    extractVersionUpdates,
    applyVersionUpdates,
    setWorkspaceError,
  }: PersistWorkspaceDeps,
) {
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

  await debugLog({
    component: "CanvasWorkspace",
    action: "persist_attempt",
    metadata: { updates: updates.map(u => ({ noteId: u.noteId, isOpen: u.isOpen })) },
  })

  if (skipServer) {
    updates.forEach(update => {
      pendingPersistsRef.current.delete(update.noteId)
    })
    syncPendingToStorage()
    setWorkspaceError(null)
    return []
  }

  if (!featureEnabled) {
    setWorkspaceError(new Error("Legacy workspace persist path not supported"))
    return []
  }

  const updatePayload = {
    updates: updates.map(update => {
      if (!update.isOpen) {
        return { noteId: update.noteId, isOpen: false }
      }
      if (update.mainPosition) {
        return {
          noteId: update.noteId,
          mainPositionX: update.mainPosition.x,
          mainPositionY: update.mainPosition.y,
        }
      }
      return { noteId: update.noteId }
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
      updates.forEach(update => {
        if (update.isOpen && update.mainPosition) {
          pendingPersistsRef.current.delete(update.noteId)
        }
      })
      syncPendingToStorage()

      await debugLog({
        component: "CanvasWorkspace",
        action: "workspace_snapshot_persisted",
        metadata: {
          noteIds: updates.map(u => u.noteId),
          retryCount: retries,
        },
      })

      let parsedPayload: any = null
      try {
        parsedPayload = rawBody ? JSON.parse(rawBody) : null
      } catch (parseError) {
        console.warn("[CanvasWorkspace] Failed to parse workspace/update payload", parseError)
      }

      if (parsedPayload) {
        const versionUpdates = extractVersionUpdates(parsedPayload)
        applyVersionUpdates(versionUpdates)
        return versionUpdates
      }

      setWorkspaceError(null)
      return []
    }

    if (response.status === 409 && retries < maxRetries) {
      retries++
      await debugLog({
        component: "CanvasWorkspace",
        action: "persist_retry_conflict",
        metadata: {
          retryCount: retries,
          maxRetries,
        },
      })
      await new Promise(resolve => setTimeout(resolve, 50))
      continue
    }

    const trimmedMessage = rawBody.trim()
    const statusMessage = `${response.status} ${response.statusText}`.trim()
    const combinedMessage = trimmedMessage || statusMessage || "Failed to persist workspace update"

    await debugLog({
      component: "CanvasWorkspace",
      action: "persist_failed",
      metadata: {
        status: response.status,
        statusText: response.statusText,
      },
      content_preview: combinedMessage,
    })

    const error = new Error(combinedMessage)
    setWorkspaceError(error)
    throw error
  }

  return []
}
