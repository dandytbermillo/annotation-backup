"use client"

import { useCanvas } from "./canvas-context"
import { CollaborationProvider } from "@/lib/yjs-provider"
import { getPlainProvider } from "@/lib/provider-switcher"

interface BranchItemProps {
  branchId: string
  parentId: string
}

export function BranchItem({ branchId, parentId }: BranchItemProps) {
  const { dataStore, dispatch, state } = useCanvas()
  
  // Check if we're in plain mode
  const plainProvider = getPlainProvider()
  const isPlainMode = !!plainProvider
  
  // Get branch data based on mode
  let branch
  let branchesMap
  
  if (isPlainMode) {
    // Plain mode: Get from dataStore
    branch = dataStore.get(branchId)
    branchesMap = dataStore
  } else {
    // Yjs mode: Get from CollaborationProvider
    const provider = CollaborationProvider.getInstance()
    branchesMap = provider.getBranchesMap()
    branch = branchesMap.get(branchId) || dataStore.get(branchId)
  }

  if (!branch) return null

  const getTypeIcon = (type: string) => {
    const icons = { note: "📝", explore: "🔍", promote: "⭐", main: "📄" }
    return icons[type as keyof typeof icons] || "📝"
  }

  const handleClick = () => {
    console.log(`BranchItem clicked: ${branchId}`)
    
    // Check if panel already exists
    if (state.panels.has(branchId)) {
      console.log(`Panel ${branchId} already exists, focusing it`)
      // Panel exists, just focus it
      const panel = state.panels.get(branchId)
      if (panel?.element) {
        panel.element.style.zIndex = String(state.panelZIndex + 1)
        dispatch({
          type: "UPDATE_PANEL_Z_INDEX",
          payload: state.panelZIndex + 1,
        })
      }
      return
    }

    console.log(`Creating new panel for branch ${branchId}`)
    
    // Calculate position for new panel
    const parentBranch = branchesMap.get(parentId) || dataStore.get(parentId)
    if (!parentBranch) {
      console.error(`Parent branch ${parentId} not found`)
      return
    }
    
    // Get sibling count based on mode
    let siblingCount
    if (isPlainMode) {
      const parent = dataStore.get(parentId)
      const siblings = parent?.branches || []
      siblingCount = siblings.length
    } else {
      // Use YJS native types to get the accurate sibling count
      const provider = CollaborationProvider.getInstance()
      const allSiblings = provider.getBranches(parentId)
      siblingCount = allSiblings.length
    }

    const targetX = parentBranch.position.x + 900 // PANEL_SPACING_X
    const targetY = parentBranch.position.y + siblingCount * 650 // PANEL_SPACING_Y

    // Update position in both stores
    dataStore.update(branchId, {
      position: { x: targetX, y: targetY },
    })
    
    const branchData = branchesMap.get(branchId)
    if (branchData) {
      branchData.position = { x: targetX, y: targetY }
      branchesMap.set(branchId, branchData)
    }

    // Add panel
    dispatch({
      type: "ADD_PANEL",
      payload: {
        id: branchId,
        panel: { element: null, branchId },
      },
    })
    
    // Also dispatch create-panel event for modern canvas
    window.dispatchEvent(new CustomEvent('create-panel', { 
      detail: { panelId: branchId },
      bubbles: true
    }))
  }

  const preview = branch.content.replace(/<[^>]*>/g, "").substring(0, 100) + "..."

  const borderColors = {
    note: "border-l-blue-400",
    explore: "border-l-orange-400",
    promote: "border-l-green-400",
  }

  return (
    <div
      className={`branch-item bg-white/15 backdrop-blur-sm rounded-lg p-4 mb-3 cursor-pointer transition-all duration-300 border-l-4 border-white/50 hover:bg-white/25 hover:translate-x-1 select-none ${
        borderColors[branch.type as keyof typeof borderColors] || "border-l-white/50"
      }`}
      onClick={handleClick}
    >
      <div className="branch-name text-white font-semibold text-xs mb-1.5 flex items-center gap-1.5">
        {getTypeIcon(branch.type)} {branch.title}
      </div>
      <div className="branch-preview text-white/85 text-xs leading-relaxed">{preview}</div>
    </div>
  )
}
