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
  overlayPopups: OverlayPopup[]
  overlayPopupsLength: number
  optimisticHydrationEnabled: boolean
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
  overlayCameraFromUserRef: MutableRefObject<{ transform: OverlayCameraState; timestamp: number }>
  layoutLoadStartedAtRef: MutableRefObject<number>
  hydrationRunIdRef: MutableRefObject<string | null>
  layoutDirtyRef: MutableRefObject<boolean>
}

type UseOverlayLayoutPersistenceResult = {
  applyOverlayLayout: (layout: OverlayLayoutPayload, options?: { reason?: "hydrate" | "conflict" }) => void
}

export function useOverlayLayoutPersistence({
  overlayPersistenceActive,
  currentWorkspaceId,
  overlayPopups,
  overlayPopupsLength,
  optimisticHydrationEnabled,
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
  overlayCameraFromUserRef,
  layoutLoadStartedAtRef,
  hydrationRunIdRef,
  layoutDirtyRef,
}: UseOverlayLayoutPersistenceOptions): UseOverlayLayoutPersistenceResult {
  const [pendingDiagnostics, setPendingDiagnostics] = useState<OverlayLayoutDiagnostics | null>(null)
  const diagnosticsRef = useRef<OverlayLayoutDiagnostics | null>(null)
  const diagnosticsHashRef = useRef<string | null>(null)
  const overlayPopupsRef = useRef(overlayPopups)

  useEffect(() => {
    diagnosticsRef.current = pendingDiagnostics
  }, [pendingDiagnostics])

  useEffect(() => {
    overlayPopupsRef.current = overlayPopups
  }, [overlayPopups])

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
      diagnosticsHashRef.current = null
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
    diagnosticsHashRef.current = null
  }, [debugLog, setOverlayPopups, toast])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    ;(window as any).__overlayRepairHandler = handleRepairMismatchedPopups

    return () => {
      if ((window as any).__overlayRepairHandler === handleRepairMismatchedPopups) {
        delete (window as any).__overlayRepairHandler
      }
    }
  }, [handleRepairMismatchedPopups])

  const applyOverlayLayout = useCallback(
    (layout: OverlayLayoutPayload, options?: { reason?: "hydrate" | "conflict" }) => {
      const reason = options?.reason ?? "hydrate"
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

        if (diagnosticsHashRef.current !== digest) {
          diagnosticsHashRef.current = digest
          setPendingDiagnostics(diagnostics)

          if (mismatchCount > 0) {
            debugLog({
              component: "PopupOverlay",
              action: "overlay_workspace_mismatch_detected",
              metadata: {
                workspaceId: currentWorkspaceId,
                mismatchCount,
                mismatches: diagnostics.workspaceMismatches.slice(0, 10),
              },
            })
          }

          if (missingCount > 0) {
            debugLog({
              component: "PopupOverlay",
              action: "overlay_workspace_missing_folder",
              metadata: {
                workspaceId: currentWorkspaceId,
                missingCount,
                missingFolders: diagnostics.missingFolders.slice(0, 10),
              },
            })
          }

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
        diagnosticsHashRef.current = null
      }

      const savedCamera = layout.camera ?? defaultCamera
      const shouldEvaluateOptimisticCamera = optimisticHydrationEnabled && reason === "hydrate"
      let cameraApplied = true

      if (layerContext?.setTransform) {
        const currentTransform = layerContext.transforms.popups || defaultCamera
        const camerasEqual =
          currentTransform.x === savedCamera.x &&
          currentTransform.y === savedCamera.y &&
          currentTransform.scale === savedCamera.scale

        const userMovedDuringHydration =
          shouldEvaluateOptimisticCamera &&
          overlayCameraFromUserRef.current.timestamp > 0 &&
          overlayCameraFromUserRef.current.timestamp >= layoutLoadStartedAtRef.current

        if (userMovedDuringHydration) {
          cameraApplied = false
        }

        if (cameraApplied && !camerasEqual) {
          layerContext.setTransform("popups", savedCamera)
        }

        if (!cameraApplied) {
          layoutDirtyRef.current = true
        }
      }

      const activeCamera =
        cameraApplied || !layerContext
          ? savedCamera
          : layerContext.transforms.popups || overlayCameraFromUserRef.current.transform || latestCameraRef.current

      latestCameraRef.current = activeCamera
      prevCameraForSaveRef.current = activeCamera
      overlayCameraFromUserRef.current = {
        transform: activeCamera,
        timestamp: overlayCameraFromUserRef.current.timestamp,
      }

      if (optimisticHydrationEnabled) {
        void debugLog({
          component: "PopupOverlay",
          action: "overlay_camera_applied",
          metadata: {
            workspaceId: currentWorkspaceId,
            applied: cameraApplied,
            reason,
          },
        })
      }

      const { popups: hydratedPopups, hash: coreHash } = buildHydratedOverlayLayout(layout, savedCamera)
      lastSavedLayoutHashRef.current = coreHash

      let mergedPopups: OverlayPopup[] = []
      if (hydratedPopups.length === 0) {
        setOverlayPopups([])
      } else {
        const normalizedPopups = (hydratedPopups as OverlayPopup[]).map((popup) => ({
          ...popup,
          sizeMode:
            popup.sizeMode ??
            (Number.isFinite(popup.width) || Number.isFinite(popup.height) ? "auto" : "default"),
        }))

        mergedPopups = normalizedPopups
        if (optimisticHydrationEnabled) {
          const existingById = new Map(overlayPopupsRef.current.map((popup) => [popup.id, popup]))
          mergedPopups = normalizedPopups.map((popup) => {
            const existing = existingById.get(popup.id)
            if (!existing) return popup

            if (existing.isDragging) {
              return {
                ...popup,
                canvasPosition: existing.canvasPosition ?? popup.canvasPosition,
                position: (existing as any).position ?? (popup as any).position,
                width: existing.width ?? popup.width,
                height: existing.height ?? popup.height,
                isDragging: true,
              }
            }

            const unchanged =
              existing.canvasPosition?.x === popup.canvasPosition?.x &&
              existing.canvasPosition?.y === popup.canvasPosition?.y &&
              existing.width === popup.width &&
              existing.height === popup.height

            return unchanged ? existing : popup
          })
        }

        setOverlayPopups(mergedPopups)

        const popupsNeedingFetch = mergedPopups.filter((popup) => popup.isLoading && popup.folderId)

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
      }

      if (optimisticHydrationEnabled && reason === "hydrate") {
        const startedAt = layoutLoadStartedAtRef.current
        const durationMs =
          startedAt > 0
            ? Math.max(
                0,
                (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt,
              )
            : 0
        layoutLoadStartedAtRef.current = 0
        void debugLog({
          component: "PopupOverlay",
          action: "overlay_layout_hydrate_finish",
          metadata: {
            workspaceId: currentWorkspaceId,
            durationMs,
            cameraApplied,
            skippedReason: cameraApplied ? undefined : "user_moved",
          },
        })
      }
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
      optimisticHydrationEnabled,
      overlayCameraFromUserRef,
      pendingDiagnostics,
      prevCameraForSaveRef,
      setOverlayPopups,
      toast,
      layoutDirtyRef,
      layoutLoadStartedAtRef,
      hydrationRunIdRef,
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
    const hydrationId = `${currentWorkspaceId ?? "default"}-${Date.now()}`
    hydrationRunIdRef.current = hydrationId
    layoutLoadStartedAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now()
    setIsWorkspaceLayoutLoading(true)

    if (optimisticHydrationEnabled) {
      void debugLog({
        component: "PopupOverlay",
        action: "overlay_layout_hydrate_start",
        metadata: {
          workspaceId: currentWorkspaceId,
          beganAt: new Date().toISOString(),
        },
      })
    }

    void (async () => {
      try {
        const envelope = await adapter.loadLayout()
        if (cancelled || hydrationRunIdRef.current !== hydrationId) return

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
        applyOverlayLayout(envelope.layout, { reason: "hydrate" })
      } catch (error) {
        if (!cancelled && hydrationRunIdRef.current === hydrationId) {
          console.error("[AnnotationApp] Failed to load overlay layout:", error)
          layoutLoadedRef.current = true
          toast({
            variant: "destructive",
            title: "Failed to load workspace layout",
            description: error instanceof Error ? error.message : "Unexpected error while loading the workspace.",
          })
        }
      } finally {
        if (!cancelled && hydrationRunIdRef.current === hydrationId) {
          setIsWorkspaceLayoutLoading(false)
          hydrationRunIdRef.current = null
          layoutLoadStartedAtRef.current = 0
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
    optimisticHydrationEnabled,
    setIsWorkspaceLayoutLoading,
    setOverlayPopups,
    toast,
    lastSavedLayoutHashRef,
    isInitialLoadRef,
    layoutLoadStartedAtRef,
    hydrationRunIdRef,
  ])

  useEffect(() => {
    if (!isInitialLoadRef.current) {
      return
    }
    layoutLoadedRef.current = true
    isInitialLoadRef.current = false
    console.log("[AnnotationApp] Initial layout load complete, enabling auto-switch")
  }, [overlayPopups, isInitialLoadRef, layoutLoadedRef])

  return {
    applyOverlayLayout,
  }
}
