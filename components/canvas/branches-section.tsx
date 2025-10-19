"use client"

import { useCanvas } from "./canvas-context"
import type { Branch } from "@/types/canvas"
import { BranchItem } from "./branch-item"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { getPlainProvider } from "@/lib/provider-switcher"
import { useEffect, useState } from "react"
import type { CanvasState } from "@/types/canvas"
import type { DataStore } from "@/lib/data-store"
import { Pencil } from "lucide-react"
import { ensurePanelKey } from "@/lib/canvas/composite-id"

interface BranchesSectionProps {
  panelId: string
  branch: Branch
  // Optional props for standalone usage (outside canvas context)
  dataStore?: DataStore
  state?: CanvasState
  dispatch?: React.Dispatch<any>
  noteId?: string
}

export function BranchesSection({ panelId, branch, dataStore: propDataStore, state: propState, dispatch: propDispatch, noteId: propNoteId }: BranchesSectionProps) {
  // Try to use canvas context if available, otherwise use props
  const canvasContext = useCanvas ? (() => { try { return useCanvas() } catch { return null } })() : null
  const state = propState || canvasContext?.state
  const dispatch = propDispatch || canvasContext?.dispatch
  const dataStore = propDataStore || canvasContext?.dataStore
  const noteId = propNoteId || canvasContext?.noteId || ''

  const [, forceUpdate] = useState({})
  const [editMode, setEditMode] = useState(false)

  const activeFilter = state?.branchFilters?.get(panelId) || "all"

  // Force re-render when state updates
  useEffect(() => {
    forceUpdate({})
  }, [state?.lastUpdate])

  const handleFilterChange = (filterType: string) => {
    if (dispatch) {
      dispatch({
        type: "SET_FILTER",
        payload: { panelId, filterType },
      })
    }
  }

  const showHelpMessage = () => {
    alert(`To create new branches:
1. Select any text in the editor
2. Choose annotation type from the toolbar
3. New panel will appear beside this one

Filter branches:
• Click All/Note/Explore/Promote to filter displayed branches
• "All" shows all branch types (default)
• Individual type buttons show only that type

Features:
• Smooth workflow curves with visual effects
• Dynamic bezier curves that adapt to panel positions
• Color-coded connection types (note, explore, promote)
• Drag panels by their headers to reposition them`)
  }

  const getFilteredBranches = () => {
    if (!dataStore) return []

    // Check if we're in plain mode
    const plainProvider = getPlainProvider()
    const isPlainMode = !!plainProvider

    let currentBranch
    let branchesMap

    if (isPlainMode) {
      // Plain mode: Get data from dataStore
      const panelStoreKey = ensurePanelKey(noteId, panelId)
      currentBranch = dataStore.get(panelStoreKey) || branch
      branchesMap = dataStore
    } else {
      // Yjs mode: Get branch data from UnifiedProvider
      const provider = UnifiedProvider.getInstance()
      branchesMap = provider.getBranchesMap()
      const panelStoreKey = ensurePanelKey(noteId, panelId)
      currentBranch = branchesMap.get(panelStoreKey) || dataStore.get(panelStoreKey) || branch
    }

    if (!currentBranch.branches || currentBranch.branches.length === 0) return []

    const filtered = currentBranch.branches.filter((branchId: string) => {
      if (activeFilter === "all") return true
      const branchStoreKey = ensurePanelKey(noteId, branchId)
      const childBranch = branchesMap.get(branchStoreKey) || dataStore.get(branchStoreKey)
      return childBranch && childBranch.type === activeFilter
    })

    return filtered
  }

  const filteredBranches = getFilteredBranches()

  return (
    <div
      data-branches-panel="true"
      style={{
        flex: "1 1 0%",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        padding: "20px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        minWidth: "300px",
      }}
    >
      <div
        style={{
          color: "white",
          fontSize: "16px",
          fontWeight: 600,
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          userSelect: "none",
        }}
      >
        📚 Branches
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <button
            onClick={() => setEditMode(!editMode)}
            style={{
              background: editMode ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.2)",
              color: "white",
              border: editMode ? "1px solid rgba(255,255,255,0.5)" : "1px solid rgba(255,255,255,0.3)",
              padding: "6px 10px",
              borderRadius: "16px",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 500,
              transition: "all 0.3s ease",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
            onMouseEnter={(e) => {
              const target = e.currentTarget
              target.style.background = "rgba(255,255,255,0.3)"
              target.style.transform = "translateY(-1px)"
            }}
            onMouseLeave={(e) => {
              const target = e.currentTarget
              target.style.background = editMode ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.2)"
              target.style.transform = "translateY(0)"
            }}
            title={editMode ? "Exit edit mode" : "Enter edit mode"}
          >
            <Pencil style={{ width: "14px", height: "14px" }} />
            {editMode ? "Done" : "Edit"}
          </button>
          <button
            onClick={showHelpMessage}
            style={{
              background: "rgba(255,255,255,0.2)",
              color: "white",
              border: "1px solid rgba(255,255,255,0.3)",
              padding: "6px 12px",
              borderRadius: "16px",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 500,
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => {
              const target = e.target as HTMLElement
              target.style.background = "rgba(255,255,255,0.3)"
              target.style.transform = "translateY(-1px)"
            }}
            onMouseLeave={(e) => {
              const target = e.target as HTMLElement
              target.style.background = "rgba(255,255,255,0.2)"
              target.style.transform = "translateY(0)"
            }}
          >
            + Add
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: "6px",
          marginBottom: "16px",
          background: "rgba(255,255,255,0.1)",
          padding: "4px",
          borderRadius: "8px",
        }}
      >
        {["all", "note", "explore", "promote"].map((filterType) => (
          <button
            key={filterType}
            onClick={() => handleFilterChange(filterType)}
            style={{
              background: activeFilter === filterType ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.15)",
              color: "white",
              border:
                activeFilter === filterType ? "1px solid rgba(255,255,255,0.5)" : "1px solid rgba(255,255,255,0.2)",
              padding: "6px 12px",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 500,
              transition: "all 0.3s ease",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              boxShadow: activeFilter === filterType ? "0 2px 8px rgba(0,0,0,0.2)" : "none",
            }}
            onMouseEnter={(e) => {
              if (activeFilter !== filterType) {
                const target = e.target as HTMLElement
                target.style.background = "rgba(255,255,255,0.25)"
                target.style.transform = "translateY(-1px)"
              }
            }}
            onMouseLeave={(e) => {
              if (activeFilter !== filterType) {
                const target = e.target as HTMLElement
                target.style.background = "rgba(255,255,255,0.15)"
                target.style.transform = "translateY(0)"
              }
            }}
          >
            {filterType}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }}>
        {filteredBranches.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              color: "rgba(255,255,255,0.6)",
              fontStyle: "italic",
              padding: "40px 20px",
              fontSize: "14px",
              whiteSpace: "pre-line",
            }}
          >
            {branch.branches?.length === 0
              ? "No branches yet.\nSelect text to create annotations!"
              : `No ${activeFilter} branches found.\nTry selecting "All" or create new ${activeFilter} annotations!`}
          </div>
        ) : (
          filteredBranches.map((branchId: string) => (
            <BranchItem
              key={branchId}
              branchId={branchId}
              parentId={panelId}
              dataStore={dataStore}
              state={state}
              dispatch={dispatch}
              editMode={editMode}
              noteId={noteId}
            />
          ))
        )}
      </div>
    </div>
  )
}
