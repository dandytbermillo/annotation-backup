"use client"

/**
 * Dashboard Dock Component
 * iOS Control Center-style dock for the Entry Dashboard view.
 * Contains: Workspace button, Add Panel button
 * (Dashboard button is in the Canvas dock for returning from workspace view)
 */

import React, { forwardRef } from "react"
import { Plus } from "lucide-react"
import { ChatNavigationPanel } from "@/components/chat"

const Z_INDEX_DOCK = 99999

interface DashboardDockProps {
  /** Handler when workspace button is clicked (opens workspace panel) */
  onWorkspaceClick?: () => void
  /** Whether workspace panel is currently open */
  isWorkspacePanelOpen?: boolean
  /** Current workspace name for tooltip */
  currentWorkspaceName?: string
  /** Number of workspaces for badge */
  workspaceCount?: number
  /** Handler when add panel button is clicked */
  onAddPanelClick?: () => void
  /** Whether add panel is disabled */
  addPanelDisabled?: boolean
  /** Current entry ID for chat navigation context */
  currentEntryId?: string
  /** Current workspace ID for chat navigation context (when in workspace mode) */
  currentWorkspaceId?: string
  className?: string
}

export const DashboardDock = forwardRef<HTMLDivElement, DashboardDockProps>(
  function DashboardDock(
    {
      onWorkspaceClick,
      isWorkspacePanelOpen = false,
      currentWorkspaceName = "Workspace",
      workspaceCount = 0,
      onAddPanelClick,
      addPanelDisabled = false,
      currentEntryId,
      currentWorkspaceId,
      className,
    },
    ref
  ) {
    return (
      <div
        ref={ref}
        className={className}
        style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 8,
          borderRadius: 28,
          zIndex: Z_INDEX_DOCK,
          background: 'rgba(18, 18, 22, 0.85)',
          backdropFilter: 'blur(30px) saturate(180%)',
          WebkitBackdropFilter: 'blur(30px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Workspace Button */}
        <button
          data-workspace-toggle
          onClick={onWorkspaceClick}
          title={`Workspace: ${currentWorkspaceName}`}
          style={{
            position: 'relative',
            width: 48,
            height: 48,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease-out',
            border: '1px solid rgba(255,255,255,0.1)',
            background: isWorkspacePanelOpen
              ? 'rgb(99, 102, 241)'
              : 'rgba(39, 39, 42, 0.8)',
            color: 'white',
            boxShadow: isWorkspacePanelOpen
              ? '0 4px 20px rgba(99,102,241,0.4)'
              : 'none',
          }}
        >
          <span style={{ fontSize: 20 }}>🗂️</span>
          {/* Badge showing workspace count */}
          {workspaceCount > 1 && (
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                minWidth: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                padding: '0 6px',
                fontSize: 11,
                fontWeight: 700,
                background: isWorkspacePanelOpen ? 'white' : 'rgb(99, 102, 241)',
                color: isWorkspacePanelOpen ? 'rgb(99, 102, 241)' : 'white',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              {workspaceCount > 99 ? '99+' : workspaceCount}
            </span>
          )}
        </button>

        {/* Chat Navigation Button */}
        <ChatNavigationPanel
          currentEntryId={currentEntryId}
          currentWorkspaceId={currentWorkspaceId}
          trigger={
            <button
              data-chat-toggle
              title="Chat Navigation"
              style={{
                position: 'relative',
                width: 48,
                height: 48,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease-out',
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(39, 39, 42, 0.8)',
                color: 'white',
              }}
            >
              <span style={{ fontSize: 20 }}>💬</span>
            </button>
          }
        />

        {/* Add Panel Button */}
        <button
          data-add-panel-toggle
          onClick={onAddPanelClick}
          disabled={addPanelDisabled}
          title="Add Panel"
          style={{
            position: 'relative',
            width: 48,
            height: 48,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: addPanelDisabled ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease-out',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            color: 'white',
            opacity: addPanelDisabled ? 0.5 : 1,
            boxShadow: '0 4px 16px rgba(99, 102, 241, 0.3)',
          }}
        >
          <Plus size={22} strokeWidth={2.5} />
        </button>
      </div>
    )
  }
)

export default DashboardDock
