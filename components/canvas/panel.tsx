"use client"

import { useRef } from "react"
import { useCanvas } from "./canvas-context"
import { buildBranchPreview } from "@/lib/utils/branch-preview"
import { usePanelDragging } from "@/hooks/use-panel-dragging"

interface PanelProps {
  panelId: string
  panelData: any
}

export function Panel({ panelId, panelData }: PanelProps) {
  const { dataStore, dispatch, state } = useCanvas()
  const panelRef = useRef<HTMLDivElement>(null)
  const branch = dataStore.get(panelId)

  usePanelDragging(panelRef, panelId)

  if (!branch) return null

  const handleMouseDown = () => {
    dispatch({
      type: "UPDATE_PANEL_Z_INDEX",
      payload: state.panelZIndex + 1,
    })

    if (panelRef.current) {
      panelRef.current.style.zIndex = String(state.panelZIndex + 1)
    }
  }

  const handleClose = () => {
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

  const showHelpMessage = () => {
    alert(`To create new branches:
1. Select any text in the editor
2. Choose annotation type from the toolbar
3. New panel will appear beside this one`)
  }

  const activeFilter = state.branchFilters.get(panelId) || "all"

  const handleFilterChange = (filterType: string) => {
    dispatch({
      type: "SET_FILTER",
      payload: { panelId, filterType },
    })
  }

  const getFilteredBranches = () => {
    if (!branch.branches || branch.branches.length === 0) return []

    return branch.branches.filter((branchId) => {
      if (activeFilter === "all") return true
      const childBranch = dataStore.get(branchId)
      return childBranch && childBranch.type === activeFilter
    })
  }

  const filteredBranches = getFilteredBranches()

  const openBranch = (branchId: string) => {
    if (state.panels.has(branchId)) {
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

    const parentBranch = dataStore.get(panelId)
    const siblingCount = Array.from(state.panels.keys()).filter((id) => {
      const branch = dataStore.get(id)
      return branch?.parentId === panelId
    }).length

    const targetX = parentBranch.position.x + 900
    const targetY = parentBranch.position.y + siblingCount * 650

    dataStore.update(branchId, {
      position: { x: targetX, y: targetY },
    })

    dispatch({
      type: "ADD_PANEL",
      payload: {
        id: branchId,
        panel: { element: null, branchId },
      },
    })
  }

  const getTypeIcon = (type: string) => {
    const icons = { note: "📝", explore: "🔍", promote: "⭐", main: "📄" }
    return icons[type as keyof typeof icons] || "📝"
  }

  const isEditable = branch.isEditable !== false

  return (
    <div
      ref={panelRef}
      style={{
        position: "absolute",
        width: "800px",
        height: "600px",
        left: branch.position.x + "px",
        top: branch.position.y + "px",
        background: "white",
        borderRadius: "12px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        border: `2px solid ${branch.type === "main" ? "#667eea" : branch.type === "note" ? "#2196f3" : branch.type === "explore" ? "#ff9800" : "#4caf50"}`,
        zIndex: state.panelZIndex,
        transition: "all 0.3s ease",
      }}
      onMouseDown={handleMouseDown}
      className="panel-hover"
    >
      {/* Panel Header */}
      <div
        style={{
          position: "relative",
          background: "rgba(255,255,255,0.05)",
          color: "#667eea",
          padding: "12px 16px",
          borderBottom: "1px solid rgba(102, 126, 234, 0.2)",
          fontSize: "14px",
          fontWeight: 600,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "grab",
          userSelect: "none",
        }}
        className="panel-header"
      >
        <span>{branch.title}</span>
        {panelId !== "main" && (
          <button
            onClick={handleClose}
            style={{
              background: "rgba(255, 71, 87, 0.1)",
              border: "1px solid rgba(255, 71, 87, 0.3)",
              color: "#ff4757",
              width: "24px",
              height: "24px",
              borderRadius: "50%",
              cursor: "pointer",
              fontSize: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s ease",
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Editor Section */}
        <div
          style={{
            flex: 2,
            padding: "20px 25px 25px 25px",
            borderRight: "1px solid #e9ecef",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {/* Auto Save Indicator */}
          <div
            id={`auto-save-${panelId}`}
            style={{
              position: "absolute",
              top: "12px",
              right: "15px",
              padding: "4px 8px",
              background: "#28a745",
              color: "white",
              borderRadius: "12px",
              fontSize: "10px",
              opacity: 0,
              transition: "opacity 0.3s ease",
              zIndex: 2,
            }}
          >
            Saved
          </div>

          {/* Editor Header */}
          <div
            style={{
              marginBottom: "20px",
              paddingBottom: "15px",
              borderBottom: "2px solid #f1f3f4",
            }}
          >
            <div
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "#2c3e50",
                marginBottom: "8px",
              }}
            >
              {branch.title}
            </div>
          </div>

          {/* Editor Content */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {branch.originalText && (
              <div
                style={{
                  background: "linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)",
                  padding: "15px",
                  borderLeft: "4px solid #2196f3",
                  marginBottom: "20px",
                  fontStyle: "italic",
                  borderRadius: "0 8px 8px 0",
                  color: "#1565c0",
                  fontSize: "14px",
                }}
              >
                "{branch.originalText}"
              </div>
            )}

            <div
              contentEditable={isEditable}
              suppressContentEditableWarning={true}
              data-panel={panelId}
              dangerouslySetInnerHTML={{ __html: branch.content }}
              style={{
                background: "#fafbfc",
                border: "1px solid #e1e8ed",
                borderRadius: "8px",
                padding: "20px",
                minHeight: "250px",
                fontFamily: "'Georgia', serif",
                lineHeight: 1.8,
                outline: "none",
                fontSize: "15px",
                color: "#2c3e50",
                resize: "none",
              }}
            />
          </div>
        </div>

        {/* Branches Section */}
        <div
          style={{
            flex: 1,
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            padding: "20px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Branches Header */}
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
                marginLeft: "auto",
                transition: "all 0.3s ease",
              }}
            >
              + Add
            </button>
          </div>

          {/* Filter Buttons */}
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
              >
                {filterType}
              </button>
            ))}
          </div>

          {/* Branch List */}
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
              filteredBranches.map((branchId) => {
                const childBranch = dataStore.get(branchId)
                if (!childBranch) return null

                const preview = childBranch.preview && childBranch.preview.trim()
                  ? childBranch.preview
                  : buildBranchPreview(childBranch.content, childBranch.originalText)

                const borderColors = {
                  note: "#64b5f6",
                  explore: "#ffb74d",
                  promote: "#81c784",
                }

                return (
                  <div
                    key={branchId}
                    onClick={() => openBranch(branchId)}
                    style={{
                      background: "rgba(255,255,255,0.15)",
                      backdropFilter: "blur(10px)",
                      borderRadius: "10px",
                      padding: "15px",
                      marginBottom: "12px",
                      cursor: "pointer",
                      transition: "all 0.3s ease",
                      borderLeft: `4px solid ${borderColors[childBranch.type as keyof typeof borderColors] || "rgba(255,255,255,0.5)"}`,
                    }}
                  >
                    <div
                      style={{
                        color: "white",
                        fontWeight: 600,
                        fontSize: "13px",
                        marginBottom: "6px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      {getTypeIcon(childBranch.type)} {childBranch.title}
                    </div>
                    <div
                      style={{
                        color: "rgba(255,255,255,0.85)",
                        fontSize: "12px",
                        lineHeight: 1.4,
                      }}
                    >
                      {preview}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Connection Points */}
      {panelId !== "main" && (
        <div
          style={{
            position: "absolute",
            left: "-6px",
            top: "50%",
            transform: "translateY(-50%)",
            width: "8px",
            height: "8px",
            background: "rgba(102, 126, 234, 0.6)",
            border: "2px solid rgba(255, 255, 255, 0.8)",
            borderRadius: "50%",
            opacity: 0,
            transition: "opacity 0.3s ease",
            zIndex: 5,
          }}
          className="connection-point input"
        />
      )}
      <div
        style={{
          position: "absolute",
          right: "-6px",
          top: "50%",
          transform: "translateY(-50%)",
          width: "8px",
          height: "8px",
          background: "rgba(102, 126, 234, 0.6)",
          border: "2px solid rgba(255, 255, 255, 0.8)",
          borderRadius: "50%",
          opacity: 0,
          transition: "opacity 0.3s ease",
          zIndex: 5,
        }}
        className="connection-point output"
      />

      <style jsx>{`
        .panel-hover:hover .connection-point {
          opacity: 0.8 !important;
        }
      `}</style>
    </div>
  )
}
