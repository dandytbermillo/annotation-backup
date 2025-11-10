import { useCallback, useEffect, useRef, useState } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type { OverlayPopup } from "@/components/floating-toolbar"
import {
  OverlayLayoutAdapter,
  OVERLAY_LAYOUT_SCHEMA_VERSION,
  type OverlayWorkspaceSummary,
} from "@/lib/adapters/overlay-layout-adapter"
import type { OverlayCameraState, OverlayLayoutPayload } from "@/lib/types/overlay-layout"
import type { toast as ToastFn } from "@/hooks/use-toast"

type PendingSnapshot = { payload: OverlayLayoutPayload; hash: string }
type CanvasMode = "overlay" | "constellation"

const workspaceNamePattern = /Workspace (\d+)/

function computeNextWorkspaceName(workspaceSummaries: OverlayWorkspaceSummary[]): string {
  const highest = workspaceSummaries.reduce((max, workspace) => {
    const match = workspaceNamePattern.exec(workspace.name)
    if (!match) return max
    const value = Number.parseInt(match[1] ?? "0", 10)
    return Number.isNaN(value) ? max : Math.max(max, value)
  }, 0)
  return `Workspace ${highest + 1}`
}

type UseOverlayWorkspacesOptions = {
  overlayPersistenceActive: boolean
  shouldShowWorkspaceToggle: boolean
  currentWorkspaceId: string | null
  setCurrentWorkspaceId: Dispatch<SetStateAction<string | null>>
  setCanvasMode: (mode: CanvasMode) => void
  ensureOverlayHydrated: (reason: string) => void
  buildLayoutPayload: () => PendingSnapshot
  flushLayoutSave: () => Promise<void>
  lastSavedLayoutHashRef: MutableRefObject<string | null>
  pendingLayoutRef: MutableRefObject<PendingSnapshot | null>
  saveTimeoutRef: MutableRefObject<NodeJS.Timeout | null>
  overlayAdapterRef: MutableRefObject<OverlayLayoutAdapter | null>
  layoutRevisionRef: MutableRefObject<string | null>
  layoutLoadedRef: MutableRefObject<boolean>
  setOverlayPopups: Dispatch<SetStateAction<OverlayPopup[]>>
  toast: typeof ToastFn
  workspacesLoadedRef: MutableRefObject<boolean>
  defaultCamera: OverlayCameraState
}

type UseOverlayWorkspacesResult = {
  workspaces: OverlayWorkspaceSummary[]
  isWorkspaceListLoading: boolean
  isWorkspaceSaving: boolean
  workspaceDeletionId: string | null
  workspaceMenuOpen: boolean
  workspaceToggleRef: MutableRefObject<HTMLDivElement | null>
  setWorkspaceMenuOpen: Dispatch<SetStateAction<boolean>>
  handleWorkspaceSelect: (workspaceId: string) => Promise<void>
  handleCreateWorkspace: () => Promise<void>
  handleDeleteWorkspace: (workspaceId: string) => Promise<void>
}

