import { useCallback, useEffect, useRef, useState } from "react"
import type { MutableRefObject, Dispatch, SetStateAction } from "react"
import type { OverlayPopup } from "@/components/floating-toolbar"
import type { LayerContextValue } from "@/components/canvas/layer-provider"
import { buildHydratedOverlayLayout } from "@/lib/workspaces/overlay-hydration"
import {
  OverlayLayoutAdapter,
  type OverlayLayoutPayload,
} from "@/lib/adapters/overlay-layout-adapter"
import type { OverlayCameraState, OverlayLayoutDiagnostics } from "@/lib/types/overlay-layout"
import { ToastAction } from "@/components/ui/toast"
import type { toast as ToastFn } from "@/hooks/use-toast"

type PendingSnapshot = { payload: OverlayLayoutPayload; hash: string }

type UseOverlayLayoutPersistenceOptions = {
  overlayPersistenceActive: boolean
  currentWorkspaceId: string | null
  overlayPopupsLength: number
  setOverlayPopups: Dispatch<SetStateAction<OverlayPopup[]>>
  fetchGlobalFolder: (folderId: string) => Promise<any | null>
  fetchGlobalChildren: (folderId: string) => Promise<any[] | null>
  fetchWithKnowledgeBase: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  toast: typeof ToastFn
  layerContext: LayerContextValue | null
  debugLog: (payload: { component: string; action: string; metadata?: Record<string, unknown> }) => void
  isDebugEnabled: () => boolean
  overlayAdapterRef: MutableRefObject<OverlayLayoutAdapter | null>
  layoutLoadedRef: MutableRefObject<boolean>
  layoutRevisionRef: MutableRefObject<string | null>
  lastSavedLayoutHashRef: MutableRefObject<string | null>
  pendingLayoutRef: MutableRefObject<PendingSnapshot | null>
  saveInFlightRef: MutableRefObject<boolean>
  saveTimeoutRef: MutableRefObject<NodeJS.Timeout | null>
  isInitialLoadRef: MutableRefObject<boolean>
  latestCameraRef: MutableRefObject<OverlayCameraState>
  prevCameraForSaveRef: MutableRefObject<OverlayCameraState>
  setIsWorkspaceLayoutLoading: Dispatch<SetStateAction<boolean>>
  defaultCamera: OverlayCameraState
}

type UseOverlayLayoutPersistenceResult = {
  applyOverlayLayout: (layout: OverlayLayoutPayload) => void
}

