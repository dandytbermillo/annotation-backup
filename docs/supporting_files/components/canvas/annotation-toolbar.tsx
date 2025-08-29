"use client"

import { useCanvas } from "./canvas-context"
import { v4 as uuidv4 } from "uuid"
import { CollaborationProvider } from "@/lib/yjs-provider"

export function AnnotationToolbar() {
  const { dispatch, state, dataStore, noteId } = useCanvas()

  const createAnnotation = (type: 'note' | 'explore' | 'promote') => {
    const text = state.selectedText
    const panel = state.currentPanel
    if (!text || !panel) return

    const annotationId = uuidv4()
    const branchId = `branch-${annotationId}`
    const branchData = {
      id: branchId,
      title: `${type.charAt(0).toUpperCase() + type.slice(1)} on "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`,
      content: `<p>Start writing your ${type} here...</p>`,
      type,
      parentId: panel,
      originalText: text,
      branches: [],
      position: { x: 0, y: 0 },
      isEditable: true,
    }

    dataStore.set(branchId, branchData)
    const provider = CollaborationProvider.getInstance()
    if (noteId) provider.setCurrentNote(noteId)
    provider.addBranch(panel, branchId, branchData)

    const parentPanel = dataStore.get(panel)
    if (parentPanel) {
      const currentBranches = provider.getBranches(panel)
      dataStore.update(panel, { branches: currentBranches })
    } else {
      dataStore.set(panel, { branches: provider.getBranches(panel), position: { x: 2000, y: 1500 } })
    }

    const branchesMap = provider.getBranchesMap()
    const parentBranch = branchesMap.get(panel) || dataStore.get(panel)
    if (!parentBranch || !parentBranch.position) {
      const defaultPosition = { x: 3000, y: 1500 }
      dataStore.update(branchId, { position: defaultPosition })
      const bd = branchesMap.get(branchId); if (bd) bd.position = defaultPosition
    } else {
      const currentBranches = provider.getBranches(panel)
      const siblingCount = currentBranches.length - 1
      const targetX = parentBranch.position.x + 900
      const targetY = parentBranch.position.y + siblingCount * 650
      dataStore.update(branchId, { position: { x: targetX, y: targetY } })
      const bd = branchesMap.get(branchId); if (bd) bd.position = { x: targetX, y: targetY }
    }

    const eventDetail = { type, annotationId, branchId, panelId: panel, text }
    document.querySelectorAll('.panel').forEach(element => {
      const panelContent = element.querySelector(`[data-panel="${panel}"]`)
      if (panelContent || element.textContent?.includes(panel)) {
        element.dispatchEvent(new CustomEvent('insert-annotation', { detail: eventDetail, bubbles: true }))
      }
    })
    window.dispatchEvent(new CustomEvent('insert-annotation-global', { detail: eventDetail }))
    window.dispatchEvent(new CustomEvent('create-panel', { detail: { panelId: branchId } }))

    dispatch({ type: "BRANCH_UPDATED" })
    const toolbar = document.getElementById("annotation-toolbar"); if (toolbar) toolbar.classList.remove("visible")
    dispatch({ type: "SET_SELECTION", payload: { text: "", range: null, panel: null } })
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div id="annotation-toolbar" className="annotation-toolbar" style={{ position: "fixed", background: "white", border: "1px solid #e0e0e0", borderRadius: "8px", padding: "8px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", display: "flex", gap: "8px", zIndex: 1000, opacity: 0, pointerEvents: "none", transform: "translateX(-50%) translateY(0)", transition: "opacity 0.2s ease, transform 0.2s ease" }}>
      <button onClick={() => createAnnotation('note')} className="annotation-btn note" title="Create Note" style={{ background: "linear-gradient(135deg, #3498db 0%, #2980b9 100%)", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "14px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px", transition: "transform 0.2s ease" }} onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"} onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}>📝 Note</button>
      <button onClick={() => createAnnotation('explore')} className="annotation-btn explore" title="Create Exploration" style={{ background: "linear-gradient(135deg, #f39c12 0%, #e67e22 100%)", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "14px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px", transition: "transform 0.2s ease" }} onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"} onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}>🔍 Explore</button>
      <button onClick={() => createAnnotation('promote')} className="annotation-btn promote" title="Create Promotion" style={{ background: "linear-gradient(135deg, #27ae60 0%, #229954 100%)", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "14px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px", transition: "transform 0.2s ease" }} onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"} onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}>⭐ Promote</button>
      <style jsx>{`.annotation-toolbar.visible{opacity:1 !important; pointer-events:auto !important; transform:translateX(-50%) translateY(-10px) !important;}`}</style>
    </div>
  )
}

