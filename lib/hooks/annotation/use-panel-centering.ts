"use client"

import { useCallback } from "react"
import { flushSync } from "react-dom"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"

import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import type { CanvasItem } from "@/types/canvas-items"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
import { isPlainModeActive } from "@/lib/collab-mode"
import { UnifiedProvider } from "@/lib/provider-switcher"
import type { DataStore } from "@/lib/data-store"
import { updateOrigin } from "@/lib/canvas/directional-scroll-origin"
import { getActiveWorkspaceContext } from "@/lib/note-workspaces/state"

type Position = { x: number; y: number }

type UsePanelCenteringOptions = {
  noteId: string
  canvasItemsRef: MutableRefObject<CanvasItem[]>
  dataStore?: DataStore | null
  resolveWorkspacePosition: (noteId: string) => Position | null
  isDefaultOffscreenPosition: (position: Position | null | undefined) => boolean
  canvasStateRef: MutableRefObject<CanvasViewportState>
  setCanvasState: Dispatch<SetStateAction<CanvasViewportState>>
  dispatch: Dispatch<any>
}

export function usePanelCentering({
  noteId,
  canvasItemsRef,
  dataStore,
  resolveWorkspacePosition,
  isDefaultOffscreenPosition,
  canvasStateRef,
  setCanvasState,
  dispatch,
}: UsePanelCenteringOptions) {
  const resolvePanelPosition = useCallback(
    (key: string): Position | null => {
      const normalizePosition = (value: any): Position | null => {
        if (!value || typeof value !== "object") return null
        const { x, y } = value as { x?: number; y?: number }
        if (typeof x !== "number" || typeof y !== "number") return null
        return { x, y }
      }

      const parsedKey = key.includes("::") ? parsePanelKey(key) : null
      const targetNoteId = parsedKey?.noteId ?? noteId
      const targetPanelId = parsedKey?.panelId ?? key
      const storeKey = ensurePanelKey(targetNoteId, targetPanelId)

      const panel = canvasItemsRef.current.find(item => {
        if (item.itemType !== "panel") return false
        if (key.includes("::")) {
          return item.storeKey === key
        }
        if (item.storeKey === storeKey) return true
        return item.panelId === targetPanelId
      })
      if (panel?.position) {
        return { ...panel.position }
      }

      const record = dataStore?.get(storeKey)
      if (record && typeof record === "object") {
        const candidates = [
          normalizePosition((record as any)?.position),
          normalizePosition((record as any)?.worldPosition),
          normalizePosition((record as any)?.mainPosition),
        ]
        for (const candidate of candidates) {
          if (candidate) {
            return { ...candidate }
          }
        }
      }

      if (!isPlainModeActive()) {
        const provider = UnifiedProvider.getInstance()
        const branchesMap = provider.getBranchesMap()
        const branch = branchesMap?.get(storeKey) ?? branchesMap?.get(key)
        if (branch?.position) {
          return { ...branch.position }
        }
      }

      if (targetPanelId === "main") {
        const workspacePosition = resolveWorkspacePosition(targetNoteId)
        if (workspacePosition && !isDefaultOffscreenPosition(workspacePosition)) {
          return { ...workspacePosition }
        }
      }

      if (typeof document === "undefined") {
        return null
      }

      const state = canvasStateRef.current
      const el = document.querySelector(`[data-store-key="${storeKey}"]`) as HTMLElement | null
      if (el) {
        const rect = el.getBoundingClientRect()
        const container = document.getElementById("canvas-container")
        const containerRect = container?.getBoundingClientRect()

        const screenX = rect.left + rect.width / 2 - (containerRect?.left ?? 0)
        const screenY = rect.top + rect.height / 2 - (containerRect?.top ?? 0)

        const worldX = (screenX - state.translateX) / state.zoom
        const worldY = (screenY - state.translateY) / state.zoom
        return { x: worldX, y: worldY }
      }

      return null
    },
    [canvasItemsRef, dataStore, noteId, resolveWorkspacePosition, isDefaultOffscreenPosition, canvasStateRef],
  )

  const centerOnPanel = useCallback(
    (storeKeyOrPanelId: string) => {
      const maxRetries = 10
      const retryDelay = 100
      let retryCount = 0

      const attemptCenter = () => {
        const position = resolvePanelPosition(storeKeyOrPanelId)
        if (!position) {
          if (retryCount < maxRetries) {
            retryCount += 1
            setTimeout(attemptCenter, retryDelay)
          } else {
            console.warn(`[Canvas] Panel '${storeKeyOrPanelId}' not found after ${maxRetries} retries`)
          }
          return
        }

        const state = canvasStateRef.current
        const doc = typeof document !== "undefined" ? document : null
        const selector = storeKeyOrPanelId.includes("::")
          ? `[data-store-key="${storeKeyOrPanelId}"]`
          : `[data-panel-id="${storeKeyOrPanelId}"]`
        const panelElement = doc ? (doc.querySelector(selector) as HTMLElement | null) : null
        const panelDimensions = panelElement
          ? { width: panelElement.offsetWidth, height: panelElement.offsetHeight }
          : { width: 500, height: 400 }

        const viewportDimensions =
          typeof window !== "undefined"
            ? { width: window.innerWidth, height: window.innerHeight }
            : { width: 0, height: 0 }

        const centerOffset = {
          x: viewportDimensions.width
            ? (viewportDimensions.width / 2 - panelDimensions.width / 2) / state.zoom
            : 0,
          y: viewportDimensions.height
            ? (viewportDimensions.height / 2 - panelDimensions.height / 2) / state.zoom
            : 0,
        }

        const targetX = -position.x + centerOffset.x
        const targetY = -position.y + centerOffset.y

        const canvasEl = doc ? doc.getElementById("infinite-canvas") : null
        if (canvasEl) {
          canvasEl.style.transition = "transform 2s ease-in-out"
          void canvasEl.offsetHeight
        }

        flushSync(() => {
          setCanvasState(prev => {
            const next = { ...prev, translateX: targetX, translateY: targetY }
            canvasStateRef.current = next
            return next
          })
        })

        dispatch({
          type: "SET_CANVAS_STATE",
          payload: {
            translateX: targetX,
            translateY: targetY,
          },
        })

        // Directional Scroll: Update origin to the new centered position
        // This allows users to pan left back to this new baseline
        const workspaceId = getActiveWorkspaceContext()
        if (workspaceId) {
          updateOrigin(workspaceId, targetX)
        }

        if (canvasEl) {
          setTimeout(() => {
            canvasEl.style.transition = ""
          }, 2100)
        }
      }

      attemptCenter()
    },
    [canvasStateRef, dispatch, resolvePanelPosition, setCanvasState],
  )

  return { resolvePanelPosition, centerOnPanel }
}
