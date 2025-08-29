"use client"

import { useCanvas } from "./canvas-context"
import { v4 as uuidv4 } from "uuid"
import { CollaborationProvider } from "@/lib/yjs-provider"
import { getPlainProvider } from "@/lib/provider-switcher"
import { createAnnotationBranch } from "@/lib/models/annotation"

export function AnnotationToolbar() {
  const { dispatch, state, dataStore, noteId } = useCanvas()

  const createAnnotation = (type: 'note' | 'explore' | 'promote') => {
    const text = state.selectedText
    const panel = state.currentPanel
    
    if (!text || !panel) {
      console.warn('No text selected or no panel available')
      return
    }

    // Generate unique IDs
    const annotationId = uuidv4()
    const branchId = `branch-${annotationId}`

    // Check if we're in plain mode
    const plainProvider = getPlainProvider()
    const isPlainMode = !!plainProvider
    
    // Create the branch data with proper quoted content
    const branchData = {
      id: branchId,
      ...createAnnotationBranch(type, panel, noteId || '', text, { x: 0, y: 0 }),
      branches: [],
      isEditable: true,
    }

    // Add the branch to data store
    dataStore.set(branchId, branchData)
    
    if (isPlainMode && plainProvider && noteId) {
      // Plain mode: Create annotation in database
      plainProvider.createBranch({
        id: branchId,
        noteId: noteId,
        parentId: panel,
        type: type,
        originalText: text,
        metadata: {
          annotationType: type,
          annotationId: annotationId
        },
        anchors: state.selectedRange ? {
          start: state.selectedRange.startOffset,
          end: state.selectedRange.endOffset,
          context: text
        } : undefined
      }).catch(error => {
        console.error('[AnnotationToolbar] Failed to create branch:', error)
      })
      
      // Update parent's branches list
      const parentPanel = dataStore.get(panel)
      if (parentPanel) {
        const branches = parentPanel.branches || []
        dataStore.update(panel, { branches: [...branches, branchId] })
      }
    } else {
      // Yjs mode: Use collaboration provider
      const provider = CollaborationProvider.getInstance()
      if (noteId) {
        provider.setCurrentNote(noteId)
      }
      
      // Use the new addBranch method that handles YJS native types properly
      provider.addBranch(panel, branchId, branchData)
      
      // Update DataStore for backward compatibility
      const parentPanel = dataStore.get(panel)
      if (parentPanel) {
        // Get current branches using the new YJS method (this will be consistent)
        const currentBranches = provider.getBranches(panel)
        dataStore.update(panel, { branches: currentBranches })
      } else {
        // If parent doesn't exist in dataStore, create minimal entry
        dataStore.set(panel, { 
          branches: provider.getBranches(panel),
          position: { x: 2000, y: 1500 } // Default position
        })
      }
    }

    // Calculate position for new panel
    const branchesMap = isPlainMode ? new Map() : CollaborationProvider.getInstance().getBranchesMap()
    const parentBranch = branchesMap.get(panel) || dataStore.get(panel)
    
    if (!parentBranch || !parentBranch.position) {
      console.warn(`Parent branch ${panel} not found or has no position`)
      // Use default position if parent not found
      const defaultPosition = { x: 3000, y: 1500 }
      dataStore.update(branchId, { position: defaultPosition })
      const branchData = branchesMap.get(branchId)
      if (branchData) {
        branchData.position = defaultPosition
      }
    } else {
      // Count siblings
      const currentBranches = isPlainMode 
        ? (dataStore.get(panel)?.branches || [])
        : CollaborationProvider.getInstance().getBranches(panel)
      const siblingCount = currentBranches.length - 1 // Subtract 1 because we just added this branch

      const targetX = parentBranch.position.x + 900 // PANEL_SPACING_X
      const targetY = parentBranch.position.y + siblingCount * 650 // PANEL_SPACING_Y

      // Update position in both stores
      dataStore.update(branchId, {
        position: { x: targetX, y: targetY },
      })
      const branchData = branchesMap.get(branchId)
      if (branchData) {
        branchData.position = { x: targetX, y: targetY }
      }
    }

    // Dispatch both panel-specific and global events for annotation insertion
    const eventDetail = {
      type,
      annotationId,
      branchId,
      panelId: panel,
      text,
    }

    // Try panel-specific event first
    const panelElements = document.querySelectorAll('.panel')
    panelElements.forEach(element => {
      // Check if this is the correct panel by looking for the panel ID in the content
      const panelContent = element.querySelector(`[data-panel="${panel}"]`)
      if (panelContent || element.textContent?.includes(panel)) {
        element.dispatchEvent(new CustomEvent('insert-annotation', { 
          detail: eventDetail,
          bubbles: true 
        }))
      }
    })

    // Also dispatch global event as fallback
    window.dispatchEvent(new CustomEvent('insert-annotation-global', { 
      detail: eventDetail 
    }))

    // Create the panel for the new branch
    window.dispatchEvent(new CustomEvent('create-panel', { 
      detail: { panelId: branchId } 
    }))

    // Force a re-render by triggering branch updated action
    dispatch({ type: "BRANCH_UPDATED" })

    // Hide the toolbar after creating annotation
    const toolbar = document.getElementById("annotation-toolbar")
    if (toolbar) {
      toolbar.classList.remove("visible")
    }

    // Clear selection
    dispatch({ type: "SET_SELECTION", payload: { text: "", range: null, panel: null } })
    
    // Clear browser text selection
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div
      id="annotation-toolbar"
      className="annotation-toolbar"
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