export function useOverlayLayoutPersistence({
  overlayPersistenceActive,
  currentWorkspaceId,
  overlayPopupsLength,
  setOverlayPopups,
  fetchGlobalFolder,
  fetchGlobalChildren,
  fetchWithKnowledgeBase,
  toast,
  layerContext,
  debugLog,
  isDebugEnabled,
  overlayAdapterRef,
  layoutLoadedRef,
  layoutRevisionRef,
  lastSavedLayoutHashRef,
  pendingLayoutRef,
  saveInFlightRef,
  saveTimeoutRef,
  isInitialLoadRef,
  latestCameraRef,
  prevCameraForSaveRef,
  setIsWorkspaceLayoutLoading,
  defaultCamera,
}: UseOverlayLayoutPersistenceOptions): UseOverlayLayoutPersistenceResult {
  const [pendingDiagnostics, setPendingDiagnostics] = useState<OverlayLayoutDiagnostics | null>(null)
  const diagnosticsRef = useRef<OverlayLayoutDiagnostics | null>(null)

  useEffect(() => {
    diagnosticsRef.current = pendingDiagnostics
  }, [pendingDiagnostics])

  const handleRepairMismatchedPopups = useCallback(() => {
    const diagnostics = diagnosticsRef.current
    if (!diagnostics) return

    const flaggedPopupIds = new Set<string>()
    diagnostics.workspaceMismatches.forEach((entry) => {
      if (entry.popupId) flaggedPopupIds.add(entry.popupId)
    })
    diagnostics.missingFolders.forEach((entry) => {
      if (entry.popupId) flaggedPopupIds.add(entry.popupId)
    })

    if (flaggedPopupIds.size === 0) {
      setPendingDiagnostics(null)
      return
    }

    setOverlayPopups((prev) => prev.filter((popup) => !flaggedPopupIds.has(popup.id)))

    debugLog({
      component: "PopupOverlay",
      action: "overlay_workspace_repair_applied",
      metadata: {
        removedPopupIds: Array.from(flaggedPopupIds),
        mismatchCount: diagnostics.workspaceMismatches.length,
        missingCount: diagnostics.missingFolders.length,
      },
    })

    toast({
      title: flaggedPopupIds.size === 1 ? "Removed 1 popup" : `Removed ${flaggedPopupIds.size} popups`,
      description:
        diagnostics.workspaceMismatches.length > 0
          ? "Popups referencing another workspace were removed from this layout."
          : "Popups without matching folders were removed from this layout.",
    })

    setPendingDiagnostics(null)
  }, [debugLog, setOverlayPopups, toast])

  const applyOverlayLayout = useCallback(
    (layout: OverlayLayoutPayload) => {
      const diagnostics = layout.diagnostics ?? null
      const mismatchCount = diagnostics?.workspaceMismatches?.length ?? 0
      const missingCount = diagnostics?.missingFolders?.length ?? 0
      const hasDiagnostics = Boolean(diagnostics) && (mismatchCount > 0 || missingCount > 0)

      if (hasDiagnostics && diagnostics) {
        const digest = JSON.stringify({
          mismatches: diagnostics.workspaceMismatches.map((entry) => ({
            popupId: entry.popupId,
            actualWorkspaceId: entry.actualWorkspaceId ?? null,
          })),
          missing: diagnostics.missingFolders.map((entry) => ({
            popupId: entry.popupId,
            folderId: entry.folderId ?? null,
          })),
        })

        if (lastSavedLayoutHashRef.current !== digest) {
          lastSavedLayoutHashRef.current = digest
          setPendingDiagnostics(diagnostics)

          debugLog({
            component: "PopupOverlay",
            action: "overlay_workspace_mismatch_detected",
            metadata: {
              workspaceId: currentWorkspaceId,
              mismatchCount,
              missingCount,
              mismatches: diagnostics.workspaceMismatches.slice(0, 10),
              missingFolders: diagnostics.missingFolders.slice(0, 10),
            },
          })

          const summaryParts: string[] = []
          if (mismatchCount > 0) {
            summaryParts.push(
              mismatchCount === 1
                ? "1 popup belongs to a different workspace."
                : `${mismatchCount} popups belong to a different workspace.`,
            )
          }
          if (missingCount > 0) {
            summaryParts.push(
              missingCount === 1
                ? "1 popup references a folder that no longer exists."
                : `${missingCount} popups reference folders that no longer exist.`,
            )
          }

          toast({
            variant: "destructive",
            title: "Overlay layout needs repair",
            description: summaryParts.join(" "),
            action: (
              <ToastAction altText="Repair popups" onClick={handleRepairMismatchedPopups}>
                Repair
              </ToastAction>
            ),
          })
        }
      } else if (pendingDiagnostics) {
        setPendingDiagnostics(null)
      }

      const savedCamera = layout.camera ?? defaultCamera
      if (layerContext?.setTransform) {
        const currentTransform = layerContext.transforms.popups || defaultCamera
        const camerasEqual =
          currentTransform.x === savedCamera.x &&
          currentTransform.y === savedCamera.y &&
          currentTransform.scale === savedCamera.scale
        if (!camerasEqual) {
          layerContext.setTransform("popups", savedCamera)
        }
      }
      latestCameraRef.current = savedCamera
      prevCameraForSaveRef.current = savedCamera
      const { popups: hydratedPopups, hash: coreHash } = buildHydratedOverlayLayout(layout, savedCamera)
      lastSavedLayoutHashRef.current = coreHash

      if (hydratedPopups.length === 0) {
        setOverlayPopups([])
        return
      }

      const restoredPopups = (hydratedPopups as OverlayPopup[]).map((popup) => ({
        ...popup,
        sizeMode:
          popup.sizeMode ??
          (Number.isFinite(popup.width) || Number.isFinite(popup.height) ? "auto" : "default"),
      }))
      setOverlayPopups(restoredPopups)

      const popupsNeedingFetch = restoredPopups.filter((popup) => popup.isLoading && popup.folderId)
      if (popupsNeedingFetch.length === 0) {
        return
      }

      popupsNeedingFetch.forEach(async (popup) => {
        if (!popup.folderId) return

        try {
          const responseData = await fetchGlobalFolder(popup.folderId)
          if (!responseData) return
          const folderData = responseData.item || responseData

          const cachedColor = popup.folder?.color
          let effectiveColor = folderData.color || cachedColor

          if (!effectiveColor) {
            const initialParentId = folderData.parentId ?? folderData.parent_id
            if (initialParentId) {
              try {
                let currentParentId = initialParentId
                let depth = 0
                const maxDepth = 10

                while (currentParentId && !effectiveColor && depth < maxDepth) {
                  const parentResponse = await fetchWithKnowledgeBase(`/api/items/${currentParentId}`)
                  if (!parentResponse.ok) break

                  const parentData = await parentResponse.json()
                  const parent = parentData.item || parentData

                  if (parent.color) {
                    effectiveColor = parent.color
                    break
                  }

                  currentParentId = parent.parentId ?? parent.parent_id
                  depth++
                }
              } catch (error) {
                console.warn("[Popup Restore] Failed to fetch ancestor color:", error)
              }
            }
          }

          const childItems = await fetchGlobalChildren(popup.folderId)
          if (!childItems) return
          const children = childItems.map((item: any) => ({
            id: item.id,
            name: item.name,
            type: item.type,
            icon: item.icon || (item.type === "folder" ? "📁" : "📄"),
            color: item.color,
            path: item.path,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            hasChildren: item.type === "folder",
            level: popup.level + 1,
            children: [],
            parentId: item.parentId ?? item.parent_id,
          }))

          setOverlayPopups((prev) =>
            prev.map((p) => {
              if (p.id !== popup.id) return p
              return {
                ...p,
                folder: {
                  id: folderData.id,
                  name: folderData.name,
                  type: "folder" as const,
                  level: popup.level,
                  color: effectiveColor,
                  path: folderData.path,
                  children,
                },
                children,
                isLoading: false,
              }
            }),
          )
        } catch (error) {
          if (isDebugEnabled()) {
            debugLog({
              component: "AnnotationApp",
              action: "folder_load_failed",
              metadata: {
                folderId: popup.folderId,
                error: error instanceof Error ? error.message : "Unknown error",
              },
            })
          }
        }
      })
    },
    [
      currentWorkspaceId,
      debugLog,
      defaultCamera,
      fetchGlobalChildren,
      fetchGlobalFolder,
      fetchWithKnowledgeBase,
      handleRepairMismatchedPopups,
      isDebugEnabled,
      lastSavedLayoutHashRef,
      layerContext,
      latestCameraRef,
      pendingDiagnostics,
      prevCameraForSaveRef,
      setOverlayPopups,
      toast,
    ],
  )

  useEffect(() => {
    if (!overlayPersistenceActive) {
      overlayAdapterRef.current = null
      return
    }

    const workspaceKey = currentWorkspaceId ?? "default"
    overlayAdapterRef.current = new OverlayLayoutAdapter({ workspaceKey })
    layoutLoadedRef.current = false
    layoutRevisionRef.current = null
    lastSavedLayoutHashRef.current = null
    pendingLayoutRef.current = null
  }, [
    currentWorkspaceId,
    lastSavedLayoutHashRef,
    layoutLoadedRef,
    layoutRevisionRef,
    overlayAdapterRef,
    overlayPersistenceActive,
    pendingLayoutRef,
  ])

  useEffect(() => {
    if (!overlayPersistenceActive || layoutLoadedRef.current) return

    const adapter = overlayAdapterRef.current
    if (!adapter) return

    let cancelled = false
    setIsWorkspaceLayoutLoading(true)

    void (async () => {
      try {
        const envelope = await adapter.loadLayout()
        if (cancelled) return

        if (!envelope) {
          layoutRevisionRef.current = null
          lastSavedLayoutHashRef.current = null
          layoutLoadedRef.current = true
          setOverlayPopups([])
          return
        }

        layoutRevisionRef.current = envelope.revision
        lastSavedLayoutHashRef.current = JSON.stringify({
          schemaVersion: envelope.layout.schemaVersion,
          popups: envelope.layout.popups,
          inspectors: envelope.layout.inspectors,
          camera: envelope.layout.camera ?? defaultCamera,
        })

        isInitialLoadRef.current = true
        applyOverlayLayout(envelope.layout)
      } catch (error) {
        if (!cancelled) {
          console.error("[AnnotationApp] Failed to load overlay layout:", error)
          layoutLoadedRef.current = true
          toast({
            variant: "destructive",
            title: "Failed to load workspace layout",
            description: error instanceof Error ? error.message : "Unexpected error while loading the workspace.",
          })
        }
      } finally {
        if (!cancelled) {
          setIsWorkspaceLayoutLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    applyOverlayLayout,
    defaultCamera,
    layoutLoadedRef,
    layoutRevisionRef,
    overlayAdapterRef,
    overlayPersistenceActive,
    setIsWorkspaceLayoutLoading,
    setOverlayPopups,
    toast,
    lastSavedLayoutHashRef,
    isInitialLoadRef,
  ])

  useEffect(() => {
    if (isInitialLoadRef.current) {
      layoutLoadedRef.current = true
      isInitialLoadRef.current = false
      console.log("[AnnotationApp] Initial layout load complete, enabling auto-switch")
    }
  }, [overlayPopupsLength, isInitialLoadRef, layoutLoadedRef])

  return {
    applyOverlayLayout,
  }
}
