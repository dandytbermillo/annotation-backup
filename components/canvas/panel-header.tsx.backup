"use client"

import { useCanvas } from "./canvas-context"
import type { Branch } from "@/types/canvas"

interface PanelHeaderProps {
  panelId: string
  branch: Branch
}

export function PanelHeader({ panelId, branch }: PanelHeaderProps) {
  const { dispatch, dataStore } = useCanvas()

  const handleClose = () => {
    // Update parent's branches list
    if (branch.parentId) {
      const parent = dataStore.get(branch.parentId)
      if (parent && parent.branches) {
        const updatedBranches = parent.branches.filter((id: string) => id !== panelId)
        dataStore.update(branch.parentId, { branches: updatedBranches })
      }
    }

    dispatch({
      type: "REMOVE_PANEL",
      payload: { id: panelId },
    })
  }

  return (
    <div
      className="panel-header relative bg-white/5 text-indigo-600 p-3 border-b border-indigo-200 text-sm font-semibold flex justify-between items-center cursor-grab select-none"
      style={{ userSelect: "none" }}
    >
      <span>{branch.title}</span>
      {panelId !== "main" && (
        <button
          className="panel-close bg-red-100 border border-red-300 text-red-500 w-6 h-6 rounded-full cursor-pointer text-sm flex items-center justify-center transition-all duration-200 hover:bg-red-200 hover:border-red-500 hover:scale-110"
          onClick={handleClose}
        >
          ×
        </button>
      )}
    </div>
  )
}
