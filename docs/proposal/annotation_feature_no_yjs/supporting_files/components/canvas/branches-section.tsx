"use client"

import { useCanvas } from "./canvas-context"
import type { Branch } from "@/types/canvas"
import { BranchItem } from "./branch-item"
import { CollaborationProvider } from "@/lib/yjs-provider"
import { useEffect, useState } from "react"

interface BranchesSectionProps { panelId: string; branch: Branch }

export function BranchesSection({ panelId, branch }: BranchesSectionProps) {
  const { state, dispatch, dataStore } = useCanvas()
  const [, forceUpdate] = useState({})
  const activeFilter = state.branchFilters.get(panelId) || "all"

  useEffect(() => { forceUpdate({}) }, [state.lastUpdate])
  const handleFilterChange = (filterType: string) => { dispatch({ type: "SET_FILTER", payload: { panelId, filterType } }) }

  const getFilteredBranches = () => {
    const provider = CollaborationProvider.getInstance()
    const branchesMap = provider.getBranchesMap()
    const currentBranch = branchesMap.get(panelId) || dataStore.get(panelId) || branch
    if (!currentBranch.branches || currentBranch.branches.length === 0) return []
    return currentBranch.branches.filter((branchId: string) => {
      if (activeFilter === "all") return true
      const childBranch = branchesMap.get(branchId) || dataStore.get(branchId)
      return childBranch && childBranch.type === activeFilter
    })
  }
  const filteredBranches = getFilteredBranches()

  return (
    <div style={{ flex: "1 1 0%", background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", minWidth: "300px" }}>
      <div style={{ color: "white", fontSize: "16px", fontWeight: 600, marginBottom: "20px", display: "flex", alignItems: "center", gap: "8px", userSelect: "none" }}>📚 Branches</div>
      <div style={{ display: "flex", gap: "6px", marginBottom: "16px", background: "rgba(255,255,255,0.1)", padding: "4px", borderRadius: "8px" }}>
        {["all", "note", "explore", "promote"].map((filterType) => (
          <button key={filterType} onClick={() => handleFilterChange(filterType)} style={{ background: activeFilter === filterType ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.15)", color: "white", border: activeFilter === filterType ? "1px solid rgba(255,255,255,0.5)" : "1px solid rgba(255,255,255,0.2)", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "11px", fontWeight: 500, transition: "all 0.3s ease", textTransform: "uppercase", letterSpacing: "0.5px", boxShadow: activeFilter === filterType ? "0 2px 8px rgba(0,0,0,0.2)" : "none" }}>{filterType}</button>
        ))}
      </div>
      <div style={{ flex: 1 }}>
        {filteredBranches.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.6)", fontStyle: "italic", padding: "40px 20px", fontSize: "14px", whiteSpace: "pre-line" }}>{branch.branches?.length === 0 ? "No branches yet.\nSelect text to create annotations!" : `No ${activeFilter} branches found.\nTry selecting "All" or create new ${activeFilter} annotations!`}</div>
        ) : (
          filteredBranches.map((branchId: string) => <BranchItem key={branchId} branchId={branchId} parentId={panelId} />)
        )}
      </div>
    </div>
  )
}

