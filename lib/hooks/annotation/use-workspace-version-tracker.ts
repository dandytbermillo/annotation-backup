"use client"

import { useCallback } from "react"
import type { MutableRefObject } from "react"

import type { WorkspaceVersionUpdate } from "@/lib/workspace/persist-workspace"

interface UseWorkspaceVersionTrackerOptions {
  workspaceVersionsRef: MutableRefObject<Map<string, number>>
  applyVersionUpdates: (updates: WorkspaceVersionUpdate[]) => void
}

export function useWorkspaceVersionTracker({
  workspaceVersionsRef,
  applyVersionUpdates,
}: UseWorkspaceVersionTrackerOptions) {
  const getWorkspaceVersion = useCallback(
    (noteId: string): number | null => {
      const value = workspaceVersionsRef.current.get(noteId)
      return typeof value === "number" ? value : null
    },
    [workspaceVersionsRef],
  )

  const updateWorkspaceVersion = useCallback(
    (noteId: string, version: number) => {
      applyVersionUpdates([{ noteId, version }])
    },
    [applyVersionUpdates],
  )

  return { getWorkspaceVersion, updateWorkspaceVersion }
}
