"use client"

import React from "react"
import { useCanvas } from "./canvas-context"
import { v4 as uuidv4 } from "uuid"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { getPlainProvider } from "@/lib/provider-switcher"
import { createAnnotationBranch } from "@/lib/models/annotation"
import { buildBranchPreview } from "@/lib/utils/branch-preview"
import { ensurePanelKey } from "@/lib/canvas/composite-id"

export function AnnotationToolbar() {
  const { dispatch, state, dataStore, noteId } = useCanvas()
  const [overridePanelInfo, setOverridePanelInfo] = React.useState<{ panelId: string; noteId: string } | null>(null)

  // Listen for panel-specific annotation creation requests from Tools button
  React.useEffect(() => {
    const handleSetAnnotationPanel = (event: Event) => {
      const customEvent = event as CustomEvent
      const { panelId, noteId } = customEvent.detail
      console.log('[AnnotationToolbar] Received set-annotation-panel event:', { panelId, noteId })
      setOverridePanelInfo({ panelId, noteId })

      // Clear the override after 5 seconds (in case button isn't clicked)
      setTimeout(() => setOverridePanelInfo(null), 5000)
    }

    window.addEventListener('set-annotation-panel', handleSetAnnotationPanel)
    return () => window.removeEventListener('set-annotation-panel', handleSetAnnotationPanel)
  }, [])

  const createAnnotation = (type: 'note' | 'explore' | 'promote') => {
    const text = state.selectedText
    const panel = overridePanelInfo?.panelId || state.currentPanel

    if (!text || !panel) {
      console.warn('No text selected or no panel available')
      return
    }

    // Use override noteId if available (from Tools button), otherwise extract from dataStore
    let panelNoteId = overridePanelInfo?.noteId || noteId

    // If no override, try to get noteId from dataStore
    if (!overridePanelInfo) {
      dataStore.forEach((value: any, key: string) => {
        if (value && typeof value === 'object' && 'id' in value) {
          // Check if this is the current panel by comparing panel IDs
          if (value.id === panel) {
            // Extract noteId from composite key (format: "noteId::panelId")
            if (key.includes('::')) {
              panelNoteId = key.split('::')[0]
              console.log('[AnnotationToolbar] Found panel noteId from composite key:', panelNoteId, 'for panel:', panel)
            } else if ('noteId' in value && typeof value.noteId === 'string') {
              // Or get it from panel data if stored directly
              panelNoteId = value.noteId
              console.log('[AnnotationToolbar] Found panel noteId from panel data:', panelNoteId, 'for panel:', panel)
            }
          }
        }
      })
    }

    console.log('[AnnotationToolbar] Creating annotation with noteId:', panelNoteId, 'for panel:', panel, 'global noteId:', noteId, 'override:', overridePanelInfo)

    // Clear the override after using it
    if (overridePanelInfo) {
      setOverridePanelInfo(null)
    }

    // Generate unique IDs
    const annotationId = uuidv4()
    const branchId = `branch-${annotationId}`

    // Check if we're in plain mode
    const plainProvider = getPlainProvider()
    const isPlainMode = !!plainProvider

    // Calculate smart position FIRST before creating branch data
    const calculateSmartPosition = () => {
      const currentPanel = document.querySelector(`[data-panel-id="${panel}"]`) as HTMLElement
      let parentPosition = { x: 2000, y: 1500 }
      
      // Debug: Check if panel was found
      if (!currentPanel) {
        fetch('/api/debug/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            component: 'AnnotationToolbar',
            action: 'panel_not_found',
            metadata: {
              parentPanel: panel,
              selector: `[data-panel-id="${panel}"]`,
              availablePanels: Array.from(document.querySelectorAll('[data-panel-id]')).map(el => el.getAttribute('data-panel-id'))
            },
            content_preview: `Parent panel ${panel} not found in DOM`,
            note_id: panelNoteId
          })
        }).catch(console.error)
      }
      
      if (currentPanel) {
        const rect = currentPanel.getBoundingClientRect()
        const panelWidth = rect.width || 800
        const gap = 50
        
        const style = window.getComputedStyle(currentPanel)
        
        // Panels use absolute positioning with left/top, not transforms
        const leftStr = style.left
        const topStr = style.top
        const currentX = parseFloat(leftStr) || 0
        const currentY = parseFloat(topStr) || 0
        
        // Debug: Log position
        fetch('/api/debug/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            component: 'AnnotationToolbar',
            action: 'panel_position',
            metadata: {
              parentPanel: panel,
              left: leftStr,
              top: topStr,
              currentX: currentX,
              currentY: currentY,
              rect: { width: rect.width, height: rect.height }
            },
            content_preview: `Panel ${panel} at x=${currentX}, y=${currentY}`,
            note_id: panelNoteId
          })
        }).catch(console.error)
        
        if (currentX || currentY) {
          // Position calculation remains the same
          
          const allPanels = document.querySelectorAll('[data-panel-id]')
          let rightOccupied = false
          let leftOccupied = false
          
          allPanels.forEach((panel) => {
            if (panel === currentPanel) return
            
            const panelStyle = window.getComputedStyle(panel)
            const panelLeft = parseFloat(panelStyle.left) || 0
            const panelX = panelLeft
            
            if (panelX > currentX + panelWidth && 
                panelX < currentX + panelWidth + gap + 100) {
              rightOccupied = true
            }
            
            if (panelX < currentX - gap && 
                panelX > currentX - panelWidth - gap - 100) {
              leftOccupied = true
            }
          })
          
          let placeOnLeft = false
          
          if (!rightOccupied && !leftOccupied) {
            // Prefer right side by default (same as branch list behavior)
            // Only use left if panel is already far to the right
            placeOnLeft = currentX > 2500
          } else if (rightOccupied && !leftOccupied) {
            placeOnLeft = true
          } else if (!rightOccupied && leftOccupied) {
            placeOnLeft = false
          } else {
            placeOnLeft = false
            parentPosition.y = currentY + 100
          }
          
          parentPosition = {
            x: placeOnLeft 
              ? currentX - panelWidth - gap
              : currentX + panelWidth + gap,
            y: parentPosition.y || currentY
          }
        }
      }
      
      return parentPosition
    }
    
    const smartPosition = calculateSmartPosition()
    
    // Log to debug_logs table
    fetch('/api/debug/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        component: 'AnnotationToolbar',
        action: 'calculate_smart_position',
        metadata: {
          parentPanel: panel,
          calculatedPosition: smartPosition,
          branchId: branchId,
          annotationType: type
        },
        content_preview: `Position for ${type} annotation: x=${smartPosition.x}, y=${smartPosition.y}`,
        note_id: panelNoteId
      })
    }).catch(console.error)

    // Create the branch data with proper quoted content AND position
    const draftBranch = createAnnotationBranch(type, panel, panelNoteId || '', text, smartPosition)
    const initialPreview = buildBranchPreview(draftBranch.content, text)

    const branchData = {
      id: branchId,
      ...draftBranch,
      position: smartPosition, // Include position in branch data
      preview: initialPreview,
      branches: [],
      isEditable: true,
      metadata: {
        ...draftBranch.metadata,
        preview: initialPreview,
      },
    }

    // Add the branch to data store with position already set
    const branchStoreKey = ensurePanelKey(panelNoteId || '', branchId)
    const panelStoreKey = ensurePanelKey(panelNoteId || '', panel)
    dataStore.set(branchStoreKey, branchData)

    if (isPlainMode && plainProvider && panelNoteId) {
      // Plain mode: Create annotation in database
      // Use raw UUID for database ID, but keep branch-xxx format for UI
      plainProvider.createBranch({
        id: annotationId, // Use raw UUID for database
        noteId: panelNoteId,
        parentId: panel,  // Keep as-is: 'main', 'branch-xxx', or UUID
        type: type,
        title: draftBranch.title, // Persist title to database immediately
        originalText: text,
        metadata: {
          annotationType: type,
          annotationId: annotationId,
          displayId: branchId, // Store the UI ID in metadata
          preview: initialPreview,
        },
        anchors: state.selectedRange ? {
          start: state.selectedRange.startOffset,
          end: state.selectedRange.endOffset,
          context: text
        } : undefined
      }).then(() => {
        return plainProvider.saveDocument(panelNoteId!, branchId, branchData.content, false, { skipBatching: true })
      }).catch(error => {
        console.error('[AnnotationToolbar] Failed to create branch or persist initial content:', error)
      })

     // Update parent's branches list
     const parentPanel = dataStore.get(panelStoreKey)
     if (parentPanel) {
        const branches = parentPanel.branches || []
        const newBranches = [...branches, branchId]
        dataStore.update(panelStoreKey, { branches: newBranches })
      }
    } else {
      // Yjs mode: Use UnifiedProvider (collab)
      const provider = UnifiedProvider.getInstance()
      if (panelNoteId) {
        provider.setCurrentNote(panelNoteId)
      }

      // Use the new addBranch method that handles YJS native types properly
      provider.addBranch(panel, branchId, branchData)

      // Update DataStore for backward compatibility
      const parentPanel = dataStore.get(panelStoreKey)
      if (parentPanel) {
        // Get current branches using the new YJS method (this will be consistent)
        const currentBranches = provider.getBranches(panel)
        dataStore.update(panelStoreKey, { branches: currentBranches })
      } else {
        // If parent doesn't exist in dataStore, create minimal entry
        dataStore.set(panelStoreKey, {
          branches: provider.getBranches(panel),
          position: { x: 2000, y: 1500 } // Default position
        })
      }
    }

    // Position is already set in branchData, no need to calculate again

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

    // Create the panel for the new branch with smart position
    window.dispatchEvent(new CustomEvent('create-panel', {
      detail: {
        panelId: branchId,
        parentPanelId: panel,
        parentPosition: smartPosition,
        noteId: panelNoteId
      }
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
