"use client"

import React, { useCallback, useEffect } from "react"
import { useCanvas } from "./canvas-context"
import { v4 as uuidv4 } from "uuid"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { getPlainProvider } from "@/lib/provider-switcher"
import { createAnnotationBranch } from "@/lib/models/annotation"
import { buildBranchPreview } from "@/lib/utils/branch-preview"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { debugLog } from "@/lib/utils/debug-logger"
import { markPanelPersistencePending, markPanelPersistenceReady } from "@/lib/note-workspaces/state"

type AnnotationTriggerDetail = {
  type: "note" | "explore" | "promote"
  panelId?: string | null
  noteId?: string | null
}

export function AnnotationToolbar() {
  const { dispatch, state, dataStore, noteId } = useCanvas()
  const [overridePanelInfo, setOverridePanelInfo] = React.useState<{ panelId: string; noteId: string } | null>(null)

  // ✅ FIX 1: Store timeout handle in ref (persists across renders)
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null)

  // Listen for panel-specific annotation creation requests from Tools button
  useEffect(() => {
    const handleSetAnnotationPanel = (event: Event) => {
      // ✅ FIX 4: Guard detail BEFORE destructuring to prevent crashes
      const detail = (event as CustomEvent)?.detail ?? {}
      const { panelId, noteId } = detail as Partial<{
        panelId: string
        noteId: string
      }>

      // ✅ FIX 3: Guard against empty/null values
      if (!panelId || !noteId) {
        console.log('[AnnotationToolbar] Clearing override (empty/null event)')
        setOverridePanelInfo(null)
        // Clear timeout if exists
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        return
      }

      console.log('[AnnotationToolbar] Received set-annotation-panel event:', { panelId, noteId })
      setOverridePanelInfo({ panelId, noteId })

      // ✅ FIX 1: Cancel previous timeout
      if (timeoutRef.current) {
        console.log('[AnnotationToolbar] Cancelling previous timeout')
        clearTimeout(timeoutRef.current)
      }

      // ✅ FIX 1: Store new timeout handle
      timeoutRef.current = setTimeout(() => {
        console.log('[AnnotationToolbar] Timeout expired, clearing override')
        setOverridePanelInfo(null)
        timeoutRef.current = null
      }, 5000)
    }

    window.addEventListener('set-annotation-panel', handleSetAnnotationPanel)

    return () => {
      console.log('[AnnotationToolbar] Cleanup - removing listener and clearing timeout')
      window.removeEventListener('set-annotation-panel', handleSetAnnotationPanel)

      // ✅ FIX 2: Clear timeout on unmount
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [])

  const selectedText = state.selectedText
  const selectedRange = state.selectedRange
  const currentPanelId = state.currentPanel

  const createAnnotation = useCallback(
    (type: "note" | "explore" | "promote", override?: AnnotationTriggerDetail | null) => {
      const text = selectedText
      const overrideSource = override ?? overridePanelInfo
      const panel = overrideSource?.panelId || currentPanelId

      if (!text || !panel) {
        console.warn("No text selected or no panel available")
        return
      }

      let panelNoteId = overrideSource?.noteId || noteId

      if (!overrideSource) {
        dataStore.forEach((value: any, key: string) => {
          if (value && typeof value === "object" && "id" in value && value.id === panel) {
            if (key.includes("::")) {
              panelNoteId = key.split("::")[0]
            } else if ("noteId" in value && typeof value.noteId === "string") {
              panelNoteId = value.noteId
            }
          }
        })
      }

      console.log(
        "[AnnotationToolbar] Creating annotation with noteId:",
        panelNoteId,
        "for panel:",
        panel,
        "global noteId:",
        noteId,
        "override:",
        overrideSource,
      )

      if (!override && overridePanelInfo) {
        setOverridePanelInfo(null)
      }

      const annotationId = uuidv4()
      const branchId = `branch-${annotationId}`
      const plainProvider = getPlainProvider()
      const isPlainMode = !!plainProvider

      const calculateSmartPosition = () => {
        const parentStoreKey = ensurePanelKey(panelNoteId || "", panel)
        const currentPanel = document.querySelector(`[data-store-key="${parentStoreKey}"]`) as HTMLElement | null
        let parentPosition = { x: 2000, y: 1500 }

        if (currentPanel) {
          const rect = currentPanel.getBoundingClientRect()
          const panelWidth = rect.width || 800
          const gap = 50
          const style = window.getComputedStyle(currentPanel)
          const currentX = parseFloat(style.left) || 0
          const currentY = parseFloat(style.top) || 0
          parentPosition = { x: currentX + panelWidth + gap, y: currentY }
        }

        return parentPosition
      }

      const smartPosition = calculateSmartPosition()

      debugLog({
        component: "AnnotationToolbar",
        action: "calculate_smart_position",
        metadata: {
          parentPanel: panel,
          calculatedPosition: smartPosition,
          branchId,
          annotationType: type,
        },
      }).catch(() => {})

      const draftBranch = createAnnotationBranch(type, panel, panelNoteId || "", text, smartPosition)
      const initialPreview = buildBranchPreview(draftBranch.content, text)

      const branchData = {
        id: branchId,
        ...draftBranch,
        position: smartPosition,
        preview: initialPreview,
        branches: [],
        isEditable: true,
        metadata: { ...draftBranch.metadata, preview: initialPreview },
      }

      const branchStoreKey = ensurePanelKey(panelNoteId || "", branchId)
      const panelStoreKey = ensurePanelKey(panelNoteId || "", panel)
      dataStore.set(branchStoreKey, branchData)

      if (isPlainMode && plainProvider && panelNoteId) {
        plainProvider
          .createBranch({
            id: annotationId,
            noteId: panelNoteId,
            parentId: panel,
            type,
            title: draftBranch.title,
            originalText: text,
            metadata: {
              annotationType: type,
              annotationId,
              displayId: branchId,
              preview: initialPreview,
            },
            anchors: selectedRange
              ? {
                  start: selectedRange.startOffset,
                  end: selectedRange.endOffset,
                  context: text,
                }
              : undefined,
          })
          .then(() => plainProvider.saveDocument(panelNoteId, branchId, branchData.content, false, { skipBatching: true }))
          .catch((error) => {
            console.error("[AnnotationToolbar] Failed to create branch or persist initial content:", error)
          })

        const parentPanel = dataStore.get(panelStoreKey)
        if (parentPanel) {
          const branches = parentPanel.branches || []
          dataStore.update(panelStoreKey, { branches: [...branches, branchId] })
        }
      } else {
        const provider = UnifiedProvider.getInstance()
        if (panelNoteId) {
          provider.setCurrentNote(panelNoteId)
        }
        provider.addBranch(panel, branchId, branchData)
        const parentPanel = dataStore.get(panelStoreKey)
        if (parentPanel) {
          const currentBranches = provider.getBranches(panel)
          dataStore.update(panelStoreKey, { branches: currentBranches })
        }
      }

      const eventDetail = { type, annotationId, branchId, panelId: panel, text }
      document.querySelectorAll(".panel").forEach((element) => {
        if (element.querySelector(`[data-panel="${panel}"]`) || element.textContent?.includes(panel)) {
          element.dispatchEvent(
            new CustomEvent("insert-annotation", {
              detail: eventDetail,
              bubbles: true,
            }),
          )
        }
      })
      window.dispatchEvent(
        new CustomEvent("insert-annotation-global", {
          detail: eventDetail,
        }),
      )

      debugLog({
        component: "AnnotationToolbar",
        action: "dispatch_create_panel_event",
        metadata: { panelId: panel, branchId, noteId: panelNoteId, position: smartPosition },
      }).catch(() => {})
      // Signal persistence pending immediately (even before create-panel is handled)
      markPanelPersistencePending(panelNoteId, branchId)
      window.dispatchEvent(
        new CustomEvent("create-panel", {
          detail: {
            panelId: branchId,
            parentPanelId: panel,
            parentPosition: smartPosition,
            noteId: panelNoteId,
            coordinateSpace: "world",
          },
        }),
      )
      markPanelPersistenceReady(panelNoteId, branchId)

      dispatch({ type: "BRANCH_UPDATED" })
      document.getElementById("annotation-toolbar")?.classList.remove("visible")
      dispatch({ type: "SET_SELECTION", payload: { text: "", range: null, panel: null } })
      window.getSelection()?.removeAllRanges()
    },
    [selectedText, selectedRange, currentPanelId, overridePanelInfo, noteId, dataStore, dispatch],
  )

  useEffect(() => {
    const handleAnnotationTrigger = (event: Event) => {
      const detail = (event as CustomEvent<AnnotationTriggerDetail>).detail
      if (!detail?.type) return
      debugLog({
        component: "AnnotationToolbar",
        action: "external_trigger",
        metadata: {
          type: detail.type,
          panelId: detail.panelId ?? null,
          noteId: detail.noteId ?? null,
        },
      }).catch(() => {})
      createAnnotation(detail.type, detail)
    }
    window.addEventListener("annotation-toolbar-trigger" as any, handleAnnotationTrigger)
    return () => {
      window.removeEventListener("annotation-toolbar-trigger" as any, handleAnnotationTrigger)
    }
  }, [createAnnotation])

  return (
    <div
      id="annotation-toolbar"
      className="annotation-toolbar"
      onMouseEnter={() => {
        const toolbar = document.getElementById("annotation-toolbar")
        if (toolbar) {
          toolbar.style.opacity = "1"
          toolbar.style.pointerEvents = "auto"
          toolbar.classList.add("visible")
        }
      }}
      onMouseLeave={() => {
        setTimeout(() => {
          const toolbar = document.getElementById("annotation-toolbar")
          if (toolbar && !toolbar.matches(':hover')) {
            toolbar.style.opacity = "0"
            toolbar.style.pointerEvents = "none"
            toolbar.classList.remove("visible")
          }
        }, 300)
      }}
      style={{
        position: "fixed",
        background: "white",
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        padding: "8px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        display: "flex",
        gap: "8px",
        zIndex: 1000,
        opacity: 0,
        pointerEvents: "none",
        transform: "translateX(-50%) translateY(0)",
        transition: "opacity 0.2s ease, transform 0.2s ease",
      }}
    >
      <button
        onClick={() => createAnnotation('note')}
        className="annotation-btn note"
        title="Create Note"
        style={{
          background: "linear-gradient(135deg, #3498db 0%, #2980b9 100%)",
          color: "white",
          border: "none",
          borderRadius: "6px",
          padding: "8px 16px",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          transition: "transform 0.2s ease",
        }}
        onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
        onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
      >
        📝 Note
      </button>

      <button
        onClick={() => createAnnotation('explore')}
        className="annotation-btn explore"
        title="Create Exploration"
        style={{
          background: "linear-gradient(135deg, #f39c12 0%, #e67e22 100%)",
          color: "white",
          border: "none",
          borderRadius: "6px",
          padding: "8px 16px",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          transition: "transform 0.2s ease",
        }}
        onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
        onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
      >
        🔍 Explore
      </button>

      <button
        onClick={() => createAnnotation('promote')}
        className="annotation-btn promote"
        title="Create Promotion"
        style={{
          background: "linear-gradient(135deg, #27ae60 0%, #229954 100%)",
          color: "white",
          border: "none",
          borderRadius: "6px",
          padding: "8px 16px",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          transition: "transform 0.2s ease",
        }}
        onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
        onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
      >
        ⭐ Promote
      </button>

      <style jsx>{`
        .annotation-toolbar.visible {
          opacity: 1 !important;
          pointer-events: auto !important;
          transform: translateX(-50%) translateY(-10px) !important;
        }
      `}</style>
    </div>
  )
}
