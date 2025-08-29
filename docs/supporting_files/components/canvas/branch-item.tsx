"use client"

import { useCanvas } from "./canvas-context"
import { CollaborationProvider } from "@/lib/yjs-provider"

interface BranchItemProps { branchId: string; parentId: string }

export function BranchItem({ branchId, parentId }: BranchItemProps) {
  const { dataStore, dispatch, state } = useCanvas()
  const provider = CollaborationProvider.getInstance()
  const branchesMap = provider.getBranchesMap()
  const branch = branchesMap.get(branchId) || dataStore.get(branchId)
  if (!branch) return null

  const getTypeIcon = (type: string) => ({ note: "📝", explore: "🔍", promote: "⭐", main: "📄" } as const)[type as any] || "📝"

  const handleClick = () => {
    if (state.panels.has(branchId)) {
      const panel = state.panels.get(branchId)
      if (panel?.element) { panel.element.style.zIndex = String(state.panelZIndex + 1); dispatch({ type: "UPDATE_PANEL_Z_INDEX", payload: state.panelZIndex + 1 }) }
      return
    }
    const parentBranch = branchesMap.get(parentId) || dataStore.get(parentId)
    if (!parentBranch) return
    const allSiblings = provider.getBranches(parentId)
    const siblingCount = allSiblings.length
    const targetX = parentBranch.position.x + 900
    const targetY = parentBranch.position.y + siblingCount * 650
    dataStore.update(branchId, { position: { x: targetX, y: targetY } })
    const branchData = branchesMap.get(branchId)
    if (branchData) { branchData.position = { x: targetX, y: targetY }; branchesMap.set(branchId, branchData) }
    dispatch({ type: "ADD_PANEL", payload: { id: branchId, panel: { element: null, branchId } } })
    window.dispatchEvent(new CustomEvent('create-panel', { detail: { panelId: branchId }, bubbles: true }))
  }

  const preview = branch.content.replace(/<[^>]*>/g, "").substring(0, 100) + "..."
  const borderColors = { note: "border-l-blue-400", explore: "border-l-orange-400", promote: "border-l-green-400" } as const

  return (
    <div className={`branch-item bg-white/15 backdrop-blur-sm rounded-lg p-4 mb-3 cursor-pointer transition-all duration-300 border-l-4 border-white/50 hover:bg-white/25 hover:translate-x-1 select-none ${borderColors[branch.type as keyof typeof borderColors] || "border-l-white/50"}`} onClick={handleClick}>
      <div className="branch-name text-white font-semibold text-xs mb-1.5 flex items-center gap-1.5">{getTypeIcon(branch.type)} {branch.title}</div>
      <div className="branch-preview text-white/85 text-xs leading-relaxed">{preview}</div>
    </div>
  )
}