export function useOverlayWorkspaces({
  overlayPersistenceActive,
  shouldShowWorkspaceToggle,
  currentWorkspaceId,
  setCurrentWorkspaceId,
  setCanvasMode,
  ensureOverlayHydrated,
  buildLayoutPayload,
  flushLayoutSave,
  lastSavedLayoutHashRef,
  pendingLayoutRef,
  saveTimeoutRef,
  overlayAdapterRef,
  layoutRevisionRef,
  layoutLoadedRef,
  setOverlayPopups,
  toast,
  workspacesLoadedRef,
  defaultCamera,
}: UseOverlayWorkspacesOptions): UseOverlayWorkspacesResult {
  const [workspaces, setWorkspaces] = useState<OverlayWorkspaceSummary[]>([])
  const [isWorkspaceListLoading, setIsWorkspaceListLoading] = useState(false)
  const [isWorkspaceSaving, setIsWorkspaceSaving] = useState(false)
  const [workspaceDeletionId, setWorkspaceDeletionId] = useState<string | null>(null)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const workspaceToggleRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!overlayPersistenceActive) {
      setIsWorkspaceListLoading(false)
      return
    }
    if (workspacesLoadedRef.current) return

    let cancelled = false
    setIsWorkspaceListLoading(true)

    OverlayLayoutAdapter.listWorkspaces()
      .then((list) => {
        if (cancelled) return
        setWorkspaces(list)
        if (list.length > 0) {
          setCurrentWorkspaceId((prev) => prev ?? list[0].id)
        }
        workspacesLoadedRef.current = true
      })
      .catch((error) => {
        console.error("[AnnotationApp] Failed to load workspace list:", error)
        toast({
          variant: "destructive",
          title: "Unable to load workspaces",
          description: error instanceof Error ? error.message : "Unexpected error while listing workspaces.",
        })
      })
      .finally(() => {
        if (!cancelled) {
          setIsWorkspaceListLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [overlayPersistenceActive, toast, setCurrentWorkspaceId, workspacesLoadedRef])

  useEffect(() => {
    if (!shouldShowWorkspaceToggle && workspaceMenuOpen) {
      setWorkspaceMenuOpen(false)
    }
  }, [shouldShowWorkspaceToggle, workspaceMenuOpen])

  useEffect(() => {
    if (!workspaceMenuOpen) return

    const handleClickAway = (event: MouseEvent) => {
      if (!workspaceToggleRef.current) return
      if (!workspaceToggleRef.current.contains(event.target as Node)) {
        setWorkspaceMenuOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickAway)
    return () => {
      document.removeEventListener("mousedown", handleClickAway)
    }
  }, [workspaceMenuOpen])

  const handleWorkspaceSelect = useCallback(
    async (workspaceId: string) => {
      ensureOverlayHydrated("workspace-select")
      if (overlayPersistenceActive) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
          saveTimeoutRef.current = null
        }

        const snapshot = buildLayoutPayload()
        if (snapshot.hash !== lastSavedLayoutHashRef.current) {
          pendingLayoutRef.current = snapshot
          try {
            await flushLayoutSave()
          } catch (error) {
            console.error("[AnnotationApp] Failed to flush layout before workspace switch:", error)
          }
        }
      }

      setWorkspaceMenuOpen(false)
      setCanvasMode("overlay")
      setCurrentWorkspaceId((prev) => (prev === workspaceId ? prev : workspaceId))
    },
    [
      buildLayoutPayload,
      ensureOverlayHydrated,
      flushLayoutSave,
      lastSavedLayoutHashRef,
      overlayPersistenceActive,
      pendingLayoutRef,
      saveTimeoutRef,
      setCanvasMode,
      setCurrentWorkspaceId,
    ],
  )

  const handleCreateWorkspace = useCallback(async () => {
    ensureOverlayHydrated("workspace-create")
    if (!overlayPersistenceActive) return

    const emptyLayout: OverlayLayoutPayload = {
      schemaVersion: OVERLAY_LAYOUT_SCHEMA_VERSION,
      popups: [],
      inspectors: [],
      lastSavedAt: new Date().toISOString(),
      camera: defaultCamera,
    }

    const defaultName = computeNextWorkspaceName(workspaces)
    let nameHint = defaultName

    if (typeof window !== "undefined") {
      const proposed = window.prompt("Name this workspace", defaultName)
      if (proposed === null) {
        return
      }
      const trimmed = proposed.trim()
      if (trimmed.length > 0) {
        nameHint = trimmed
      }
    }

    setIsWorkspaceSaving(true)

    try {
      const result = await OverlayLayoutAdapter.createWorkspace({
        layout: emptyLayout,
        version: emptyLayout.schemaVersion,
        nameHint,
      })

      setWorkspaces((prev) => {
        const withoutDuplicate = prev.filter((ws) => ws.id !== result.workspace.id)
        const updated = [result.workspace, ...withoutDuplicate]
        return updated.sort((a, b) => {
          const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0
          const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0
          return bTime - aTime
        })
      })

      layoutRevisionRef.current = result.envelope.revision
      lastSavedLayoutHashRef.current = JSON.stringify({
        schemaVersion: result.envelope.layout.schemaVersion,
        popups: result.envelope.layout.popups,
        inspectors: result.envelope.layout.inspectors,
        camera: result.envelope.layout.camera ?? defaultCamera,
      })
      layoutLoadedRef.current = true
      setCanvasMode("overlay")
      setCurrentWorkspaceId(result.workspace.id)
      setWorkspaceMenuOpen(false)
      setOverlayPopups([])
      toast({
        title: "Workspace created",
        description: `${result.workspace.name} is ready — start arranging panels.`,
      })
    } catch (error) {
      console.error("[AnnotationApp] Failed to create workspace:", error)
      toast({
        variant: "destructive",
        title: "Failed to snapshot workspace",
        description: error instanceof Error ? error.message : "Unexpected error while saving the workspace.",
      })
    } finally {
      setIsWorkspaceSaving(false)
    }
  }, [
    defaultCamera,
    ensureOverlayHydrated,
    lastSavedLayoutHashRef,
    layoutLoadedRef,
    layoutRevisionRef,
    overlayPersistenceActive,
    setCanvasMode,
    setCurrentWorkspaceId,
    setOverlayPopups,
    toast,
    workspaces,
  ])

  const handleDeleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (workspaceDeletionId) return

      const targetWorkspace = workspaces.find((ws) => ws.id === workspaceId)
      if (!targetWorkspace || targetWorkspace.isDefault) return

      if (typeof window !== "undefined") {
        const confirmed = window.confirm(
          `Delete "${targetWorkspace.name}"? This will remove its saved overlay layout.`,
        )
        if (!confirmed) {
          return
        }
      }

      setWorkspaceDeletionId(workspaceId)

      try {
        await OverlayLayoutAdapter.deleteWorkspace({ workspaceId })

        const updatedWorkspaces = workspaces.filter((ws) => ws.id !== workspaceId)
        setWorkspaces(updatedWorkspaces)
        setWorkspaceMenuOpen(false)

        if (currentWorkspaceId === workspaceId) {
          const fallback = updatedWorkspaces[0]?.id ?? null
          setCurrentWorkspaceId(fallback)
          setCanvasMode("overlay")
          if (!fallback) {
            overlayAdapterRef.current = null
            layoutRevisionRef.current = null
            lastSavedLayoutHashRef.current = null
            layoutLoadedRef.current = true
            setOverlayPopups([])
          }
        }

        toast({
          title: "Workspace deleted",
          description: `${targetWorkspace.name} has been removed.`,
        })
      } catch (error) {
        console.error("[AnnotationApp] Failed to delete workspace:", error)
        toast({
          variant: "destructive",
          title: "Failed to delete workspace",
          description: error instanceof Error ? error.message : "Unexpected error while deleting the workspace.",
        })
      } finally {
        setWorkspaceDeletionId(null)
      }
    },
    [
      currentWorkspaceId,
      lastSavedLayoutHashRef,
      layoutLoadedRef,
      layoutRevisionRef,
      overlayAdapterRef,
      setCanvasMode,
      setCurrentWorkspaceId,
      setOverlayPopups,
      toast,
      workspaceDeletionId,
      workspaces,
    ],
  )

  return {
    workspaces,
    isWorkspaceListLoading,
    isWorkspaceSaving,
    workspaceDeletionId,
    workspaceMenuOpen,
    workspaceToggleRef,
    setWorkspaceMenuOpen,
    handleWorkspaceSelect,
    handleCreateWorkspace,
    handleDeleteWorkspace,
  }
}
